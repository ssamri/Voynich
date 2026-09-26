import { db } from '../db.js';
import { substitute } from '../voynich/analysis.js';
import { glyphUnits, levenshtein } from './text.js';
export function listCribs() {
    return db.prepare('SELECT * FROM cribs ORDER BY confidence DESC, id').all();
}
export function addCrib(c) {
    const info = db
        .prepare('INSERT INTO cribs(folio, locus, eva, expected, language, category, source, confidence, notes, author_label) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(c.folio ?? null, c.locus ?? null, c.eva.trim().toLowerCase(), c.expected.trim().toLowerCase(), c.language ?? null, c.category ?? null, c.source ?? null, Math.min(1, Math.max(0, c.confidence ?? 0.3)), c.notes ?? null, c.authorLabel ?? null);
    return Number(info.lastInsertRowid);
}
export function updateCrib(id, c) {
    const cur = db.prepare('SELECT * FROM cribs WHERE id = ?').get(id);
    if (!cur)
        throw new Error('Indice introuvable');
    const n = { ...cur, ...c };
    db.prepare('UPDATE cribs SET folio=?, locus=?, eva=?, expected=?, language=?, category=?, source=?, confidence=?, notes=? WHERE id=?').run(n.folio, n.locus, n.eva, n.expected, n.language, n.category, n.source, n.confidence, n.notes, id);
}
export function deleteCrib(id) {
    db.prepare('DELETE FROM cribs WHERE id = ?').run(id);
}
/** Applique une table de substitution aux indices et mesure la concordance (pondérée par la confiance). */
export function testCribs(mapping, ids) {
    const cribs = listCribs().filter((c) => !ids?.length || ids.includes(c.id));
    if (!cribs.length)
        throw new Error('Aucun indice enregistré.');
    const rows = cribs.map((c) => {
        const decoded = substitute(c.eva, mapping).output.replace(/\s+/g, '');
        const similarity = 1 - levenshtein(decoded, c.expected) / Math.max(decoded.length, c.expected.length, 1);
        return { id: c.id, eva: c.eva, expected: c.expected, decoded, exact: decoded === c.expected, similarity: Number(similarity.toFixed(3)), confidence: c.confidence };
    });
    const w = rows.reduce((a, r) => a + r.confidence, 0) || 1;
    return {
        cribs: rows.length,
        exactMatches: rows.filter((r) => r.exact).length,
        weightedSimilarity: rows.reduce((a, r) => a + r.similarity * r.confidence, 0) / w,
        rows,
    };
}
/**
 * Contraintes déduites des indices dans l'hypothèse d'une substitution simple :
 * quand le nombre d'unités EVA égale le nombre de lettres, chaque position donne un couple unité → lettre.
 * Les couples confirmés par plusieurs indices sont solides ; les conflits réfutent l'hypothèse ou l'indice.
 */
export function cribConstraints(alphabet = 'eva-grouped') {
    const pairs = new Map();
    const skipped = [];
    for (const c of listCribs()) {
        const units = glyphUnits(c.eva, alphabet);
        const letters = [...c.expected];
        if (units.length !== letters.length) {
            skipped.push(c.id);
            continue;
        }
        units.forEach((u, i) => {
            const m = pairs.get(u) ?? new Map();
            const e = m.get(letters[i]) ?? { count: 0, cribs: [] };
            e.count++;
            e.cribs.push(c.id);
            m.set(letters[i], e);
            pairs.set(u, m);
        });
    }
    const constraints = [...pairs.entries()].map(([unit, m]) => {
        const options = [...m.entries()].map(([letter, e]) => ({ letter, ...e })).sort((a, b) => b.count - a.count);
        return { unit, options, conflict: options.length > 1 };
    });
    return { alphabet, constraints, skippedLengthMismatch: skipped };
}
//# sourceMappingURL=cribs.js.map