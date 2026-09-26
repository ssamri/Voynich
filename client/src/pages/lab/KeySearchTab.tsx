import { useState } from 'react';
import { Gavel } from 'lucide-react';
import { ErrorBox, Field, Toggle } from '../../components/ui';
import { VerdictBadge } from '../../components/ResultView';
import { LanguageSelect, RunButton, SourceSelect, parseJsonObject, useLab, type useRefs } from './shared';

interface AnnealResult {
  language: string;
  mapping: Record<string, string>;
  bitsPerChar: number;
  controlBitsPerChar: number | null;
  referenceBitsPerChar: number;
  extraControls: { name: string; bitsPerChar: number; sample: string }[];
  decodedSample: string;
  controlSample: string | null;
  interpretation: string;
}

export default function KeySearchTab({ refs, onJudge }: { refs: ReturnType<typeof useRefs>; onJudge: (mappingJson: string) => void }) {
  const [p, setP] = useState({ lang: '' as number | '', source: 'voynich', alphabet: 'eva-grouped', iterations: 12000, restarts: 3, maxWords: 1500, useCribs: false, fixed: '{}', seed: 1 });
  const [controls, setControls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lab = useLab<AnnealResult>('anneal');
  const r = lab.run?.result;
  const others = (refs.data?.refs ?? []).filter((x) => x.kind !== 'natural');

  async function run() {
    setError(null);
    try {
      await lab.exec({
        language_ref_id: p.lang,
        source: p.source,
        alphabet: p.alphabet,
        iterations: p.iterations,
        restarts: p.restarts,
        max_words: p.maxWords,
        use_cribs: p.useCribs,
        fixed: parseJsonObject(p.fixed, 'Correspondances imposées'),
        control_sources: controls,
        seed: p.seed,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const bars = r
    ? [
        { name: 'Texte analysé', v: r.bitsPerChar, strong: true },
        ...(r.controlBitsPerChar !== null ? [{ name: 'Contrôle : glyphes mélangés', v: r.controlBitsPerChar, strong: false }] : []),
        ...r.extraControls.map((c) => ({ name: `Contrôle : ${c.name}`, v: c.bitsPerChar, strong: false })),
        { name: `Vrai texte (${r.language})`, v: r.referenceBitsPerChar, strong: false },
      ]
    : [];
  const max = Math.max(...bars.map((b) => b.v), 1);

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-fg-400">
        Le recuit simulé essaie des milliers de clés de substitution et garde celle qui rend le texte le plus « probable » dans la langue cible.
        Attention : un optimiseur trouve toujours quelque chose. La même recherche est donc lancée sur des textes de contrôle ; seul un écart net avec eux constitue un signal.
      </p>
      <div className="card grid gap-3 p-4 md:grid-cols-3">
        <Field label="Langue cible"><LanguageSelect value={p.lang} onChange={(v) => setP({ ...p, lang: v })} refs={refs.data?.refs ?? []} /></Field>
        <Field label="Texte"><SourceSelect value={p.source} onChange={(v) => setP({ ...p, source: v })} refs={refs.data?.refs} /></Field>
        <Field label="Unités">
          <select className="input" value={p.alphabet} onChange={(e) => setP({ ...p, alphabet: e.target.value })}>
            <option value="eva-grouped">Groupées (ch, sh, cth, iin…)</option>
            <option value="eva">Glyphe par glyphe (EVA)</option>
          </select>
        </Field>
        <Field label="Itérations"><input className="input" type="number" min={500} max={60000} step={500} value={p.iterations} onChange={(e) => setP({ ...p, iterations: Number(e.target.value) })} /></Field>
        <Field label="Redémarrages"><input className="input" type="number" min={1} max={8} value={p.restarts} onChange={(e) => setP({ ...p, restarts: Number(e.target.value) })} /></Field>
        <Field label="Mots utilisés"><input className="input" type="number" min={100} max={5000} step={100} value={p.maxWords} onChange={(e) => setP({ ...p, maxWords: Number(e.target.value) })} /></Field>
        <div className="md:col-span-2">
          <Field label="Contrôles supplémentaires (textes générés, chiffres)">
            <div className="flex flex-wrap gap-1.5">
              {others.length ? others.map((o) => {
                const id = `ref:${o.id}`;
                const on = controls.includes(id);
                return (
                  <button key={id} className={`chip py-1 ${on ? 'border-primary-500 text-fg-50' : 'opacity-70'}`} onClick={() => setControls(on ? controls.filter((c) => c !== id) : [...controls, id].slice(0, 5))}>
                    {o.name}
                  </button>
                );
              }) : <span className="text-xs text-fg-400">Générez des textes de contrôle dans l’onglet Corpus de référence.</span>}
            </div>
          </Field>
        </div>
        <Field label="Graine"><input className="input" type="number" value={p.seed} onChange={(e) => setP({ ...p, seed: Number(e.target.value) })} /></Field>
        <div className="md:col-span-2">
          <Field label="Correspondances imposées (JSON)"><input className="input eva text-xs" value={p.fixed} onChange={(e) => setP({ ...p, fixed: e.target.value })} /></Field>
        </div>
        <div className="flex items-end pb-2"><Toggle checked={p.useCribs} onChange={(v) => setP({ ...p, useCribs: v })} label="Tenir compte des indices" /></div>
        <div className="md:col-span-3"><RunButton busy={lab.busy} onClick={run} disabled={!p.lang}>Lancer la recherche</RunButton></div>
      </div>
      <ErrorBox error={error ?? lab.error} />
      {lab.run && r && (
        <div className="card space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip font-mono">#E{lab.run.id}</span>
            <VerdictBadge verdict={lab.run.verdict} />
            <button className="btn-ghost ml-auto py-1.5" onClick={() => onJudge(JSON.stringify(r.mapping, null, 2))}>
              <Gavel className="h-4 w-4" /> Soumettre cette clé au juge
            </button>
          </div>
          <p className="rounded-lg border border-primary-500/30 bg-primary-500/5 px-3 py-2 text-sm text-fg-100">{r.interpretation}</p>
          <div>
            <div className="label">Coût en bits par caractère (plus bas = mieux ajusté)</div>
            <div className="space-y-1">
              {bars.map((b) => (
                <div key={b.name} className="grid grid-cols-[minmax(0,16rem)_1fr_3.5rem] items-center gap-2 text-xs">
                  <span className={b.strong ? 'font-semibold text-fg-50' : 'text-fg-300'}>{b.name}</span>
                  <span className="relative h-3">
                    <span className={`absolute inset-y-0 left-0 rounded-r-[4px] ${b.strong ? 'bg-primary-500' : 'bg-fg-400/60'}`} style={{ width: `${(b.v / max) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono tabular-nums text-fg-300">{b.v.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="label">Texte obtenu (extrait)</div>
              <p className="rounded-lg bg-surface-850 p-3 font-mono text-xs text-fg-200">{r.decodedSample}</p>
            </div>
            <div>
              <div className="label">Clé trouvée</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(r.mapping).map(([k, v]) => <span key={k} className="chip font-mono">{k} → {v}</span>)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
