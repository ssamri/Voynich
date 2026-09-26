import { db, ftsQuery } from './db.js';
export const MEMORY_TYPES = ['hypothesis', 'finding', 'fact', 'dead_end', 'glossary', 'question', 'plan'];
export const MEMORY_LABELS = {
    hypothesis: 'Hypothèse',
    finding: 'Découverte',
    fact: 'Fait établi',
    dead_end: 'Impasse',
    glossary: 'Glossaire',
    question: 'Question ouverte',
    plan: 'Plan / prochaine étape',
};
export function setEvidence(id, evidence) {
    db.prepare('UPDATE memories SET evidence = ? WHERE id = ?').run(evidence, id);
}
export function createMemory(m) {
    const info = db
        .prepare(`INSERT INTO memories(type, title, content, tags, confidence, pinned, author_agent_id, author_label, session_id)
       VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(m.type, m.title, m.content, m.tags ?? '', Math.min(1, Math.max(0, m.confidence ?? 0.5)), m.pinned ? 1 : 0, m.authorAgentId ?? null, m.authorLabel ?? null, m.sessionId ?? null);
    const id = Number(info.lastInsertRowid);
    if (m.evidence)
        setEvidence(id, m.evidence);
    return getMemory(id);
}
export function getMemory(id) {
    return db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
}
export function updateMemory(id, patch) {
    const cur = getMemory(id);
    if (!cur)
        throw new Error(`Mémoire #${id} introuvable`);
    db.prepare(`UPDATE memories SET type=?, title=?, content=?, tags=?, confidence=?, status=?, pinned=?, updated_at=datetime('now') WHERE id=?`).run(patch.type ?? cur.type, patch.title ?? cur.title, patch.content ?? cur.content, patch.tags ?? cur.tags, patch.confidence ?? cur.confidence, patch.status ?? cur.status, patch.pinned === undefined ? cur.pinned : patch.pinned ? 1 : 0, id);
    return getMemory(id);
}
export function searchMemories(query, opts = {}) {
    const q = ftsQuery(query);
    const limit = opts.limit ?? 10;
    const statusClause = opts.includeInactive ? '' : `AND m.status IN ('active','confirmed')`;
    const typeClause = opts.type ? 'AND m.type = @type' : '';
    if (!q) {
        return db
            .prepare(`SELECT * FROM memories m WHERE 1=1 ${statusClause} ${typeClause} ORDER BY m.updated_at DESC LIMIT @limit`)
            .all({ type: opts.type, limit });
    }
    return db
        .prepare(`SELECT m.* FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
       WHERE memories_fts MATCH @q ${statusClause} ${typeClause}
       ORDER BY bm25(memories_fts) LIMIT @limit`)
        .all({ q, type: opts.type, limit });
}
export function pinnedMemories() {
    return db.prepare(`SELECT * FROM memories WHERE pinned = 1 AND status != 'archived' ORDER BY updated_at DESC LIMIT 30`).all();
}
export function formatMemory(m) {
    const status = m.status === 'active' ? '' : ` [${m.status}]`;
    return `#${m.id} (${MEMORY_LABELS[m.type] ?? m.type}, confiance ${Math.round(m.confidence * 100)} %${status}${m.author_label ? `, par ${m.author_label}` : ''}) ${m.title}\n${m.content}${m.evidence ? `\nPreuve : ${m.evidence}` : ''}`;
}
//# sourceMappingURL=memory.js.map