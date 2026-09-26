import fs from 'node:fs';
import path from 'node:path';
import { extractText } from 'unpdf';
import { db, ftsQuery } from '../db.js';
import { config } from '../config.js';
import { randomToken } from '../security/crypto.js';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|ivtff|eva|log|tex|rtf)$/i;
/** Découpe en morceaux ~1600 caractères avec recouvrement, en coupant sur les paragraphes. */
export function chunkText(text, size = 1600, overlap = 200) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + size, text.length);
        if (end < text.length) {
            const para = text.lastIndexOf('\n\n', end);
            const sentence = text.lastIndexOf('. ', end);
            const cut = para > start + size / 2 ? para : sentence > start + size / 2 ? sentence + 1 : end;
            end = cut;
        }
        const content = text.slice(start, end).trim();
        if (content)
            chunks.push({ start, content });
        if (end >= text.length)
            break;
        start = Math.max(end - overlap, start + 1);
    }
    return chunks;
}
function indexDocument(id, content) {
    db.prepare('DELETE FROM doc_chunks WHERE document_id = ?').run(id);
    const insert = db.prepare('INSERT INTO doc_chunks(document_id, idx, start_offset, content) VALUES (?,?,?,?)');
    chunkText(content).forEach((c, i) => insert.run(id, i, c.start, c.content));
}
export async function ingestFile(file, meta) {
    const name = file.originalname;
    let kind;
    let content = '';
    let filePath = null;
    if (IMAGE_TYPES.has(file.mimetype)) {
        kind = 'image';
    }
    else if (file.mimetype === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
        kind = 'pdf';
        const { text } = await extractText(new Uint8Array(file.buffer), { mergePages: false });
        content = text.map((t, i) => `[Page ${i + 1}]\n${t.trim()}`).join('\n\n');
    }
    else if (file.mimetype.startsWith('text/') || TEXT_EXT.test(name) || file.mimetype === 'application/json') {
        kind = 'text';
        content = file.buffer.toString('utf8');
    }
    else {
        throw new Error(`Type de fichier non pris en charge : ${file.mimetype || name}`);
    }
    if (kind !== 'text') {
        const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
        filePath = `${Date.now()}-${randomToken(8)}${ext}`;
        fs.writeFileSync(path.join(config.uploadsDir, filePath), file.buffer);
    }
    const tx = db.transaction(() => {
        const info = db
            .prepare('INSERT INTO documents(title, filename, mime, kind, size, tags, source, content, file_path) VALUES (?,?,?,?,?,?,?,?,?)')
            .run(meta.title?.trim() || name, name, file.mimetype, kind, file.buffer.length, meta.tags ?? '', meta.source ?? null, content, filePath);
        const id = Number(info.lastInsertRowid);
        if (content)
            indexDocument(id, content);
        return id;
    });
    return tx();
}
export function createTextDocument(title, content, tags = '', source = null) {
    return db.transaction(() => {
        const info = db
            .prepare(`INSERT INTO documents(title, kind, mime, size, tags, source, content) VALUES (?, 'text', 'text/markdown', ?, ?, ?, ?)`)
            .run(title, Buffer.byteLength(content), tags, source, content);
        const id = Number(info.lastInsertRowid);
        indexDocument(id, content);
        return id;
    })();
}
export function updateDocument(id, patch) {
    const doc = getDocument(id);
    if (!doc)
        throw new Error('Document introuvable');
    db.transaction(() => {
        db.prepare('UPDATE documents SET title = ?, tags = ?, notes = ?, content = ?, size = ? WHERE id = ?').run(patch.title ?? doc.title, patch.tags ?? doc.tags, patch.notes ?? doc.notes, patch.content ?? doc.content, patch.content !== undefined ? Buffer.byteLength(patch.content) : doc.size, id);
        if (patch.content !== undefined)
            indexDocument(id, patch.content);
    })();
}
export function getDocument(id) {
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}
export function deleteDocument(id) {
    const doc = getDocument(id);
    if (!doc)
        return;
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    if (doc.file_path)
        fs.rmSync(path.join(config.uploadsDir, doc.file_path), { force: true });
}
export function documentFile(doc) {
    return doc.file_path ? path.join(config.uploadsDir, doc.file_path) : null;
}
export function searchLibrary(query, limit = 8) {
    const q = ftsQuery(query);
    if (!q)
        return [];
    return db
        .prepare(`SELECT c.document_id, d.title, c.idx, c.start_offset,
              snippet(doc_chunks_fts, 0, '«', '»', ' … ', 48) AS snippet,
              bm25(doc_chunks_fts) AS score
       FROM doc_chunks_fts JOIN doc_chunks c ON c.id = doc_chunks_fts.rowid
       JOIN documents d ON d.id = c.document_id
       WHERE doc_chunks_fts MATCH ? ORDER BY score LIMIT ?`)
        .all(q, limit);
}
//# sourceMappingURL=library.js.map