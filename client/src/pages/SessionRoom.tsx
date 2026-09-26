import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, Brain, Globe, Moon, ChevronRight, Download, Play, Send, Square, Wrench, FileText, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatTokens, useFetch } from '../lib/hooks';
import type { Agent, Memory, Message, ResearchSession } from '../lib/types';
import { MEMORY_LABELS } from '../lib/types';
import Markdown from '../components/Markdown';
import { ErrorBox, Spinner, toast } from '../components/ui';

interface ToolEntry {
  key: string;
  name: string;
  input: unknown;
  output?: string;
  isError?: boolean;
}

type LiveMessage = Message & { streaming?: boolean };

type StreamEvent =
  | { type: 'status'; status: string }
  | { type: 'message'; message: Message }
  | { type: 'turn_start'; tempId: string; agentId: number; agentName: string; color: string }
  | { type: 'delta'; tempId: string; text: string }
  | { type: 'thinking'; tempId: string; text: string }
  | { type: 'tool_call'; tempId: string; callId: string; name: string; input: unknown }
  | { type: 'tool_result'; tempId: string; callId: string; name: string; output: string; isError: boolean }
  | { type: 'turn_end'; tempId: string; message: Message }
  | { type: 'memory'; memory: Memory }
  | { type: 'error'; error: string };

