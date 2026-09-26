import { useState } from 'react';
import { Download, FileUp, Trash2, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/hooks';
import { Empty, ErrorBox, Field, Spinner, Toggle, toast } from '../../components/ui';
import { KIND_LABELS, SourceSelect, type useRefs } from './shared';

export default function RefsTab({ refs }: { refs: ReturnType<typeof useRefs> }) {
  const data = refs.data;
  const [meta, setMeta] = useState({ name: '', language: '', genre: '', medievalLatin: false, stripDiacritics: true });
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [gen, setGen] = useState({ kind: 'timm_autocopy', sourceRefId: '' as number | '', voynichSource: 'voynich', length: 20000, seed: 1 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      toast.ok(ok);
      refs.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const g = data?.generators.find((x) => x.kind === gen.kind);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-fg-400">
        Les corpus de référence servent de points de comparaison : langues médiévales réelles (idéalement des herbiers, traités médicaux, calendriers),
        chiffres historiques et textes générés mécaniquement. Sans eux, les statistiques de Voynich n’ont pas d’échelle.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-4">
          <h3 className="font-semibold text-fg-50">Ajouter une langue naturelle</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nom"><input className="input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="Latin — herbier" /></Field>
            <Field label="Langue"><input className="input" value={meta.language} onChange={(e) => setMeta({ ...meta, language: e.target.value })} placeholder="la" /></Field>
            <Field label="Genre"><input className="input" value={meta.genre} onChange={(e) => setMeta({ ...meta, genre: e.target.value })} placeholder="herbier" /></Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Toggle checked={meta.stripDiacritics} onChange={(v) => setMeta({ ...meta, stripDiacritics: v })} label="Retirer les accents" />
            <Toggle checked={meta.medievalLatin} onChange={(v) => setMeta({ ...meta, medievalLatin: v })} label="Graphie médiévale (j→i, v→u)" />
          </div>
          <Field label="Depuis une URL (texte brut, page web ou PDF)" hint="Ex. un fichier texte de Project Gutenberg, Wikisource ou The Latin Library.">
            <div className="flex gap-2">
              <input className="input font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
              <button className="btn-ghost" disabled={!meta.name || !url || !!busy} onClick={() => act('url', () => api.post('/science/refs/url', { ...meta, url }), 'Corpus importé.')}>
                {busy === 'url' ? <Spinner /> : <Download className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="Ou coller un texte">
            <textarea className="input min-h-24 text-xs" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" disabled={!meta.name || text.length < 100 || !!busy} onClick={() => act('text', () => api.post('/science/refs/text', { ...meta, text }), 'Corpus ajouté.')}>
              Ajouter le texte collé
            </button>
            <label className="btn-ghost cursor-pointer">
              <FileUp className="h-4 w-4" /> Fichier .txt
              <input
                type="file"
                accept=".txt,.md,text/plain"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f || !meta.name) return setError('Donnez d’abord un nom au corpus.');
                  const fd = new FormData();
                  fd.append('file', f);
                  Object.entries(meta).forEach(([k, v]) => fd.append(k, String(v)));
                  act('file', () => api.post('/science/refs/file', fd), 'Corpus importé.');
                }}
              />
            </label>
          </div>
        </div>

        <div className="card space-y-3 p-4">
          <h3 className="font-semibold text-fg-50">Générer un texte de contrôle</h3>
          <Field label="Méthode">
            <select className="input" value={gen.kind} onChange={(e) => setGen({ ...gen, kind: e.target.value })}>
              {data?.generators.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
            </select>
          </Field>
          {g && <p className="text-xs text-fg-400">{g.description}</p>}
          {g?.needsSource === 'reference' ? (
            <Field label="Texte en clair à chiffrer">
              <select className="input" value={gen.sourceRefId} onChange={(e) => setGen({ ...gen, sourceRefId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Choisir…</option>
                {data?.refs.filter((r) => r.kind === 'natural').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Construit à partir de">
              <SourceSelect value={gen.voynichSource} onChange={(v) => setGen({ ...gen, voynichSource: v })} voynichOnly />
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Longueur (mots)"><input className="input" type="number" min={500} max={100000} value={gen.length} onChange={(e) => setGen({ ...gen, length: Number(e.target.value) })} /></Field>
            <Field label="Graine (reproductible)"><input className="input" type="number" value={gen.seed} onChange={(e) => setGen({ ...gen, seed: Number(e.target.value) })} /></Field>
          </div>
          <button
            className="btn-primary"
            disabled={!!busy || (g?.needsSource === 'reference' && !gen.sourceRefId)}
            onClick={() => act('gen', () => api.post('/science/refs/generate', { ...gen, sourceRefId: gen.sourceRefId || undefined }), 'Texte de contrôle généré.')}
          >
            {busy === 'gen' ? <Spinner /> : <Wand2 className="h-4 w-4" />} Générer
          </button>
        </div>
      </div>
      <ErrorBox error={error ?? refs.error} />
      {!data?.refs.length ? (
        <Empty title="Aucun corpus de référence">Commencez par 3 à 5 langues médiévales de genre proche, puis générez les textes de contrôle.</Empty>
      ) : (
        <div className="card divide-y divide-surface-700/70">
          {data.refs.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="chip font-mono">ref:{r.id}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-fg-50">{r.name}</div>
                <div className="text-xs text-fg-400">
                  {KIND_LABELS[r.kind]}{r.language ? ` · ${r.language}` : ''}{r.genre ? ` · ${r.genre}` : ''} · {r.tokens.toLocaleString('fr-FR')} mots · {formatDate(r.created_at)}
                </div>
              </div>
              <button className="btn-danger px-2 py-1" aria-label="Supprimer" onClick={() => confirm(`Supprimer « ${r.name} » ?`) && act('del', () => api.del(`/science/refs/${r.id}`), 'Corpus supprimé.')}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
