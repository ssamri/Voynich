import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate, useFetch } from '../../lib/hooks';
import { Modal, Spinner, toast } from '../../components/ui';
import ResultView, { VerdictBadge } from '../../components/ResultView';

interface Exp {
  id: number;
  kind: string;
  title: string;
  status: string;
  verdict: string | null;
  summary: string | null;
  corpus_version: string | null;
  seed: number | null;
  session_id: number | null;
  author_label: string | null;
  duration_ms: number | null;
  created_at: string;
}
interface ExpDetail extends Exp {
  params: unknown;
  criteria: unknown;
  result: unknown;
}

const KINDS: Record<string, string> = {
  fingerprint: 'Empreintes',
  evaluate: 'Juge',
  anneal: 'Recherche de clé',
  sukhotin: 'Sukhotin',
  hmm: 'HMM',
  word_structure: 'Structure des mots',
  keywords: 'Mots-clés',
  similar_words: 'Mots proches',
  line_effects: 'Effets de ligne',
  code: 'Bac à sable',
  cribs: 'Indices',
};

export default function ExperimentsTab() {
  const [kind, setKind] = useState('');
  const list = useFetch(() => api.get<Exp[]>(`/science/experiments${kind ? `?kind=${kind}` : ''}`), [kind]);
  const [detail, setDetail] = useState<ExpDetail | null>(null);
  const [replaying, setReplaying] = useState(false);

  async function open(id: number) {
    setDetail(await api.get<ExpDetail>(`/science/experiments/${id}`));
  }

  async function replay(id: number) {
    setReplaying(true);
    try {
      const r = await api.post<{ identical: boolean; replay: { id: number } }>(`/science/experiments/${id}/replay`);
      toast.ok(r.identical ? `Réplication #E${r.replay.id} : résultat identique.` : `Réplication #E${r.replay.id} : le résultat diffère (corpus ou code modifié ?).`);
      list.reload();
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-sm text-fg-400">
          Chaque analyse, qu’elle vienne de vous ou d’un agent, est consignée avec ses paramètres, sa graine et la version du corpus. Toute affirmation doit citer son numéro (#E…) et peut être rejouée.
        </p>
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Tous les types</option>
          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? (
        <Spinner />
      ) : (
        <div className="card divide-y divide-surface-700/70">
          {list.data?.map((e) => (
            <button key={e.id} onClick={() => open(e.id)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-800/50">
              <span className="chip mt-0.5 shrink-0 font-mono">#E{e.id}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-fg-50">{e.title}</span>
                  <VerdictBadge verdict={e.verdict} />
                  {e.status === 'planned' && <span className="chip">pré-enregistré</span>}
                  {e.status === 'error' && <span className="chip text-danger-400">erreur</span>}
                </div>
                <div className="truncate text-xs text-fg-400">{e.summary}</div>
              </div>
              <div className="shrink-0 text-right text-xs text-fg-400">
                <div>{e.author_label ?? '—'}</div>
                <div>{formatDate(e.created_at)}</div>
              </div>
            </button>
          ))}
          {!list.data?.length && <p className="px-4 py-8 text-center text-sm text-fg-400">Aucune expérience pour l’instant.</p>}
        </div>
      )}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `#E${detail.id} — ${detail.title}` : ''} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-400">
              <VerdictBadge verdict={detail.verdict} />
              <span className="chip">{KINDS[detail.kind] ?? detail.kind}</span>
              <span>corpus {detail.corpus_version ?? '—'}</span>
              {detail.seed !== null && <span>· graine {detail.seed}</span>}
              {detail.duration_ms !== null && <span>· {(detail.duration_ms / 1000).toFixed(1)} s</span>}
              <span>· {detail.author_label ?? '—'}{detail.session_id ? ` (séance #${detail.session_id})` : ''}</span>
              {detail.status === 'done' && (
                <button className="btn-ghost ml-auto py-1" disabled={replaying} onClick={() => replay(detail.id)}>
                  {replaying ? <Spinner /> : <RotateCcw className="h-4 w-4" />} Rejouer
                </button>
              )}
            </div>
            {detail.summary && <p className="text-sm text-fg-100">{detail.summary}</p>}
            {detail.criteria != null && (
              <section>
                <div className="label">Critères pré-enregistrés</div>
                <ResultView value={detail.criteria} />
              </section>
            )}
            <section>
              <div className="label">Paramètres</div>
              <ResultView value={detail.params} />
            </section>
            {detail.result != null && (
              <section>
                <div className="label">Résultat</div>
                <ResultView value={detail.result} />
              </section>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