function parseJson(s: string | null) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export default function SessionRoom() {
  const { id } = useParams();
  const sessionId = Number(id);
  const agents = useFetch(() => api.get<Agent[]>('/agents'));
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [tools, setTools] = useState<Record<number, ToolEntry[]>>({});
  const [memories, setMemories] = useState<Memory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [rounds, setRounds] = useState(2);
  const [synthAgent, setSynthAgent] = useState<number | ''>('');
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ session: ResearchSession; messages: Message[] }>(`/sessions/${sessionId}`);
      setSession(r.session);
      setRounds(r.session.roundsPerRun);
      const t: Record<number, ToolEntry[]> = {};
      for (const m of r.messages.filter((x) => x.kind === 'tool' && x.parent_id)) {
        (t[m.parent_id!] ??= []).push({ key: `db-${m.id}`, name: m.tool_name ?? '?', input: parseJson(m.tool_input), output: m.tool_output ?? '', isError: Boolean(m.error) });
      }
      setTools(t);
      setMessages(r.messages.filter((m) => m.kind !== 'tool'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // Flux temps réel
  useEffect(() => {
    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    let first = true;
    es.addEventListener('hello', () => {
      if (!first) load(); // resynchronisation après reconnexion
      first = false;
    });
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as StreamEvent;
      switch (e.type) {
        case 'status':
          setSession((s) => (s ? { ...s, status: e.status } : s));
          break;
        case 'message':
          setMessages((ms) => (ms.some((m) => m.id === e.message.id) ? ms : [...ms, e.message]));
          break;
        case 'turn_start':
          setMessages((ms) => [
            ...ms,
            {
              id: Number(e.tempId),
              session_id: sessionId,
              kind: 'agent',
              agent_id: e.agentId,
              agent_name: e.agentName,
              content: '',
              thinking: '',
              tool_name: null,
              tool_input: null,
              tool_output: null,
              parent_id: null,
              model: null,
              input_tokens: 0,
              output_tokens: 0,
              cache_read_tokens: 0,
              duration_ms: null,
              error: null,
              created_at: new Date().toISOString(),
              streaming: true,
            },
          ]);
          break;
        case 'delta':
          setMessages((ms) => ms.map((m) => (m.id === Number(e.tempId) ? { ...m, content: m.content + e.text } : m)));
          break;
        case 'thinking':
          setMessages((ms) => ms.map((m) => (m.id === Number(e.tempId) ? { ...m, thinking: (m.thinking ?? '') + e.text } : m)));
          break;
        case 'tool_call':
          setTools((t) => ({ ...t, [Number(e.tempId)]: [...(t[Number(e.tempId)] ?? []), { key: e.callId, name: e.name, input: e.input }] }));
          break;
        case 'tool_result':
          setTools((t) => {
            const list = t[Number(e.tempId)] ?? [];
            const exists = list.some((x) => x.key === e.callId);
            const next = exists
              ? list.map((x) => (x.key === e.callId ? { ...x, output: e.output, isError: e.isError } : x))
              : [...list, { key: e.callId, name: e.name, input: null, output: e.output, isError: e.isError }];
            return { ...t, [Number(e.tempId)]: next };
          });
          break;
        case 'turn_end':
          setMessages((ms) => ms.map((m) => (m.id === Number(e.tempId) ? { ...e.message, streaming: false } : m)));
          break;
        case 'memory':
          setMemories((list) => [e.memory, ...list.filter((m) => m.id !== e.memory.id)]);
          toast.ok(`Mémoire : ${MEMORY_LABELS[e.memory.type]} « ${e.memory.title} »`);
          break;
        case 'error':
          toast.err(e.error);
          break;
      }
    };
    return () => es.close();
  }, [sessionId, load]);

  // Défilement automatique si l'utilisateur est en bas.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, tools]);

  const agentById = useMemo(() => new Map((agents.data ?? []).map((a) => [a.id, a])), [agents.data]);
  const participants = (session?.agentIds ?? []).map((i) => agentById.get(i)).filter(Boolean) as Agent[];
  const running = session?.status === 'running';
  const totals = messages.reduce((acc, m) => ({ in: acc.in + m.input_tokens, out: acc.out + m.output_tokens, cache: acc.cache + m.cache_read_tokens }), { in: 0, out: 0, cache: 0 });

  async function run(extra?: { synthesizeWith?: number }) {
    try {
      await api.post(`/sessions/${sessionId}/run`, { rounds, ...extra });
      stick.current = true;
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function send(andRun: boolean) {
    if (!input.trim()) return;
    try {
      await api.post(`/sessions/${sessionId}/messages`, { content: input, run: andRun && !running, rounds });
      setInput('');
      stick.current = true;
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  if (error) return <div className="p-8"><ErrorBox error={error} /></div>;
  if (!session) return <div className="p-8"><Spinner /></div>;

  return (
    <div className="flex h-full flex-col xl:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-700/80 px-4 py-3 sm:px-6">
          <Link to="/sessions" className="text-fg-400 hover:text-fg-50" aria-label="Retour">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-0">
            <h1 className="h-display truncate text-2xl">{session.title}</h1>
            <div className="flex items-center gap-2 text-xs text-fg-400">
              <span className={clsx('h-2 w-2 rounded-full', running ? 'animate-pulse bg-success-400' : 'bg-surface-500')} />
              {running ? 'Les agents travaillent…' : session.status === 'stopped' ? 'Interrompue' : 'En attente'}
              <span>· {session.mode === 'orchestrated' ? 'dirigée' : session.mode === 'cycle' ? 'cycles de recherche' : 'table ronde'}</span>
              {session.tokenBudget ? <span>· budget {formatTokens(session.tokenBudget)} tokens</span> : null}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <label className="flex items-center gap-2 text-xs text-fg-400">
              Tours
              <input type="number" min={1} max={20} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className="input w-16 py-1.5" />
            </label>
            {running ? (
              <button className="btn-danger" onClick={() => api.post(`/sessions/${sessionId}/stop`)}>
                <Square className="h-4 w-4" /> Arrêter
              </button>
            ) : (
              <button className="btn-primary" onClick={() => run()}>
                <Play className="h-4 w-4" /> Lancer
              </button>
            )}
            <a className="btn-ghost" href={`/api/sessions/${sessionId}/export`} title="Exporter en Markdown">
              <Download className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          <div className="mx-auto max-w-4xl space-y-5">
            <div className="card border-primary-500/20 p-4">
              <div className="label">Objectif</div>
              <p className="text-sm text-fg-100">{session.objective}</p>
            </div>
            {messages.length === 0 && (
              <p className="py-10 text-center text-sm text-fg-400">Lancez la séance ou adressez une première consigne à l’équipe.</p>
            )}
            {messages.map((m) =>
              m.kind === 'system' ? (
                <div key={m.id} className="flex items-center gap-3 py-1 text-xs font-medium text-primary-400">
                  <span className="h-px flex-1 bg-primary-500/30" />
                  {m.content}
                  <span className="h-px flex-1 bg-primary-500/30" />
                </div>
              ) : m.kind === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-primary-500/30 bg-primary-500/10 px-4 py-3">
                    <div className="mb-1 text-xs font-medium text-primary-300">Chercheur principal · {formatDate(m.created_at)}</div>
                    <Markdown>{m.content}</Markdown>
                  </div>
                </div>
              ) : (
                <AgentMessage key={m.id} m={m} agent={m.agent_id ? agentById.get(m.agent_id) : undefined} tools={tools[m.id] ?? []} parent={m.parent_id ? messages.find((x) => x.id === m.parent_id) : undefined} />
              ),
            )}
          </div>
        </div>

        <div className="border-t border-surface-700/80 p-3 sm:p-4">
          <div className="mx-auto flex max-w-4xl gap-2">
            <textarea
              className="input min-h-[52px] flex-1 resize-y"
              rows={2}
              placeholder="Consigne, indice, correction, nouvelle piste… (Ctrl+Entrée pour envoyer et lancer)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send(true);
                }
              }}
            />
            <div className="flex flex-col gap-2">
              <button className="btn-primary" onClick={() => send(true)} disabled={!input.trim()} title="Envoyer et lancer les agents">
                <Send className="h-4 w-4" />
              </button>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => send(false)} disabled={!input.trim()} title="Envoyer sans lancer">
                Noter
              </button>
            </div>
          </div>
        </div>
      </div>

      <aside className="max-h-[40vh] shrink-0 space-y-5 overflow-y-auto border-t border-surface-700/80 p-4 xl:max-h-none xl:w-80 xl:border-l xl:border-t-0">
        <section>
          <div className="label">Participants</div>
          <div className="space-y-2">
            {participants.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-[#0f1420]" style={{ background: a.color }}>
                  {a.name[0]}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-fg-100">
                    {a.name} {session.mode === 'orchestrated' && session.leadAgentId === a.id && <span className="chip ml-1">directeur</span>}
                  </div>
                  <div className="truncate font-mono text-[11px] text-fg-400">{a.model}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="label">Synthèse</div>
          <div className="flex gap-2">
            <select className="input py-1.5" value={synthAgent} onChange={(e) => setSynthAgent(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Agent…</option>
              {participants.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn-ghost py-1.5" disabled={!synthAgent || running} onClick={() => run({ synthesizeWith: Number(synthAgent) })}>
              <FileText className="h-4 w-4" />
            </button>
          </div>
          {session.summary && (
            <details className="mt-2 rounded-lg border border-surface-700 p-2 text-xs">
              <summary className="cursor-pointer text-fg-300">Dernière synthèse</summary>
              <div className="mt-2">
                <Markdown>{session.summary}</Markdown>
              </div>
            </details>
          )}
        </section>
        <section>
          <div className="label">Consommation</div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-surface-850 p-2"><div className="font-mono text-fg-50">{formatTokens(totals.in)}</div><div className="text-fg-400">entrée</div></div>
            <div className="rounded-lg bg-surface-850 p-2"><div className="font-mono text-fg-50">{formatTokens(totals.out)}</div><div className="text-fg-400">sortie</div></div>
            <div className="rounded-lg bg-surface-850 p-2"><div className="font-mono text-fg-50">{formatTokens(totals.cache)}</div><div className="text-fg-400">cache</div></div>
          </div>
        </section>
        <CampaignPanel sessionId={sessionId} agents={participants} />
        {memories.length > 0 && (
          <section>
            <div className="label flex items-center gap-1"><Brain className="h-3.5 w-3.5" /> Mémoire (cette séance)</div>
            <div className="space-y-2">
              {memories.map((m) => (
                <div key={m.id} className="rounded-lg border border-surface-700 p-2 text-xs">
                  <div className="text-fg-400">{MEMORY_LABELS[m.type]} · {Math.round(m.confidence * 100)} % · {m.status}</div>
                  <div className="text-fg-100">{m.title}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

function AgentMessage({ m, agent, tools, parent }: { m: LiveMessage; agent?: Agent; tools: ToolEntry[]; parent?: LiveMessage }) {
  const color = agent?.color ?? '#a8966f';
  return (
    <div className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-base font-bold text-[#0f1420]" style={{ background: color }}>
        {(m.agent_name ?? '?')[0]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold" style={{ color }}>{m.agent_name}</span>
          {parent && <span className="text-fg-400">↳ consulté par {parent.agent_name}</span>}
          {m.model && <span className="font-mono text-fg-400">{m.model}</span>}
          {!m.streaming && m.output_tokens > 0 && (
            <span className="text-fg-400">
              {formatTokens(m.input_tokens)} → {formatTokens(m.output_tokens)} tok{m.duration_ms ? ` · ${(m.duration_ms / 1000).toFixed(1)} s` : ''}
            </span>
          )}
          {m.streaming && <Spinner className="h-3 w-3 text-fg-400" />}
        </div>
        <div className="card border-l-2 px-4 py-3" style={{ borderLeftColor: color }}>
          {m.thinking && (
            <details className="mb-2 text-xs text-fg-400">
              <summary className="cursor-pointer select-none">Raisonnement</summary>
              <div className="mt-1 whitespace-pre-wrap border-l border-surface-600 pl-3 italic">{m.thinking}</div>
            </details>
          )}
          {tools.length > 0 && (
            <div className="mb-2 space-y-1">
              {tools.map((t) => (
                <details key={t.key} className="group rounded-md border border-surface-700 bg-surface-850/60 text-xs">
                  <summary className="flex cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-fg-300">
                    <ChevronRight className="h-3 w-3 transition group-open:rotate-90" />
                    {t.name.startsWith('web_') ? <Globe className="h-3 w-3 text-primary-500" /> : <Wrench className="h-3 w-3 text-primary-500" />}
                    <span className="font-mono">{t.name}</span>
                    <span className="truncate text-fg-400">{t.input ? JSON.stringify(t.input).slice(0, 90) : ''}</span>
                    {t.output === undefined ? <Spinner className="ml-auto h-3 w-3" /> : t.isError ? <AlertTriangle className="ml-auto h-3 w-3 text-danger-400" /> : null}
                  </summary>
                  <div className="space-y-2 border-t border-surface-700 p-2">
                    {t.input != null && <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg-300">{JSON.stringify(t.input, null, 2)}</pre>}
                    {t.output !== undefined && <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg-200">{t.output}</pre>}
                  </div>
                </details>
              ))}
            </div>
          )}
          {m.content ? <Markdown>{m.content}</Markdown> : m.streaming ? <span className="text-sm text-fg-400">…</span> : null}
          {m.error && (
            <div className="mt-2 flex items-center gap-2 text-xs text-danger-400">
              <AlertTriangle className="h-3.5 w-3.5" /> {m.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Campaign {
  enabled: number;
  hour: number;
  rounds: number;
  token_budget: number;
  report_agent_id: number | null;
  last_run_at: string | null;
  last_status: string | null;
}

/** Campagne nocturne : relance automatique quotidienne avec budget et rapport du matin. */
function CampaignPanel({ sessionId, agents }: { sessionId: number; agents: Agent[] }) {
  const current = useFetch(() => api.get<Campaign | null>(`/sessions/${sessionId}/campaign`), [sessionId]);
  const [form, setForm] = useState<{ enabled: boolean; hour: number; rounds: number; tokenBudget: number; reportAgentId: number | null } | null>(null);
  useEffect(() => {
    const c = current.data;
    setForm({ enabled: Boolean(c?.enabled), hour: c?.hour ?? 2, rounds: c?.rounds ?? 3, tokenBudget: c?.token_budget ?? 300000, reportAgentId: c?.report_agent_id ?? null });
  }, [current.data]);
  if (!form) return null;
  async function save(runNow = false) {
    try {
      await api.put(`/sessions/${sessionId}/campaign`, form);
      if (runNow) await api.post(`/sessions/${sessionId}/campaign/run`);
      toast.ok(runNow ? 'Campagne lancée.' : 'Campagne enregistrée.');
      current.reload();
    } catch (e) {
      toast.err((e as Error).message);
    }
  }
  return (
    <section>
      <div className="label flex items-center gap-1"><Moon className="h-3.5 w-3.5" /> Campagne nocturne</div>
      <div className="space-y-2 rounded-lg border border-surface-700 p-3 text-xs">
        <label className="flex items-center gap-2 text-fg-200">
          <input type="checkbox" className="accent-primary-500" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Relancer chaque jour à
          <input type="number" min={0} max={23} className="input w-14 py-1" value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} /> h
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-fg-400">Tours / cycles<input type="number" min={1} max={20} className="input mt-1 py-1" value={form.rounds} onChange={(e) => setForm({ ...form, rounds: Number(e.target.value) })} /></label>
          <label className="text-fg-400">Budget (tokens)<input type="number" min={10000} step={10000} className="input mt-1 py-1" value={form.tokenBudget} onChange={(e) => setForm({ ...form, tokenBudget: Number(e.target.value) })} /></label>
        </div>
        <label className="block text-fg-400">
          Rapport du matin rédigé par
          <select className="input mt-1 py-1" value={form.reportAgentId ?? ''} onChange={(e) => setForm({ ...form, reportAgentId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Directeur / premier agent</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1 py-1 text-xs" onClick={() => save(false)}>Enregistrer</button>
          <button className="btn-ghost flex-1 py-1 text-xs" onClick={() => save(true)}>Lancer maintenant</button>
        </div>
        {current.data?.last_run_at && <p className="text-fg-400">Dernière exécution : {formatDate(current.data.last_run_at)} ({current.data.last_status})</p>}
        <p className="text-fg-400">Le rapport est déposé dans la Bibliothèque. Heure du serveur.</p>
      </div>
    </section>
  );
}
