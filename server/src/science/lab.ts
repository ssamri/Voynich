import { z } from 'zod';
import { hmm, keywords, lineEffects, similarWords, sukhotin, wordStructure } from './algorithms.js';
import { anneal } from './anneal.js';
import { listCribs, testCribs } from './cribs.js';
import { DEFAULT_CRITERIA, evaluateDecipherment, type Criteria } from './evaluate.js';
import { getExperiment, runExperiment, type Author } from './experiments.js';
import { compareFingerprints } from './fingerprint.js';
import { runSandbox } from './sandbox.js';
import { fingerprintFor, listRefs, parseVoynichSource, tokensFor } from './sources.js';

/**
 * Point d'entrée unique du laboratoire : chaque analyse est validée, exécutée
 * et consignée dans le journal d'expériences (rejouable à l'identique).
 */
const source = z.string().default('voynich').describe('« voynich », « voynich:lang:A », « voynich:section:H », « voynich:hand:1 » ou « ref:<id> »');
const alphabet = z.enum(['eva', 'eva-grouped']).optional().describe('eva = glyphe par glyphe ; eva-grouped = ch, sh, cth, iin… comptés comme un seul signe');
const region = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1) });

export const LAB_SCHEMAS = {
  fingerprint: z.object({ target: source, references: z.array(z.string()).max(40).optional().describe('Sources à comparer ; par défaut tous les corpus de référence + langues A/B') }),
  evaluate: z.object({
    mapping: z.record(z.string(), z.string()).optional(),
    glossary: z.record(z.string(), z.string()).optional(),
    language_ref_id: z.number().int(),
    source: source.optional(),
    max_words: z.number().int().min(100).max(20000).optional(),
    baseline_runs: z.number().int().min(20).max(500).optional(),
    seed: z.number().int().optional(),
  }),
  anneal: z.object({
    language_ref_id: z.number().int(),
    source: source.optional(),
    alphabet,
    iterations: z.number().int().min(500).max(60000).optional(),
    restarts: z.number().int().min(1).max(8).optional(),
    max_words: z.number().int().min(100).max(5000).optional(),
    fixed: z.record(z.string(), z.string()).optional().describe('Correspondances imposées (ex. issues des indices)'),
    use_cribs: z.boolean().optional(),
    control_sources: z.array(z.string()).max(5).optional().describe('Contrôles supplémentaires optimisés de la même façon, ex. ["ref:2","ref:3"] (textes générés, autres langues chiffrées)'),
    seed: z.number().int().optional(),
  }),
  sukhotin: z.object({ source: source.optional(), alphabet }),
  hmm: z.object({ source: source.optional(), alphabet, states: z.number().int().min(2).max(6).optional(), iterations: z.number().int().min(5).max(100).optional(), seed: z.number().int().optional() }),
  word_structure: z.object({ source: source.optional(), alphabet }),
  keywords: z.object({ source: source.optional(), parts: z.number().int().min(8).max(256).optional(), min_freq: z.number().int().min(3).optional(), seed: z.number().int().optional() }),
  similar_words: z.object({ word: z.string().min(1), source: source.optional(), window: z.number().int().min(1).max(5).optional() }),
  line_effects: z.object({ source: source.optional() }),
  code: z.object({ code: z.string().min(1).max(20000), refs: z.array(z.number().int()).max(5).optional(), timeout_ms: z.number().int().min(500).max(15000).optional() }),
  cribs: z.object({ mapping: z.record(z.string(), z.string()), crib_ids: z.array(z.number().int()).optional() }),
};
export type LabKind = keyof typeof LAB_SCHEMAS;
export const REGION = region;

const TITLES: Record<LabKind, string> = {
  fingerprint: 'Comparaison d’empreintes statistiques',
  evaluate: 'Évaluation d’un déchiffrement (juge)',
  anneal: 'Recherche automatique de clé (recuit simulé)',
  sukhotin: 'Algorithme de Sukhotin',
  hmm: 'Modèle de Markov caché',
  word_structure: 'Structure interne des mots',
  keywords: 'Mots-clés par concentration',
  similar_words: 'Mots aux contextes similaires',
  line_effects: 'Effets de ligne et de paragraphe',
  code: 'Calcul libre (bac à sable)',
  cribs: 'Test d’une clé sur les indices',
};

function voynichFilter(src: string | undefined) {
  const f = parseVoynichSource(src ?? 'voynich');
  if (!f) throw new Error('Cette analyse porte sur le corpus Voynich (source « voynich… »).');
  return f;
}

