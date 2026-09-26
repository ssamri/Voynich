import { db } from '../db.js';
import { selectLines, wordsOf } from '../voynich/analysis.js';
import { fetchUrl } from '../web/search.js';
import { fingerprint } from './fingerprint.js';
import { generate } from './generators.js';
import { CharNgramModel } from './ngram.js';
import { normalizeText, tokensOf } from './text.js';
/**
 * Désignation d'une source de texte :
 *  - « voynich » (tout le corpus), « voynich:lang:A », « voynich:section:H », « voynich:hand:2 »
 *  - « ref:<id> » (corpus de référence)
 */
export function parseVoynichSource(src) {
    if (src === 'voynich')
        return {};
    const m = /^voynich:(lang|section|hand):(\w+)$/.exec(src);
    if (!m)
        return null;
    return m[1] === 'lang' ? { language: m[2] } : m[1] === 'section' ? { illustration: m[2] } : { hand: m[2] };
}
export function tokensFor(src) {
    const vf = parseVoynichSource(src);
    if (vf)
        return { id: src, name: src === 'voynich' ? 'Voynich (tout)' : `Voynich ${src.slice(8)}`, kind: 'voynich', tokens: wordsOf(selectLines(vf)) };
    const m = /^ref:(\d+)$/.exec(src);
    if (!m)
        throw new Error(`Source inconnue : ${src}`);
    const row = getRef(Number(m[1]));
    if (!row)
        throw new Error(`Corpus de référence #${m[1]} introuvable`);
    return { id: src, name: row.name, kind: row.kind, tokens: tokensOf(row.text) };
}
export function listRefs() {
    return db
        .prepare('SELECT id, name, language, genre, kind, source, notes, params, tokens, created_at FROM ref_corpora ORDER BY kind, name')
        .all();
}
export function getRef(id) {
    return db.prepare('SELECT * FROM ref_corpora WHERE id = ?').get(id);
}
export function deleteRef(id) {
    db.prepare('DELETE FROM ref_corpora WHERE id = ?').run(id);
    modelCache.delete(id);
    fpCache.delete(`ref:${id}`);
}
export function addRef(r) {
    if (r.tokens.length < 200)
        throw new Error('Texte trop court (200 mots minimum) pour des statistiques fiables.');
    const info = db
        .prepare('INSERT INTO ref_corpora(name, language, genre, kind, source, notes, params, text, tokens) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(r.name, r.language ?? null, r.genre ?? null, r.kind, r.source ?? null, r.notes ?? null, r.params ? JSON.stringify(r.params) : null, r.tokens.join(' '), r.tokens.length);
    return Number(info.lastInsertRowid);
}
export async function importRefFromUrl(url, meta) {
    const page = await fetchUrl(url);
    const text = stripGutenberg(page.text);
    return addRef({ ...meta, kind: 'natural', source: page.url, tokens: tokensOf(normalizeText(text, meta)) });
}
export function importRefFromText(raw, meta) {
    return addRef({ ...meta, kind: 'natural', tokens: tokensOf(normalizeText(stripGutenberg(raw), meta)) });
}
/** Retire l'en-tête et la licence des fichiers Project Gutenberg. */
function stripGutenberg(text) {
    const start = /\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i.exec(text);
    const end = /\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i.exec(text);
    return text.slice(start ? start.index + start[0].length : 0, end ? end.index : text.length);
}
export function generateRef(kind, opts) {
    const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    const voynichTokens = tokensFor(opts.voynichSource ?? 'voynich').tokens;
    const ref = opts.sourceRefId ? getRef(opts.sourceRefId) : undefined;
    if (['simple_substitution', 'homophonic', 'verbose_cipher'].includes(kind) && !ref)
        throw new Error('Choisissez un corpus de référence en langue naturelle à chiffrer.');
    if (['shuffle_words', 'shuffle_chars', 'rugg_grille', 'timm_autocopy'].includes(kind) && !voynichTokens.length)
        throw new Error('Importez d’abord le corpus EVA.');
    const tokens = generate(kind, { voynichTokens, referenceTokens: ref ? tokensOf(ref.text) : [], length: opts.length, seed });
    return addRef({
        name: opts.name ?? `${kind}${ref ? ` (${ref.name})` : ''} #${seed % 10000}`,
        kind: ['simple_substitution', 'homophonic', 'verbose_cipher'].includes(kind) ? 'cipher' : 'generated',
        language: ref?.language ?? undefined,
        source: `générateur ${kind}`,
        params: { kind, sourceRefId: opts.sourceRefId, voynichSource: opts.voynichSource, length: opts.length, seed },
        tokens,
    });
}
const modelCache = new Map();
export function languageModel(refId, order = 4) {
    const hit = modelCache.get(refId);
    if (hit && hit.order === order)
        return hit;
    const ref = getRef(refId);
    if (!ref)
        throw new Error(`Corpus de référence #${refId} introuvable`);
    const m = CharNgramModel.fromText(ref.text, order);
    modelCache.set(refId, m);
    return m;
}
export function vocabulary(refId) {
    const ref = getRef(refId);
    if (!ref)
        throw new Error(`Corpus de référence #${refId} introuvable`);
    return new Set(tokensOf(ref.text));
}
const fpCache = new Map();
export function fingerprintFor(src) {
    // Le corpus Voynich peut changer (réimport) : pas de cache pour lui.
    if (src.startsWith('ref:') && fpCache.has(src))
        return fpCache.get(src);
    const fp = fingerprint(tokensFor(src).tokens);
    if (src.startsWith('ref:'))
        fpCache.set(src, fp);
    return fp;
}
//# sourceMappingURL=sources.js.map