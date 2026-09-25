import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessagesSquare, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatTokens, useFetch } from '../lib/hooks';
import type { Agent, DocumentSummary, ResearchSession } from '../lib/types';
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner } from '../components/ui';

export const OBJECTIVE_IDEAS = [
  'Établir un inventaire rigoureux des propriétés statistiques du texte (entropies, positions des glyphes, langues A/B) et en déduire les familles de systèmes d’écriture compatibles ou exclues.',
  'Tester l’hypothèse d’un chiffre de substitution simple sur une langue romane ou le latin : proposer des tables, les appliquer à f1r et évaluer objectivement le résultat.',
  'Analyser les étiquettes de la section zodiacale (f70v–f73v) et chercher des correspondances avec les noms de mois médiévaux.',
  'Étudier la structure préfixe/racine/suffixe des mots (qo-, ch-, -dy, -aiin) et comparer avec la morphologie de langues naturelles.',
];

export default function Sessions() {
  const sessions = useFetch(() => api.get<ResearchSession[]>('/sessions'));
  const agents = useFetch(() => api.get<Agent[]>('/agents'));
  const docs = useFetch(() => api.get<{ documents: DocumentSummary[] }>('/library'));
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', objective: '', mode: 'roundtable' as 'roundtable' | 'orchestrated', agentIds: [] as number[], leadAgentId: null as number | null, roundsPerRun: 2, contextDocIds: [] as number[] });

  const activeAgents = agents.data?.filter((a) => a.enabled) ?? [];

  function openNew() {
    setError(null);
    setForm({ title: '', objective: '', mode: 'roundtable', agentIds: activeAgents.map((a) => a.id), leadAgentId: activeAgents[0]?.id ?? null, roundsPerRun: 2, contextDocIds: [] });
    setOpen(true);
  }

  async function create() {
    setError(null);
    try {
      const s = await api.post<ResearchSession>('/sessions', form);
      navigate(`/sessions/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(s: ResearchSession) {
    if (!confirm(`Supprimer la séance « ${s.title} » et toute sa transcription ?`)) return;
    await api.del(`/sessions/${s.id}`);
    sessions.reload();
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <PageHeader
        title="Séances de recherche"
        subtitle="Une séance réunit vos agents autour d’un objectif. Ils débattent en table ronde ou sous la direction d’un agent coordinateur, utilisent le corpus, la bibliothèque et consignent leurs résultats dans la mémoire partagée."
        actions={
          <button className="btn-primary" onClick={openNew} disabled={!activeAgents.length}>
            <Plus className="h-4 w-4" /> Nouvelle séance
          </button>
        }
      />
      {!agents.loading && !activeAgents.length && (
        <div className="mb-4 rounded-lg border border-gold-500/30 bg-gold-500/5 px-4 py-3 text-sm text-parch-200">
          Configurez d’abord vos <Link to="/agents" className="text-gold-400 underline">agents</Link>.
        </div>
      )}
      <ErrorBox error={sessions.error} />
      {sessions.loading && !sessions.data ? (
        <Spinner />
      ) : !sessions.data?.length ? (
        <Empty icon={<MessagesSquare className="h-10 w-10" />} title="Aucune séance">
          Lancez une première séance, par exemple : « {OBJECTIVE_IDEAS[0].slice(0, 90)}… »
        </Empty>
      ) : (
        <div className="space-y-3">
          {sessions.data.map((s) => (
            <div key={s.id} className="card flex items-center gap-4 p-4 transition hover:border-ink-600">
              <Link to={`/sessions/${s.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${s.status === 'running' ? 'animate-pulse bg-verdigris-400' : 'bg-ink-500'}`} />
                  <span className="h-display truncate text-xl">{s.title}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-parch-400">{s.objective}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <span className="chip">{s.mode === 'orchestrated' ? 'Dirigée' : 'Table ronde'}</span>
                  <span className="chip">{s.messageCount ?? 0} messages</span>
                  <span className="chip">{formatTokens(s.tokens ?? 0)} tokens</span>
                  {s.updatedAt && <span className="chip">{formatDate(s.updatedAt)}</span>}
                </div>
              </Link>
              <button className="btn-danger px-2.5 py-1.5" onClick={() => remove(s)} aria-label="Supprimer">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle séance" wide>
        <div className="space-y-4">
          <Field label="Titre">
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex. Structure morphologique des mots EVA" />
          </Field>
          <Field label="Objectif">
            <textarea className="input min-h-28" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {OBJECTIVE_IDEAS.map((o) => (
              <button key={o} className="chip hover:border-gold-500/50" onClick={() => setForm({ ...form, objective: o, title: form.title || o.split(/[:,.]/)[0].slice(0, 80) })}>
                {o.slice(0, 60)}…
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Mode">
              <select className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as typeof form.mode })}>
                <option value="roundtable">Table ronde (chacun son tour)</option>
                <option value="orchestrated">Dirigée (un agent délègue)</option>
              </select>
            </Field>
            {form.mode === 'orchestrated' && (
              <Field label="Directeur de recherche">
                <select className="input" value={form.leadAgentId ?? ''} onChange={(e) => setForm({ ...form, leadAgentId: Number(e.target.value) })}>
                  {activeAgents.filter((a) => form.agentIds.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Tours par lancement">
              <input className="input" type="number" min={1} max={20} value={form.roundsPerRun} onChange={(e) => setForm({ ...form, roundsPerRun: Number(e.target.value) })} />
            </Field>
          </div>
          <div>
            <span className="label">Agents participants (ordre de parole)</span>
            <div className="flex flex-wrap gap-2">
              {activeAgents.map((a) => {
                const on = form.agentIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    className={`chip py-1 ${on ? 'border-gold-500/60 text-parch-50' : 'opacity-60'}`}
                    onClick={() => setForm({ ...form, agentIds: on ? form.agentIds.filter((x) => x !== a.id) : [...form.agentIds, a.id] })}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                    {a.name}
                  </button>
                );
              })}
            </div>
          </div>
          {!!docs.data?.documents.length && (
            <div>
              <span className="label">Documents de contexte (joints à chaque agent ; images visibles par les modèles)</span>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-ink-700 p-2">
                {docs.data.documents.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-center gap-2 text-sm text-parch-200">
                    <input
                      type="checkbox"
                      className="accent-gold-500"
                      checked={form.contextDocIds.includes(d.id)}
                      onChange={(e) => setForm({ ...form, contextDocIds: e.target.checked ? [...form.contextDocIds, d.id] : form.contextDocIds.filter((x) => x !== d.id) })}
                    />
                    <span className="chip">{d.kind}</span> {d.title}
                  </label>
                ))}
              </div>
            </div>
          )}
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button>
            <button className="btn-primary" onClick={create} disabled={!form.title || !form.objective || !form.agentIds.length}>
              Créer la séance
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
