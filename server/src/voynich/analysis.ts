import { db } from '../db.js';

export interface CorpusFilter {
  illustration?: string;
  language?: string;
  hand?: string;
  folios?: string[];
  /** Exclut les mots contenant des glyphes illisibles (? ou *). */
  cleanOnly?: boolean;
}

interface LineRow {
  folio: string;
  locus: string;
  text: string;
  illustration: string | null;
  language: string | null;
  hand: string | null;
}

let lineCache: LineRow[] | null = null;
const analysisCache = new Map<string, unknown>();

export function invalidateCorpusCache() {
  lineCache = null;
  analysisCache.clear();
}

function allLines(): LineRow[] {
  if (!lineCache) {
    lineCache = db
      .prepare(
        `SELECT l.folio, l.locus, l.text, p.illustration, p.language, p.hand
         FROM corpus_lines l LEFT JOIN corpus_pages p ON p.folio = l.folio ORDER BY l.ord`,
      )
      .all() as LineRow[];
  }
  return lineCache;
}

export function selectLines(f: CorpusFilter = {}) {
  const folios = f.folios?.length ? new Set(f.folios) : null;
  return allLines().filter(
    (l) =>
      (!f.illustration || l.illustration === f.illustration) &&
      (!f.language || l.language === f.language) &&
      (!f.hand || l.hand === f.hand) &&
      (!folios || folios.has(l.folio)),
  );
}

export function wordsOf(lines: { text: string }[], cleanOnly = true): string[] {
  const out: string[] = [];
  for (const l of lines) {
    for (const w of l.text.split(' ')) {
      if (!w) continue;
      if (cleanOnly && /[?*]/.test(w)) continue;
      out.push(w);
    }
  }
  return out;
}

