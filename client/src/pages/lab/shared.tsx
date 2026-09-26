import { useState, type ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import { ErrorBox, Spinner } from '../../components/ui';
import ResultView, { VerdictBadge } from '../../components/ResultView';

export interface RefCorpus {
  id: number;
  name: string;
  language: string | null;
  genre: string | null;
  kind: 'natural' | 'cipher' | 'generated';
  source: string | null;
  tokens: number;
  created_at: string;
}
export interface Generator {
  kind: string;
  label: string;
  needsSource: 'voynich' | 'reference' | 'none';
  description: string;
}
export interface Feature {
  key: string;
  label: string;
  hint: string;
}
export interface LabRun<R = unknown> {
  id: number;
  result: R;
  summary: string;
  verdict?: 'pass' | 'fail' | 'inconclusive' | null;
}

export const KIND_LABELS: Record<RefCorpus['kind'], string> = { natural: 'Langue naturelle', cipher: 'Chiffre', generated: 'Texte généré' };

export function useRefs() {
  return useFetch(() => api.get<{ refs: RefCorpus[]; generators: Generator[]; features: Feature[] }>('/science/refs'));
}

export const VOYNICH_SOURCES = [
  { value: 'voynich', label: 'Voynich — tout le corpus' },
  { value: 'voynich:lang:A', label: 'Voynich — langue A' },
  { value: 'voynich:lang:B', label: 'Voynich — langue B' },
  { value: 'voynich:section:H', label: 'Voynich — herbier' },
  { value: 'voynich:section:B', label: 'Voynich — biologique' },
  { value: 'voynich:section:P', label: 'Voynich — pharmaceutique' },
  { value: 'voynich:section:S', label: 'Voynich — recettes' },
  { value: 'voynich:section:Z', label: 'Voynich — zodiaque' },
  { value: 'voynich:section:A', label: 'Voynich — astronomique' },
];

export function SourceSelect({ value, onChange, refs, voynichOnly }: { value: string; onChange: (v: string) => void; refs?: RefCorpus[]; voynichOnly?: boolean }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Manuscrit de Voynich">
        {VOYNICH_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </optgroup>
      {!voynichOnly && !!refs?.length && (
        <optgroup label="Corpus de référence">
          {refs.map((r) => <option key={r.id} value={`ref:${r.id}`}>{r.name}</option>)}
        </optgroup>
      )}
    </select>
  );
}

export function LanguageSelect({ value, onChange, refs }: { value: number | ''; onChange: (v: number | '') => void; refs: RefCorpus[] }) {
  const natural = refs.filter((r) => r.kind === 'natural');
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
      <option value="">{natural.length ? 'Choisir une langue…' : 'Aucune langue : importez un corpus'}</option>
      {natural.map((r) => <option key={r.id} value={r.id}>{r.name}{r.language ? ` (${r.language})` : ''}</option>)}
    </select>
  );
}

/** Lance une analyse du laboratoire et affiche son résultat consigné. */
export function useLab<R = unknown>(kind: string) {
  const [run, setRun] = useState<LabRun<R> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exec = async (params: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<LabRun<R>>(`/science/run/${kind}`, params);
      setRun(r);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy, exec, setRun };
}

export function RunButton({ busy, onClick, children, disabled }: { busy: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button className="btn-primary" onClick={onClick} disabled={busy || disabled}>
      {busy ? <Spinner /> : <FlaskConical className="h-4 w-4" />} {children}
    </button>
  );
}

export function RunResult({ run, error, children }: { run: LabRun | null; error: string | null; children?: ReactNode }) {
  if (error) return <ErrorBox error={error} />;
  if (!run) return null;
  return (
    <div className="card mt-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip font-mono">#E{run.id}</span>
        <VerdictBadge verdict={run.verdict} />
        <span className="text-sm text-fg-200">{run.summary}</span>
      </div>
      {children ?? (
        <details>
          <summary className="cursor-pointer text-xs text-fg-400">Résultat détaillé</summary>
          <div className="mt-2">
            <ResultView value={run.result} />
          </div>
        </details>
      )}
    </div>
  );
}

export function parseJsonObject(text: string, label: string): Record<string, string> {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new Error(`${label} : JSON invalide (objet attendu, ex. {"ch": "k"})`);
  }
}
