import { getRef } from './sources.js';
import { counts, glyphUnits, levenshtein, rng, shuffle, tokensOf } from './text.js';
class TrigramScorer {
    letters;
    idx;
    table;
    L;
    constructor(text) {
        const letterCounts = counts([...text.replace(/\s+/g, '')]);
        this.letters = [...letterCounts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
        const symbols = ['_', ...this.letters];
        this.idx = new Map(symbols.map((s, i) => [s, i]));
        const L = (this.L = symbols.length);
        const tri = new Float64Array(L * L * L);
        const bi = new Float64Array(L * L);
        const seq = [0, ...[...`${text.trim().replace(/\s+/g, '_')}`].map((c) => this.idx.get(c) ?? 0), 0];
        for (let i = 2; i < seq.length; i++) {
            tri[(seq[i - 2] * L + seq[i - 1]) * L + seq[i]]++;
            bi[seq[i - 2] * L + seq[i - 1]]++;
        }
        this.table = new Float64Array(L * L * L);
        for (let a = 0; a < L; a++)
            for (let b = 0; b < L; b++)
                for (let c = 0; c < L; c++)
                    this.table[(a * L + b) * L + c] = Math.log2((tri[(a * L + b) * L + c] + 0.1) / (bi[a * L + b] + 0.1 * L));
    }
    letterIndex(l) {
        return this.idx.get(l) ?? -1;
    }
    /** Log-vraisemblance moyenne (bits/caractère, négatif) d'une séquence d'indices (0 = frontière de mot). */
    score(seq) {
        const L = this.L;
        let s = 0;
        for (let i = 2; i < seq.length; i++)
            s += this.table[(seq[i - 2] * L + seq[i - 1]) * L + seq[i]];
        return s / (seq.length - 2);
    }
}
const scorerCache = new Map();
function scorerFor(refId) {
    if (!scorerCache.has(refId)) {
        const ref = getRef(refId);
        if (!ref || ref.kind !== 'natural')
            throw new Error('Choisissez un corpus de référence en langue naturelle.');
        scorerCache.set(refId, new TrigramScorer(tokensOf(ref.text).slice(0, 300000).join(' ')));
    }
    return scorerCache.get(refId);
}
function optimise(words, scorer, input, rand) {
    const units = [...counts(words.flat()).entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
    const uIdx = new Map(units.map((u, i) => [u, i]));
    const encoded = words.map((w) => w.map((u) => uIdx.get(u)));
    const totalLen = encoded.reduce((a, w) => a + w.length + 1, 1);
    const buf = new Int32Array(totalLen + 1);
    const letters = scorer.letters;
    const fixed = new Map(Object.entries(input.fixed ?? {}).filter(([u, l]) => uIdx.has(u) && scorer.letterIndex(l) >= 0).map(([u, l]) => [uIdx.get(u), scorer.letterIndex(l)]));
    const cribs = (input.cribs ?? []).map((c) => ({ units: glyphUnits(c.eva, input.alphabet ?? 'eva'), expected: c.expected, weight: c.weight ?? 1 }));
    const evaluate = (key) => {
        let k = 0;
        buf[k++] = 0;
        for (const w of encoded) {
            for (const u of w)
                buf[k++] = key[u];
            buf[k++] = 0;
        }
        let s = scorer.score(buf.subarray(0, k));
        if (cribs.length) {
            let bonus = 0;
            for (const c of cribs) {
                const dec = c.units.map((u) => (uIdx.has(u) ? letters[key[uIdx.get(u)] - 1] ?? '?' : '?')).join('');
                bonus += c.weight * (1 - levenshtein(dec, c.expected) / Math.max(dec.length, c.expected.length, 1));
            }
            s += (0.5 * bonus) / cribs.length;
        }
        return s;
    };
    let best = null;
    for (let r = 0; r < (input.restarts ?? 3); r++) {
        // Départ : correspondance des rangs de fréquence (+ bruit selon le redémarrage).
        const key = new Int32Array(units.length);
        for (let i = 0; i < units.length; i++)
            key[i] = 1 + ((i + (r ? Math.floor(rand() * 4) : 0)) % letters.length);
        for (const [u, l] of fixed)
            key[u] = l;
        let cur = evaluate(key);
        let localBest = { key: key.slice(), score: cur };
        const iters = input.iterations ?? 6000;
        for (let it = 0; it < iters; it++) {
            const T = 0.08 * (1 - it / iters) + 0.002;
            const u = Math.floor(rand() * units.length);
            if (fixed.has(u))
                continue;
            const old = key[u];
            let v = -1;
            let oldV = 0;
            if (rand() < 0.5) {
                key[u] = 1 + Math.floor(rand() * letters.length);
            }
            else {
                v = Math.floor(rand() * units.length);
                if (fixed.has(v))
                    continue;
                oldV = key[v];
                key[u] = oldV;
                key[v] = old;
            }
            const s = evaluate(key);
            if (s >= cur || rand() < Math.exp((s - cur) / T)) {
                cur = s;
                if (s > localBest.score)
                    localBest = { key: key.slice(), score: s };
            }
            else {
                key[u] = old;
                if (v >= 0)
                    key[v] = oldV;
            }
        }
        if (!best || localBest.score > best.score)
            best = localBest;
    }
    const mapping = Object.fromEntries(units.map((u, i) => [u, letters[best.key[i] - 1]]));
    const decoded = words.slice(0, 60).map((w) => w.map((u) => mapping[u]).join('')).join(' ');
    return { mapping, bitsPerChar: -best.score, decoded, units: units.length };
}
export function anneal(input) {
    const seed = input.seed ?? 2024;
    const rand = rng(seed);
    const scorer = scorerFor(input.languageRefId);
    const tokens = input.tokens.slice(0, input.maxWords ?? 1500);
    if (tokens.length < 100)
        throw new Error('Texte trop court pour l’optimisation (100 mots minimum).');
    const words = tokens.map((t) => glyphUnits(t, input.alphabet ?? 'eva'));
    const real = optimise(words, scorer, input, rand);
    let control = null;
    if (input.withControl !== false) {
        // Contrôle : mêmes unités, mêmes longueurs de mots, positions mélangées.
        const flat = shuffle(words.flat(), rand);
        let k = 0;
        const ctrlWords = words.map((w) => flat.slice(k, (k += w.length)));
        control = optimise(ctrlWords, scorer, { ...input, cribs: [] }, rand);
    }
    const extra = (input.controlSources ?? []).map((c) => {
        const w = c.tokens.slice(0, input.maxWords ?? 1500).map((t) => glyphUnits(t, input.alphabet ?? 'eva'));
        const r = optimise(w, scorer, { ...input, cribs: [], fixed: {} }, rand);
        return { name: c.name, bitsPerChar: r.bitsPerChar, sample: r.decoded.slice(0, 200) };
    });
    const ref = getRef(input.languageRefId);
    const refSample = tokensOf(ref.text).slice(1000, 3000);
    const buf = [0];
    for (const w of refSample) {
        for (const c of w)
            buf.push(scorer.letterIndex(c));
        buf.push(0);
    }
    const referenceBits = -scorer.score(Int32Array.from(buf.map((x) => Math.max(0, x))));
    const gap = control ? control.bitsPerChar - real.bitsPerChar : null;
    const bestExtra = extra.length ? Math.min(...extra.map((e) => e.bitsPerChar)) : null;
    const interpretation = gap === null
        ? 'Sans contrôle, le score seul ne prouve rien.'
        : gap <= 0.3
            ? 'Pas mieux que le contrôle mélangé : la clé trouvée est un artefact de l’optimisation, pas un déchiffrement.'
            : bestExtra !== null && real.bitsPerChar >= bestExtra - 0.1
                ? 'Mieux que le texte mélangé, mais PAS mieux que les textes de contrôle générés ou chiffrés : la structure exploitée par l’optimisation ne prouve pas qu’il s’agit de la langue cible.'
                : bestExtra !== null
                    ? 'Mieux que le texte mélangé ET que les contrôles fournis : signal intéressant, à confirmer avec evaluate_decipherment (dictionnaire), une autre langue et un autre alphabet.'
                    : 'Mieux que le texte mélangé : le texte a une structure interne exploitable, ce qui ne prouve PAS qu’il s’agit de la langue cible (un texte généré sans sens obtient souvent le même résultat). Ajoutez des contrôles générés (control_sources) et une autre langue.';
    return {
        language: ref.name,
        alphabet: input.alphabet ?? 'eva',
        words: tokens.length,
        seed,
        mapping: real.mapping,
        bitsPerChar: real.bitsPerChar,
        controlBitsPerChar: control?.bitsPerChar ?? null,
        referenceBitsPerChar: referenceBits,
        signalGap: gap,
        decodedSample: real.decoded,
        controlSample: control?.decoded ?? null,
        extraControls: extra,
        interpretation,
    };
}
//# sourceMappingURL=anneal.js.map