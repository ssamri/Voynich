import { Link } from 'react-router-dom';
import { Bot, BookOpen, Brain, CheckCircle2, Circle, MessagesSquare, PlugZap, ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatTokens, useFetch } from '../lib/hooks';
import { MEMORY_LABELS, type MemoryType } from '../lib/types';
import { ErrorBox, PageHeader, Spinner, StatTile } from '../components/ui';

interface DashboardData {
  counts: { providers: number; agents: number; documents: number; memories: number; sessions: number; messages: number };
  memoryByType: { type: MemoryType; status: string; n: number }[];
  usageByAgent: { id: number | null; name: string; color: string | null; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; turns: number; avg_ms: number }[];
  recentMemories: { id: number; type: MemoryType; title: string; confidence: number; status: string; author_label: string | null; updated_at: string }[];
  recentSessions: { id: number; title: string; status: string; updated_at: string }[];
  corpus: { lines: number; pages: number };
}

export default function Dashboard() {
  const { data, error, loading } = useFetch(() => api.get<DashboardData>('/dashboard'));
  if (loading && !data) return <div className="p-8"><Spinner /></div>;
  if (!data) return <div className="p-8"><ErrorBox error={error} /></div>;
  const c = data.counts;

  const steps = [
    { done: c.providers > 0, label: 'Connecter Claude et ChatGPT', to: '/providers', icon: PlugZap },
    { done: c.agents >= 2, label: 'Configurer au moins deux agents et leurs rôles', to: '/agents', icon: Bot },
    { done: data.corpus.lines > 0, label: 'Importer la transcription EVA du manuscrit', to: '/corpus', icon: ScrollText },
    { done: c.documents > 0, label: 'Alimenter la bibliothèque (articles, notes, images)', to: '/library', icon: BookOpen },
    { done: c.sessions > 0, label: 'Lancer une première séance de recherche', to: '/sessions', icon: MessagesSquare },
  ];
  const pending = steps.filter((s) => !s.done).length;

  const byType = new Map<string, number>();
  data.memoryByType.forEach((m) => byType.set(m.type, (byType.get(m.type) ?? 0) + m.n));
  const refuted = data.memoryByType.filter((m) => m.status === 'refuted').reduce((a, m) => a + m.n, 0);
  const confirmed = data.memoryByType.filter((m) => m.status === 'confirmed').reduce((a, m) => a + m.n, 0);
  const totalOut = data.usageByAgent.reduce((a, u) => a + u.output_tokens, 0);
  const totalIn = data.usageByAgent.reduce((a, u) => a + u.input_tokens, 0);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <PageHeader title="Tableau de bord" subtitle="Vue d’ensemble du laboratoire : état de la configuration, travaux des agents et acquis de la recherche." />

      {pending > 0 && (
        <div className="card mb-6 p-5">
          <h2 className="h-display mb-3 text-xl">Mise en route</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {steps.map((s) => (
              <Link key={s.to} to={s.to} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-ink-800">
                {s.done ? <CheckCircle2 className="h-5 w-5 text-verdigris-400" /> : <Circle className="h-5 w-5 text-parch-400" />}
                <s.icon className="h-4 w-4 text-gold-500/80" />
                <span className={s.done ? 'text-parch-400 line-through' : 'text-parch-100'}>{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Agents actifs" value={c.agents} hint={`${c.providers} connexion(s) IA`} icon={<Bot className="h-4 w-4" />} />
        <StatTile label="Séances" value={c.sessions} hint={`${c.messages} interventions d’agents`} icon={<MessagesSquare className="h-4 w-4" />} />
        <StatTile label="Mémoire" value={c.memories} hint={`${confirmed} confirmée(s) · ${refuted} réfutée(s)`} icon={<Brain className="h-4 w-4" />} />
        <StatTile label="Bibliothèque" value={c.documents} hint={data.corpus.lines ? `corpus : ${data.corpus.pages} folios` : 'corpus non importé'} icon={<BookOpen className="h-4 w-4" />} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="h-display mb-3 text-xl">Derniers acquis</h2>
          {data.recentMemories.length === 0 ? (
            <p className="text-sm text-parch-400">Aucun élément en mémoire pour l’instant.</p>
          ) : (
            <ul className="space-y-2">
              {data.recentMemories.map((m) => (
                <li key={m.id} className="flex items-start gap-3 text-sm">
                  <span className="chip shrink-0">{MEMORY_LABELS[m.type]}</span>
                  <div className="min-w-0">
                    <div className={`truncate ${m.status === 'refuted' ? 'text-parch-400 line-through' : 'text-parch-100'}`}>{m.title}</div>
                    <div className="text-xs text-parch-400">
                      {Math.round(m.confidence * 100)} % · {m.author_label ?? '—'} · {formatDate(m.updated_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {byType.size > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-ink-700 pt-3">
              {[...byType.entries()].map(([t, n]) => (
                <span key={t} className="chip">{MEMORY_LABELS[t as MemoryType] ?? t} · {n}</span>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="h-display mb-3 text-xl">Consommation par agent</h2>
          {data.usageByAgent.length === 0 ? (
            <p className="text-sm text-parch-400">Aucune intervention pour l’instant.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="text-xs text-parch-400">
                  <tr>
                    <th className="pb-2 text-left font-medium">Agent</th>
                    <th className="pb-2 text-right font-medium">Tours</th>
                    <th className="pb-2 text-right font-medium">Entrée</th>
                    <th className="pb-2 text-right font-medium">Sortie</th>
                    <th className="pb-2 text-right font-medium">Cache</th>
                  </tr>
                </thead>
                <tbody>
                  {data.usageByAgent.map((u, i) => (
                    <tr key={i} className="border-t border-ink-700/60">
                      <td className="py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: u.color ?? '#a8966f' }} />
                          <span className="text-parch-100">{u.name}</span>
                        </div>
                        <div className="font-mono text-[11px] text-parch-400">{u.model}</div>
                      </td>
                      <td className="text-right font-mono text-parch-200">{u.turns}</td>
                      <td className="text-right font-mono text-parch-200">{formatTokens(u.input_tokens)}</td>
                      <td className="text-right font-mono text-parch-200">{formatTokens(u.output_tokens)}</td>
                      <td className="text-right font-mono text-parch-400">{u.input_tokens ? Math.round((u.cache_read_tokens / u.input_tokens) * 100) : 0} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-parch-400">Total : {formatTokens(totalIn)} tokens en entrée, {formatTokens(totalOut)} en sortie.</p>
            </>
          )}
        </div>
      </div>

      {data.recentSessions.length > 0 && (
        <div className="card mt-4 p-5">
          <h2 className="h-display mb-3 text-xl">Séances récentes</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {data.recentSessions.map((s) => (
              <Link key={s.id} to={`/sessions/${s.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-ink-800">
                <span className={`h-2 w-2 rounded-full ${s.status === 'running' ? 'animate-pulse bg-verdigris-400' : 'bg-ink-500'}`} />
                <span className="flex-1 truncate text-parch-100">{s.title}</span>
                <span className="text-xs text-parch-400">{formatDate(s.updated_at)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
