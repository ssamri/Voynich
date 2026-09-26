import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../security/auth.js';
import { subscribe } from '../orchestrator/bus.js';
import { getCampaign, runCampaignNow, upsertCampaign } from '../orchestrator/campaigns.js';
import { addUserMessage, getSession, isRunning, startRun, stopSession } from '../orchestrator/runner.js';
export const sessionsRouter = Router();
const view = (s) => ({
    id: s.id,
    title: s.title,
    objective: s.objective,
    mode: s.mode,
    agentIds: JSON.parse(s.agent_ids),
    leadAgentId: s.lead_agent_id,
    roundsPerRun: s.rounds_per_run,
    contextDocIds: JSON.parse(s.context_doc_ids),
    status: isRunning(s.id) ? 'running' : s.status === 'running' ? 'idle' : s.status,
    summary: s.summary,
    tokenBudget: s.token_budget,
});
const input = z.object({
    title: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(10000),
    mode: z.enum(['roundtable', 'orchestrated', 'cycle']).default('roundtable'),
    agentIds: z.array(z.number().int()).min(1),
    leadAgentId: z.number().int().nullable().optional(),
    roundsPerRun: z.number().int().min(1).max(20).default(2),
    contextDocIds: z.array(z.number().int()).max(30).default([]),
    tokenBudget: z.number().int().min(10000).max(50_000_000).nullable().optional(),
});
sessionsRouter.get('/', (_req, res) => {
    const rows = db
        .prepare(`SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.kind != 'tool') AS message_count,
              (SELECT COALESCE(SUM(input_tokens + output_tokens),0) FROM messages m WHERE m.session_id = s.id) AS tokens
       FROM research_sessions s ORDER BY s.updated_at DESC`)
        .all();
    res.json(rows.map((r) => ({ ...view(r), messageCount: r.message_count, tokens: r.tokens, updatedAt: r.updated_at, createdAt: r.created_at })));
});
sessionsRouter.post('/', (req, res) => {
    const b = input.parse(req.body);
    const info = db
        .prepare(`INSERT INTO research_sessions(title, objective, mode, agent_ids, lead_agent_id, rounds_per_run, context_doc_ids, token_budget) VALUES (?,?,?,?,?,?,?,?)`)
        .run(b.title, b.objective, b.mode, JSON.stringify(b.agentIds), b.leadAgentId ?? null, b.roundsPerRun, JSON.stringify(b.contextDocIds), b.tokenBudget ?? null);
    audit(req, 'session.create', { id: info.lastInsertRowid });
    res.json(view(getSession(Number(info.lastInsertRowid))));
});
sessionsRouter.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const cur = getSession(id);
    if (!cur) {
        res.status(404).json({ error: 'Séance introuvable' });
        return;
    }
    const b = input.partial().parse(req.body);
    db.prepare(`UPDATE research_sessions SET title=?, objective=?, mode=?, agent_ids=?, lead_agent_id=?, rounds_per_run=?, context_doc_ids=?, token_budget=?, updated_at=datetime('now') WHERE id=?`).run(b.title ?? cur.title, b.objective ?? cur.objective, b.mode ?? cur.mode, b.agentIds ? JSON.stringify(b.agentIds) : cur.agent_ids, b.leadAgentId === undefined ? cur.lead_agent_id : b.leadAgentId, b.roundsPerRun ?? cur.rounds_per_run, b.contextDocIds ? JSON.stringify(b.contextDocIds) : cur.context_doc_ids, b.tokenBudget === undefined ? cur.token_budget : b.tokenBudget, id);
    res.json(view(getSession(id)));
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
    if (run && !isRunning(id))
        startRun(id, { rounds });
    res.json({ message });
});
sessionsRouter.post('/:id/run', (req, res) => {
    const b = z
        .object({
        rounds: z.number().int().min(1).max(20).optional(),
        agentIds: z.array(z.number().int()).optional(),
        synthesizeWith: z.number().int().optional(),
        tokenBudget: z.number().int().min(10000).optional(),
    })
        .parse(req.body ?? {});
    const id = Number(req.params.id);
    startRun(id, { rounds: b.rounds, agentIds: b.agentIds, tokenBudget: b.tokenBudget, synthesize: b.synthesizeWith ? { agentId: b.synthesizeWith } : undefined });
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
    const msgs = db.prepare(`SELECT * FROM messages WHERE session_id = ? AND kind != 'tool' ORDER BY id`).all(s.id);
    const body = msgs
        .map((m) => `### ${m.kind === 'user' ? 'Chercheur principal' : m.agent_name ?? 'Agent'} — ${m.created_at}\n\n${m.content}`)
        .join('\n\n---\n\n');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="seance-${s.id}.md"`);
    res.send(`# ${s.title}\n\n**Objectif :** ${s.objective}\n\n${s.summary ? `## Synthèse\n\n${s.summary}\n\n` : ''}## Transcription\n\n${body}\n`);
});
/** Campagne nocturne : exécution planifiée avec budget et rapport du matin. */
sessionsRouter.get('/:id/campaign', (req, res) => res.json(getCampaign(Number(req.params.id)) ?? null));
sessionsRouter.put('/:id/campaign', (req, res) => {
    const b = z
        .object({
        enabled: z.boolean(),
        hour: z.number().int().min(0).max(23),
        rounds: z.number().int().min(1).max(20),
        tokenBudget: z.number().int().min(10000).max(50_000_000),
        reportAgentId: z.number().int().nullable().optional(),
    })
        .parse(req.body);
    res.json(upsertCampaign(Number(req.params.id), b));
});
sessionsRouter.post('/:id/campaign/run', (req, res) => {
    runCampaignNow(Number(req.params.id));
    res.json({ ok: true });
});
//# sourceMappingURL=sessions.js.map