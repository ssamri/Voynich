import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../security/auth.js';
import { subscribe } from '../orchestrator/bus.js';
import { addUserMessage, getSession, isRunning, startRun, stopSession, type SessionRow } from '../orchestrator/runner.js';

export const sessionsRouter = Router();

const view = (s: SessionRow) => ({
  id: s.id,
  title: s.title,
  objective: s.objective,
  mode: s.mode,
  agentIds: JSON.parse(s.agent_ids) as number[],
  leadAgentId: s.lead_agent_id,
  roundsPerRun: s.rounds_per_run,
  contextDocIds: JSON.parse(s.context_doc_ids) as number[],
  status: isRunning(s.id) ? 'running' : s.status === 'running' ? 'idle' : s.status,
  summary: s.summary,
});

const input = z.object({
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(10000),
  mode: z.enum(['roundtable', 'orchestrated']).default('roundtable'),
  agentIds: z.array(z.number().int()).min(1),
  leadAgentId: z.number().int().nullable().optional(),
  roundsPerRun: z.number().int().min(1).max(20).default(2),
  contextDocIds: z.array(z.number().int()).max(30).default([]),
});

sessionsRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.kind != 'tool') AS message_count,
              (SELECT COALESCE(SUM(input_tokens + output_tokens),0) FROM messages m WHERE m.session_id = s.id) AS tokens
       FROM research_sessions s ORDER BY s.updated_at DESC`,
    )
    .all() as (SessionRow & { message_count: number; tokens: number; updated_at: string; created_at: string })[];
  res.json(rows.map((r) => ({ ...view(r), messageCount: r.message_count, tokens: r.tokens, updatedAt: r.updated_at, createdAt: r.created_at })));
});

sessionsRouter.post('/', (req, res) => {
  const b = input.parse(req.body);
  const info = db
    .prepare(
      `INSERT INTO research_sessions(title, objective, mode, agent_ids, lead_agent_id, rounds_per_run, context_doc_ids) VALUES (?,?,?,?,?,?,?)`,
    )
    .run(b.title, b.objective, b.mode, JSON.stringify(b.agentIds), b.leadAgentId ?? null, b.roundsPerRun, JSON.stringify(b.contextDocIds));
  audit(req, 'session.create', { id: info.lastInsertRowid });
  res.json(view(getSession(Number(info.lastInsertRowid))!));
});

sessionsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = getSession(id);
  if (!cur) {
    res.status(404).json({ error: 'Séance introuvable' });
    return;
  }
  const b = input.partial().parse(req.body);
  db.prepare(
    `UPDATE research_sessions SET title=?, objective=?, mode=?, agent_ids=?, lead_agent_id=?, rounds_per_run=?, context_doc_ids=?, updated_at=datetime('now') WHERE id=?`,
  ).run(
    b.title ?? cur.title,
    b.objective ?? cur.objective,
    b.mode ?? cur.mode,
    b.agentIds ? JSON.stringify(b.agentIds) : cur.agent_ids,
    b.leadAgentId === undefined ? cur.lead_agent_id : b.leadAgentId,
    b.roundsPerRun ?? cur.rounds_per_run,
    b.contextDocIds ? JSON.stringify(b.contextDocIds) : cur.context_doc_ids,
    id,
  );
  res.json(view(getSession(id)!));
});

sessionsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  stopSession(id);
  db.prepare('DELETE FROM research_sessions WHERE id = ?').run(id);
  audit(req, 'session.delete', { id });
  res.json({ ok: true });
});

sessionsRouter.get('/:id', (req, res) => {
  const s = getSession(Number(req.params.id));
  if (!s) {
    res.status(404).json({ error: 'Séance introuvable' });
    return;
  }
  const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id').all(s.id);
  res.json({ session: view(s), messages });
});

sessionsRouter.post('/:id/messages', (req, res) => {
  const { content, run, rounds } = z
    .object({ content: z.string().trim().min(1).max(50000), run: z.boolean().default(false), rounds: z.number().int().min(1).max(20).optional() })
    .parse(req.body);
  const id = Number(req.params.id);
  if (!getSession(id)) {
    res.status(404).json({ error: 'Séance introuvable' });
    return;
  }
  const message = addUserMessage(id, content);
  if (run && !isRunning(id)) startRun(id, { rounds });
  res.json({ message });
});

sessionsRouter.post('/:id/run', (req, res) => {
  const b = z
    .object({ rounds: z.number().int().min(1).max(20).optional(), agentIds: z.array(z.number().int()).optional(), synthesizeWith: z.number().int().optional() })
    .parse(req.body ?? {});
  const id = Number(req.params.id);
  startRun(id, { rounds: b.rounds, agentIds: b.agentIds, synthesize: b.synthesizeWith ? { agentId: b.synthesizeWith } : undefined });
  res.json({ ok: true });
});

sessionsRouter.post('/:id/stop', (req, res) => {
  stopSession(Number(req.params.id));
  res.json({ ok: true });
});

/** Flux temps réel (Server-Sent Events) des événements de la séance. */
sessionsRouter.get('/:id/stream', (req, res) => {
  const id = Number(req.params.id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ running: isRunning(id) })}\n\n`);
  const unsubscribe = subscribe(id, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

sessionsRouter.get('/:id/export', (req, res) => {
  const s = getSession(Number(req.params.id));
  if (!s) {
    res.status(404).end();
    return;
  }
  const msgs = db.prepare(`SELECT * FROM messages WHERE session_id = ? AND kind != 'tool' ORDER BY id`).all(s.id) as {
    kind: string;
    agent_name: string | null;
    content: string;
    created_at: string;
  }[];
  const body = msgs
    .map((m) => `### ${m.kind === 'user' ? 'Chercheur principal' : m.agent_name ?? 'Agent'} — ${m.created_at}\n\n${m.content}`)
    .join('\n\n---\n\n');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="seance-${s.id}.md"`);
  res.send(`# ${s.title}\n\n**Objectif :** ${s.objective}\n\n${s.summary ? `## Synthèse\n\n${s.summary}\n\n` : ''}## Transcription\n\n${body}\n`);
});
