import { z } from 'zod';
import type { ToolDefinition } from '../llm/types.js';
import { getDocument, searchLibrary } from '../library/library.js';
import { MEMORY_TYPES, createMemory, formatMemory, getMemory, searchMemories, updateMemory } from '../memory.js';
import * as corpus from '../voynich/analysis.js';
import { getPage, corpusInfo, listPages } from '../voynich/corpus.js';
import { publish } from './bus.js';
import { fetchUrl, webSearch } from '../web/search.js';

export const TOOL_GROUPS = {
  library: 'Bibliothèque (recherche et lecture de documents)',
  memory: 'Mémoire partagée (lecture et écriture)',
  corpus: 'Corpus EVA (folios, recherche, statistiques)',
  substitution: 'Test de tables de substitution',
  collaboration: 'Consulter un autre agent (ask_agent)',
} as const;
export type ToolGroup = keyof typeof TOOL_GROUPS;

export interface ToolContext {
  sessionId: number;
  agentId: number;
  agentName: string;
  groups: ToolGroup[];
  /** Consultation d'un autre agent ; absent pour un agent déjà consulté (pas de récursion). */
  askAgent?: (name: string, question: string) => Promise<string>;
  otherAgents: string[];
  /** Outils internet génériques (modèles sans recherche web native). */
  genericWeb?: boolean;
}

function tool<S extends z.ZodType>(name: string, description: string, input: S, run: (i: z.infer<S>) => Promise<string> | string): ToolDefinition<z.infer<S>> {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(input) as Record<string, unknown>;
  return { name, description, input: input as z.ZodType<z.infer<S>>, jsonSchema, run };
}

const filterSchema = z
  .object({
    illustration: z.enum(['A', 'B', 'C', 'H', 'P', 'S', 'T', 'Z']).optional().describe('Section : H herbier, A astro, C cosmo, Z zodiaque, B biologique, P pharma, S recettes, T texte'),
    language: z.enum(['A', 'B']).optional().describe('Langue de Currier'),
    folios: z.array(z.string()).max(50).optional().describe('Liste de folios, ex. ["f1r","f1v"]'),
  })
  .optional();

const json = (v: unknown) => JSON.stringify(v, null, 1);

