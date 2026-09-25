import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { MEMORY_LABELS, MEMORY_TYPES, createMemory, searchMemories, updateMemory, type MemoryRow } from '../memory.js';

export const memoryRouter = Router();

memoryRouter.get('/meta', (_req, res) => res.json({ types: MEMORY_TYPES, labels: MEMORY_LABELS }));

memoryRouter.get('/', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const type = req.query.type ? String(req.query.type) : undefined;
  if (q) {
    res.json(searchMemories(q, { type, limit: 200, includeInactive: true }));
    return;
  }
  const rows = db
    .prepare(`SELECT * FROM memories ${type ? 'WHERE type = ?' : ''} ORDER BY pinned DESC, updated_at DESC LIMIT 1000`)
    .all(...(type ? [type] : [])) as MemoryRow[];
  res.json(rows);
});

const input = z.object({
  type: z.enum(MEMORY_TYPES),
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(20000),
  tags: z.string().max(300).optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(['active', 'confirmed', 'refuted', 'archived']).optional(),
  pinned: z.boolean().optional(),
});

memoryRouter.post('/', (req, res) => {
  const body = input.parse(req.body);
  const m = createMemory({ ...body, authorLabel: 'Chercheur principal' });
  if (body.status && body.status !== 'active') res.json(updateMemory(m.id, { status: body.status }));
  else res.json(m);
});

memoryRouter.put('/:id', (req, res) => {
  res.json(updateMemory(Number(req.params.id), input.partial().parse(req.body)));
});

memoryRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM memories WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

memoryRouter.get('/export', (_req, res) => {
  const rows = db.prepare('SELECT * FROM memories ORDER BY type, id').all() as MemoryRow[];
  const md = MEMORY_TYPES.map((t) => {
    const items = rows.filter((r) => r.type === t);
    if (!items.length) return '';
    return `## ${MEMORY_LABELS[t]}\n\n${items
      .map((m) => `### #${m.id} ${m.title}\n_Statut : ${m.status} · confiance ${Math.round(m.confidence * 100)} % · ${m.author_label ?? '—'} · ${m.updated_at}_\n\n${m.content}\n`)
      .join('\n')}`;
  })
    .filter(Boolean)
    .join('\n\n');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="memoire-voynich.md"');
  res.send(`# Mémoire de recherche — Manuscrit de Voynich\n\n${md}`);
});
