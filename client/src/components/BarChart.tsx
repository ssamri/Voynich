import { useState } from 'react';

interface Datum {
  label: string;
  value: number;
}

/**
 * Histogramme horizontal, une seule série (pas de légende : le titre la nomme).
 * Barres fines à extrémités arrondies, étiquettes en encre de texte, info-bulle au survol.
 */
export function HBarChart({ data, format = (v) => v.toLocaleString('fr-FR'), mono = true, total }: { data: Datum[]; format?: (v: number) => string; mono?: boolean; total?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="space-y-[2px]" role="table">
      {data.map((d, i) => (
        <div
          key={d.label}
          role="row"
          className="group grid grid-cols-[5.5rem_1fr_4.5rem] items-center gap-2 rounded px-1 py-[3px] hover:bg-surface-800"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        >
          <span role="cell" className={`truncate text-right text-xs text-fg-200 ${mono ? 'eva' : ''}`} title={d.label}>
            {d.label}
          </span>
          <span role="cell" className="relative h-3">
            <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-primary-500/85 transition-[width] group-hover:bg-primary-400" style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span role="cell" className="text-right font-mono text-xs text-fg-400 tabular-nums">
            {hover === i && total ? `${((d.value / total) * 100).toFixed(2)} %` : format(d.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Histogramme vertical compact (ex. distribution des longueurs de mots). */
export function ColumnChart({ data, height = 160 }: { data: Datum[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div>
      <div className="relative flex items-end gap-[2px] border-b border-surface-600" style={{ height }}>
        {data.map((d, i) => (
          <div key={d.label} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className={`w-full rounded-t-[4px] ${hover === i ? 'bg-primary-400' : 'bg-primary-500/85'}`} style={{ height: `${(d.value / max) * 100}%` }} />
            {hover === i && (
              <div className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border border-surface-600 bg-surface-850 px-2 py-1 text-xs text-fg-100 shadow">
                {d.label} : {d.value.toLocaleString('fr-FR')}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {data.map((d) => (
          <div key={d.label} className="flex-1 text-center font-mono text-[10px] text-fg-400">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
