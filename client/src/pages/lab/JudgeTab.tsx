import { useEffect, useState } from 'react';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { ErrorBox, Field, toast } from '../../components/ui';
import { VerdictBadge } from '../../components/ResultView';
import { LanguageSelect, RunButton, SourceSelect, parseJsonObject, useLab, type useRefs } from './shared';

interface EvalResult {
  language: string;
  words: number;
  coverage: number;
  collisionRate: number;
  crossEntropy: number;
  referenceCrossEntropy: number;
  randomCrossEntropy: number;
  dictionaryRate: number;
  randomDictionaryRate: number;
  percentileCrossEntropy: number;
  percentileDictionary: number;
  criteria: { minCoverage: number; minPercentile: number; minDictionaryRate: number };
  checks: Record<string, boolean>;
  sample: string;
}

const CHECK_LABELS: Record<string, string> = {
  coverage: 'Couverture suffisante du texte',
  beatsRandomLanguageModel: 'Plus plausible que les tables aléatoires (modèle de langue)',
  beatsRandomDictionary: 'Plus de vrais mots que les tables aléatoires',
  dictionaryRate: 'Taux de mots du dictionnaire suffisant',
};

export default function JudgeTab({ refs, prefill }: { refs: ReturnType<typeof useRefs>; prefill: string | null }) {
  const [mode, setMode] = useState<'mapping' | 'glossary'>('mapping');
  const [json, setJson] = useState('{\n  "o": "a",\n  "ch": "k"\n}');
  const [lang, setLang] = useState<number | ''>('');
  const [source, setSource] = useState('voynich');
  const [test, setTest] = useState({ title: '', hypothesis: '', minCoverage: 0.9, minPercentile: 0.99, minDictionaryRate: 0.25 });
  const [testId, setTestId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lab = useLab<EvalResult>('evaluate');
  const r = lab.run?.result;

  useEffect(() => {
    if (prefill) {
      setMode('mapping');
      setJson(prefill);
    }
  }, [prefill]);

  async function register() {
    setError(null);
    try {
      const { id } = await api.post<{ id: number }>('/science/tests', test);
      setTestId(id);
      toast.ok(`Test #E${id} pré-enregistré : critères figés.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run() {
    setError(null);
    try {
      const obj = parseJsonObject(json, mode === 'mapping' ? 'Table' : 'Glossaire');
      const res = await lab.exec({ [mode]: obj, language_ref_id: lang, source, test_id: testId ?? undefined });
      if (res) setTestId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const pct = (x: number) => `${Math.round(x * 100)} %`;

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-fg-400">
        Le juge note une hypothèse sur tout le texte, pas sur des mots choisis : couverture, plausibilité dans la langue cible, taux de vrais mots,
        et surtout comparaison avec la même table dont les valeurs sont mélangées au hasard. Pré-enregistrez les critères pour qu’ils ne bougent plus après coup.
      </p>
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="card space-y-3 p-4">
          <div className="flex gap-2">
            <button className={mode === 'mapping' ? 'btn-primary py-1.5' : 'btn-ghost py-1.5'} onClick={() => setMode('mapping')}>Table de substitution</button>
            <button className={mode === 'glossary' ? 'btn-primary py-1.5' : 'btn-ghost py-1.5'} onClick={() => setMode('glossary')}>Glossaire mot à mot</button>
          </div>
          <Field label={mode === 'mapping' ? 'Séquences EVA → lettres (JSON)' : 'Mots EVA → mots clairs (JSON)'}>
            <textarea className="input eva min-h-48 text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Langue cible"><LanguageSelect value={lang} onChange={setLang} refs={refs.data?.refs ?? []} /></Field>
            <Field label="Texte évalué"><SourceSelect value={source} onChange={setSource} refs={refs.data?.refs} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RunButton busy={lab.busy} onClick={run} disabled={!lang}>Évaluer</RunButton>
            {testId && <span className="chip"><Lock className="h-3 w-3" /> test #E{testId} pré-enregistré</span>}
          </div>
        </div>
        <div className="card space-y-3 p-4">
          <h3 className="flex items-center gap-2 font-semibold text-fg-50"><Lock className="h-4 w-4 text-primary-500" /> Pré-enregistrer le test</h3>
          <Field label="Titre"><input className="input" value={test.title} onChange={(e) => setTest({ ...test, title: e.target.value })} /></Field>
          <Field label="Hypothèse testée"><textarea className="input min-h-16" value={test.hypothesis} onChange={(e) => setTest({ ...test, hypothesis: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Couverture"><input className="input" type="number" step={0.05} min={0} max={1} value={test.minCoverage} onChange={(e) => setTest({ ...test, minCoverage: Number(e.target.value) })} /></Field>
            <Field label="Percentile"><input className="input" type="number" step={0.01} min={0.5} max={1} value={test.minPercentile} onChange={(e) => setTest({ ...test, minPercentile: Number(e.target.value) })} /></Field>
            <Field label="Mots dict."><input className="input" type="number" step={0.05} min={0} max={1} value={test.minDictionaryRate} onChange={(e) => setTest({ ...test, minDictionaryRate: Number(e.target.value) })} /></Field>
          </div>
          <button className="btn-ghost w-full" disabled={test.title.length < 3 || test.hypothesis.length < 3} onClick={register}>Figer les critères</button>
        </div>
      </div>
      <ErrorBox error={error ?? lab.error} />
      {lab.run && r && (
        <div className="card space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip font-mono">#E{lab.run.id}</span>
            <VerdictBadge verdict={lab.run.verdict} />
            <span className="text-sm text-fg-300">Langue : {r.language} · {r.words.toLocaleString('fr-FR')} mots évalués</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Couverture" value={pct(r.coverage)} sub={`seuil ${pct(r.criteria.minCoverage)}`} />
            <Metric label="Entropie croisée" value={`${r.crossEntropy.toFixed(2)} bits`} sub={`langue réelle ${r.referenceCrossEntropy.toFixed(2)} · hasard ${r.randomCrossEntropy.toFixed(2)}`} />
            <Metric label="Mots du dictionnaire" value={pct(r.dictionaryRate)} sub={`hasard ${pct(r.randomDictionaryRate)} · seuil ${pct(r.criteria.minDictionaryRate)}`} />
            <Metric label="Mieux que le hasard" value={`${pct(r.percentileCrossEntropy)} / ${pct(r.percentileDictionary)}`} sub={`seuil ${pct(r.criteria.minPercentile)} · collisions ${pct(r.collisionRate)}`} />
          </div>
          <ul className="space-y-1 text-sm">
            {Object.entries(r.checks).map(([k, ok]) => (
              <li key={k} className="flex items-center gap-2">
                {ok ? <CheckCircle2 className="h-4 w-4 text-success-400" /> : <XCircle className="h-4 w-4 text-danger-400" />}
                <span className="text-fg-200">{CHECK_LABELS[k] ?? k}</span>
              </li>
            ))}
          </ul>
          <div>
            <div className="label">Début du texte obtenu</div>
            <p className="rounded-lg bg-surface-850 p-3 font-mono text-xs text-fg-200">{r.sample}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-surface-700 p-3">
      <div className="text-xs text-fg-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-fg-50">{value}</div>
      <div className="mt-0.5 text-xs text-fg-400">{sub}</div>
    </div>
  );
}