function counts<T>(items: Iterable<T>) {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

function top<T>(m: Map<T, number>, n: number) {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function entropy(m: Map<unknown, number>) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  let h = 0;
  for (const c of m.values()) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Entropies caractère : h0 (log2 alphabet), h1 (unigrammes), h2 (conditionnelle bigrammes). */
export function characterEntropy(text: string) {
  const chars = [...text];
  const uni = counts(chars);
  const bi = new Map<string, number>();
  for (let i = 0; i < chars.length - 1; i++) {
    const k = chars[i] + chars[i + 1];
    bi.set(k, (bi.get(k) ?? 0) + 1);
  }
  const h1 = entropy(uni);
  const hBi = entropy(bi);
  return {
    alphabet: uni.size,
    h0: Math.log2(Math.max(uni.size, 1)),
    h1,
    h2: hBi - h1,
    length: chars.length,
  };
}

function cached<T>(key: string, fn: () => T): T {
  if (analysisCache.has(key)) return analysisCache.get(key) as T;
  const v = fn();
  analysisCache.set(key, v);
  return v;
}

export function overview(f: CorpusFilter = {}) {
  return cached(`overview:${JSON.stringify(f)}`, () => {
    const lines = selectLines(f);
    const words = wordsOf(lines, f.cleanOnly ?? true);
    const wf = counts(words);
    const joined = words.join(' ');
    const letters = [...joined.replace(/ /g, '')];
    const cf = counts(letters);
    const lengths = counts(words.map((w) => w.length));
    const hapax = [...wf.values()].filter((c) => c === 1).length;
    const zipf = top(wf, 500).map(([, c], i) => ({ rank: i + 1, freq: c }));
    return {
      lines: lines.length,
      folios: new Set(lines.map((l) => l.folio)).size,
      tokens: words.length,
      types: wf.size,
      hapax,
      typeTokenRatio: words.length ? wf.size / words.length : 0,
      meanWordLength: words.length ? letters.length / words.length : 0,
      entropy: characterEntropy(joined.replace(/ /g, '_')),
      topWords: top(wf, 60).map(([word, count]) => ({ word, count })),
      characters: top(cf, 40).map(([char, count]) => ({ char, count })),
      wordLengths: [...lengths.entries()].sort((a, b) => a[0] - b[0]).map(([length, count]) => ({ length, count })),
      zipf,
    };
  });
}

/** Distribution positionnelle : fréquence de chaque glyphe en début, milieu et fin de mot. */
export function positional(f: CorpusFilter = {}) {
  return cached(`positional:${JSON.stringify(f)}`, () => {
    const words = wordsOf(selectLines(f));
    const stats = new Map<string, { initial: number; medial: number; final: number }>();
    const bump = (c: string, k: 'initial' | 'medial' | 'final') => {
      const s = stats.get(c) ?? { initial: 0, medial: 0, final: 0 };
      s[k]++;
      stats.set(c, s);
    };
    for (const w of words) {
      const chars = [...w];
      chars.forEach((c, i) => bump(c, i === 0 ? 'initial' : i === chars.length - 1 ? 'final' : 'medial'));
    }
    return [...stats.entries()]
      .map(([char, s]) => ({ char, ...s, total: s.initial + s.medial + s.final }))
      .sort((a, b) => b.total - a.total);
  });
}

export function ngrams(n: number, f: CorpusFilter = {}, limit = 50, level: 'char' | 'word' = 'char') {
  return cached(`ngrams:${n}:${level}:${limit}:${JSON.stringify(f)}`, () => {
    const lines = selectLines(f);
    const m = new Map<string, number>();
    if (level === 'word') {
      for (const l of lines) {
        const w = l.text.split(' ').filter(Boolean);
        for (let i = 0; i + n <= w.length; i++) {
          const k = w.slice(i, i + n).join(' ');
          m.set(k, (m.get(k) ?? 0) + 1);
        }
      }
    } else {
      for (const w of wordsOf(lines)) {
        const s = `_${w}_`;
        for (let i = 0; i + n <= s.length; i++) {
          const k = s.slice(i, i + n);
          m.set(k, (m.get(k) ?? 0) + 1);
        }
      }
    }
    return top(m, limit).map(([gram, count]) => ({ gram, count }));
  });
}

/** Compare les fréquences relatives de mots entre deux sous-corpus (ex. langue A vs B). */
export function compare(a: CorpusFilter, b: CorpusFilter, limit = 40) {
  const wa = counts(wordsOf(selectLines(a)));
  const wb = counts(wordsOf(selectLines(b)));
  const ta = [...wa.values()].reduce((x, y) => x + y, 0) || 1;
  const tb = [...wb.values()].reduce((x, y) => x + y, 0) || 1;
  const all = new Set([...wa.keys(), ...wb.keys()]);
  const rows = [...all]
    .map((word) => {
      const fa = (wa.get(word) ?? 0) / ta;
      const fb = (wb.get(word) ?? 0) / tb;
      // log-ratio lissé
      const score = Math.log2((fa + 1e-5) / (fb + 1e-5));
      return { word, a: wa.get(word) ?? 0, b: wb.get(word) ?? 0, score };
    })
    .filter((r) => r.a + r.b >= 5);
  rows.sort((x, y) => y.score - x.score);
  return { tokensA: ta, tokensB: tb, moreInA: rows.slice(0, limit), moreInB: rows.slice(-limit).reverse() };
}

export function search(pattern: string, opts: { regex?: boolean; filter?: CorpusFilter; limit?: number } = {}) {
  const lines = selectLines(opts.filter);
  const limit = Math.min(opts.limit ?? 100, 500);
  let re: RegExp;
  if (opts.regex) {
    if (pattern.length > 200) throw new Error('Motif trop long');
    re = new RegExp(pattern, 'g');
  } else {
    re = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  }
  const hits: { locus: string; folio: string; text: string; matches: string[] }[] = [];
  let total = 0;
  for (const l of lines) {
    const m = l.text.match(re);
    if (m) {
      total += m.length;
      if (hits.length < limit) hits.push({ locus: l.locus, folio: l.folio, text: l.text, matches: m.slice(0, 10) });
    }
  }
  return { total, lines: hits.length, hits };
}

/**
 * Applique une table de substitution (glyphes EVA → symboles) à un texte, en privilégiant
 * les séquences les plus longues (ex. "ch" avant "c"). Sert à tester des hypothèses.
 */
export function substitute(text: string, mapping: Record<string, string>) {
  const keys = Object.keys(mapping).filter(Boolean).sort((a, b) => b.length - a.length);
  let out = '';
  const unmapped = new Map<string, number>();
  for (let i = 0; i < text.length; ) {
    if (text[i] === ' ') {
      out += ' ';
      i++;
      continue;
    }
    const k = keys.find((key) => text.startsWith(key, i));
    if (k) {
      out += mapping[k];
      i += k.length;
    } else {
      unmapped.set(text[i], (unmapped.get(text[i]) ?? 0) + 1);
      out += text[i];
      i++;
    }
  }
  return { output: out, unmapped: Object.fromEntries(unmapped) };
}

export function folioText(folio: string) {
  return allLines().filter((l) => l.folio === folio);
}

export function corpusLoaded() {
  return allLines().length > 0;
}
