import { allCorpusLines, wordsOf } from '../voynich/analysis.js';
import { counts } from './text.js';

interface PageInfo {
  folio: string;
  section: string | null;
  language: string | null;
  hand: string | null;
}

function pages() {
  const map = new Map<string, PageInfo & { words: string[] }>();
  for (const l of allCorpusLines()) {
    const p = map.get(l.folio) ?? { folio: l.folio, section: l.illustration, language: l.language, hand: l.hand, words: [] };
    p.words.push(...wordsOf([l]));
    map.set(l.folio, p);
  }
  return [...map.values()].filter((p) => p.words.length > 0);
}

/** Carte de chaleur glyphes × folios (fréquence relative de chaque glyphe par page). */
export function glyphHeatmap(topGlyphs = 22) {
  const ps = pages();
  const global = counts(ps.flatMap((p) => p.words.join('').split('')));
  const glyphs = [...global.entries()].sort((a, b) => b[1] - a[1]).slice(0, topGlyphs).map(([g]) => g);
  const matrix = ps.map((p) => {
    const c = counts(p.words.join('').split(''));
    const tot = [...c.values()].reduce((a, b) => a + b, 0) || 1;
    return glyphs.map((g) => Number(((c.get(g) ?? 0) / tot).toFixed(4)));
  });
  return { folios: ps.map(({ words: _w, ...info }) => info), glyphs, matrix };
}

/**
 * Carte des pages : chaque folio est un vecteur TF-IDF de ses mots ; on projette en 2D
 * (MDS classique sur la similarité cosinus). Des pages proches partagent leur vocabulaire.
 */
export function pageMap() {
  const ps = pages();
  const df = new Map<string, number>();
  for (const p of ps) for (const w of new Set(p.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const vocab = [...df.entries()].filter(([, d]) => d >= 3).map(([w]) => w);
  const vIdx = new Map(vocab.map((w, i) => [w, i]));
  const N = ps.length;
  const vecs = ps.map((p) => {
    const tf = counts(p.words.filter((w) => vIdx.has(w)));
    const v = new Map<number, number>();
    let norm = 0;
    for (const [w, c] of tf) {
      const x = (1 + Math.log(c)) * Math.log(N / (df.get(w) ?? 1));
      v.set(vIdx.get(w)!, x);
      norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [k, x] of v) v.set(k, x / norm);
    return v;
  });
  const G = Array.from({ length: N }, () => new Float64Array(N));
  for (let i = 0; i < N; i++)
    for (let j = i; j < N; j++) {
      let s = 0;
      const [a, b] = vecs[i].size < vecs[j].size ? [vecs[i], vecs[j]] : [vecs[j], vecs[i]];
      for (const [k, x] of a) s += x * (b.get(k) ?? 0);
      G[i][j] = G[j][i] = s;
    }
  // Double centrage puis deux premiers vecteurs propres (itération de la puissance + déflation).
  const rowMean = G.map((r) => r.reduce((a, b) => a + b, 0) / N);
  const all = rowMean.reduce((a, b) => a + b, 0) / N;
  const K = G.map((r, i) => Float64Array.from(r, (x, j) => x - rowMean[i] - rowMean[j] + all));
  const eig: { value: number; vector: Float64Array }[] = [];
  for (let e = 0; e < 2; e++) {
    let v = Float64Array.from({ length: N }, (_, i) => Math.sin(i + 1 + e));
    let lambda = 0;
    for (let it = 0; it < 200; it++) {
      const w = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let j = 0; j < N; j++) s += K[i][j] * v[j];
        w[i] = s;
      }
      for (const p of eig) {
        const d = w.reduce((a, x, i) => a + x * p.vector[i], 0);
        for (let i = 0; i < N; i++) w[i] -= d * p.vector[i];
      }
      const n = Math.sqrt(w.reduce((a, x) => a + x * x, 0)) || 1;
      lambda = n;
      v = w.map((x) => x / n);
    }
    eig.push({ value: lambda, vector: v });
  }
  const neighbours = G.map((row, i) =>
    [...row]
      .map((s, j) => ({ j, s }))
      .filter((x) => x.j !== i)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => ({ folio: ps[x.j].folio, similarity: Number(x.s.toFixed(3)) })),
  );
  return {
    points: ps.map((p, i) => ({
      folio: p.folio,
      section: p.section,
      language: p.language,
      hand: p.hand,
      words: p.words.length,
      x: eig[0].vector[i] * Math.sqrt(eig[0].value),
      y: eig[1].vector[i] * Math.sqrt(eig[1].value),
      neighbours: neighbours[i],
    })),
    vocabulary: vocab.length,
  };
}

/** Répartition d'un mot (ou d'un motif) le long du manuscrit. */
export function dispersion(pattern: string, regex = false) {
  let re: RegExp;
  if (regex) {
    if (pattern.length > 100) throw new Error('Motif trop long');
    re = new RegExp(`^(?:${pattern})$`);
  } else re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const hits: number[] = [];
  const folios: { folio: string; start: number; section: string | null; language: string | null }[] = [];
  let i = 0;
  let current = '';
  for (const l of allCorpusLines()) {
    if (l.folio !== current) {
      folios.push({ folio: l.folio, start: i, section: l.illustration, language: l.language });
      current = l.folio;
    }
    for (const w of wordsOf([l], false)) {
      if (re.test(w)) hits.push(i);
      i++;
    }
  }
  return { pattern, total: i, hits, folios };
}
