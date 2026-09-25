import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { audit } from '../security/auth.js';
import {
  createTextDocument,
  deleteDocument,
  documentFile,
  getDocument,
  ingestFile,
  searchLibrary,
  updateDocument,
} from '../library/library.js';

export const libraryRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 } });

libraryRouter.get('/', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const docs = db
    .prepare(
      `SELECT id, title, filename, mime, kind, size, tags, source, notes, created_at, length(content) AS chars
       FROM documents ORDER BY created_at DESC`,
    )
    .all();
  res.json({ documents: docs, hits: q ? searchLibrary(q, 30) : [] });
});

libraryRouter.post('/upload', upload.array('files', 20), async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const results: { name: string; id?: number; error?: string }[] = [];
  for (const f of files) {
    try {
      // multer décode le nom en latin1 ; on rétablit l'UTF-8.
      const originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const id = await ingestFile({ ...f, originalname }, { tags: req.body.tags, source: req.body.source });
      results.push({ name: originalname, id });
    } catch (err) {
      results.push({ name: f.originalname, error: (err as Error).message });
    }
  }
  audit(req, 'library.upload', results);
  res.json({ results });
});

libraryRouter.post('/note', (req, res) => {
  const body = z
    .object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(2_000_000), tags: z.string().max(300).optional(), source: z.string().max(500).optional() })
    .parse(req.body);
  const id = createTextDocument(body.title, body.content, body.tags, body.source ?? null);
  audit(req, 'library.note', { id });
  res.json({ id });
});

libraryRouter.get('/:id', (req, res) => {
  const doc = getDocument(Number(req.params.id));
  if (!doc) {
    res.status(404).json({ error: 'Document introuvable' });
    return;
  }
  const { file_path: _f, ...rest } = doc;
  res.json({ ...rest, hasFile: Boolean(doc.file_path) });
});

libraryRouter.get('/:id/file', (req, res) => {
  const doc = getDocument(Number(req.params.id));
  const file = doc && documentFile(doc);
  if (!doc || !file) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', doc.mime ?? 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.filename ?? 'document')}`);
  res.sendFile(file);
});

libraryRouter.put('/:id', (req, res) => {
  const body = z
    .object({ title: z.string().trim().min(1).max(200).optional(), tags: z.string().max(300).optional(), notes: z.string().max(20000).optional(), content: z.string().max(5_000_000).optional() })
    .parse(req.body);
  updateDocument(Number(req.params.id), body);
  res.json({ ok: true });
});

libraryRouter.delete('/:id', (req, res) => {
  deleteDocument(Number(req.params.id));
  audit(req, 'library.delete', { id: Number(req.params.id) });
  res.json({ ok: true });
});
