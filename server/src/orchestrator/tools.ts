import { z } from 'zod';
import type { ToolDefinition, ToolOutput } from '../llm/types.js';
import { getDocument, searchLibrary } from '../library/library.js';
import { MEMORY_TYPES, createMemory, formatMemory, getMemory, searchMemories, setEvidence, updateMemory } from '../memory.js';
import * as corpus from '../voynich/analysis.js';
import { getPage, corpusInfo, listPages } from '../voynich/corpus.js';
import { publish } from './bus.js';
import { fetchUrl, webSearch } from '../web/search.js';
import { LAB_SCHEMAS, REGION, replayExperiment, runLab, type LabKind } from '../science/lab.js';
import { getExperiment, registerTest } from '../science/experiments.js';
import { DEFAULT_CRITERIA } from '../science/evaluate.js';
import { listRefs } from '../science/sources.js';
import { addCrib, cribConstraints, listCribs } from '../science/cribs.js';
import { addAnnotation, folioImage, listAnnotations } from '../science/iiif.js';

export const TOOL_GROUPS = {
  library: 'Bibliothèque (recherche et lecture de documents)',
  memory: 'Mémoire partagée (lecture et écriture)',
  corpus: 'Corpus EVA (folios, recherche, statistiques)',
  substitution: 'Test de tables de substitution',
  collaboration: 'Consulter un autre agent (ask_agent)',
  science: 'Laboratoire : juge, recherche de clé, algorithmes, corpus de référence, calcul, indices',
  images: 'Images du manuscrit (vision) et annotations',
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

function tool<S extends z.ZodType>(name: string, description: string, input: S, run: (i: z.infer<S>) => Promise<string | ToolOutput> | string | ToolOutput): ToolDefinition<z.infer<S>> {
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
        'Enregistre un élément durable dans la mémoire partagée. Pour une découverte (finding) ou un fait (fact), la preuve est OBLIGATOIRE : numéro d’expérience (#E12), URL, document de la bibliothèque (doc #3) ou référence bibliographique [Auteur, année].',
        z.object({
          type: z.enum(MEMORY_TYPES),
          title: z.string().min(3).max(200),
          content: z.string().min(3).max(8000).describe('Énoncé précis, avec éléments de preuve / test'),
          confidence: z.number().min(0).max(1).describe('Confiance de 0 à 1'),
          evidence: z.string().max(2000).optional().describe('Preuves : #E<n>, URL, doc #<n>, [Auteur, année]'),
          tags: z.string().max(200).optional().describe('Étiquettes séparées par des virgules'),
        }),
        (i) => {
          if ((i.type === 'finding' || i.type === 'fact') && !hasEvidence(i.evidence)) {
            throw new Error('Preuve manquante : citez une expérience (#E12), une URL, un document (doc #3) ou une référence [Auteur, année].');
          }
          const m = createMemory({ ...i, authorAgentId: ctx.agentId, authorLabel: ctx.agentName, sessionId: ctx.sessionId });
          publish(ctx.sessionId, { type: 'memory', memory: m });
          return `Enregistré sous #${m.id}.`;
        },
      ),
      tool(
        'update_memory',
        'Met à jour un élément de mémoire : statut (confirmed, refuted, archived), confiance ou complément. Passer une hypothèse en « confirmed » exige une expérience du juge au verdict PASS (#E<n>).',
        z.object({
          id: z.number().int(),
          status: z.enum(['active', 'confirmed', 'refuted', 'archived']).optional(),
          confidence: z.number().min(0).max(1).optional(),
          append: z.string().max(4000).optional().describe('Texte ajouté à la fin du contenu'),
          evidence: z.string().max(2000).optional().describe('Preuves justifiant le changement (#E<n>, URL…)'),
        }),
        ({ id, status, confidence, append, evidence }) => {
          const cur = getMemory(id);
          if (!cur) return `Mémoire #${id} introuvable.`;
          if (status === 'confirmed' && cur.type === 'hypothesis') {
            const passing = experimentIds(evidence).map(getExperiment).filter((e) => e?.verdict === 'pass');
            if (!passing.length) throw new Error('Confirmation refusée : il faut une expérience du juge avec le verdict PASS (evaluate_decipherment), citée comme #E<n>.');
          }
          if ((status === 'confirmed' || status === 'refuted') && !hasEvidence(evidence)) {
            throw new Error('Preuve manquante pour changer le statut (#E<n>, URL, doc #n ou [Auteur, année]).');
          }
          const m = updateMemory(id, {
            status,
            confidence,
            content: append || evidence ? `${cur.content}${append ? `\n\n— ${ctx.agentName} : ${append}` : ''}${evidence ? `\n\nPreuve (${ctx.agentName}) : ${evidence}` : ''}` : undefined,
          });
          if (evidence) setEvidence(id, evidence);
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

  if (has('science')) {
    const author = { sessionId: ctx.sessionId, agentId: ctx.agentId, authorLabel: ctx.agentName };
    const lab = (kind: LabKind, description: string) =>
      tool(kind === 'code' ? 'run_code' : kind === 'cribs' ? 'test_cribs' : kind === 'evaluate' ? 'evaluate_decipherment' : kind === 'anneal' ? 'anneal_substitution' : kind === 'fingerprint' ? 'compare_fingerprints' : `algo_${kind}`, description,
        kind === 'evaluate' ? LAB_SCHEMAS.evaluate.extend({ test_id: z.number().int().optional().describe('Test pré-enregistré (register_test)') }) : LAB_SCHEMAS[kind],
        async (params: Record<string, unknown>) => {
          const { test_id, ...rest } = params as { test_id?: number };
          const r = await runLab(kind, rest, { ...author, experimentId: test_id ?? null });
          return `Expérience #E${r.id}${r.verdict ? ` — verdict ${String(r.verdict).toUpperCase()}` : ''}\n${r.summary}\n\n${JSON.stringify(r.result, null, 1).slice(0, 12000)}`;
        });
    tools.push(
      tool('list_reference_corpora', 'Liste les corpus de comparaison (langues naturelles, chiffres, textes générés) avec leur identifiant « ref:<id> ».', z.object({}), () => {
        const refs = listRefs();
        return refs.length ? refs.map((r) => `ref:${r.id} — ${r.name} [${r.kind}${r.language ? `, ${r.language}` : ''}] ${r.tokens} mots`).join('\n') : 'Aucun corpus de référence : demandez au chercheur d’en ajouter (page Laboratoire).';
      }),
      lab('fingerprint', 'Compare l’empreinte statistique (entropies, longueurs, Zipf, positions, répétitions…) d’un texte avec des langues réelles, des chiffres et des textes générés. Élimine des familles d’hypothèses.'),
      tool(
        'register_test',
        'Pré-enregistre un test AVANT de l’exécuter : les critères de réussite sont figés. Renvoie un numéro à passer ensuite à evaluate_decipherment (test_id).',
        z.object({
          title: z.string().min(5).max(200),
          hypothesis: z.string().min(5).max(3000),
          min_coverage: z.number().min(0).max(1).optional(),
          min_percentile: z.number().min(0.5).max(1).optional(),
          min_dictionary_rate: z.number().min(0).max(1).optional(),
        }),
        (i) => {
          const criteria = {
            minCoverage: i.min_coverage ?? DEFAULT_CRITERIA.minCoverage,
            minPercentile: i.min_percentile ?? DEFAULT_CRITERIA.minPercentile,
            minDictionaryRate: i.min_dictionary_rate ?? DEFAULT_CRITERIA.minDictionaryRate,
          };
          const id = registerTest({ kind: 'evaluate', title: i.title, criteria, params: { hypothesis: i.hypothesis }, ...author });
          return `Test pré-enregistré #E${id} avec critères ${JSON.stringify(criteria)}. Exécutez-le avec evaluate_decipherment(test_id: ${id}).`;
        },
      ),
      lab('evaluate', 'LE JUGE. Note une hypothèse de déchiffrement (table de substitution ou glossaire mot à mot) : couverture, plausibilité linguistique, mots du dictionnaire, comparaison à des tables aléatoires. Verdict PASS / FAIL / INCONCLUSIVE.'),
      lab('anneal', 'Recherche automatiquement la meilleure clé de substitution vers une langue cible (recuit simulé) ET la même recherche sur un texte de contrôle mélangé : seul un écart net avec le contrôle est un signal.'),
      lab('sukhotin', 'Algorithme de Sukhotin : identifie les symboles qui se comportent comme des voyelles.'),
      lab('hmm', 'Modèle de Markov caché : regroupe les symboles en classes selon leur comportement.'),
      lab('word_structure', 'Structure des mots : préfixes, suffixes, positions préférées, ordre relatif strict des glyphes (grammaire à cases).'),
      lab('keywords', 'Mots-clés par concentration (Montemurro & Zanette) : mots groupés dans certaines parties du manuscrit, avec leur section dominante.'),
      lab('similar_words', 'Mots aux contextes similaires (vecteurs de co-occurrence) : variantes, synonymes ou mots d’une même catégorie.'),
      lab('line_effects', 'Effets de position : glyphes et mots propres au début / fin de ligne, première ligne des paragraphes.'),
      lab('code', 'Exécute du JavaScript dans un bac à sable isolé. Données : VOYNICH (lignes {folio, locus, text, section, language, hand}), fonctions lines(filtre), words(filtre), freq(tableau), entropy(tableau), refWords(id) pour les corpus passés dans refs. Utiliser console.log et/ou return.'),
      tool('replay_experiment', 'Rejoue une expérience avec les mêmes paramètres pour vérifier un résultat annoncé (reproductibilité).', z.object({ id: z.number().int() }), async ({ id }) => JSON.stringify(await replayExperiment(id, author), null, 1)),
      tool('get_experiment', 'Affiche une expérience du journal (paramètres, critères, résultat).', z.object({ id: z.number().int() }), ({ id }) => {
        const e = getExperiment(id);
        return e ? JSON.stringify({ ...e, params: JSON.parse(e.params), result: e.result ? JSON.parse(e.result) : null }, null, 1).slice(0, 15000) : `Expérience #${id} introuvable.`;
      }),
      tool('list_cribs', 'Liste les indices (mots EVA dont on soupçonne le sens : mois du zodiaque, plantes, étoiles…).', z.object({}), () => {
        const c = listCribs();
        return c.length ? c.map((x) => `#${x.id} ${x.eva} → « ${x.expected} » (${x.language ?? '?'}, ${x.category ?? '?'}, confiance ${x.confidence}) ${x.folio ?? ''} ${x.source ? `— ${x.source}` : ''}`).join('\n') : 'Aucun indice enregistré.';
      }),
      tool(
        'add_crib',
        'Ajoute un indice. La source est obligatoire (publication, étiquette visible, raisonnement iconographique).',
        z.object({
          eva: z.string().min(1).max(60),
          expected: z.string().min(1).max(60),
          language: z.string().max(40).optional(),
          category: z.enum(['zodiaque', 'plante', 'étoile', 'autre']).optional(),
          folio: z.string().optional(),
          locus: z.string().optional(),
          source: z.string().min(3).max(500),
          confidence: z.number().min(0).max(1),
        }),
        (i) => `Indice #${addCrib({ ...i, authorLabel: ctx.agentName })} enregistré.`,
      ),
      lab('cribs', 'Applique une table de substitution aux indices et mesure la concordance.'),
      tool('crib_constraints', 'Déduit des indices les correspondances glyphe → lettre imposées (hypothèse de substitution simple) et signale les conflits.', z.object({ alphabet: z.enum(['eva', 'eva-grouped']).optional() }), ({ alphabet }) =>
        JSON.stringify(cribConstraints(alphabet), null, 1),
      ),
    );
  }

  if (has('images')) {
    tools.push(
      tool(
        'view_folio_image',
        'Affiche l’image d’un folio du manuscrit (ou une zone, coordonnées relatives 0–1) pour l’examiner visuellement.',
        z.object({ folio: z.string().regex(/^f\d+[rv]\d*$/), region: REGION.optional(), size: z.number().int().min(400).max(2000).optional() }),
        async ({ folio, region, size }) => {
          const img = await folioImage(folio, { region, size: size ?? 1400 });
          const notes = listAnnotations(folio);
          return {
            text: `Image de ${folio}${region ? ` (zone ${JSON.stringify(region)})` : ''}.${notes.length ? `\nAnnotations : ${notes.map((n) => `[${n.kind}] ${n.title ?? ''} (${n.x.toFixed(2)},${n.y.toFixed(2)}) ${n.locus ?? ''}`).join(' ; ')}` : ''}`,
            images: [{ mediaType: img.mediaType, data: img.data.toString('base64') }],
          };
        },
      ),
      tool('list_annotations', 'Liste les annotations d’images (étiquettes reliées aux lignes de transcription, plantes, étoiles…).', z.object({ folio: z.string().optional() }), ({ folio }) => {
        const a = listAnnotations(folio);
        return a.length ? a.map((n) => `#${n.id} ${n.folio} [${n.kind}] ${n.title ?? ''} — ${n.note ?? ''} ${n.locus ? `(ligne ${n.locus})` : ''} zone (${n.x.toFixed(2)},${n.y.toFixed(2)},${n.w.toFixed(2)},${n.h.toFixed(2)})`).join('\n') : 'Aucune annotation.';
      }),
      tool(
        'add_annotation',
        'Annote une zone d’un folio (coordonnées relatives 0–1) : étiquette, plante, étoile, nymphe, signe du zodiaque…',
        z.object({
          folio: z.string().regex(/^f\d+[rv]\d*$/),
          region: REGION,
          kind: z.enum(['label', 'plant', 'star', 'nymph', 'zodiac', 'diagram', 'other']),
          title: z.string().max(200),
          note: z.string().max(3000).optional(),
          locus: z.string().max(40).optional().describe('Ligne de transcription reliée, ex. f67r1.12'),
        }),
        (i) => `Annotation #${addAnnotation({ folio: i.folio, ...i.region, kind: i.kind, title: i.title, note: i.note ?? null, locus: i.locus ?? null, author_label: ctx.agentName })} ajoutée.`,
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

const EVIDENCE = /#E\d+|https?:\/\/\S+|doc\s*#\d+|\[[^\]]+,\s*\d{4}[^\]]*\]/i;
function hasEvidence(e?: string) {
  return Boolean(e && EVIDENCE.test(e));
}
function experimentIds(e?: string) {
  return [...(e ?? '').matchAll(/#E(\d+)/g)].map((m) => Number(m[1]));
}
