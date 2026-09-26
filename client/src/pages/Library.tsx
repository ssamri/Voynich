import { useRef, useState, type DragEvent } from 'react';
import { BookOpen, FileImage, FileText, FileType, NotebookPen, Search, Trash2, Upload } from 'lucide-react';
import { api, qs } from '../lib/api';
import { formatBytes, formatDate, useDebounced, useFetch } from '../lib/hooks';
import type { DocumentSummary, LibraryHit } from '../lib/types';
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, toast } from '../components/ui';

interface FullDoc extends DocumentSummary {
  content: string;
  hasFile: boolean;
}

const ICONS = { text: FileText, pdf: FileType, image: FileImage };

export default function Library() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const lib = useFetch(() => api.get<{ documents: DocumentSummary[]; hits: LibraryHit[] }>(`/library${qs({ q: dq })}`), [dq]);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [tags, setTags] = useState('');
  const [viewing, setViewing] = useState<FullDoc | null>(null);
  const [note, setNote] = useState<{ title: string; content: string; tags: string; source: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setUploading(true);
    const fd = new FormData();
    list.forEach((f) => fd.append('files', f));
    fd.append('tags', tags);
    try {
      const r = await api.post<{ results: { name: string; id?: number; error?: string }[] }>('/library/upload', fd);
      const ok = r.results.filter((x) => x.id).length;
      const errs = r.results.filter((x) => x.error);
      if (ok) toast.ok(`${ok} document(s) indexé(s).`);
      errs.forEach((e) => toast.err(`${e.name} : ${e.error}`));
      lib.reload();
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    upload(e.dataTransfer.files);
  }

  async function open(id: number) {
    setViewing(await api.get<FullDoc>(`/library/${id}`));
  }

  async function saveViewing() {
    if (!viewing) return;
    await api.put(`/library/${viewing.id}`, { title: viewing.title, tags: viewing.tags, notes: viewing.notes ?? '' });
    toast.ok('Document mis à jour.');
    setViewing(null);
    lib.reload();
  }

  async function remove(d: DocumentSummary) {
    if (!confirm(`Supprimer « ${d.title} » ?`)) return;
    await api.del(`/library/${d.id}`);
    lib.reload();
  }

  async function saveNote() {
    if (!note) return;
    try {
      await api.post('/library/note', note);
      setNote(null);
      toast.ok('Note ajoutée à la bibliothèque.');
      lib.reload();
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <PageHeader
        title="Bibliothèque"
        subtitle="Articles, livres, transcriptions, notes et images de folios. Tout est indexé en plein texte (BM25) et consultable par les agents via leurs outils."
        actions={
          <button className="btn-ghost" onClick={() => setNote({ title: '', content: '', tags: '', source: '' })}>
            <NotebookPen className="h-4 w-4" /> Nouvelle note
          </button>
        }
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`card mb-6 flex flex-col items-center gap-3 border-dashed p-6 text-center transition ${drag ? 'border-primary-500 bg-primary-500/5' : ''}`}
      >
        <Upload className="h-8 w-8 text-primary-500/80" />
        <div className="text-sm text-fg-200">Glissez-déposez vos fichiers : PDF, TXT, Markdown, CSV, JSON, images PNG/JPEG/WebP (folios)</div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <input className="input w-56 py-1.5" placeholder="Étiquettes (optionnel)" value={tags} onChange={(e) => setTags(e.target.value)} />
          <button className="btn-primary py-1.5" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : <Upload className="h-4 w-4" />} Choisir des fichiers
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-fg-400" />
        <input className="input pl-9" placeholder="Recherche plein texte dans tous les documents…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={lib.error} />

      {dq && lib.data && (
        <div className="mb-6 space-y-2">
          <div className="label">{lib.data.hits.length} passage(s) trouvé(s)</div>
          {lib.data.hits.map((h, i) => (
            <button key={i} onClick={() => open(h.document_id)} className="card block w-full p-3 text-left text-sm hover:border-surface-600">
              <div className="text-xs text-primary-400">{h.title}</div>
              <div className="mt-1 text-fg-200">{h.snippet}</div>
            </button>
          ))}
        </div>
      )}

      {lib.loading && !lib.data ? (
        <Spinner />
      ) : !lib.data?.documents.length ? (
        <Empty icon={<BookOpen className="h-10 w-10" />} title="Bibliothèque vide">
          Ajoutez par exemple les travaux de Currier, D’Imperio (« The Voynich Manuscript: An Elegant Enigma »), les articles de Zandbergen, Davis, Bowern & Lindemann, ainsi que vos propres notes.
        </Empty>
      ) : (
        <div className="card divide-y divide-surface-700/70">
          {lib.data.documents.map((d) => {
            const Icon = ICONS[d.kind];
            return (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                <Icon className="h-5 w-5 shrink-0 text-primary-500/80" />
                <button className="min-w-0 flex-1 text-left" onClick={() => open(d.id)}>
                  <div className="truncate text-sm text-fg-50">{d.title}</div>
                  <div className="text-xs text-fg-400">
                    {d.kind.toUpperCase()} · {formatBytes(d.size)}
                    {d.chars ? ` · ${d.chars.toLocaleString('fr-FR')} caractères` : ''} · {formatDate(d.created_at)}
                    {d.tags && ` · ${d.tags}`}
                  </div>
                </button>
                <button className="btn-danger px-2.5 py-1.5" onClick={() => remove(d)} aria-label="Supprimer">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.title ?? ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Titre">
                <input className="input" value={viewing.title} onChange={(e) => setViewing({ ...viewing, title: e.target.value })} />
              </Field>
              <Field label="Étiquettes">
                <input className="input" value={viewing.tags} onChange={(e) => setViewing({ ...viewing, tags: e.target.value })} />
              </Field>
            </div>
            <Field label="Notes (visibles par les agents, notamment pour décrire une image)">
              <textarea className="input min-h-20" value={viewing.notes ?? ''} onChange={(e) => setViewing({ ...viewing, notes: e.target.value })} />
            </Field>
            {viewing.kind === 'image' && viewing.hasFile && <img src={`/api/library/${viewing.id}/file`} alt={viewing.title} className="max-h-[60vh] w-full rounded-lg object-contain" />}
            {viewing.kind === 'pdf' && viewing.hasFile && (
              <a className="btn-ghost" href={`/api/library/${viewing.id}/file`} target="_blank" rel="noreferrer">
                Ouvrir le PDF original
              </a>
            )}
            {viewing.content && <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-850 p-4 font-mono text-xs text-fg-200">{viewing.content.slice(0, 200_000)}</pre>}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setViewing(null)}>Fermer</button>
              <button className="btn-primary" onClick={saveViewing}>Enregistrer</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!note} onClose={() => setNote(null)} title="Nouvelle note" wide>
        {note && (
          <div className="space-y-4">
            <Field label="Titre">
              <input className="input" value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} />
            </Field>
            <Field label="Contenu (Markdown)">
              <textarea className="input min-h-64 font-mono text-xs" value={note.content} onChange={(e) => setNote({ ...note, content: e.target.value })} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Étiquettes">
                <input className="input" value={note.tags} onChange={(e) => setNote({ ...note, tags: e.target.value })} />
              </Field>
              <Field label="Source">
                <input className="input" value={note.source} onChange={(e) => setNote({ ...note, source: e.target.value })} placeholder="URL, référence bibliographique…" />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setNote(null)}>Annuler</button>
              <button className="btn-primary" onClick={saveNote} disabled={!note.title || !note.content}>Ajouter</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
