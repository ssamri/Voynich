import fs from 'node:fs';
import { db } from '../db.js';
import { buildProvider, getProviderRow } from '../llm/registry.js';
import type { ContentPart, Effort, NeutralMessage } from '../llm/types.js';
import { documentFile, getDocument } from '../library/library.js';
import { formatMemory, pinnedMemories, searchMemories } from '../memory.js';
import { publish } from './bus.js';
import { VOYNICH_BRIEF } from './prompts.js';
import { buildTools, TOOL_GROUPS, type ToolGroup } from './tools.js';

export interface AgentRow {
  id: number;
  name: string;
  provider_id: number | null;
  model: string;
  role_title: string;
  system_prompt: string;
  temperature: number | null;
  max_tokens: number;
  effort: Effort | null;
  color: string;
  tools: string;
  web_search: number;
  enabled: number;
}

export interface SessionRow {
  id: number;
  title: string;
  objective: string;
  mode: 'roundtable' | 'orchestrated';
  agent_ids: string;
  lead_agent_id: number | null;
  rounds_per_run: number;
  context_doc_ids: string;
  status: string;
  summary: string | null;
}

interface MessageRow {
  id: number;
  kind: 'user' | 'agent' | 'tool' | 'system';
  agent_id: number | null;
  agent_name: string | null;
  content: string;
}

const MAX_TOOL_STEPS = 12;
const HISTORY_CHAR_BUDGET = 160_000;
const CONTEXT_DOC_CHAR_BUDGET = 60_000;
const DONE_MARKER = /STATUT\s*:\s*TERMIN[ÉE]/i;

const running = new Map<number, AbortController>();

export const isRunning = (sessionId: number) => running.has(sessionId);

export function stopSession(sessionId: number) {
  running.get(sessionId)?.abort();
}

export function getSession(id: number) {
  return db.prepare('SELECT * FROM research_sessions WHERE id = ?').get(id) as SessionRow | undefined;
}

export function getAgent(id: number) {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
}

export function getMessage(id: number) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

function sessionAgents(session: SessionRow) {
  const ids = JSON.parse(session.agent_ids) as number[];
  return ids.map(getAgent).filter((a): a is AgentRow => Boolean(a && a.enabled));
}

function setStatus(sessionId: number, status: string, detail?: string) {
  db.prepare(`UPDATE research_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, sessionId);
  publish(sessionId, { type: 'status', status, detail });
}

export function addUserMessage(sessionId: number, content: string) {
  const info = db.prepare(`INSERT INTO messages(session_id, kind, content) VALUES (?, 'user', ?)`).run(sessionId, content);
  const message = getMessage(Number(info.lastInsertRowid));
  publish(sessionId, { type: 'message', message });
  return message;
}

function systemPrompt(agent: AgentRow, session: SessionRow, team: AgentRow[]) {
  const others = team.filter((a) => a.id !== agent.id);
  return [
    VOYNICH_BRIEF,
    `## Ton identité\nTu es « ${agent.name} »${agent.role_title ? `, ${agent.role_title}` : ''}.\n${agent.system_prompt}`.trim(),
    `## Équipe\n${
      others.map((a) => `- ${a.name} : ${a.role_title || 'agent'}`).join('\n') || '- (aucun autre agent)'
    }\n- Chercheur principal : l'humain qui dirige le projet. Ses consignes priment.`,
    `## Séance « ${session.title} »\nObjectif : ${session.objective}\nMode : ${
      session.mode === 'orchestrated' ? 'dirigé par un directeur de recherche qui délègue' : 'table ronde, chacun à son tour'
    }.`,
  ].join('\n\n');
}

/** Mémoire injectée dans le dernier message (volatile) pour préserver le cache du prompt système. */
function memoryDigest(session: SessionRow, recentText: string) {
  const pinned = pinnedMemories();
  const seen = new Set(pinned.map((m) => m.id));
  const relevant = searchMemories(`${session.objective} ${recentText}`.slice(0, 2000), { limit: 8 }).filter((m) => !seen.has(m.id));
  const parts: string[] = [];
  if (pinned.length) parts.push(`### Mémoire épinglée\n${pinned.map(formatMemory).join('\n\n')}`);
  if (relevant.length) parts.push(`### Mémoire pertinente\n${relevant.map(formatMemory).join('\n\n')}`);
  return parts.length ? `## Mémoire partagée de l'équipe\n${parts.join('\n\n')}` : '';
}

function contextParts(session: SessionRow): ContentPart[] {
  const ids = JSON.parse(session.context_doc_ids) as number[];
  const parts: ContentPart[] = [];
  let budget = CONTEXT_DOC_CHAR_BUDGET;
  for (const id of ids) {
    const doc = getDocument(id);
    if (!doc) continue;
    if (doc.kind === 'image') {
      const file = documentFile(doc);
      if (file && fs.existsSync(file) && doc.mime) {
        parts.push({ type: 'text', text: `Document #${doc.id} (image) : « ${doc.title} »${doc.notes ? ` — ${doc.notes}` : ''}` });
        parts.push({ type: 'image', mediaType: doc.mime, data: fs.readFileSync(file).toString('base64') });
      }
    } else {
      const take = Math.max(0, Math.min(doc.content.length, budget));
      budget -= take;
      const truncated = take < doc.content.length;
      parts.push({
        type: 'text',
        text: `Document de contexte #${doc.id} : « ${doc.title} »${
          truncated ? ` (extrait ${take}/${doc.content.length} caractères — lire la suite avec read_document)` : ''
        }\n\n${doc.content.slice(0, take)}`,
      });
    }
  }
  return parts;
}

