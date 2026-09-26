import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { audit } from '../security/auth.js';
import { encrypt, maskKey } from '../security/crypto.js';
import { getSearchSettings, saveSearchSettings, webSearch } from '../web/search.js';
import { FREE_PRESETS, PROVIDER_KINDS, buildProvider, getProviderRow, invalidateProvider, type ProviderRow } from '../llm/registry.js';

export const providersRouter = Router();

const publicView = (p: ProviderRow) => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  baseUrl: p.base_url,
  hasKey: Boolean(p.api_key_enc),
  keyHint: p.api_key_hint,
  defaultModel: p.default_model,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});

const baseUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//.test(u), 'URL http(s) attendue')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

const providerInput = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['anthropic', 'openai', 'openai_compatible']),
  baseUrl,
  apiKey: z.string().trim().max(500).optional(),
  defaultModel: z.string().trim().max(120).optional().nullable(),
});

providersRouter.get('/kinds', (_req, res) => res.json(PROVIDER_KINDS));
providersRouter.get('/presets', (_req, res) => res.json(FREE_PRESETS));

/** Moteur de recherche internet utilisé par les IA sans recherche native. */
providersRouter.get('/web-search', (_req, res) => res.json(getSearchSettings()));
providersRouter.put('/web-search', (req, res) => {
  const b = z.object({ engine: z.enum(['wikipedia', 'tavily', 'brave']), apiKey: z.string().trim().max(300).optional() }).parse(req.body);
  saveSearchSettings(b.engine, b.apiKey || undefined);
  audit(req, 'web_search.update', { engine: b.engine, keyChanged: Boolean(b.apiKey) });
  res.json(getSearchSettings());
});
providersRouter.post('/web-search/test', async (_req, res) => {
  try {
    const r = await webSearch('Voynich manuscript', 3);
    res.json({ ok: true, engine: r.engine, count: r.results.length, first: r.results[0]?.title ?? null });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message });
  }
});

providersRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM providers ORDER BY id').all() as ProviderRow[];
  res.json(rows.map(publicView));
});

providersRouter.post('/', (req, res) => {
  const body = providerInput.parse(req.body);
  if (body.kind !== 'openai_compatible' && !body.apiKey) {
    res.status(400).json({ error: 'Clé API requise' });
    return;
  }
  const info = db
    .prepare('INSERT INTO providers(name, kind, base_url, api_key_enc, api_key_hint, default_model) VALUES (?,?,?,?,?,?)')
    .run(
      body.name,
      body.kind,
      body.baseUrl ?? null,
      body.apiKey ? encrypt(body.apiKey) : null,
      body.apiKey ? maskKey(body.apiKey) : null,
      body.defaultModel || PROVIDER_KINDS[body.kind].defaultModel || null,
    );
  audit(req, 'provider.create', { id: info.lastInsertRowid, name: body.name, kind: body.kind });
  res.json(publicView(getProviderRow(Number(info.lastInsertRowid))!));
});

providersRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = getProviderRow(id);
  if (!cur) {
    res.status(404).json({ error: 'Fournisseur introuvable' });
    return;
  }
  const body = providerInput.partial().parse(req.body);
  db.prepare(
    `UPDATE providers SET name=?, kind=?, base_url=?, api_key_enc=?, api_key_hint=?, default_model=?, updated_at=datetime('now') WHERE id=?`,
  ).run(
    body.name ?? cur.name,
    body.kind ?? cur.kind,
    body.baseUrl === undefined ? cur.base_url : body.baseUrl,
    body.apiKey ? encrypt(body.apiKey) : cur.api_key_enc,
    body.apiKey ? maskKey(body.apiKey) : cur.api_key_hint,
    body.defaultModel === undefined ? cur.default_model : body.defaultModel,
    id,
  );
  invalidateProvider(id);
  audit(req, 'provider.update', { id, keyChanged: Boolean(body.apiKey) });
  res.json(publicView(getProviderRow(id)!));
});

providersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  invalidateProvider(id);
  audit(req, 'provider.delete', { id });
  res.json({ ok: true });
});

/** Teste la connexion en listant les modèles disponibles. */
providersRouter.get('/:id/models', async (req, res) => {
  const row = getProviderRow(Number(req.params.id));
  if (!row) {
    res.status(404).json({ error: 'Fournisseur introuvable' });
    return;
  }
  try {
    const started = Date.now();
    const models = await buildProvider(row).listModels();
    res.json({ ok: true, latencyMs: Date.now() - started, models });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message });
  }
});
