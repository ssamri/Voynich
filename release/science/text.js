/** Outils de texte communs : aléatoire reproductible, découpage en glyphes, normalisation. */
/** Générateur pseudo-aléatoire reproductible (mulberry32) : les expériences sont rejouables avec la même graine. */
export function rng(seed) {
    let a = seed >>> 0 || 0x9e3779b9;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function shuffle(arr, rand) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
export function pick(arr, rand) {
    return arr[Math.floor(rand() * arr.length)];
}
const GROUPS = ['cth', 'ckh', 'cph', 'cfh', 'iiin', 'iin', 'ch', 'sh', 'ee', 'in', 'ir'];
export function glyphUnits(word, alphabet = 'eva') {
    if (alphabet === 'eva')
        return [...word];
    const out = [];
    for (let i = 0; i < word.length;) {
        const g = GROUPS.find((x) => word.startsWith(x, i));
        if (g) {
            out.push(g);
            i += g.length;
        }
        else {
            out.push(word[i]);
            i++;
        }
    }
    return out;
}
/** Normalise un texte de référence en mots minuscules (lettres uniquement). */
export function normalizeText(raw, opts = {}) {
    let s = raw.toLowerCase().normalize('NFKC');
    if (opts.stripDiacritics)
        s = s.normalize('NFD').replace(/\p{M}+/gu, '');
    if (opts.medievalLatin)
        s = s.replace(/j/g, 'i').replace(/v/g, 'u');
    return s
        .replace(/[^\p{L}\s]+/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .join(' ');
}
export function tokensOf(text) {
    return text.split(/\s+/).filter(Boolean);
}
export function counts(items) {
    const m = new Map();
    for (const i of items)
        m.set(i, (m.get(i) ?? 0) + 1);
    return m;
}
export function entropyOf(m) {
    let total = 0;
    for (const v of m.values())
        total += v;
    let h = 0;
    for (const c of m.values()) {
        const p = c / total;
        if (p > 0)
            h -= p * Math.log2(p);
    }
    return h;
}
export function mean(xs) {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
export function sd(xs) {
    const m = mean(xs);
    return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
export function levenshtein(a, b) {
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[b.length];
}
//# sourceMappingURL=text.js.map