function buildHistory(session: SessionRow, agent: AgentRow, finalInstruction: string): NeutralMessage[] {
  const rows = db
    .prepare(`SELECT id, kind, agent_id, agent_name, content FROM messages WHERE session_id = ? AND kind IN ('user','agent') AND content != '' ORDER BY id`)
    .all(session.id) as MessageRow[];

  // On garde les messages les plus récents dans la limite du budget.
  const kept: MessageRow[] = [];
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    used += rows[i].content.length;
    if (used > HISTORY_CHAR_BUDGET && kept.length > 0) break;
    kept.unshift(rows[i]);
  }
  const omitted = rows.length - kept.length;

  const msgs: NeutralMessage[] = [];
  const push = (role: 'user' | 'assistant', parts: ContentPart[]) => {
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content.push(...parts);
    else msgs.push({ role, content: [...parts] });
  };

  push('user', [
    {
      type: 'text',
      text: `[Système] Ouverture de la séance « ${session.title} ».\nObjectif : ${session.objective}${
        omitted ? `\n(${omitted} messages plus anciens omis — consulter la mémoire partagée pour les acquis.)` : ''
      }`,
    },
    ...contextParts(session),
  ]);

  for (const r of kept) {
    if (r.kind === 'user') push('user', [{ type: 'text', text: `[Chercheur principal] : ${r.content}` }]);
    else if (r.agent_id === agent.id) push('assistant', [{ type: 'text', text: r.content }]);
    else push('user', [{ type: 'text', text: `[${r.agent_name ?? 'Agent'}] : ${r.content}` }]);
  }

  const recent = kept.slice(-4).map((r) => r.content).join(' ');
  const digest = memoryDigest(session, recent);
  push('user', [{ type: 'text', text: [digest, finalInstruction].filter(Boolean).join('\n\n') }]);
  return msgs;
}

interface TurnOptions {
  instruction: string;
  signal: AbortSignal;
  team: AgentRow[];
  /** Si défini, l'agent répond à une consultation (pas de ask_agent pour éviter la récursion). */
  consultedBy?: { name: string; messageId: number };
}

async function runTurn(session: SessionRow, agent: AgentRow, opts: TurnOptions): Promise<string> {
  const info = db
    .prepare(`INSERT INTO messages(session_id, kind, agent_id, agent_name, model, parent_id) VALUES (?, 'agent', ?, ?, ?, ?)`)
    .run(session.id, agent.id, agent.name, agent.model, opts.consultedBy?.messageId ?? null);
  const messageId = Number(info.lastInsertRowid);
  const tempId = String(messageId);
  publish(session.id, { type: 'turn_start', tempId, agentId: agent.id, agentName: agent.name, color: agent.color });

  const started = Date.now();
  let partial = '';
  let thinking = '';
  const toolInputs = new Map<string, unknown>();

  const finish = (fields: { content: string; thinking?: string; error?: string | null; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number }; model?: string }) => {
    db.prepare(
      `UPDATE messages SET content = ?, thinking = ?, error = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, duration_ms = ?, model = COALESCE(?, model) WHERE id = ?`,
    ).run(
      fields.content,
      fields.thinking || null,
      fields.error ?? null,
      fields.usage?.inputTokens ?? 0,
      fields.usage?.outputTokens ?? 0,
      fields.usage?.cacheReadTokens ?? 0,
      Date.now() - started,
      fields.model ?? null,
      messageId,
    );
    publish(session.id, { type: 'turn_end', tempId, message: getMessage(messageId) });
  };

  try {
    if (!agent.provider_id) throw new Error(`L'agent ${agent.name} n'a pas de fournisseur configuré.`);
    const providerRow = getProviderRow(agent.provider_id);
    if (!providerRow) throw new Error(`Fournisseur introuvable pour ${agent.name}.`);
    const provider = buildProvider(providerRow);

    const groups = (JSON.parse(agent.tools) as ToolGroup[]).filter((g) => g in TOOL_GROUPS);
    const others = opts.team.filter((a) => a.id !== agent.id);
    const tools = buildTools({
      sessionId: session.id,
      agentId: agent.id,
      agentName: agent.name,
      groups,
      otherAgents: others.map((a) => a.name),
      askAgent: opts.consultedBy
        ? undefined
        : async (name, question) => {
            const target = others.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
            if (!target) return `Agent « ${name} » inconnu. Agents disponibles : ${others.map((a) => a.name).join(', ')}`;
            return runTurn(session, target, {
              team: opts.team,
              signal: opts.signal,
              consultedBy: { name: agent.name, messageId },
              instruction: `[${agent.name} te consulte] ${question}\n\nRéponds précisément et de manière autonome ; utilise tes outils si nécessaire.`,
            });
          },
    });

    const result = await provider.runAgentLoop({
      model: agent.model,
      system: systemPrompt(agent, session, opts.team),
      messages: buildHistory(session, agent, opts.instruction),
      tools,
      maxTokens: agent.max_tokens,
      temperature: agent.temperature,
      effort: agent.effort,
      webSearch: Boolean(agent.web_search),
      maxSteps: MAX_TOOL_STEPS,
      signal: opts.signal,
      events: {
        onText: (text) => {
          partial += text;
          publish(session.id, { type: 'delta', tempId, text });
        },
        onThinking: (text) => {
          thinking += text;
          publish(session.id, { type: 'thinking', tempId, text });
        },
        onToolCall: ({ id, name, input }) => {
          toolInputs.set(id, input);
          publish(session.id, { type: 'tool_call', tempId, callId: id, name, input });
        },
        onToolResult: ({ id, name, output, isError }) => {
          db.prepare(
            `INSERT INTO messages(session_id, kind, agent_id, agent_name, tool_name, tool_input, tool_output, parent_id, error) VALUES (?, 'tool', ?, ?, ?, ?, ?, ?, ?)`,
          ).run(session.id, agent.id, agent.name, name, JSON.stringify(toolInputs.get(id) ?? null), output, messageId, isError ? 'erreur' : null);
          publish(session.id, { type: 'tool_result', tempId, callId: id, name, output, isError });
        },
      },
    });
    finish({ content: result.text || '_(aucune réponse textuelle)_', thinking: result.thinking, usage: result.usage, model: result.model });
    return result.text;
  } catch (err) {
    const aborted = opts.signal.aborted;
    const error = aborted ? 'Interrompu par le chercheur' : (err as Error).message;
    finish({ content: partial, thinking, error });
    if (aborted) throw err;
    publish(session.id, { type: 'error', error: `${agent.name} : ${error}` });
    return `Erreur de ${agent.name} : ${error}`;
  }
}