export async function runLab(kind: LabKind, rawParams: unknown, author: Author & { title?: string; experimentId?: number | null } = {}) {
  const params = LAB_SCHEMAS[kind].parse(rawParams) as Record<string, any>;
  const seed = typeof params.seed === 'number' ? params.seed : null;
  return runExperiment<unknown>({ kind, title: author.title ?? TITLES[kind], params, seed, ...author }, async (criteria) => {
    switch (kind) {
      case 'fingerprint': {
        const target = { id: params.target, name: tokensFor(params.target).name, fp: fingerprintFor(params.target) };
        const refIds: string[] = params.references ?? [
          ...listRefs().map((r) => `ref:${r.id}`),
          ...['voynich:lang:A', 'voynich:lang:B'].filter((s) => s !== params.target),
        ];
        const refs = refIds.filter((r) => r !== params.target).map((id) => {
          const t = tokensFor(id);
          return { id, name: t.name, kind: t.kind, fp: fingerprintFor(id) };
        });
        if (!refs.length) throw new Error('Aucun corpus de comparaison : ajoutez des corpus de référence (page Laboratoire).');
        const cmp = compareFingerprints(target, refs);
        const result = { target: target.fp, comparison: cmp, references: Object.fromEntries(refs.map((r) => [r.id, r.fp])) };
        return {
          result,
          summary: `Plus proches de ${target.name} : ${cmp.ranking.slice(0, 4).map((r) => `${r.name} (${r.distance.toFixed(2)})`).join(', ')}.`,
        };
      }
      case 'evaluate': {
        const c: Criteria = { ...DEFAULT_CRITERIA, ...(criteria ?? {}) };
        const out = evaluateDecipherment(
          {
            mapping: params.mapping,
            glossary: params.glossary,
            languageRefId: params.language_ref_id,
            source: params.source,
            maxWords: params.max_words,
            baselineRuns: params.baseline_runs,
            seed: params.seed,
          },
          c,
        );
        return out;
      }
      case 'anneal': {
        const cribs = params.use_cribs ? listCribs().map((c) => ({ eva: c.eva, expected: c.expected, weight: c.confidence })) : [];
        const r = anneal({
          tokens: tokensFor(params.source ?? 'voynich').tokens,
          languageRefId: params.language_ref_id,
          alphabet: params.alphabet,
          iterations: params.iterations,
          restarts: params.restarts,
          maxWords: params.max_words,
          fixed: params.fixed,
          cribs,
          seed: params.seed,
          controlSources: (params.control_sources ?? []).map((src: string) => {
            const t = tokensFor(src);
            return { name: t.name, tokens: t.tokens };
          }),
        });
        return {
          result: r,
          summary: `${r.bitsPerChar.toFixed(2)} bits/car (mélangé ${r.controlBitsPerChar?.toFixed(2) ?? '—'}${r.extraControls.map((e) => `, ${e.name} ${e.bitsPerChar.toFixed(2)}`).join('')} ; langue réelle ${r.referenceBitsPerChar.toFixed(2)}). ${r.interpretation}`,
          // Une recherche de clé ne « prouve » jamais rien seule : au mieux non concluante, à confirmer par le juge.
          verdict: r.signalGap !== null && r.signalGap <= 0.3 ? 'fail' : 'inconclusive',
        };
      }
      case 'sukhotin': {
        const r = sukhotin(tokensFor(params.source ?? 'voynich').tokens, params.alphabet);
        return { result: r, summary: `Voyelles probables : ${r.vowels.map((v) => v.symbol).join(' ')}` };
      }
      case 'hmm': {
        const r = hmm(tokensFor(params.source ?? 'voynich').tokens, { states: params.states, iterations: params.iterations, alphabet: params.alphabet, seed: params.seed });
        const groups = Array.from({ length: r.states }, (_, s) => r.classes.filter((c) => c.state === s).map((c) => c.symbol).join(' '));
        return { result: r, summary: groups.map((g, i) => `état ${i} : ${g}`).join(' | ') };
      }
      case 'word_structure': {
        const r = wordStructure(tokensFor(params.source ?? 'voynich').tokens, params.alphabet);
        return { result: r, summary: `Ordres stricts : ${r.strictOrder.slice(0, 6).map((o) => `${o.a}<${o.b} (${Math.round(o.consistency * 100)} %)`).join(', ')}` };
      }
      case 'keywords': {
        const r = keywords({ filter: voynichFilter(params.source), parts: params.parts, minFreq: params.min_freq, seed: params.seed });
        return { result: r, summary: `Mots les plus concentrés : ${r.keywords.slice(0, 10).map((k) => k.word).join(', ')}` };
      }
      case 'similar_words': {
        const r = similarWords(params.word, { filter: voynichFilter(params.source), window: params.window });
        return { result: r, summary: `Voisins de ${params.word} : ${r.neighbours.slice(0, 8).map((n) => n.word).join(', ')}` };
      }
      case 'line_effects': {
        const r = lineEffects(voynichFilter(params.source));
        return {
          result: r,
          summary: `Début de ligne : ${r.lineInitialGlyphs.slice(0, 4).map((g) => `${g.glyph}×${g.overrepresentation.toFixed(1)}`).join(', ')} ; fin : ${r.lineFinalGlyphs.slice(0, 4).map((g) => `${g.glyph}×${g.overrepresentation.toFixed(1)}`).join(', ')}`,
        };
      }
      case 'code': {
        const r = await runSandbox(params.code, { refs: params.refs, timeoutMs: params.timeout_ms });
        return { result: r, summary: r.ok ? `OK en ${r.durationMs} ms` : `Erreur : ${r.error}` };
      }
      case 'cribs': {
        const r = testCribs(params.mapping, params.crib_ids);
        return { result: r, summary: `${r.exactMatches}/${r.cribs} indices exacts, similarité pondérée ${(r.weightedSimilarity * 100).toFixed(0)} %` };
      }
    }
  });
}

/** Rejoue une expérience avec les mêmes paramètres (et la même graine) : vérifie une affirmation. */
export async function replayExperiment(id: number, author: Author = {}) {
  const e = getExperiment(id);
  if (!e) throw new Error(`Expérience #${id} introuvable`);
  if (!(e.kind in LAB_SCHEMAS)) throw new Error(`Type d’expérience non rejouable : ${e.kind}`);
  const replay = await runLab(e.kind as LabKind, JSON.parse(e.params), { ...author, title: `Réplication de #${id} — ${e.title}` });
  const same = JSON.stringify(replay.result) === e.result;
  return {
    original: { id, summary: e.summary, verdict: e.verdict, corpusVersion: e.corpus_version },
    replay: { id: replay.id, summary: replay.summary, verdict: replay.verdict ?? null },
    identical: same,
  };
}
