import { counts, pick, rng, shuffle } from './text.js';
export const GENERATORS = [
    { kind: 'shuffle_words', label: 'Mots de Voynich mélangés', needsSource: 'voynich', description: 'Même vocabulaire, ordre aléatoire : détruit toute syntaxe.' },
    { kind: 'shuffle_chars', label: 'Glyphes de Voynich mélangés', needsSource: 'voynich', description: 'Mêmes glyphes et longueurs de mots, positions aléatoires : détruit la structure des mots.' },
    { kind: 'rugg_grille', label: 'Tables et grille (G. Rugg, 2004)', needsSource: 'voynich', description: 'Mots assemblés à partir de tables préfixe / milieu / suffixe lues à travers une grille mobile.' },
    { kind: 'timm_autocopy', label: 'Auto-copie (Timm & Schinner, 2020)', needsSource: 'voynich', description: 'Chaque mot est une copie modifiée d’un mot déjà écrit à proximité.' },
    { kind: 'simple_substitution', label: 'Chiffre par substitution simple', needsSource: 'reference', description: 'Une langue réelle chiffrée lettre à lettre.' },
    { kind: 'homophonic', label: 'Chiffre homophonique', needsSource: 'reference', description: 'Chaque lettre a plusieurs symboles possibles (masque les fréquences).' },
    { kind: 'verbose_cipher', label: 'Chiffre « verbeux »', needsSource: 'reference', description: 'Chaque lettre devient une petite syllabe de 1 à 3 glyphes EVA : hypothèse d’un chiffre verbeux.' },
];
const EVA_SYMBOLS = 'oeyaicdklrsthnqpmfg'.split('');
const EVA_SYLLABLES = ['o', 'e', 'y', 'a', 'd', 'l', 'r', 's', 'k', 't', 'ch', 'sh', 'ol', 'or', 'al', 'ar', 'dy', 'ey', 'ok', 'ot', 'qo', 'ai', 'in', 'iin', 'ee', 'ed', 'ch', 'cth', 'ckh', 'am', 'od'];
function sizeLimit(tokens, n) {
    return tokens.slice(0, Math.min(tokens.length, n));
}
export function generate(kind, opts) {
    const rand = rng(opts.seed ?? 42);
    const length = opts.length ?? 20000;
    const vt = opts.voynichTokens ?? [];
    const rt = opts.referenceTokens ?? [];
    switch (kind) {
        case 'shuffle_words':
            return shuffle(sizeLimit(vt, length), rand);
        case 'shuffle_chars': {
            const words = sizeLimit(vt, length);
            const glyphs = shuffle(words.join('').split(''), rand);
            let k = 0;
            return words.map((w) => glyphs.slice(k, (k += w.length)).join(''));
        }
        case 'rugg_grille': {
            // Tables construites à partir des découpes fréquentes des mots de Voynich (3 colonnes, 36 lignes).
            const pre = new Map();
            const mid = new Map();
            const suf = new Map();
            for (const w of vt) {
                const a = Math.min(2, Math.max(1, Math.floor(w.length / 3)));
                const b = Math.max(a, w.length - 2);
                pre.set(w.slice(0, a), (pre.get(w.slice(0, a)) ?? 0) + 1);
                mid.set(w.slice(a, b), (mid.get(w.slice(a, b)) ?? 0) + 1);
                suf.set(w.slice(b), (suf.get(w.slice(b)) ?? 0) + 1);
            }
            const top = (m) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 36).map(([s]) => s);
            const table = [top(pre), top(mid), top(suf)];
            const rows = Math.min(...table.map((c) => c.length));
            // Grille : trois fenêtres décalées qui glissent le long de la table.
            const offsets = [0, Math.floor(rand() * rows), Math.floor(rand() * rows)];
            const out = [];
            let r = Math.floor(rand() * rows);
            while (out.length < length) {
                const w = table.map((col, c) => (rand() < (c === 1 ? 0.25 : 0.1) ? '' : col[(r + offsets[c]) % rows])).join('');
                if (w)
                    out.push(w);
                r = (r + 1 + Math.floor(rand() * 3)) % rows;
                if (rand() < 0.05)
                    offsets[Math.floor(rand() * 3)] = Math.floor(rand() * rows);
            }
            return out;
        }
        case 'timm_autocopy': {
            const subs = [['o', 'a', 'y'], ['e', 'ee'], ['ch', 'sh'], ['k', 't', 'p', 'f'], ['d', 'l', 'r', 's'], ['n', 'm'], ['in', 'iin', 'ir'], ['ckh', 'cth']];
            const prefixes = ['q', 'qo', 'o', 'ch', 'sh', 'y', 'd'];
            const suffixes = ['y', 'dy', 'ey', 'ol', 'or', 'al', 'ar', 'aiin', 'in'];
            const out = sizeLimit(vt, 12).length ? sizeLimit(vt, 12) : ['daiin', 'chol', 'qokeedy', 'shedy', 'otar'];
            const mutate = (w) => {
                let s = w;
                const r = rand();
                if (r < 0.55) {
                    const group = pick(subs.filter((g) => g.some((x) => s.includes(x))).concat([[]]), rand);
                    const from = [...group].sort((a, b) => b.length - a.length).find((x) => s.includes(x));
                    if (from)
                        s = s.replace(from, pick(group, rand));
                }
                else if (r < 0.7) {
                    const p = prefixes.find((x) => s.startsWith(x));
                    s = p && s.length > p.length + 1 ? s.slice(p.length) : pick(prefixes, rand) + s;
                }
                else if (r < 0.85) {
                    const x = suffixes.find((y) => s.endsWith(y));
                    s = x && s.length > x.length + 1 ? s.slice(0, -x.length) : s + pick(suffixes, rand);
                }
                return s;
            };
            while (out.length < length) {
                // Source : un mot récent (fenêtre de ~10 mots) ou la même position ~8 mots plus haut (ligne précédente).
                const back = rand() < 0.6 ? 1 + Math.floor(rand() * 10) : 8 + Math.floor(rand() * 3);
                let src = out[Math.max(0, out.length - back)];
                // Garde-fou : on repart d'un mot court quand la copie dérive (les mots de Voynich dépassent rarement 10 glyphes).
                if (src.length > 9)
                    src = pick(out.filter((w) => w.length >= 3 && w.length <= 7).slice(-50).concat(['daiin', 'chol', 'shedy']), rand);
                let next = rand() < 0.1 ? src : mutate(src);
                if (next.length > 10)
                    next = next.slice(0, 4 + Math.floor(rand() * 4));
                out.push(next);
            }
            return out;
        }
        case 'simple_substitution': {
            const letters = [...new Set(rt.join(''))];
            const targets = shuffle(EVA_SYMBOLS.concat('bjuvwxz'.split('')), rand);
            const key = new Map(letters.map((l, i) => [l, targets[i % targets.length]]));
            return sizeLimit(rt, length).map((w) => [...w].map((c) => key.get(c) ?? c).join(''));
        }
        case 'homophonic': {
            const freq = counts(rt.join(''));
            const letters = [...freq.keys()];
            const pool = shuffle(Array.from({ length: 60 }, (_, i) => EVA_SYMBOLS[i % EVA_SYMBOLS.length] + (i >= EVA_SYMBOLS.length ? EVA_SYMBOLS[(i * 7) % EVA_SYMBOLS.length] : '')), rand);
            const total = [...freq.values()].reduce((a, b) => a + b, 0);
            let k = 0;
            const homophones = new Map();
            for (const l of letters) {
                const n = Math.max(1, Math.round(((freq.get(l) ?? 0) / total) * 40));
                homophones.set(l, pool.slice(k, (k += n)).filter(Boolean));
                if (!homophones.get(l).length)
                    homophones.set(l, [pick(EVA_SYMBOLS, rand)]);
            }
            return sizeLimit(rt, length).map((w) => [...w].map((c) => pick(homophones.get(c) ?? [c], rand)).join(''));
        }
        case 'verbose_cipher': {
            const letters = [...new Set(rt.join(''))];
            const sylls = shuffle([...new Set(EVA_SYLLABLES)], rand);
            const key = new Map(letters.map((l, i) => [l, sylls[i % sylls.length] + (i >= sylls.length ? pick(['y', 'o', 'e'], rand) : '')]));
            // Dans un chiffre verbeux, chaque lettre claire devient souvent un « mot » chiffré.
            return sizeLimit(rt, Math.floor(length / 4)).flatMap((w) => [...w].map((c) => key.get(c) ?? c));
        }
    }
}
//# sourceMappingURL=generators.js.map