export interface RunOptions {
  rounds?: number;
  agentIds?: number[];
  synthesize?: { agentId: number };
}

export function startRun(sessionId: number, opts: RunOptions = {}) {
  const session = getSession(sessionId);
  if (!session) throw new Error('Séance introuvable');
  if (running.has(sessionId)) throw new Error('La séance est déjà en cours');
  const team = sessionAgents(session);
  if (!team.length) throw new Error('Aucun agent actif dans cette séance');

  const controller = new AbortController();
  running.set(sessionId, controller);
  setStatus(sessionId, 'running');

  (async () => {
    const signal = controller.signal;
    try {
      if (opts.synthesize) {
        const agent = getAgent(opts.synthesize.agentId);
        if (!agent) throw new Error('Agent de synthèse introuvable');
        const text = await runTurn(session, agent, {
          team,
          signal,
          instruction: `[Système] Rédige la SYNTHÈSE de la séance : 1) acquis établis (avec niveau de confiance), 2) hypothèses en cours et tests associés, 3) impasses, 4) prochaines étapes priorisées. Enregistre les éléments clés dans la mémoire partagée (save_memory / update_memory) avant de répondre.`,
        });
        db.prepare(`UPDATE research_sessions SET summary = ? WHERE id = ?`).run(text, sessionId);
        return;
      }

      const rounds = Math.max(1, Math.min(opts.rounds ?? session.rounds_per_run, 20));
      if (session.mode === 'orchestrated') {
        const lead = team.find((a) => a.id === session.lead_agent_id) ?? team[0];
        for (let r = 0; r < rounds && !signal.aborted; r++) {
          const text = await runTurn(session, lead, {
            team,
            signal,
            instruction: `[Système] Tour ${r + 1}/${rounds}. Tu diriges la séance : fixe l'étape suivante, délègue les questions précises aux spécialistes via ask_agent, confronte leurs réponses, fais tester les hypothèses sur le corpus et consigne les résultats dans la mémoire. Termine par une synthèse d'étape. Si l'objectif est atteint ou si tu as besoin d'une décision du chercheur principal, termine par la ligne « STATUT: TERMINÉ ».`,
          });
          if (DONE_MARKER.test(text)) break;
        }
      } else {
        const order = opts.agentIds?.length ? team.filter((a) => opts.agentIds!.includes(a.id)) : team;
        for (let r = 0; r < rounds && !signal.aborted; r++) {
          for (const agent of order) {
            if (signal.aborted) break;
            await runTurn(session, agent, {
              team,
              signal,
              instruction: `[Système] Tour ${r + 1}/${rounds} — c'est à toi, ${agent.name}. Réagis précisément aux dernières contributions (accord, désaccord argumenté, compléments), fais avancer la recherche selon ton rôle en utilisant tes outils quand c'est utile, puis termine par 1 à 3 propositions concrètes pour la suite.`,
            });
          }
        }
      }
    } catch (err) {
      if (!signal.aborted) publish(sessionId, { type: 'error', error: (err as Error).message });
    } finally {
      running.delete(sessionId);
      setStatus(sessionId, signal.aborted ? 'stopped' : 'idle');
    }
  })();
}
