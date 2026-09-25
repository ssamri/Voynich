import { useState } from 'react';
import { Brain, Download, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '../lib/api';
import { formatDate, useDebounced, useFetch } from '../lib/hooks';
import { MEMORY_LABELS, STATUS_LABELS, type Memory, type MemoryStatus, type MemoryType } from '../lib/types';
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle, toast } from '../components/ui';
import Markdown from '../components/Markdown';

type Draft = Partial<Memory> & { type: MemoryType; title: string; content: string };

const STATUS_STYLE: Record<MemoryStatus, string> = {
  active: 'text-fg-200 border-surface-600',
  confirmed: 'text-success-400 border-success-400/40',
  refuted: 'text-danger-400 border-danger-400/40 line-through',
  archived: 'text-fg-400 border-surface-600',
};

export default function MemoryPage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState<MemoryType | ''>('');
  const dq = useDebounced(q);
  const mem = useFetch(() => api.get<Memory[]>(`/memory${qs({ q: dq, type })}`), [dq, type]);
  const [draft, setDraft] = useState<Draft | null>(null);

  async function save() {
    if (!draft) return;
    try {
      const body = { type: draft.type, title: draft.title, content: draft.content, tags: draft.tags ?? '', confidence: draft.confidence ?? 0.5, status: draft.status ?? 'active', pinned: Boolean(draft.pinned) };
      if (draft.id) await api.put(`/memory/${draft.id}`, body);
      else await api.post('/memory', body);
      setDraft(null);
      mem.reload();
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function togglePin(m: Memory) {
    await api.put(`/memory/${m.id}`, { pinned: !m.pinned });
    mem.reload();
  }

  async function remove(m: Memory) {
    if (!confirm(`Supprimer la mémoire #${m.id} ?`)) return;
    await api.del(`/memory/${m.id}`);
    mem.reload();
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <PageHeader
        title="Mémoire partagée"
        subtitle="Le carnet de laboratoire commun aux agents : hypothèses, découvertes, impasses, glossaire, questions et plans. Les éléments épinglés sont rappelés à chaque tour ; les autres sont retrouvés par pertinence."
        actions={
          <>
            <a className="btn-ghost" href="/api/memory/export">
              <Download className="h-4 w-4" /> Exporter
            </a>
            <button className="btn-primary" onClick={() => setDraft({ type: 'hypothesis', title: '', content: '', confidence: 0.5 })}>
              <Plus className="h-4 w-4" /> Ajouter
            </button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-fg-400" />
          <input className="input pl-9" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          <button className={clsx('chip py-1', !type && 'border-primary-500/60 text-fg-50')} onClick={() => setType('')}>Tout</button>
          {(Object.keys(MEMORY_LABELS) as MemoryType[]).map((t) => (
            <button key={t} className={clsx('chip py-1', type === t && 'border-primary-500/60 text-fg-50')} onClick={() => setType(t)}>
              {MEMORY_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={mem.error} />
      {mem.loading && !mem.data ? (
        <Spinner />
      ) : !mem.data?.length ? (
        <Empty icon={<Brain className="h-10 w-10" />} title="Mémoire vide">
          Les agents y consigneront leurs résultats au fil des séances. Vous pouvez aussi y déposer vos propres acquis et hypothèses.
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {mem.data.map((m) => (
            <div key={m.id} className={clsx('card flex flex-col p-4', m.pinned && 'border-primary-500/40')}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="chip">{MEMORY_LABELS[m.type]}</span>
                    <span className={clsx('chip', STATUS_STYLE[m.status])}>{STATUS_LABELS[m.status]}</span>
                    <span className="text-fg-400">#{m.id}</span>
                  </div>
                  <button className="mt-2 text-left font-medium text-fg-50 hover:text-primary-300" onClick={() => setDraft({ ...m })}>
                    {m.title}
                  </button>
                </div>
                <button onClick={() => togglePin(m)} className="rounded p-1 text-fg-400 hover:text-primary-400" title={m.pinned ? 'Désépingler' : 'Épingler'}>
                  {m.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-2 line-clamp-6 text-sm">
                <Markdown>{m.content}</Markdown>
              </div>
              <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-fg-400">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-700" title={`Confiance ${Math.round(m.confidence * 100)} %`}>
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${m.confidence * 100}%` }} />
                </div>
                {Math.round(m.confidence * 100)} %
                <span className="truncate">· {m.author_label ?? '—'} · {formatDate(m.updated_at)}</span>
                <button onClick={() => remove(m)} className="ml-auto rounded p-1 hover:text-danger-400" aria-label="Supprimer">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `Mémoire #${draft.id}` : 'Nouvel élément de mémoire'} wide>
        {draft && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Type">
                <select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as MemoryType })}>
                  {(Object.keys(MEMORY_LABELS) as MemoryType[]).map((t) => <option key={t} value={t}>{MEMORY_LABELS[t]}</option>)}
                </select>
              </Field>
              <Field label="Statut">
                <select className="input" value={draft.status ?? 'active'} onChange={(e) => setDraft({ ...draft, status: e.target.value as MemoryStatus })}>
                  {(Object.keys(STATUS_LABELS) as MemoryStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </Field>
              <Field label={`Confiance : ${Math.round((draft.confidence ?? 0.5) * 100)} %`}>
                <input type="range" min={0} max={1} step={0.05} className="w-full accent-primary-500" value={draft.confidence ?? 0.5} onChange={(e) => setDraft({ ...draft, confidence: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Titre">
              <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="Contenu">
              <textarea className="input min-h-48" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
            </Field>
            <Field label="Étiquettes">
              <input className="input" value={draft.tags ?? ''} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
            </Field>
            <Toggle checked={Boolean(draft.pinned)} onChange={(v) => setDraft({ ...draft, pinned: v ? 1 : 0 })} label="Épinglé (rappelé à chaque tour des agents)" />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setDraft(null)}>Annuler</button>
              <button className="btn-primary" onClick={save} disabled={!draft.title || !draft.content}>Enregistrer</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
