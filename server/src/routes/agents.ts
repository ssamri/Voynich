import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../security/auth.js';
import { ROLE_PRESETS } from '../orchestrator/prompts.js';
import { TOOL_GROUPS } from '../orchestrator/tools.js';
import { getAgent, type AgentRow } from '../orchestrator/runner.js';

export const agentsRouter = Router();

const view = (a: AgentRow) => ({
  id: a.id,
  name: a.name,
  providerId: a.provider_id,
  model: a.model,
  roleTitle: a.role_title,
  systemPrompt: a.system_prompt,
  temperature: a.temperature,
  maxTokens: a.max_tokens,
  effort: a.effort,
  color: a.color,
  tools: JSON.parse(a.tools) as string[],
  webSearch: Boolean(a.web_search),
  enabled: Boolean(a.enabled),
});

const toolKeys = Object.keys(TOOL_GROUPS) as [keyof typeof TOOL_GROUPS, ...(keyof typeof TOOL_GROUPS)[]];

const agentInput = z.object({
  name: z.string().trim().min(1).max(60),
  providerId: z.number().int().nullable(),
  model: z.string().trim().min(1).max(120),
  roleTitle: z.string().trim().max(200).default(''),
  systemPrompt: z.string().max(20000).default(''),
  temperature: z.number().min(0).max(2).nullable().default(null),
  maxTokens: z.number().int().min(256).max(128000).default(16000),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().default('high'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#5b8def'),
  tools: z.array(z.enum(toolKeys)).default([...toolKeys]),
  webSearch: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

agentsRouter.get('/meta', (_req, res) => res.json({ presets: ROLE_PRESETS, toolGroups: TOOL_GROUPS }));

agentsRouter.get('/', (_req, res) => {
  res.json((db.prepare('SELECT * FROM agents ORDER BY id').all() as AgentRow[]).map(view));
});

function save(id: number | null, body: z.infer<typeof agentInput>) {
  const values = [
    body.name,
    body.providerId,
    body.model,
    body.roleTitle,
    body.systemPrompt,
    body.temperature,
    body.maxTokens,
    body.effort,
    body.color,
    JSON.stringify(body.tools),
    body.webSearch ? 1 : 0,
    body.enabled ? 1 : 0,
  ];
  if (id === null) {
    const info = db
      .prepare(
        `INSERT INTO agents(name, provider_id, model, role_title, system_prompt, temperature, max_tokens, effort, color, tools, web_search, enabled)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(...values);
    return Number(info.lastInsertRowid);
  }
  db.prepare(
    `UPDATE agents SET name=?, provider_id=?, model=?, role_title=?, system_prompt=?, temperature=?, max_tokens=?, effort=?, color=?, tools=?, web_search=?, enabled=?, updated_at=datetime('now') WHERE id=?`,
  ).run(...values, id);
  return id;
}

agentsRouter.post('/', (req, res) => {
  const id = save(null, agentInput.parse(req.body));
  audit(req, 'agent.create', { id });
  res.json(view(getAgent(id)!));
});

agentsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getAgent(id)) {
    res.status(404).json({ error: 'Agent introuvable' });
    return;
  }
  save(id, agentInput.parse(req.body));
  audit(req, 'agent.update', { id });
  res.json(view(getAgent(id)!));
});

agentsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM agents WHERE id = ?').run(Number(req.params.id));
  audit(req, 'agent.delete', { id: Number(req.params.id) });
  res.json({ ok: true });
});
