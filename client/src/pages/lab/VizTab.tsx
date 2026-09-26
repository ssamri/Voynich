import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useDebounced, useFetch } from '../../lib/hooks';
import { ErrorBox, Spinner } from '../../components/ui';

interface Heat {
  folios: { folio: string; section: string | null; language: string | null }[];
  glyphs: string[];
  matrix: number[][];
}
interface PagePoint {
  folio: string;
  section: string | null;
  language: string | null;
  hand: string | null;
  words: number;
  x: number;
  y: number;
  neighbours: { folio: string; similarity: number }[];
}
interface Disp {
  total: number;
  hits: number[];
  folios: { folio: string; start: number; section: string | null; language: string | null }[];
}

const LANG_COLOR: Record<string, string> = { A: 'var(--series-a)', B: 'var(--series-b)' };
const langColor = (l: string | null) => LANG_COLOR[l ?? ''] ?? 'var(--series-none)';

export default function VizTab() {
  return (
    <div className="space-y-6">
      <PageMap />
      <Dispersion />
      <Heatmap />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-fg-300">
      {[['A', 'Langue A'], ['B', 'Langue B'], ['?', 'Non attribuée']].map(([k, l]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: langColor(k === '?' ? null : k) }} /> {l}
        </span>
      ))}
    </div>
  );
}

function PageMap() {
  const data = useFetch(() => api.get<{ points: PagePoint[]; vocabulary: number }>('/science/viz/pages'));
  const [hover, setHover] = useState<PagePoint | null>(null);
  const W = 720;
  const H = 420;
  const pad = 24;
  const scale = useMemo(() => {
    const pts = data.data?.points ?? [];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { x: (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad), y: (v: number) => pad + ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad) };
  }, [data.data]);

  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-fg-50">Carte des pages par vocabulaire</h3>
          <p className="text-xs text-fg-400">Chaque point est un folio ; deux pages proches partagent leur vocabulaire (projection TF-IDF). Permet de vérifier les langues A/B, les mains et les sections.</p>
        </div>
        <Legend />
      </div>
      <ErrorBox error={data.error} />
      {!data.data ? (
        <Spinner />
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Carte des pages">
            {data.data.points.map((p) => (
              <circle
                key={p.folio}
                cx={scale.x(p.x)}
                cy={scale.y(p.y)}
                r={hover?.folio === p.folio ? 7 : 5}
                fill={langColor(p.language)}
                stroke="var(--surface-900)"
                strokeWidth={2}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer"
              />
            ))}
          </svg>
          {hover && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-surface-600 bg-surface-900 px-3 py-2 text-xs shadow-lg">
              <div className="font-mono font-semibold text-fg-50">{hover.folio}</div>
              <div className="text-fg-300">Section {hover.section ?? '?'} · langue {hover.language ?? '?'} · main {hover.hand ?? '?'} · {hover.words} mots</div>
              <div className="mt-1 text-fg-400">Plus proches : {hover.neighbours.map((n) => `${n.folio} (${n.similarity})`).join(', ')}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Dispersion() {
  const [q, setQ] = useState('daiin');
  const [regex, setRegex] = useState(false);
  const dq = useDebounced(q, 400);
  const data = useFetch(() => (dq ? api.get<Disp>(`/science/viz/dispersion?q=${encodeURIComponent(dq)}&regex=${regex ? 1 : 0}`) : Promise.resolve(null)), [dq, regex]);
  const d = data.data;
  const W = 1000;
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold text-fg-50">Répartition d’un mot dans le manuscrit</h3>
          <p className="text-xs text-fg-400">Chaque trait est une occurrence, de la première à la dernière page. La bande du bas indique la langue de chaque folio.</p>
        </div>
        <div className="flex items-center gap-2">
          <input className="input eva w-48" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-1 text-xs text-fg-300">
            <input type="checkbox" className="accent-primary-500" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> regex
          </label>
        </div>
      </div>
      <ErrorBox error={data.error} />
      {d && d.total > 0 && (
        <>
          <svg viewBox={`0 0 ${W} 70`} className="w-full" role="img" aria-label={`Répartition de ${q}`}>
            {d.hits.map((h, i) => (
              <line key={i} x1={(h / d.total) * W} x2={(h / d.total) * W} y1={4} y2={44} stroke="var(--primary-500)" strokeWidth={1.5} />
            ))}
            {d.folios.map((f, i) => {
              const next = d.folios[i + 1]?.start ?? d.total;
              return <rect key={f.folio} x={(f.start / d.total) * W} y={52} width={Math.max(0.5, ((next - f.start) / d.total) * W - 0.5)} height={10} fill={langColor(f.language)}><title>{`${f.folio} — ${f.section ?? '?'} / ${f.language ?? '?'}`}</title></rect>;
            })}
          </svg>
          <p className="mt-1 text-xs text-fg-300">{d.hits.length.toLocaleString('fr-FR')} occurrence(s) sur {d.total.toLocaleString('fr-FR')} mots.</p>
          <Legend />
        </>
      )}
    </section>
  );
}

function Heatmap() {
  const data = useFetch(() => api.get<Heat>('/science/viz/heatmap'));
  const [hover, setHover] = useState<{ folio: string; glyph: string; v: number } | null>(null);
  const d = data.data;
  const colMax = useMemo(() => (d ? d.glyphs.map((_, j) => Math.max(...d.matrix.map((r) => r[j]), 1e-9)) : []), [d]);
  return (
    <section className="card p-4">
      <h3 className="font-semibold text-fg-50">Glyphes par folio</h3>
      <p className="mb-2 text-xs text-fg-400">Fréquence relative de chaque glyphe (colonne) sur chaque page (ligne), normalisée par glyphe. Les ruptures horizontales révèlent des changements de langue, de main ou de sujet.</p>
      <ErrorBox error={data.error} />
      {!d ? (
        <Spinner />
      ) : (
        <div className="flex gap-3">
          <div className="max-h-[520px] overflow-auto">
            <div className="grid" style={{ gridTemplateColumns: `4.5rem 0.5rem repeat(${d.glyphs.length}, 1.1rem)` }}>
              <div />
              <div />
              {d.glyphs.map((g) => <div key={g} className="eva text-center text-[10px] text-fg-300">{g}</div>)}
              {d.folios.map((f, i) => (
                <div key={f.folio} className="contents">
                  <div className="font-mono text-[10px] leading-3 text-fg-400">{f.folio}</div>
                  <div style={{ background: langColor(f.language) }} className="my-[1px]" />
                  {d.matrix[i].map((v, j) => (
                    <div
                      key={j}
                      className="m-[1px] h-2.5"
                      style={{ background: `color-mix(in srgb, var(--primary-500) ${Math.round((v / colMax[j]) * 100)}%, var(--surface-800))` }}
                      onMouseEnter={() => setHover({ folio: f.folio, glyph: d.glyphs[j], v })}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="w-44 shrink-0 text-xs text-fg-300">
            {hover ? (
              <>
                <div className="font-mono text-fg-50">{hover.folio}</div>
                <div>glyphe <span className="eva">{hover.glyph}</span> : {(hover.v * 100).toFixed(2)} %</div>
              </>
            ) : (
              'Survolez une case.'
            )}
            <div className="mt-3"><Legend /></div>
          </div>
        </div>
      )}
    </section>
  );
}
