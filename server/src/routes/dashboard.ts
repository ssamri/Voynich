import { Router } from 'express';
import { db } from '../db.js';
import { corpusInfo } from '../voynich/corpus.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', (_req, res) => {
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  res.json({
    counts: {
      providers: one('SELECT COUNT(*) AS n FROM providers'),
      agents: one('SELECT COUNT(*) AS n FROM agents WHERE enabled = 1'),
      documents: one('SELECT COUNT(*) AS n FROM documents'),
      memories: one(`SELECT COUNT(*) AS n FROM memories WHERE status != 'archived'`),
      sessions: one('SELECT COUNT(*) AS n FROM research_sessions'),
      messages: one(`SELECT COUNT(*) AS n FROM messages WHERE kind = 'agent'`),
    },
    memoryByType: db.prepare(`SELECT type, status, COUNT(*) AS n FROM memories GROUP BY type, status`).all(),
    usageByAgent: db
      .prepare(
        `SELECT a.id, COALESCE(a.name, m.agent_name) AS name, a.color, m.model,
                SUM(m.input_tokens) AS input_tokens, SUM(m.output_tokens) AS output_tokens, SUM(m.cache_read_tokens) AS cache_read_tokens,
                COUNT(*) AS turns, AVG(m.duration_ms) AS avg_ms
         FROM messages m LEFT JOIN agents a ON a.id = m.agent_id
         WHERE m.kind = 'agent' GROUP BY m.agent_id, m.model ORDER BY output_tokens DESC`,
      )
      .all(),
    recentMemories: db
      .prepare(`SELECT id, type, title, confidence, status, author_label, updated_at FROM memories ORDER BY updated_at DESC LIMIT 8`)
      .all(),
    recentSessions: db.prepare(`SELECT id, title, status, updated_at FROM research_sessions ORDER BY updated_at DESC LIMIT 5`).all(),
    corpus: corpusInfo(),
  });
});
