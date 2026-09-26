import { db } from '../db.js';
import { selectLines, wordsOf } from '../voynich/analysis.js';
import { counts, entropyOf, glyphUnits, rng, shuffle } from './text.js';
/** Algorithme de Sukhotin : sépare les symboles en « voyelles » et « consonnes » par leurs voisinages. */
export function sukhotin(tokens, alphabet = 'eva') {
    const words = tokens.map((t) => glyphUnits(t, alphabet));
    const syms = [...new Set(words.flat())];
    const idx = new Map(syms.map((s, i) => [s, i]));
    const n = syms.length;
    const adj = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const w of words) {
        for (let i = 0; i < w.length - 1; i++) {
            const a = idx.get(w[i]);
            const b = idx.get(w[i + 1]);
            if (a !== b) {
                adj[a][b]++;
                adj[b][a]++;
            }
        }
    }
    const sums = adj.map((row) => row.reduce((x, y) => x + y, 0));
    const vowel = new Array(n).fill(false);
    const order = [];
    for (;;) {
        let best = -1;
        for (let i = 0; i < n; i++)
            if (!vowel[i] && sums[i] > 0 && (best < 0 || sums[i] > sums[best]))
                best = i;
        if (best < 0)
            break;
        vowel[best] = true;
        order.push(syms[best]);
        for (let i = 0; i < n; i++)
            if (!vowel[i])
                sums[i] -= 2 * adj[i][best];
    }
    const freq = counts(words.flat());
    return {
        method: 'Sukhotin (1962)',
        vowels: order.map((s) => ({ symbol: s, freq: freq.get(s) ?? 0 })),
        consonants: syms.filter((_, i) => !vowel[i]).map((s) => ({ symbol: s, freq: freq.get(s) ?? 0 })).sort((a, b) => b.freq - a.freq),
        note: "Dans une écriture alphabétique, les voyelles et les consonnes ont tendance à alterner. Un résultat très déséquilibré suggère que les glyphes ne sont pas des lettres simples.",
    };
}
/** Modèle de Markov caché à k états, appris par Baum-Welch (normalisé) : regroupe les symboles par comportement. */
export function hmm(tokens, opts = {}) {
    const K = Math.min(Math.max(opts.states ?? 2, 2), 6);
    const rand = rng(opts.seed ?? 7);
    const seq = [];
    for (const t of tokens) {
        seq.push(...glyphUnits(t, opts.alphabet ?? 'eva'), '_');
        if (seq.length > (opts.maxSymbols ?? 30000))
            break;
    }
    const syms = [...new Set(seq)];
    const M = syms.length;
    const idx = new Map(syms.map((s, i) => [s, i]));
    const obs = seq.map((s) => idx.get(s));
    const T = obs.length;
    const norm = (a) => {
        const s = a.reduce((x, y) => x + y, 0);
        return a.map((x) => x / s);
    };
    let pi = norm(Array.from({ length: K }, () => 1 + rand()));
    let A = Array.from({ length: K }, () => norm(Array.from({ length: K }, () => 1 + rand())));
    let B = Array.from({ length: K }, () => norm(Array.from({ length: M }, () => 1 + rand())));
    let logLik = 0;
    for (let it = 0; it < (opts.iterations ?? 40); it++) {
        const alpha = Array.from({ length: T }, () => new Float64Array(K));
        const beta = Array.from({ length: T }, () => new Float64Array(K));
        const c = new Float64Array(T);
        for (let i = 0; i < K; i++)
            alpha[0][i] = pi[i] * B[i][obs[0]];
        c[0] = 1 / alpha[0].reduce((x, y) => x + y, 0);
        for (let i = 0; i < K; i++)
            alpha[0][i] *= c[0];
        for (let t = 1; t < T; t++) {
            let s = 0;
            for (let j = 0; j < K; j++) {
                let a = 0;
                for (let i = 0; i < K; i++)
                    a += alpha[t - 1][i] * A[i][j];
                alpha[t][j] = a * B[j][obs[t]];
                s += alpha[t][j];
            }
            c[t] = 1 / s;
            for (let j = 0; j < K; j++)
                alpha[t][j] *= c[t];
        }
        for (let i = 0; i < K; i++)
            beta[T - 1][i] = c[T - 1];
        for (let t = T - 2; t >= 0; t--) {
            for (let i = 0; i < K; i++) {
                let b = 0;
                for (let j = 0; j < K; j++)
                    b += A[i][j] * B[j][obs[t + 1]] * beta[t + 1][j];
                beta[t][i] = b * c[t];
            }
        }
        logLik = -Array.from(c).reduce((x, y) => x + Math.log(y), 0);
        const newA = Array.from({ length: K }, () => new Array(K).fill(1e-9));
        const newB = Array.from({ length: K }, () => new Array(M).fill(1e-9));
        const gammaSum = new Array(K).fill(1e-9);
        const newPi = new Array(K).fill(0);
        for (let t = 0; t < T; t++) {
            let gs = 0;
            const g = new Array(K);
            for (let i = 0; i < K; i++) {
                g[i] = alpha[t][i] * beta[t][i];
                gs += g[i];
            }
            for (let i = 0; i < K; i++) {
                const gamma = g[i] / gs;
                if (t === 0)
                    newPi[i] = gamma;
                newB[i][obs[t]] += gamma;
                if (t < T - 1) {
                    gammaSum[i] += gamma;
                    for (let j = 0; j < K; j++)
                        newA[i][j] += alpha[t][i] * A[i][j] * B[j][obs[t + 1]] * beta[t + 1][j];
                }
            }
        }
        pi = norm(newPi.map((x) => x + 1e-9));
        A = newA.map(norm);
        B = newB.map(norm);
    }
    const classes = syms
        .map((s, m) => {
        const probs = B.map((row) => row[m]);
        const state = probs.indexOf(Math.max(...probs));
        return { symbol: s, state, weights: probs.map((p) => Number(p.toFixed(4))) };
    })
        .sort((a, b) => a.state - b.state || b.weights[b.state] - a.weights[a.state]);
    return {
        method: `Modèle de Markov caché à ${K} états (Baum-Welch)`,
        states: K,
        symbols: T,
        logLikelihood: logLik,
        transitions: A.map((r) => r.map((x) => Number(x.toFixed(3)))),
        classes,
        note: 'Pour une langue alphabétique, un HMM à 2 états sépare généralement voyelles et consonnes. Comparer avec la même analyse sur un corpus de référence.',
    };
}
/** Structure interne des mots : affixes fréquents, positions préférées, ordre relatif des glyphes (grammaire à cases). */
export function wordStructure(tokens, alphabet = 'eva-grouped') {
    const types = counts(tokens);
    const prefixes = new Map();
    const suffixes = new Map();
    const slots = new Map();
    const before = new Map();
    for (const [w, c] of types) {
        const u = glyphUnits(w, alphabet);
        for (let k = 1; k <= Math.min(3, u.length - 1); k++) {
            const p = u.slice(0, k).join('');
            const s = u.slice(u.length - k).join('');
            prefixes.set(p, (prefixes.get(p) ?? 0) + c);
            suffixes.set(s, (suffixes.get(s) ?? 0) + c);
        }
        u.forEach((g, i) => {
            const bin = u.length === 1 ? 0 : Math.round((i / (u.length - 1)) * 4);
            const arr = slots.get(g) ?? [0, 0, 0, 0, 0];
            arr[bin] += c;
            slots.set(g, arr);
        });
        const seen = [...new Set(u)];
        for (const a of seen)
            for (const b of seen)
                if (a !== b && u.indexOf(a) < u.indexOf(b))
                    before.set(`${a}|${b}`, (before.get(`${a}|${b}`) ?? 0) + c);
    }
    const ordered = [];
    for (const [k, ab] of before) {
        const [a, b] = k.split('|');
        const ba = before.get(`${b}|${a}`) ?? 0;
        if (ab + ba >= 30 && ab >= ba)
            ordered.push({ a, b, consistency: ab / (ab + ba), count: ab + ba });
    }
    ordered.sort((x, y) => y.consistency - x.consistency || y.count - x.count);
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([s, count]) => ({ s, count }));
    return {
        alphabet,
        topPrefixes: top(prefixes),
        topSuffixes: top(suffixes),
        slotProfile: [...slots.entries()]
            .map(([g, arr]) => {
            const tot = arr.reduce((a, b) => a + b, 0);
            return { glyph: g, total: tot, distribution: arr.map((x) => Number((x / tot).toFixed(3))), entropy: Number((entropyOf(new Map(arr.map((v, i) => [i, v]))) / Math.log2(5)).toFixed(3)) };
        })
            .sort((a, b) => b.total - a.total)
            .slice(0, 30),
        strictOrder: ordered.slice(0, 30),
        note: 'Un ordre relatif très constant entre glyphes (cohérence proche de 1) évoque une grammaire à cases (Stolfi, Zattera) plutôt qu’une orthographe alphabétique ordinaire.',
    };
}
function sectionTokens(filter = {}) {
    const out = [];
    for (const l of selectLines(filter))
        for (const w of wordsOf([l]))
            out.push({ w, section: l.illustration, folio: l.folio });
    return out;
}
/** Mots-clés par concentration (Montemurro & Zanette, 2013) : un mot « porteur de sens » se regroupe dans certaines parties du texte. */
export function keywords(opts = {}) {
    const toks = sectionTokens(opts.filter);
    const P = opts.parts ?? 64;
    const N = toks.length;
    if (N < P * 10)
        throw new Error('Texte trop court pour cette analyse');
    const partOf = (i) => Math.min(P - 1, Math.floor((i / N) * P));
    const dist = (seq) => {
        const m = new Map();
        seq.forEach((w, i) => {
            const arr = m.get(w) ?? new Array(P).fill(0);
            arr[partOf(i)]++;
            m.set(w, arr);
        });
        return m;
    };
    const H = (arr) => entropyOf(new Map(arr.map((v, i) => [i, v])));
    const words = toks.map((t) => t.w);
    const real = dist(words);
    const rand = rng(opts.seed ?? 3);
    const shuffles = [0, 1, 2, 3].map(() => dist(shuffle(words, rand)));
    const rows = [];
    for (const [w, arr] of real) {
        const count = arr.reduce((a, b) => a + b, 0);
        if (count < (opts.minFreq ?? 10))
            continue;
        const sRand = shuffles.reduce((a, m) => a + H(m.get(w)), 0) / shuffles.length;
        const s = H(arr);
        const info = (count / N) * (sRand - s);
        const idxs = toks.map((t, i) => (t.w === w ? i : -1)).filter((i) => i >= 0);
        const secs = counts(idxs.map((i) => toks[i].section ?? '?'));
        const main = [...secs.entries()].sort((a, b) => b[1] - a[1])[0];
        rows.push({
            word: w,
            count,
            information: info,
            concentration: sRand - s,
            mainSection: main ? `${main[0]} (${Math.round((main[1] / count) * 100)} %)` : null,
            folios: [...new Set(idxs.map((i) => toks[i].folio))].slice(0, 8),
        });
    }
    rows.sort((a, b) => b.information - a.information);
    return { method: 'Montemurro & Zanette (2013)', tokens: N, parts: P, keywords: rows.slice(0, opts.limit ?? 40) };
}
/** Mots aux contextes similaires (PPMI + cosinus) : candidats variantes, synonymes ou mots d'une même catégorie. */
export function similarWords(word, opts = {}) {
    const words = wordsOf(selectLines(opts.filter ?? {}));
    const freq = counts(words);
    const minF = opts.minFreq ?? 5;
    if ((freq.get(word) ?? 0) < minF)
        throw new Error(`« ${word} » est trop rare (${freq.get(word) ?? 0} occurrences, minimum ${minF}).`);
    const W = opts.window ?? 2;
    const co = new Map();
    let total = 0;
    for (let i = 0; i < words.length; i++) {
        const a = words[i];
        if ((freq.get(a) ?? 0) < minF)
            continue;
        for (let j = Math.max(0, i - W); j <= Math.min(words.length - 1, i + W); j++) {
            if (j === i)
                continue;
            const b = words[j];
            const m = co.get(a) ?? new Map();
            m.set(b, (m.get(b) ?? 0) + 1);
            co.set(a, m);
            total++;
        }
    }
    const ctxTotals = new Map();
    for (const m of co.values())
        for (const [b, c] of m)
            ctxTotals.set(b, (ctxTotals.get(b) ?? 0) + c);
    const rowTotals = new Map([...co.entries()].map(([a, m]) => [a, [...m.values()].reduce((x, y) => x + y, 0)]));
    const vec = (a) => {
        const out = new Map();
        for (const [b, c] of co.get(a) ?? []) {
            const pmi = Math.log2((c * total) / (rowTotals.get(a) * ctxTotals.get(b)));
            if (pmi > 0)
                out.set(b, pmi);
        }
        return out;
    };
    const norm = (v) => Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0));
    const target = vec(word);
    const tn = norm(target);
    const sims = [];
    for (const a of co.keys()) {
        if (a === word)
            continue;
        const v = vec(a);
        let dot = 0;
        for (const [k, x] of target)
            dot += x * (v.get(k) ?? 0);
        const s = dot / (tn * norm(v) || 1);
        sims.push({ word: a, similarity: Number(s.toFixed(4)), count: freq.get(a), editDistanceHint: a.includes(word.slice(1)) || word.includes(a.slice(1)) });
    }
    sims.sort((a, b) => b.similarity - a.similarity);
    return { word, occurrences: freq.get(word), neighbours: sims.slice(0, opts.limit ?? 20) };
}
/** Effets de ligne et de paragraphe : glyphes propres au début / à la fin de ligne, première ligne des paragraphes. */
export function lineEffects(filter = {}) {
    const rows = db
        .prepare(`SELECT l.folio, l.locus, l.locus_type, l.text, p.illustration, p.language, p.hand FROM corpus_lines l LEFT JOIN corpus_pages p ON p.folio = l.folio ORDER BY l.ord`)
        .all();
    const lines = rows.filter((l) => (!filter.illustration || l.illustration === filter.illustration) && (!filter.language || l.language === filter.language) && (!filter.hand || l.hand === filter.hand));
    const pos = { first: new Map(), middle: new Map(), last: new Map() };
    const lenByPos = { first: [], middle: [], last: [] };
    const initialGlyph = { first: new Map(), all: new Map() };
    const finalGlyph = { last: new Map(), all: new Map() };
    let gallowsParaFirst = 0;
    let paraFirstLines = 0;
    let gallowsOther = 0;
    let otherLines = 0;
    const isParaStart = (t) => Boolean(t && /^@P|^\*P/.test(t));
    for (const l of lines) {
        const ws = wordsOf([l], true);
        if (!ws.length)
            continue;
        ws.forEach((w, i) => {
            const k = i === 0 ? 'first' : i === ws.length - 1 ? 'last' : 'middle';
            pos[k].set(w, (pos[k].get(w) ?? 0) + 1);
            lenByPos[k].push(w.length);
            initialGlyph.all.set(w[0], (initialGlyph.all.get(w[0]) ?? 0) + 1);
            finalGlyph.all.set(w[w.length - 1], (finalGlyph.all.get(w[w.length - 1]) ?? 0) + 1);
        });
        initialGlyph.first.set(ws[0][0], (initialGlyph.first.get(ws[0][0]) ?? 0) + 1);
        const lw = ws[ws.length - 1];
        finalGlyph.last.set(lw[lw.length - 1], (finalGlyph.last.get(lw[lw.length - 1]) ?? 0) + 1);
        if (isParaStart(l.locus_type)) {
            paraFirstLines++;
            gallowsParaFirst += /[ptkf]/.test(ws[0]) ? 1 : 0;
        }
        else {
            otherLines++;
            gallowsOther += /[ptkf]/.test(ws[0]) ? 1 : 0;
        }
    }
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const ratio = (sub, all) => {
        const st = [...sub.values()].reduce((a, b) => a + b, 0) || 1;
        const at = [...all.values()].reduce((a, b) => a + b, 0) || 1;
        return [...sub.entries()]
            .filter(([, c]) => c >= 5)
            .map(([g, c]) => ({ glyph: g, count: c, share: c / st, overrepresentation: c / st / ((all.get(g) ?? 0) / at || 1e-9) }))
            .sort((a, b) => b.overrepresentation - a.overrepresentation)
            .slice(0, 12);
    };
    const topW = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, count]) => ({ word, count }));
    return {
        lines: lines.length,
        meanWordLength: { first: avg(lenByPos.first), middle: avg(lenByPos.middle), last: avg(lenByPos.last) },
        lineInitialGlyphs: ratio(initialGlyph.first, initialGlyph.all),
        lineFinalGlyphs: ratio(finalGlyph.last, finalGlyph.all),
        topFirstWords: topW(pos.first),
        topLastWords: topW(pos.last),
        paragraphs: {
            firstLines: paraFirstLines,
            gallowsInitialRateFirstLine: paraFirstLines ? gallowsParaFirst / paraFirstLines : null,
            gallowsInitialRateOtherLines: otherLines ? gallowsOther / otherLines : null,
        },
        note: 'Dans un texte ordinaire, la position dans la ligne n’influence presque pas les mots. De forts effets de ligne suggèrent une mise en forme ou un procédé de génération.',
    };
}
//# sourceMappingURL=algorithms.js.map