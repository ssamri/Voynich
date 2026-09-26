import { substitute } from '../voynich/analysis.js';
import { languageModel, tokensFor, vocabulary, getRef } from './sources.js';
import { rng, shuffle, tokensOf } from './text.js';
export const DEFAULT_CRITERIA = { minCoverage: 0.9, minPercentile: 0.99, minDictionaryRate: 0.25 };
function decodeAll(tokens, input) {
    if (input.glossary) {
        return tokens.map((t) => input.glossary[t] ?? null);
    }
    return tokens.map((t) => substitute(t, input.mapping ?? {}).output.replace(/\s+/g, ''));
}
function scoreDecoded(decoded, lm, vocab) {
    const covered = decoded.filter((d) => Boolean(d));
    const text = covered.join(' ');
    const inDict = covered.filter((w) => vocab.has(w)).length;
    return { crossEntropy: lm.crossEntropy(text), dictionaryRate: covered.length ? inDict / covered.length : 0 };
}
export function evaluateDecipherment(input, criteria = DEFAULT_CRITERIA) {
    if (!input.mapping && !input.glossary)
        throw new Error('Fournir une table de substitution (mapping) ou un glossaire.');
    const ref = getRef(input.languageRefId);
    if (!ref || ref.kind !== 'natural')
        throw new Error('Choisissez un corpus de référence en langue naturelle pour la langue cible.');
    const seed = input.seed ?? 12345;
    const rand = rng(seed);
    const tokens = tokensFor(input.source ?? 'voynich').tokens.slice(0, input.maxWords ?? 4000);
    if (!tokens.length)
        throw new Error('Aucun mot EVA à évaluer (corpus non importé ?)');
    const lm = languageModel(input.languageRefId);
    const vocab = vocabulary(input.languageRefId);
    // Couverture
    let coverage;
    if (input.glossary) {
        coverage = tokens.filter((t) => input.glossary[t] !== undefined).length / tokens.length;
    }
    else {
        let total = 0;
        let unmapped = 0;
        for (const t of tokens) {
            total += t.length;
            for (const c of Object.values(substitute(t, input.mapping).unmapped))
                unmapped += c;
        }
        coverage = total ? 1 - unmapped / total : 0;
    }
    const decoded = decodeAll(tokens, input);
    const real = scoreDecoded(decoded, lm, vocab);
    // Collisions : mots EVA distincts qui donnent le même mot clair (perte d'information).
    const decodedSrc = new Set();
    const plains = new Set();
    tokens.forEach((t, i) => {
        if (!decoded[i])
            return;
        decodedSrc.add(t);
        plains.add(decoded[i]);
    });
    const collisionRate = decodedSrc.size ? 1 - plains.size / decodedSrc.size : 0;
    // Référence nulle : mêmes clés, valeurs permutées au hasard.
    const runs = Math.min(Math.max(input.baselineRuns ?? 100, 20), 500);
    const keys = Object.keys(input.mapping ?? input.glossary);
    const values = Object.values(input.mapping ?? input.glossary);
    const baseline = [];
    for (let r = 0; r < runs; r++) {
        const perm = shuffle(values, rand);
        const m = Object.fromEntries(keys.map((k, i) => [k, perm[i]]));
        baseline.push(scoreDecoded(decodeAll(tokens, input.glossary ? { glossary: m } : { mapping: m }), lm, vocab));
    }
    const pctCE = baseline.filter((b) => b.crossEntropy > real.crossEntropy).length / runs;
    const pctDict = baseline.filter((b) => b.dictionaryRate < real.dictionaryRate).length / runs;
    const meanBase = (k) => baseline.reduce((a, b) => a + b[k], 0) / runs;
    // Échelle : score d'un vrai texte de la langue cible (un extrait du corpus de référence lui-même).
    const refTokens = tokensOf(ref.text);
    const refSample = refTokens.slice(Math.floor(refTokens.length / 2), Math.floor(refTokens.length / 2) + 2000).join(' ');
    const referenceCrossEntropy = lm.crossEntropy(refSample);
    const checks = {
        coverage: coverage >= criteria.minCoverage,
        beatsRandomLanguageModel: pctCE >= criteria.minPercentile,
        beatsRandomDictionary: pctDict >= criteria.minPercentile,
        dictionaryRate: real.dictionaryRate >= criteria.minDictionaryRate,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    const verdict = passed === 4 ? 'pass' : passed <= 1 ? 'fail' : 'inconclusive';
    const result = {
        language: ref.name,
        words: tokens.length,
        coverage,
        collisionRate,
        crossEntropy: real.crossEntropy,
        referenceCrossEntropy,
        randomCrossEntropy: meanBase('crossEntropy'),
        dictionaryRate: real.dictionaryRate,
        randomDictionaryRate: meanBase('dictionaryRate'),
        percentileCrossEntropy: pctCE,
        percentileDictionary: pctDict,
        baselineRuns: runs,
        criteria,
        checks,
        verdict,
        sample: decoded.slice(0, 80).map((d) => d ?? '?').join(' '),
        seed,
    };
    const pct = (x) => `${Math.round(x * 100)} %`;
    const summary = `Verdict ${verdict.toUpperCase()} — couverture ${pct(coverage)}, entropie croisée ${real.crossEntropy.toFixed(2)} bits/car ` +
        `(texte réel ${referenceCrossEntropy.toFixed(2)}, hasard ${meanBase('crossEntropy').toFixed(2)}), mots du dictionnaire ${pct(real.dictionaryRate)} ` +
        `(hasard ${pct(meanBase('dictionaryRate'))}), meilleur que ${pct(pctCE)} / ${pct(pctDict)} des tables aléatoires, collisions ${pct(collisionRate)}.`;
    return { result, summary, verdict };
}
//# sourceMappingURL=evaluate.js.map