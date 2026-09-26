import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import { ErrorBox, Field, toast } from '../../components/ui';
import { RunButton, RunResult, parseJsonObject, useLab } from './shared';

interface Crib {
  id: number;
  folio: string | null;
  locus: string | null;
  eva: string;
  expected: string;
  language: string | null;
  category: string | null;
  source: string | null;
  confidence: number;
  author_label: string | null;
}
interface Constraint {
  unit: string;
  options: { letter: string; count: number; cribs: number[] }[];
  conflict: boolean;
}

const EMPTY = { eva: '', expected: '', folio: '', locus: '', language: '', category: 'zodiaque', source: '', confidence: 0.3 };

export default function CribsTab() {
  const cribs = useFetch(() => api.get<Crib[]>('/science/cribs'));
  const [alphabet, setAlphabet] = useState<'eva' | 'eva-grouped'>('eva-grouped');
  const constraints = useFetch(() => api.get<{ constraints: Constraint[]; skippedLengthMismatch: number[] }>(`/science/cribs/constraints?alphabet=${alphabet}`), [alphabet, cribs.data]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState('{}');
  const lab = useLab('cribs');

  async function add() {
    setError(null);
    try {
      await api.post('/science/cribs', { ...form, folio: form.folio || undefined, locus: form.locus || undefined });
      setForm(EMPTY);
      toast.ok('Indice ajouté.');
      cribs.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-fg-400">
        Les indices (« cribs ») sont des mots dont on soupçonne le sens grâce au contexte : noms de mois écrits en clair près des signes du zodiaque,
        plantes identifiées, étoiles. Chaque indice doit citer sa source et une confiance honnête ; ils contraignent la recherche de clé et le juge.
      </p>
      <div className="card grid gap-3 p-4 md:grid-cols-4">
        <Field label="Mot EVA"><input className="input eva" value={form.eva} onChange={(e) => setForm({ ...form, eva: e.target.value })} /></Field>
        <Field label="Sens supposé"><input className="input" value={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.value })} /></Field>
        <Field label="Langue"><input className="input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} placeholder="occitan, latin…" /></Field>
        <Field label="Catégorie">
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {['zodiaque', 'plante', 'étoile', 'autre'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Folio"><input className="input font-mono" value={form.folio} onChange={(e) => setForm({ ...form, folio: e.target.value })} placeholder="f70v" /></Field>
        <Field label="Ligne"><input className="input font-mono" value={form.locus} onChange={(e) => setForm({ ...form, locus: e.target.value })} /></Field>
        <Field label={`Confiance : ${Math.round(form.confidence * 100)} %`}><input type="range" min={0} max={1} step={0.05} className="w-full accent-primary-500" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })} /></Field>
        <Field label="Source"><input className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="publication, observation…" /></Field>
        <div className="md:col-span-4"><button className="btn-primary" disabled={!form.eva || !form.expected} onClick={add}>Ajouter l’indice</button></div>
      </div>
      <ErrorBox error={error} />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-fg-400">
            <tr>
              {['EVA', 'Sens supposé', 'Langue', 'Catégorie', 'Folio', 'Confiance', 'Source', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {cribs.data?.map((c) => (
              <tr key={c.id} className="border-t border-surface-700/60">
                <td className="eva px-3 py-1.5 text-fg-50">{c.eva}</td>
                <td className="px-3 py-1.5 text-fg-100">{c.expected}</td>
                <td className="px-3 py-1.5 text-fg-300">{c.language ?? '—'}</td>
                <td className="px-3 py-1.5 text-fg-300">{c.category ?? '—'}</td>
                <td className="px-3 py-1.5 font-mono text-fg-300">{c.folio ?? '—'}</td>
                <td className="px-3 py-1.5 text-fg-300">{Math.round(c.confidence * 100)} %</td>
                <td className="max-w-64 truncate px-3 py-1.5 text-fg-400" title={c.source ?? ''}>{c.source ?? '—'} {c.author_label ? `· ${c.author_label}` : ''}</td>
                <td className="px-3 py-1.5">
                  <button className="text-fg-400 hover:text-danger-400" aria-label="Supprimer" onClick={async () => { await api.del(`/science/cribs/${c.id}`); cribs.reload(); }}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!cribs.data?.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-fg-400">Aucun indice pour l’instant.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-fg-50">Contraintes déduites</h3>
            <select className="input w-auto py-1" value={alphabet} onChange={(e) => setAlphabet(e.target.value as typeof alphabet)}>
              <option value="eva-grouped">Unités groupées</option>
              <option value="eva">Glyphe par glyphe</option>
            </select>
          </div>
          <p className="text-xs text-fg-400">Si le nombre d’unités EVA égale le nombre de lettres, chaque position impose une correspondance. Les conflits réfutent la substitution simple… ou l’indice.</p>
          <div className="flex flex-wrap gap-1.5">
            {constraints.data?.constraints.map((c) => (
              <span key={c.unit} className={`chip font-mono ${c.conflict ? 'border-danger-400/60 text-danger-400' : ''}`} title={c.options.map((o) => `${o.letter} (${o.count})`).join(', ')}>
                {c.unit} → {c.options.map((o) => o.letter).join(' | ')}
              </span>
            ))}
          </div>
          {!!constraints.data?.skippedLengthMismatch.length && <p className="text-xs text-fg-400">{constraints.data.skippedLengthMismatch.length} indice(s) ignoré(s) : longueurs différentes.</p>}
        </div>
        <div className="card space-y-3 p-4">
          <h3 className="font-semibold text-fg-50">Tester une clé sur les indices</h3>
          <textarea className="input eva min-h-28 text-xs" value={mapping} onChange={(e) => setMapping(e.target.value)} />
          <RunButton busy={lab.busy} onClick={() => { try { lab.exec({ mapping: parseJsonObject(mapping, 'Table') }); } catch (e) { toast.err((e as Error).message); } }}>Tester</RunButton>
          <RunResult run={lab.run} error={lab.error} />
        </div>
      </div>
    </div>
  );
}