export function buildTools(ctx: ToolContext): ToolDefinition<any>[] {
  const tools: ToolDefinition<any>[] = [];
  const has = (g: ToolGroup) => ctx.groups.includes(g);

  if (has('library')) {
    tools.push(
      tool(
        'search_library',
        'Recherche plein texte dans la bibliothèque de documents (articles, livres, notes, transcriptions). Renvoie des extraits avec l’identifiant du document et la position.',
        z.object({ query: z.string().min(2).describe('Mots-clés'), limit: z.number().int().min(1).max(20).optional() }),
        ({ query, limit }) => {
          const hits = searchLibrary(query, limit ?? 8);
          if (!hits.length) return 'Aucun résultat dans la bibliothèque.';
          return hits.map((h) => `[doc #${h.document_id} « ${h.title} », offset ${h.start_offset}] ${h.snippet}`).join('\n\n');
        },
      ),
      tool(
        'read_document',
        'Lit un passage d’un document de la bibliothèque (texte extrait). Utiliser offset pour paginer.',
        z.object({
          document_id: z.number().int(),
          offset: z.number().int().min(0).optional(),
          length: z.number().int().min(200).max(20000).optional(),
        }),
        ({ document_id, offset, length }) => {
          const doc = getDocument(document_id);
          if (!doc) return `Document #${document_id} introuvable.`;
          if (doc.kind === 'image') return `Le document #${document_id} est une image (« ${doc.title} ») ; il est joint visuellement s’il fait partie du contexte de la séance. Notes : ${doc.notes ?? '—'}`;
          const start = offset ?? 0;
          const len = length ?? 6000;
          const slice = doc.content.slice(start, start + len);
          return `« ${doc.title} » (${doc.content.length} caractères, extrait ${start}–${start + slice.length})\n\n${slice}`;
        },
      ),
    );
  }

  if (has('memory')) {
    tools.push(
      tool(
        'search_memory',
        'Recherche dans la mémoire partagée de l’équipe (hypothèses, découvertes, faits, impasses, glossaire, questions, plans).',
        z.object({
          query: z.string().describe('Mots-clés (vide = éléments récents)'),
          type: z.enum(MEMORY_TYPES).optional(),
          include_inactive: z.boolean().optional().describe('Inclure les éléments réfutés/archivés'),
        }),
        ({ query, type, include_inactive }) => {
          const rows = searchMemories(query, { type, limit: 12, includeInactive: include_inactive });
          return rows.length ? rows.map(formatMemory).join('\n\n') : 'Aucun élément de mémoire correspondant.';
        },
      ),
      tool(
        'save_memory',
        'Enregistre un élément durable dans la mémoire partagée. À utiliser pour les résultats vérifiés, hypothèses testables, impasses, termes de glossaire, questions ouvertes et plans.',
        z.object({
          type: z.enum(MEMORY_TYPES),
          title: z.string().min(3).max(200),
          content: z.string().min(3).max(8000).describe('Énoncé précis, avec éléments de preuve / test'),
          confidence: z.number().min(0).max(1).describe('Confiance de 0 à 1'),
          tags: z.string().max(200).optional().describe('Étiquettes séparées par des virgules'),
        }),
        (i) => {
          const m = createMemory({ ...i, authorAgentId: ctx.agentId, authorLabel: ctx.agentName, sessionId: ctx.sessionId });
          publish(ctx.sessionId, { type: 'memory', memory: m });
          return `Enregistré sous #${m.id}.`;
        },
      ),
      tool(
        'update_memory',
        'Met à jour un élément de mémoire : changer son statut (confirmed, refuted, archived), sa confiance ou y ajouter un complément.',
        z.object({
          id: z.number().int(),
          status: z.enum(['active', 'confirmed', 'refuted', 'archived']).optional(),
          confidence: z.number().min(0).max(1).optional(),
          append: z.string().max(4000).optional().describe('Texte ajouté à la fin du contenu'),
        }),
        ({ id, status, confidence, append }) => {
          const cur = getMemory(id);
          if (!cur) return `Mémoire #${id} introuvable.`;
          const m = updateMemory(id, {
            status,
            confidence,
            content: append ? `${cur.content}\n\n— ${ctx.agentName} : ${append}` : undefined,
          });
          publish(ctx.sessionId, { type: 'memory', memory: m });
          return `Mémoire #${id} mise à jour.`;
        },
      ),
    );
  }

  if (has('corpus')) {
    const requireCorpus = () => {
      if (!corpus.corpusLoaded()) throw new Error('Aucun corpus EVA importé. Demandez au chercheur de l’importer (page Corpus).');
    };
    tools.push(
      tool(
        'corpus_info',
        'Informations sur la transcription EVA chargée et la liste des folios avec section et langue.',
        z.object({}),
        () => {
          requireCorpus();
          const pages = (listPages() as { folio: string; illustration: string | null; language: string | null; hand: string | null }[])
            .map((p) => `${p.folio}:${p.illustration ?? '?'}/${p.language ?? '?'}/${p.hand ?? '?'}`)
            .join(' ');
          return `${json(corpusInfo())}\n\nFolios (folio:section/langue/main) :\n${pages}`;
        },
      ),
      tool(
        'corpus_get_folio',
        'Renvoie la transcription EVA d’un folio (ex. "f1r", "f68r3"), ligne par ligne, avec ses métadonnées (section, langue, main).',
        z.object({ folio: z.string().regex(/^f\d+[rv]\d*$/) }),
        ({ folio }) => {
          requireCorpus();
          const p = getPage(folio);
          if (!p) return `Folio ${folio} introuvable.`;
          return `${json(p.page)}\n\n${(p.lines as { locus: string; text: string }[]).map((l) => `${l.locus}: ${l.text}`).join('\n')}`;
        },
      ),
      tool(
        'corpus_search',
        'Recherche un mot EVA exact ou une expression régulière JavaScript dans le corpus. Renvoie le nombre total d’occurrences et les lignes (locus).',
        z.object({
          pattern: z.string().min(1).max(200),
          regex: z.boolean().optional(),
          filter: filterSchema,
          limit: z.number().int().min(1).max(200).optional(),
        }),
        ({ pattern, regex, filter, limit }) => {
          requireCorpus();
          return json(corpus.search(pattern, { regex, filter, limit: limit ?? 40 }));
        },
      ),
      tool(
        'corpus_stats',
        'Statistiques sur le corpus ou un sous-corpus : overview (tokens, types, entropies h0/h1/h2, mots fréquents, longueurs), positional (glyphes en début/milieu/fin de mot), ngrams (caractères ou mots), compare (sous-corpus A vs B).',
        z.object({
          kind: z.enum(['overview', 'positional', 'ngrams', 'compare']),
          filter: filterSchema,
          n: z.number().int().min(1).max(5).optional().describe('Taille des n-grammes'),
          level: z.enum(['char', 'word']).optional(),
          compare_with: filterSchema.describe('Second sous-corpus pour kind=compare'),
          limit: z.number().int().min(5).max(200).optional(),
        }),
        ({ kind, filter, n, level, compare_with, limit }) => {
          requireCorpus();
          switch (kind) {
            case 'overview': {
              const o = corpus.overview(filter ?? {});
              return json({ ...o, zipf: o.zipf.slice(0, 20), topWords: o.topWords.slice(0, limit ?? 40) });
            }
            case 'positional':
              return json(corpus.positional(filter ?? {}).slice(0, limit ?? 40));
            case 'ngrams':
              return json(corpus.ngrams(n ?? 2, filter ?? {}, limit ?? 40, level ?? 'char'));
            case 'compare':
              return json(corpus.compare(filter ?? {}, compare_with ?? {}, limit ?? 25));
          }
        },
      ),
    );
  }

  if (has('substitution')) {
    tools.push(
      tool(
        'apply_substitution',
        'Teste une hypothèse de déchiffrement : applique une table de substitution (séquences EVA → lettres/syllabes) à un folio ou à un texte EVA. Les séquences les plus longues sont prioritaires. Renvoie le texte transformé et les glyphes non couverts.',
        z.object({
          mapping: z.record(z.string(), z.string()).describe('Ex. {"ch":"k","o":"a","aiin":"um"}'),
          folio: z.string().optional(),
          text: z.string().max(5000).optional(),
        }),
        ({ mapping, folio, text }) => {
          let source = text ?? '';
          if (folio) {
            requireCorpusFor(folio);
            source = corpus.folioText(folio).map((l) => l.text).join('\n');
          }
          if (!source) return 'Fournir folio ou text.';
          const lines = source.split('\n').map((l) => corpus.substitute(l, mapping));
          const unmapped: Record<string, number> = {};
          for (const l of lines) for (const [k, v] of Object.entries(l.unmapped)) unmapped[k] = (unmapped[k] ?? 0) + v;
          return `${lines.map((l) => l.output).join('\n')}\n\nGlyphes non couverts : ${json(unmapped)}`;
        },
      ),
    );
  }

  if (ctx.genericWeb) {
    tools.push(
      tool(
        'web_search',
        'Recherche sur internet. Renvoie une liste de résultats (titre, URL, extrait). Utiliser ensuite fetch_url pour lire une page.',
        z.object({ query: z.string().min(2).max(300), limit: z.number().int().min(1).max(10).optional() }),
        async ({ query, limit }) => {
          const { engine, results } = await webSearch(query, limit ?? 6);
          if (!results.length) return `Aucun résultat (${engine}).`;
          return `Moteur : ${engine}\n\n${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n')}`;
        },
      ),
      tool(
        'fetch_url',
        'Lit le texte d’une page web ou d’un PDF en ligne (URL publique http/https). Utiliser offset pour lire la suite.',
        z.object({ url: z.string().url(), offset: z.number().int().min(0).optional() }),
        async ({ url, offset }) => {
          const page = await fetchUrl(url);
          const start = offset ?? 0;
          const slice = page.text.slice(start, start + 15_000);
          return `« ${page.title || page.url} » — ${page.url}\n(${page.text.length} caractères, extrait ${start}–${start + slice.length})\n\n${slice}`;
        },
      ),
    );
  }

  if (has('collaboration') && ctx.askAgent && ctx.otherAgents.length) {
    const askAgent = ctx.askAgent;
    tools.push(
      tool(
        'ask_agent',
        `Pose une question précise à un autre agent de l’équipe et récupère sa réponse (il peut utiliser ses propres outils). Agents disponibles : ${ctx.otherAgents.join(', ')}.`,
        z.object({ agent: z.string(), question: z.string().min(5).max(6000) }),
        ({ agent, question }) => askAgent(agent, question),
      ),
    );
  }

  return tools;
}

function requireCorpusFor(folio: string) {
  if (!corpus.corpusLoaded()) throw new Error('Aucun corpus EVA importé.');
  if (!corpus.folioText(folio).length) throw new Error(`Folio ${folio} introuvable.`);
}
