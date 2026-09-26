import { useState } from 'react';
import { Field } from '../../components/ui';
import { RunButton, RunResult, SourceSelect, useLab, type useRefs } from './shared';

interface FP {
  target: Record<string, number>;
  comparison: {
    target: string;
    features: { key: string; label: string; hint: string }[];
    ranking: { id: string; name: string; kind: string; distance: number; perFeature: Record<string, number> }[];
  };
  references: Record<string, Record<string, number>>;
}

const KIND_COLOR: Record<string, string> = { natural: 'bg-primary-500', voynich: 'bg-primary-300', cipher: 'bg-fg-400', generated: 'bg-fg-300' };

export default function FingerprintTab({ refs }: { refs: ReturnType<typeof useRefs> }) {
  const [target, setTarget] = useState('voynich');
  const lab = useLab<FP>('fingerprint');
  const r = lab.run?.result;
  const max = r ? Math.max(...r.comparison.ranking.map((x) => x.distance), 0.01) : 1;
  const top = r?.comparison.ranking.slice(0, 5) ?? [];

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-fg-400">
        L’empreinte statistique résume un texte en une dizaine de mesures comparables (entropies, longueurs, vocabulaire, Zipf, positions des glyphes, répétitions).
        On la compare à tous les corpus de référence : les plus proches suggèrent la famille d’écriture, les plus éloignés éliminent des hypothèses.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <Field label="Texte analysé">
            <SourceSelect value={target} onChange={setTarget} refs={refs.data?.refs} />
          </Field>
        </div>
        <RunButton busy={lab.busy} onClick={() => lab.exec({ target })}>Comparer</RunButton>
      </div>
      <RunResult run={lab.run} error={lab.error}>
        {r && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="label">Distance à {r.comparison.target} (plus court = plus semblable)</div>
              <div className="space-y-1">
                {r.comparison.ranking.map((x) => (
                  <div key={x.id} className="grid grid-cols-[minmax(0,12rem)_1fr_3rem] items-center gap-2 text-xs" title={`${x.name} — distance ${x.distance.toFixed(3)}`}>
                    <span className="truncate text-fg-200">{x.name}</span>
                    <span className="relative h-3">
                      <span className={`absolute inset-y-0 left-0 rounded-r-[4px] ${KIND_COLOR[x.kind] ?? 'bg-fg-400'}`} style={{ width: `${(x.distance / max) * 100}%` }} />
                    </span>
                    <span className="text-right font-mono tabular-nums text-fg-400">{x.distance.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-fg-400">Bleu : langues naturelles et Voynich · gris : chiffres et textes générés.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-fg-400">
                  <tr>
                    <th className="py-1 text-left font-medium">Mesure</th>
                    <th className="py-1 pl-2 text-right font-medium">Cible</th>
                    {top.map((t) => (
                      <th key={t.id} className="py-1 pl-2 text-right font-medium" title={t.name}>
                        <span className="ml-auto block max-w-[6.5rem] truncate">{t.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.comparison.features.map((f) => (
                    <tr key={f.key} className="border-t border-surface-700/60" title={f.hint}>
                      <td className="py-1 text-fg-200">{f.label}</td>
                      <td className="py-1 text-right font-mono text-fg-50">{fmt(r.target[f.key])}</td>
                      {top.map((t) => <td key={t.id} className="py-1 text-right font-mono text-fg-300">{fmt(r.references[t.id]?.[f.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </RunResult>
    </div>
  );
}

function fmt(v: number | undefined) {
  if (v === undefined || v === null) return '—';
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString('fr-FR') : v.toFixed(3);
}
