import { db } from '../db.js';
import { corpusVersion } from '../voynich/analysis.js';

export interface ExperimentRow {
  id: number;
  kind: string;
  title: string;
  status: 'planned' | 'running' | 'done' | 'error';
  verdict: 'pass' | 'fail' | 'inconclusive' | null;
  criteria: string | null;
  params: string;
  result: string | null;
  summary: string | null;
  corpus_version: string | null;
  seed: number | null;
  session_id: number | null;
  agent_id: number | null;
  author_label: string | null;
  duration_ms: number | null;
  created_at: string;
  finished_at: string | null;
}

export interface Author {
  sessionId?: number | null;
  agentId?: number | null;
  authorLabel?: string | null;
}

export function getExperiment(id: number) {
  return db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as ExperimentRow | undefined;
}

export function listExperiments(opts: { kind?: string; sessionId?: number; limit?: number } = {}) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.kind) {
    where.push('kind = ?');
    args.push(opts.kind);
  }
  if (opts.sessionId) {
    where.push('session_id = ?');
    args.push(opts.sessionId);
  }
  return db
    .prepare(
      `SELECT id, kind, title, status, verdict, criteria, summary, corpus_version, seed, session_id, agent_id, author_label, duration_ms, created_at, finished_at
       FROM experiments ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
    )
    .all(...args, opts.limit ?? 200);
}

/** Pré-enregistre un test : les critères de réussite sont figés AVANT l'exécution. */
export function registerTest(t: { kind: string; title: string; criteria: unknown; params?: unknown } & Author) {
  const info = db
    .prepare(
      `INSERT INTO experiments(kind, title, status, criteria, params, session_id, agent_id, author_label, corpus_version) VALUES (?,?,'planned',?,?,?,?,?,?)`,
    )
    .run(t.kind, t.title, JSON.stringify(t.criteria), JSON.stringify(t.params ?? {}), t.sessionId ?? null, t.agentId ?? null, t.authorLabel ?? null, corpusVersion());
  return Number(info.lastInsertRowid);
}

/**
 * Exécute une analyse et la consigne dans le journal (paramètres, graine, version du corpus, résultat).
 * Si `experimentId` désigne un test pré-enregistré, ses critères sont réutilisés tels quels.
 */
export async function runExperiment<R>(
  e: { kind: string; title: string; params: unknown; seed?: number | null; experimentId?: number | null } & Author,
  fn: (criteria: Record<string, unknown> | null) => Promise<{ result: R; summary: string; verdict?: ExperimentRow['verdict'] }> | { result: R; summary: string; verdict?: ExperimentRow['verdict'] },
) {
  let id = e.experimentId ?? null;
  let criteria: Record<string, unknown> | null = null;
  if (id) {
    const planned = getExperiment(id);
    if (!planned) throw new Error(`Test #${id} introuvable`);
    if (planned.status !== 'planned') throw new Error(`Le test #${id} a déjà été exécuté ; pré-enregistrez un nouveau test.`);
    if (planned.kind !== e.kind) throw new Error(`Le test #${id} est de type « ${planned.kind} », pas « ${e.kind} ».`);
    criteria = planned.criteria ? JSON.parse(planned.criteria) : null;
    db.prepare(`UPDATE experiments SET status='running', params=?, seed=?, corpus_version=? WHERE id=?`).run(JSON.stringify(e.params), e.seed ?? null, corpusVersion(), id);
  } else {
    const info = db
      .prepare(
        `INSERT INTO experiments(kind, title, status, params, seed, session_id, agent_id, author_label, corpus_version) VALUES (?,?,'running',?,?,?,?,?,?)`,
      )
      .run(e.kind, e.title, JSON.stringify(e.params), e.seed ?? null, e.sessionId ?? null, e.agentId ?? null, e.authorLabel ?? null, corpusVersion());
    id = Number(info.lastInsertRowid);
  }
  const started = Date.now();
  try {
    const out = await fn(criteria);
    db.prepare(`UPDATE experiments SET status='done', result=?, summary=?, verdict=?, duration_ms=?, finished_at=datetime('now') WHERE id=?`).run(
      JSON.stringify(out.result),
      out.summary,
      out.verdict ?? null,
      Date.now() - started,
      id,
    );
    return { id, ...out };
  } catch (err) {
    db.prepare(`UPDATE experiments SET status='error', summary=?, duration_ms=?, finished_at=datetime('now') WHERE id=?`).run((err as Error).message, Date.now() - started, id);
    throw err;
  }
}
