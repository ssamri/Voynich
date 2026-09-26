import { useState } from 'react';
import { Field } from '../../components/ui';
import ResultView from '../../components/ResultView';
import { RunButton, RunResult, SourceSelect, useLab, type useRefs } from './shared';

const ALGOS = [
  { kind: 'sukhotin', label: 'Voyelles (Sukhotin)', help: 'Repère les symboles qui alternent avec les autres comme des voyelles.', any: true },
  { kind: 'hmm', label: 'Classes de symboles (HMM)', help: 'Modèle de Markov caché : regroupe les symboles selon leur comportement (2 à 6 classes).', any: true },
  { kind: 'word_structure', label: 'Structure des mots', help: 'Préfixes, suffixes, positions préférées et ordre relatif strict des glyphes (grammaire à cases).', any: true },
  { kind: 'keywords', label: 'Mots-clés par section', help: 'Mots concentrés dans certaines parties du texte (Montemurro & Zanette).', any: false },
  { kind: 'similar_words', label: 'Mots aux contextes proches', help: 'Mots employés dans des contextes similaires : variantes ou mots de même catégorie.', any: false },
  { kind: 'line_effects', label: 'Effets de ligne', help: 'Glyphes et mots propres au début ou à la fin des lignes et des paragraphes.', any: false },
] as const;

const SAMPLE_CODE = `// Exemple : longueur moyenne des mots par section et par langue
const out = {};
for (const l of lines()) {
  const k = (l.section ?? '?') + '/' + (l.language ?? '?');
  const ws = l.text.split(' ').filter(Boolean);
  out[k] ??= { mots: 0, glyphes: 0 };
  out[k].mots += ws.length;
  out[k].glyphes += ws.join('').length;
}
return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +(v.glyphes / v.mots).toFixed(2)]));`;

export default function AlgorithmsTab({ refs }: { refs: ReturnType<typeof useRefs> }) {
  const [kind, setKind] = useState<(typeof ALGOS)[number]['kind']>('sukhotin');
  const [source, setSource] = useState('voynich');
  const [alphabet, setAlphabet] = useState('eva-grouped');
  const [states, setStates] = useState(2);
  const [word, setWord] = useState('daiin');
  const algo = ALGOS.find((a) => a.kind === kind)!;
  const lab = useLab(kind);

  const [code, setCode] = useState(SAMPLE_CODE);
  const [codeRefs, setCodeRefs] = useState<number[]>([]);
  const sandbox = useLab<{ ok: boolean; logs: string; value: string | null; error?: string; durationMs: number }>('code');

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="space-y-3">
        <h3 className="font-semibold text-fg-50">Algorithmes</h3>
        <div className="card space-y-3 p-4">
          <Field label="Analyse">
            <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); lab.setRun(null); }}>
              {ALGOS.map((a) => <option key={a.kind} value={a.kind}>{a.label}</option>)}
            </select>
          </Field>
          <p className="text-xs text-fg-400">{algo.help} {algo.any && 'Comparez avec la même analyse sur une langue de référence.'}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Texte"><SourceSelect value={source} onChange={setSource} refs={refs.data?.refs} voynichOnly={!algo.any} /></Field>
            {algo.any && (
              <Field label="Unités">
                <select className="input" value={alphabet} onChange={(e) => setAlphabet(e.target.value)}>
                  <option value="eva-grouped">Groupées</option>
                  <option value="eva">Glyphe par glyphe</option>
                </select>
              </Field>
            )}
            {kind === 'hmm' && <Field label="États"><input className="input" type="number" min={2} max={6} value={states} onChange={(e) => setStates(Number(e.target.value))} /></Field>}
            {kind === 'similar_words' && <Field label="Mot EVA"><input className="input eva" value={word} onChange={(e) => setWord(e.target.value)} /></Field>}
          </div>
          <RunButton busy={lab.busy} onClick={() => lab.exec({ source, ...(algo.any ? { alphabet } : {}), ...(kind === 'hmm' ? { states } : {}), ...(kind === 'similar_words' ? { word } : {}) })}>
            Lancer
          </RunButton>
        </div>
        <RunResult run={lab.run} error={lab.error}>
          {lab.run && <ResultView value={lab.run.result} />}
        </RunResult>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-fg-50">Bac à sable de calcul</h3>
        <div className="card space-y-3 p-4">
          <p className="text-xs text-fg-400">
            JavaScript exécuté dans un environnement isolé (sans réseau ni fichiers, 15 s max). Disponible : <code className="font-mono">VOYNICH</code>, <code className="font-mono">lines(filtre)</code>, <code className="font-mono">words(filtre)</code>, <code className="font-mono">freq()</code>, <code className="font-mono">entropy()</code>, <code className="font-mono">refWords(id)</code>. Les agents disposent du même outil.
          </p>
          <textarea className="input min-h-72 font-mono text-xs leading-relaxed" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
          <Field label="Corpus de référence accessibles (refWords)">
            <div className="flex flex-wrap gap-1.5">
              {refs.data?.refs.map((r) => {
                const on = codeRefs.includes(r.id);
                return (
                  <button key={r.id} className={`chip py-1 ${on ? 'border-primary-500 text-fg-50' : 'opacity-70'}`} onClick={() => setCodeRefs(on ? codeRefs.filter((x) => x !== r.id) : [...codeRefs, r.id].slice(0, 5))}>
                    {r.id} · {r.name}
                  </button>
                );
              })}
            </div>
          </Field>
          <RunButton busy={sandbox.busy} onClick={() => sandbox.exec({ code, refs: codeRefs })}>Exécuter</RunButton>
        </div>
        <RunResult run={sandbox.run} error={sandbox.error}>
          {sandbox.run && (
            <div className="space-y-2">
              {sandbox.run.result.logs && <pre className="max-h-64 overflow-auto rounded-lg bg-surface-850 p-3 font-mono text-xs text-fg-200">{sandbox.run.result.logs}</pre>}
              {sandbox.run.result.error && <pre className="rounded-lg bg-danger-400/10 p-3 font-mono text-xs text-danger-400">{sandbox.run.result.error}</pre>}
              {sandbox.run.result.value && <ResultView value={JSON.parse(sandbox.run.result.value)} />}
            </div>
          )}
        </RunResult>
      </section>
    </div>
  );
}
