import { counts, entropyOf, mean, sd } from './text.js';
export const FEATURES = [
    { key: 'h2', label: 'Entropie conditionnelle h2', hint: 'bits/caractère — prévisibilité d’un caractère connaissant le précédent' },
    { key: 'h1', label: 'Entropie h1', hint: 'bits/caractère — diversité des caractères' },
    { key: 'meanWordLength', label: 'Longueur moyenne des mots', hint: 'caractères' },
    { key: 'sdWordLength', label: 'Écart-type des longueurs', hint: 'caractères' },
    { key: 'ttr', label: 'Richesse du vocabulaire (TTR)', hint: 'types / tokens sur 5 000 mots' },
    { key: 'hapaxRatio', label: 'Part des hapax', hint: 'mots vus une seule fois / types, sur 5 000 mots' },
    { key: 'zipfSlope', label: 'Pente de Zipf', hint: '≈ −1 pour les langues naturelles' },
    { key: 'repeatRate', label: 'Répétitions consécutives', hint: 'part des mots identiques au précédent' },
    { key: 'positionalSpecialization', label: 'Spécialisation positionnelle', hint: '0 = glyphes placés n’importe où ; 1 = chaque glyphe a sa position' },
    { key: 'wordBigramEntropy', label: 'Entropie mot suivant', hint: 'bits — imprévisibilité du mot suivant' },
    { key: 'alphabetSize', label: 'Taille de l’alphabet', hint: 'caractères distincts' },
];
const WORD_SAMPLE = 5000;
const CHAR_SAMPLE = 40000;
export function fingerprint(tokens) {
    const sample = tokens.slice(0, WORD_SAMPLE);
    const sampleCounts = counts(sample);
    const allCounts = counts(tokens);
    const lengths = tokens.map((t) => [...t].length);
    const text = tokens.join('_');
    const chars = [...text.slice(0, CHAR_SAMPLE)];
    const uni = counts(chars);
    const bi = new Map();
    for (let i = 0; i < chars.length - 1; i++) {
        const k = chars[i] + chars[i + 1];
        bi.set(k, (bi.get(k) ?? 0) + 1);
    }
    const h1 = entropyOf(uni);
    const ranked = [...allCounts.values()].sort((a, b) => b - a).slice(0, 1000);
    const xs = ranked.map((_, i) => Math.log(i + 1));
    const ys = ranked.map((c) => Math.log(c));
    const mx = mean(xs);
    const my = mean(ys);
    const zipfSlope = xs.length > 2 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0) : 0;
    let repeats = 0;
    for (let i = 1; i < tokens.length; i++)
        if (tokens[i] === tokens[i - 1])
            repeats++;
    // Spécialisation positionnelle : 1 − entropie normalisée de la position (début/milieu/fin), pondérée.
    const pos = new Map();
    for (const w of sample) {
        const cs = [...w];
        cs.forEach((c, i) => {
            const p = pos.get(c) ?? [0, 0, 0];
            p[i === 0 ? 0 : i === cs.length - 1 ? 2 : 1]++;
            pos.set(c, p);
        });
    }
    let spec = 0;
    let weight = 0;
    for (const p of pos.values()) {
        const tot = p[0] + p[1] + p[2];
        const h = entropyOf(new Map(p.map((v, i) => [i, v])));
        spec += tot * (1 - h / Math.log2(3));
        weight += tot;
    }
    // Entropie conditionnelle du mot suivant (sur l'échantillon).
    const pairs = new Map();
    for (let i = 0; i < sample.length - 1; i++) {
        const k = `${sample[i]} ${sample[i + 1]}`;
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    const wordBigramEntropy = entropyOf(pairs) - entropyOf(sampleCounts);
    const wl = new Array(16).fill(0);
    for (const l of lengths)
        wl[Math.min(l, 15)]++;
    return {
        tokens: tokens.length,
        types: allCounts.size,
        sampleTokens: sample.length,
        ttr: sample.length ? sampleCounts.size / sample.length : 0,
        hapaxRatio: sampleCounts.size ? [...sampleCounts.values()].filter((c) => c === 1).length / sampleCounts.size : 0,
        meanWordLength: mean(lengths),
        sdWordLength: sd(lengths),
        alphabetSize: new Set(text.replace(/_/g, '')).size,
        h1,
        h2: entropyOf(bi) - h1,
        zipfSlope,
        repeatRate: tokens.length > 1 ? repeats / (tokens.length - 1) : 0,
        positionalSpecialization: weight ? spec / weight : 0,
        wordBigramEntropy,
        wordLengths: wl.map((c) => c / Math.max(1, lengths.length)),
    };
}
/**
 * Compare une empreinte cible à une série de références : distance euclidienne sur caractéristiques
 * standardisées (z-scores calculés sur l'ensemble comparé). Plus la distance est faible, plus les textes se ressemblent.
 */
export function compareFingerprints(target, refs) {
    const keys = FEATURES.map((f) => f.key).filter((k) => k !== 'alphabetSize');
    const all = [target.fp, ...refs.map((r) => r.fp)];
    const stats = Object.fromEntries(keys.map((k) => {
        const vals = all.map((fp) => fp[k]);
        return [k, { m: mean(vals), s: sd(vals) || 1 }];
    }));
    const z = (fp, k) => (fp[k] - stats[k].m) / stats[k].s;
    const ranking = refs
        .map((r) => {
        const perFeature = Object.fromEntries(keys.map((k) => [k, Math.abs(z(target.fp, k) - z(r.fp, k))]));
        const distance = Math.sqrt(Object.values(perFeature).reduce((a, d) => a + d * d, 0) / keys.length);
        return { id: r.id, name: r.name, kind: r.kind, distance, perFeature };
    })
        .sort((a, b) => a.distance - b.distance);
    return { target: target.name, features: FEATURES, ranking };
}
//# sourceMappingURL=fingerprint.js.map