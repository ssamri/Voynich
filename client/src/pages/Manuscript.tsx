import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import clsx from 'clsx';
import { Download, Minus, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, toast } from '../components/ui';

interface Info {
  manifest?: string;
  importedAt?: string;
  title?: string;
  defaultManifest: string;
  images: number;
}
interface ImageRow {
  folio: string;
  canvas_label: string;
}
interface Annotation {
  id: number;
  folio: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  locus: string | null;
  title: string | null;
  note: string | null;
  author_label: string | null;
}
interface PageData {
  page: { folio: string; illustration: string | null; language: string | null; hand: string | null };
  lines: { locus: string; locus_type: string | null; text: string }[];
}

const KINDS: Record<string, string> = { label: 'Étiquette', plant: 'Plante', star: 'Étoile', nymph: 'Nymphe', zodiac: 'Zodiaque', diagram: 'Diagramme', other: 'Autre' };

export default function Manuscript() {
  const info = useFetch(() => api.get<Info>('/manuscript/info'));
  const images = useFetch(() => api.get<ImageRow[]>('/manuscript/images'));
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folio, setFolio] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!folio && images.data?.length) setFolio(images.data[0].folio);
  }, [images.data, folio]);

  async function importManifest() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ imported: number; unmatched: string[] }>('/manuscript/import', { url: url || undefined });
      toast.ok(`${r.imported} pages importées${r.unmatched.length ? ` (${r.unmatched.length} sans numéro de folio)` : ''}.`);
      info.reload();
      images.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const list = (images.data ?? []).filter((i) => !filter || i.folio.includes(filter.trim()));

  return (
    <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
      <PageHeader
        title="Manuscrit"
        subtitle="Images haute résolution de la Beinecke Library (domaine public, IIIF), annotations reliées aux lignes de transcription. Les agents multimodaux peuvent examiner les mêmes images."
      />
      {!info.data?.images ? (
        <div className="card max-w-3xl space-y-3 p-5">
          <h2 className="font-semibold text-fg-50">Importer les images</h2>
          <p className="text-sm text-fg-400">L’application lit le manifeste IIIF du manuscrit (liste des pages et de leurs images). Adresse par défaut, à vérifier sur le site de la Beinecke si elle a changé :</p>
          <Field label="URL du manifeste IIIF">
            <input className="input font-mono text-xs" value={url} placeholder={info.data?.defaultManifest} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <button className="btn-primary" disabled={busy} onClick={importManifest}>
            {busy ? <Spinner /> : <Download className="h-4 w-4" />} Importer
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[11rem_1fr] xl:grid-cols-[11rem_1fr_24rem]">
          <aside className="card max-h-[78vh] overflow-y-auto p-2">
            <input className="input mb-2 py-1.5 font-mono text-xs" placeholder="f67r…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            {list.map((i) => (
              <button
                key={i.folio}
                onClick={() => setFolio(i.folio)}
                className={clsx('block w-full rounded px-2 py-1 text-left font-mono text-sm', folio === i.folio ? 'bg-primary-500/15 text-primary-400' : 'text-fg-200 hover:bg-surface-800')}
              >
                {i.folio}
              </button>
            ))}
            <button className="btn-ghost mt-3 w-full py-1 text-xs" onClick={importManifest} disabled={busy}>
              {busy ? <Spinner /> : <RotateCcw className="h-3 w-3" />} Réimporter
            </button>
          </aside>
          {folio ? <FolioWorkspace key={folio} folio={folio} /> : <Empty title="Choisissez un folio" />}
        </div>
      )}
    </div>
  );
}

