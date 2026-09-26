import clsx from 'clsx';

/** Affichage générique d'un résultat d'analyse : valeurs, tableaux d'objets, sous-objets repliables. */
export default function ResultView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-fg-400">—</span>;
  if (typeof value === 'number') return <span className="font-mono tabular-nums text-fg-100">{Number.isInteger(value) ? value.toLocaleString('fr-FR') : value.toFixed(4)}</span>;
  if (typeof value === 'boolean') return <span className={value ? 'text-success-400' : 'text-danger-400'}>{value ? 'oui' : 'non'}</span>;
  if (typeof value === 'string') return <span className="whitespace-pre-wrap break-words text-fg-100">{value}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-fg-400">(vide)</span>;
    if (value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
      const cols = [...new Set(value.slice(0, 50).flatMap((v) => Object.keys(v as object)))].slice(0, 8);
      return (
        <div className="max-h-96 overflow-auto rounded-lg border border-surface-700">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-850 text-fg-400">
              <tr>{cols.map((c) => <th key={c} className="px-2 py-1.5 text-left font-medium">{c}</th>)}</tr>
            </thead>
            <tbody>
              {value.slice(0, 100).map((row, i) => (
                <tr key={i} className="border-t border-surface-700/60">
                  {cols.map((c) => (
                    <td key={c} className="px-2 py-1 align-top">
                      <ResultView value={(row as Record<string, unknown>)[c]} depth={depth + 1} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {value.length > 100 && <div className="px-2 py-1 text-xs text-fg-400">… {value.length - 100} lignes de plus</div>}
        </div>
      );
    }
    return <span className="font-mono text-xs text-fg-200">{value.slice(0, 60).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')}{value.length > 60 ? ' …' : ''}</span>;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (depth > 3) return <span className="font-mono text-xs text-fg-300">{JSON.stringify(value).slice(0, 300)}</span>;
  return (
    <dl className={clsx('grid gap-x-4 gap-y-1.5 text-sm', depth === 0 ? 'grid-cols-1 sm:grid-cols-[minmax(8rem,14rem)_1fr]' : 'grid-cols-[minmax(6rem,10rem)_1fr]')}>
      {entries.map(([k, v]) => {
        const complex = v !== null && typeof v === 'object' && !(Array.isArray(v) && v.every((x) => typeof x !== 'object'));
        return complex && depth > 0 ? (
          <details key={k} className="col-span-full">
            <summary className="cursor-pointer text-xs font-medium text-fg-300">{k}</summary>
            <div className="mt-1 pl-3">
              <ResultView value={v} depth={depth + 1} />
            </div>
          </details>
        ) : (
          <div key={k} className="contents">
            <dt className="text-xs font-medium text-fg-400">{k}</dt>
            <dd className="min-w-0">
              <ResultView value={v} depth={depth + 1} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return null;
  const map: Record<string, [string, string]> = {
    pass: ['PASS', 'border-success-400/50 bg-success-400/10 text-success-400'],
    fail: ['FAIL', 'border-danger-400/50 bg-danger-400/10 text-danger-400'],
    inconclusive: ['NON CONCLUANT', 'border-surface-600 bg-surface-800 text-fg-300'],
  };
  const [label, cls] = map[verdict] ?? [verdict, 'border-surface-600 text-fg-300'];
  return <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide', cls)}>{label}</span>;
}