function FolioWorkspace({ folio }: { folio: string }) {
  const annotations = useFetch(() => api.get<Annotation[]>(`/manuscript/annotations?folio=${folio}`));
  const page = useFetch(() => api.get<PageData>(`/corpus/pages/${folio}`).catch(() => null));
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drawMode, setDrawMode] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [editing, setEditing] = useState<Partial<Annotation> | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [imgError, setImgError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'pan' | 'draw'; sx: number; sy: number; ox: number; oy: number } | null>(null);

  const rel = (e: RPointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  function down(e: RPointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (drawMode) {
      const p = rel(e);
      drag.current = { kind: 'draw', sx: p.x, sy: p.y, ox: 0, oy: 0 };
      setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    } else {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
    }
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setOffset({ x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy });
    else {
      const p = rel(e);
      setDraft({ x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) });
    }
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'draw' && draft && draft.w > 0.005 && draft.h > 0.005) {
      setEditing({ ...draft, folio, kind: 'label', title: '', note: '', locus: null });
    }
    setDraft(null);
  }

  async function save() {
    if (!editing) return;
    try {
      const body = { folio, x: editing.x, y: editing.y, w: editing.w, h: editing.h, kind: editing.kind, title: editing.title || null, note: editing.note || null, locus: editing.locus || null };
      if (editing.id) await api.put(`/manuscript/annotations/${editing.id}`, body);
      else await api.post('/manuscript/annotations', body);
      setEditing(null);
      setDrawMode(false);
      annotations.reload();
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  const selectedAnn = annotations.data?.find((a) => a.id === selected);

  return (
    <>
      <div className="card flex min-h-[60vh] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-700 px-3 py-2">
          <span className="font-mono font-semibold text-fg-50">{folio}</span>
          {page.data?.page && (
            <span className="text-xs text-fg-400">
              section {page.data.page.illustration ?? '?'} · langue {page.data.page.language ?? '?'} · main {page.data.page.hand ?? '?'}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button className="btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.max(1, z / 1.4))} aria-label="Dézoomer"><Minus className="h-4 w-4" /></button>
            <span className="w-12 text-center font-mono text-xs text-fg-300">{Math.round(zoom * 100)} %</span>
            <button className="btn-ghost px-2 py-1" onClick={() => setZoom((z) => Math.min(8, z * 1.4))} aria-label="Zoomer"><Plus className="h-4 w-4" /></button>
            <button className="btn-ghost px-2 py-1" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} aria-label="Réinitialiser"><RotateCcw className="h-4 w-4" /></button>
            <button className={drawMode ? 'btn-primary px-2.5 py-1' : 'btn-ghost px-2.5 py-1'} onClick={() => setDrawMode(!drawMode)}>
              <Pencil className="h-4 w-4" /> {drawMode ? 'Tracez une zone…' : 'Annoter'}
            </button>
          </div>
        </div>
        <div
          className={clsx('relative flex-1 touch-none overflow-hidden bg-surface-950', drawMode ? 'cursor-crosshair' : 'cursor-grab')}
          onWheel={(e) => setZoom((z) => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
        >
          {imgError ? (
            <p className="p-6 text-sm text-danger-400">Image indisponible (réseau ou manifeste). Vérifiez l’accès à la Beinecke depuis le serveur.</p>
          ) : (
            <div className="flex h-full items-center justify-center" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: 'center center' }}>
              <div ref={stage} className="relative select-none" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
                {!loaded && <div className="flex h-96 w-72 items-center justify-center"><Spinner className="h-6 w-6" /></div>}
                <img
                  src={`/api/manuscript/images/${folio}?size=2000`}
                  alt={`Folio ${folio}`}
                  draggable={false}
                  className={clsx('max-h-[72vh] w-auto', !loaded && 'hidden')}
                  onLoad={() => setLoaded(true)}
                  onError={() => setImgError(true)}
                />
                {loaded &&
                  annotations.data?.map((a) => (
                    <button
                      key={a.id}
                      title={`${KINDS[a.kind] ?? a.kind} — ${a.title ?? ''}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setSelected(a.id === selected ? null : a.id)}
                      className={clsx('absolute rounded-sm border-2', a.id === selected ? 'border-primary-400 bg-primary-400/25' : 'border-primary-500/80 bg-primary-500/10 hover:bg-primary-500/20')}
                      style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}
                    />
                  ))}
                {draft && <div className="absolute border-2 border-dashed border-primary-400 bg-primary-400/15" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
        <section className="card p-3">
          <div className="label">Annotations ({annotations.data?.length ?? 0})</div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {annotations.data?.map((a) => (
              <div key={a.id} className={clsx('flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm', a.id === selected ? 'bg-primary-500/10' : 'hover:bg-surface-800')}>
                <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(a.id)}>
                  <div className="text-fg-100"><span className="chip mr-1">{KINDS[a.kind] ?? a.kind}</span>{a.title || '(sans titre)'}</div>
                  {a.locus && <div className="font-mono text-xs text-fg-400">ligne {a.locus}</div>}
                  {a.note && <div className="line-clamp-2 text-xs text-fg-400">{a.note}</div>}
                  <div className="text-[11px] text-fg-400">{a.author_label}</div>
                </button>
                <button className="text-fg-400 hover:text-fg-100" onClick={() => setEditing(a)} aria-label="Modifier"><Pencil className="h-3.5 w-3.5" /></button>
                <button className="text-fg-400 hover:text-danger-400" onClick={async () => { await api.del(`/manuscript/annotations/${a.id}`); annotations.reload(); }} aria-label="Supprimer"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {!annotations.data?.length && <p className="text-xs text-fg-400">Cliquez sur « Annoter » puis tracez une zone sur l’image.</p>}
          </div>
        </section>
        <section className="card p-3">
          <div className="label">Transcription EVA</div>
          {!page.data ? (
            <p className="text-xs text-fg-400">Aucune transcription pour ce folio (importez le corpus EVA).</p>
          ) : (
            <div className="max-h-[48vh] space-y-0.5 overflow-y-auto">
              {page.data.lines.map((l) => {
                const linked = annotations.data?.find((a) => a.locus === l.locus);
                return (
                  <button
                    key={l.locus}
                    onClick={() => linked && setSelected(linked.id)}
                    className={clsx('grid w-full grid-cols-[4.5rem_1fr] gap-2 rounded px-1 py-0.5 text-left text-xs', selectedAnn?.locus === l.locus ? 'bg-primary-500/15' : linked ? 'hover:bg-surface-800' : '')}
                  >
                    <span className={clsx('font-mono', linked ? 'text-primary-400' : 'text-fg-400')}>{l.locus.replace(`${folio}.`, '')}{l.locus_type?.startsWith('@L') || l.locus_type?.startsWith('L') ? ' ⌗' : ''}</span>
                    <span className="eva break-words text-fg-100">{l.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </aside>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Modifier l’annotation' : 'Nouvelle annotation'}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select className="input" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                  {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Ligne de transcription reliée">
                <select className="input font-mono text-xs" value={editing.locus ?? ''} onChange={(e) => setEditing({ ...editing, locus: e.target.value || null })}>
                  <option value="">—</option>
                  {page.data?.lines.map((l) => <option key={l.locus} value={l.locus}>{l.locus} · {l.text.slice(0, 24)}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Titre"><input className="input" value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Ex. étiquette près du Bélier" /></Field>
            <Field label="Note"><textarea className="input min-h-24" value={editing.note ?? ''} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></Field>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn-primary" onClick={save}>Enregistrer</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
