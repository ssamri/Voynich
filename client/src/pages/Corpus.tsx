import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Download, ScrollText, Search, Upload } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useDebounced, useFetch } from '../lib/hooks';
import type { CorpusInfo } from '../lib/types';
import { ColumnChart, HBarChart } from '../components/BarChart';
import { Empty, ErrorBox, Field, PageHeader, Spinner, StatTile, toast } from '../components/ui';

interface Overview {
  lines: number;
  folios: number;
  tokens: number;
  types: number;
  hapax: number;
  typeTokenRatio: number;
  meanWordLength: number;
  entropy: { alphabet: number; h0: number; h1: number; h2: number };
  topWords: { word: string; count: number }[];
  characters: { char: string; count: number }[];
  wordLengths: { length: number; count: number }[];
}
interface PageRow {
  folio: string;
  quire: string | null;
  illustration: string | null;
  language: string | null;
  hand: string | null;
  line_count: number;
}
interface Filter {
  illustration: string;
  language: string;
  hand: string;
}

const TABS = ['Analyse', 'Folios', 'Recherche', 'Comparer', 'Substitution', 'Import'] as const;
type Tab = (typeof TABS)[number];

export default function Corpus() {
  const info = useFetch(() => api.get<CorpusInfo>('/corpus/info'));
  const [tab, setTab] = useState<Tab>('Analyse');
  const loaded = (info.data?.lines ?? 0) > 0;

  useEffect(() => {
    if (info.data && !loaded) setTab('Import');
  }, [info.data, loaded]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <PageHeader
        title="Corpus EVA"
        subtitle="Transcription du manuscrit en alphabet EVA (format IVTFF) : consultation par folio, recherche, statistiques et tests de substitution — les mêmes outils que ceux mis à disposition des agents."
      />
      {info.data && loaded && (
        <p className="-mt-3 mb-5 text-xs text-parch-400">
          Source : {info.data.source} · transcripteur {info.data.transcriber} · {info.data.pages} folios · {info.data.lines.toLocaleString('fr-FR')} lignes
        </p>
      )}
      <div className="mb-6 flex flex-wrap gap-1 border-b border-ink-700">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={!loaded && t !== 'Import'}
            className={clsx('-mb-px border-b-2 px-4 py-2 text-sm transition disabled:opacity-40', tab === t ? 'border-gold-500 text-gold-300' : 'border-transparent text-parch-300 hover:text-parch-50')}
          >
            {t}
          </button>
        ))}
      </div>
      {info.loading && !info.data && <Spinner />}
      {info.data && (
        <>
          {tab === 'Import' && <ImportTab info={info.data} onDone={() => { info.reload(); setTab('Analyse'); }} />}
          {loaded && tab === 'Analyse' && <AnalysisTab sections={info.data.sections} />}
          {loaded && tab === 'Folios' && <FoliosTab sections={info.data.sections} />}
          {loaded && tab === 'Recherche' && <SearchTab sections={info.data.sections} />}
          {loaded && tab === 'Comparer' && <CompareTab sections={info.data.sections} />}
          {loaded && tab === 'Substitution' && <SubstitutionTab />}
        </>
      )}
    </div>
  );
}

function FilterBar({ value, onChange, sections }: { value: Filter; onChange: (f: Filter) => void; sections: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-2">
      <select className="input w-auto py-1.5" value={value.illustration} onChange={(e) => onChange({ ...value, illustration: e.target.value })}>
        <option value="">Toutes sections</option>
        {Object.entries(sections).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <select className="input w-auto py-1.5" value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value })}>
        <option value="">Langues A + B</option>
        <option value="A">Langue A (Currier)</option>
        <option value="B">Langue B (Currier)</option>
      </select>
      <select className="input w-auto py-1.5" value={value.hand} onChange={(e) => onChange({ ...value, hand: e.target.value })}>
        <option value="">Toutes mains</option>
        {['1', '2', '3', '4', '5', 'X', 'Y'].map((h) => <option key={h} value={h}>Main {h}</option>)}
      </select>
    </div>
  );
}

const EMPTY_FILTER: Filter = { illustration: '', language: '', hand: '' };

function AnalysisTab({ sections }: { sections: Record<string, string> }) {
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [n, setN] = useState(2);
  const [level, setLevel] = useState<'char' | 'word'>('char');
  const ov = useFetch(() => api.get<Overview>(`/corpus/overview${qs({ ...filter })}`), [filter]);
  const ng = useFetch(() => api.get<{ gram: string; count: number }[]>(`/corpus/ngrams${qs({ ...filter, n, level })}`), [filter, n, level]);
  const pos = useFetch(() => api.get<{ char: string; initial: number; medial: number; final: number; total: number }[]>(`/corpus/positional${qs({ ...filter })}`), [filter]);
  const o = ov.data;
  const letters = o?.characters.reduce((a, c) => a + c.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <FilterBar value={filter} onChange={setFilter} sections={sections} />
      <ErrorBox error={ov.error} />
      {!o ? (
        <Spinner />
      ) : o.tokens === 0 ? (
        <Empty title="Aucun mot pour ce filtre" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Mots (tokens)" value={o.tokens.toLocaleString('fr-FR')} hint={`${o.folios} folios · ${o.lines.toLocaleString('fr-FR')} lignes`} />
            <StatTile label="Vocabulaire (types)" value={o.types.toLocaleString('fr-FR')} hint={`${o.hapax.toLocaleString('fr-FR')} hapax · TTR ${o.typeTokenRatio.toFixed(3)}`} />
            <StatTile label="Entropie h2" value={o.entropy.h2.toFixed(2)} hint={`h0 ${o.entropy.h0.toFixed(2)} · h1 ${o.entropy.h1.toFixed(2)} bits/glyphe`} />
            <StatTile label="Longueur moyenne" value={o.meanWordLength.toFixed(2)} hint={`${o.entropy.alphabet} symboles distincts (espace inclus)`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h3 className="h-display mb-3 text-xl">Mots les plus fréquents</h3>
              <HBarChart data={o.topWords.slice(0, 30).map((w) => ({ label: w.word, value: w.count }))} total={o.tokens} />
            </div>
            <div className="space-y-4">
              <div className="card p-4">
                <h3 className="h-display mb-3 text-xl">Fréquence des glyphes</h3>
                <HBarChart data={o.characters.slice(0, 24).map((c) => ({ label: c.char, value: c.count }))} total={letters} />
              </div>
              <div className="card p-4">
                <h3 className="h-display mb-3 text-xl">Longueur des mots (glyphes)</h3>
                <ColumnChart data={o.wordLengths.filter((w) => w.length <= 15).map((w) => ({ label: String(w.length), value: w.count }))} />
              </div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="h-display text-xl">N-grammes</h3>
                <div className="flex gap-2">
                  <select className="input w-auto py-1" value={level} onChange={(e) => setLevel(e.target.value as 'char' | 'word')}>
                    <option value="char">glyphes</option>
                    <option value="word">mots</option>
                  </select>
                  <select className="input w-auto py-1" value={n} onChange={(e) => setN(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((k) => <option key={k} value={k}>n = {k}</option>)}
                  </select>
                </div>
              </div>
              <p className="mb-2 text-xs text-parch-400">« _ » marque le début ou la fin d’un mot.</p>
              {ng.data ? <HBarChart data={ng.data.slice(0, 25).map((g) => ({ label: g.gram, value: g.count }))} /> : <Spinner />}
            </div>
            <div className="card p-4">
              <h3 className="h-display mb-1 text-xl">Position des glyphes dans le mot</h3>
              <p className="mb-3 text-xs text-parch-400">Part des occurrences en début / milieu / fin de mot. Une forte spécialisation positionnelle est une signature du texte voynichien.</p>
              <table className="w-full text-xs">
                <thead className="text-parch-400">
                  <tr>
                    <th className="py-1 text-left font-medium">Glyphe</th>
                    <th className="py-1 text-right font-medium">Début</th>
                    <th className="py-1 text-right font-medium">Milieu</th>
                    <th className="py-1 text-right font-medium">Fin</th>
                    <th className="py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.data?.slice(0, 20).map((p) => (
                    <tr key={p.char} className="border-t border-ink-700/60">
                      <td className="eva py-1 text-parch-50">{p.char}</td>
                      {[p.initial, p.medial, p.final].map((v, i) => (
                        <td key={i} className="py-1 text-right font-mono tabular-nums text-parch-200">
                          <span className="inline-block rounded px-1" style={{ background: `rgb(201 162 39 / ${(v / p.total) * 0.55})` }}>{Math.round((v / p.total) * 100)} %</span>
                        </td>
                      ))}
                      <td className="py-1 text-right font-mono tabular-nums text-parch-400">{p.total.toLocaleString('fr-FR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FoliosTab({ sections }: { sections: Record<string, string> }) {
  const pages = useFetch(() => api.get<PageRow[]>('/corpus/pages'));
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const page = useFetch(() => (sel ? api.get<{ page: PageRow & { header: string }; lines: { locus: string; text: string; raw: string }[] }>(`/corpus/pages/${sel}`) : Promise.resolve(null)), [sel]);
  const [raw, setRaw] = useState(false);
  const list = (pages.data ?? []).filter((p) => (!filter.illustration || p.illustration === filter.illustration) && (!filter.language || p.language === filter.language) && (!filter.hand || p.hand === filter.hand));

  useEffect(() => {
    if (!sel && pages.data?.length) setSel(pages.data[0].folio);
  }, [pages.data, sel]);

  return (
    <div className="space-y-4">
      <FilterBar value={filter} onChange={setFilter} sections={sections} />
      <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <div className="card max-h-[70vh] overflow-y-auto p-2">
          {list.map((p) => (
            <button key={p.folio} onClick={() => setSel(p.folio)} className={clsx('flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm', sel === p.folio ? 'bg-gold-500/15 text-gold-300' : 'text-parch-200 hover:bg-ink-800')}>
              <span className="font-mono">{p.folio}</span>
              <span className="text-[11px] text-parch-400">
                {p.illustration ?? '?'} · {p.language ?? '?'} · {p.line_count}
              </span>
            </button>
          ))}
        </div>
        <div className="card min-h-64 p-5">
          {!page.data ? (
            <Spinner />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h3 className="h-display text-2xl">{page.data.page.folio}</h3>
                {page.data.page.illustration && <span className="chip">{sections[page.data.page.illustration] ?? page.data.page.illustration}</span>}
                {page.data.page.language && <span className="chip">Langue {page.data.page.language}</span>}
                {page.data.page.hand && <span className="chip">Main {page.data.page.hand}</span>}
                {page.data.page.quire && <span className="chip">Cahier {page.data.page.quire}</span>}
                <label className="ml-auto flex items-center gap-2 text-xs text-parch-400">
                  <input type="checkbox" className="accent-gold-500" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> IVTFF brut
                </label>
              </div>
              <div className="space-y-1">
                {page.data.lines.map((l) => (
                  <div key={l.locus} className="grid grid-cols-[5.5rem_1fr] gap-3 text-sm">
                    <span className="font-mono text-xs text-parch-400">{l.locus}</span>
                    <span className="eva break-words text-parch-100">{raw ? l.raw : l.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchTab({ sections }: { sections: Record<string, string> }) {
  const [q, setQ] = useState('daiin');
  const [regex, setRegex] = useState(false);
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const dq = useDebounced(q, 400);
  const res = useFetch(() => api.get<{ total: number; lines: number; hits: { locus: string; text: string; matches: string[] }[] }>(`/corpus/search${qs({ q: dq, regex: regex ? 1 : 0, ...filter })}`), [dq, regex, filter]);

  const highlight = useMemo(() => {
    try {
      return dq ? new RegExp(regex ? `(${dq})` : `\\b(${dq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'g') : null;
    } catch {
      return null;
    }
  }, [dq, regex]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-parch-400" />
          <input className="input eva pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="mot EVA ou expression régulière" />
        </div>
        <label className="flex items-center gap-2 text-sm text-parch-300">
          <input type="checkbox" className="accent-gold-500" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Regex
        </label>
      </div>
      <FilterBar value={filter} onChange={setFilter} sections={sections} />
      <ErrorBox error={res.error} />
      {res.data && (
        <div className="card p-4">
          <div className="label">{res.data.total.toLocaleString('fr-FR')} occurrence(s) sur {res.data.lines} ligne(s) affichée(s)</div>
          <div className="space-y-1">
            {res.data.hits.map((h) => (
              <div key={h.locus} className="grid grid-cols-[6rem_1fr] gap-3 text-sm">
                <span className="font-mono text-xs text-parch-400">{h.locus}</span>
                <span className="eva text-parch-200">
                  {highlight
                    ? h.text.split(highlight).map((part, i) => (i % 2 === 1 ? <mark key={i} className="rounded bg-gold-500/30 px-0.5 text-parch-50">{part}</mark> : part))
                    : h.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CompareTab({ sections }: { sections: Record<string, string> }) {
  const [a, setA] = useState<Filter>({ ...EMPTY_FILTER, language: 'A' });
  const [b, setB] = useState<Filter>({ ...EMPTY_FILTER, language: 'B' });
  const pref = (f: Filter, p: string) => Object.fromEntries(Object.entries(f).map(([k, v]) => [`${p}${k}`, v]));
  const res = useFetch(
    () => api.get<{ tokensA: number; tokensB: number; moreInA: Row[]; moreInB: Row[] }>(`/corpus/compare${qs({ ...pref(a, 'a_'), ...pref(b, 'b_') })}`),
    [a, b],
  );
  type Row = { word: string; a: number; b: number; score: number };
  const table = (rows: Row[]) => (
    <table className="w-full text-xs">
      <thead className="text-parch-400">
        <tr>
          <th className="py-1 text-left font-medium">Mot</th>
          <th className="py-1 text-right font-medium">A</th>
          <th className="py-1 text-right font-medium">B</th>
          <th className="py-1 text-right font-medium">log₂ ratio</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.word} className="border-t border-ink-700/60">
            <td className="eva py-1 text-parch-50">{r.word}</td>
            <td className="py-1 text-right font-mono text-parch-200">{r.a}</td>
            <td className="py-1 text-right font-mono text-parch-200">{r.b}</td>
            <td className="py-1 text-right font-mono text-parch-400">{r.score.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="label">Sous-corpus A</div>
          <FilterBar value={a} onChange={setA} sections={sections} />
        </div>
        <div>
          <div className="label">Sous-corpus B</div>
          <FilterBar value={b} onChange={setB} sections={sections} />
        </div>
      </div>
      <ErrorBox error={res.error} />
      {res.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-4">
            <h3 className="h-display mb-2 text-xl">Surreprésentés dans A <span className="text-sm text-parch-400">({res.data.tokensA.toLocaleString('fr-FR')} mots)</span></h3>
            {table(res.data.moreInA)}
          </div>
          <div className="card p-4">
            <h3 className="h-display mb-2 text-xl">Surreprésentés dans B <span className="text-sm text-parch-400">({res.data.tokensB.toLocaleString('fr-FR')} mots)</span></h3>
            {table(res.data.moreInB)}
          </div>
        </div>
      )}
    </div>
  );
}

function SubstitutionTab() {
  const [mapping, setMapping] = useState('{\n  "ch": "k",\n  "o": "a",\n  "aiin": "um"\n}');
  const [folio, setFolio] = useState('f1r');
  const [out, setOut] = useState<{ source: string; output: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setError(null);
    try {
      const m = JSON.parse(mapping);
      setOut(await api.post('/corpus/substitute', { mapping: m, folio }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="card space-y-3 p-4">
        <Field label="Table de substitution (JSON)" hint="Séquences EVA → lettres. Les séquences longues sont appliquées en priorité.">
          <textarea className="input eva min-h-64 text-xs" value={mapping} onChange={(e) => setMapping(e.target.value)} />
        </Field>
        <Field label="Folio">
          <input className="input font-mono" value={folio} onChange={(e) => setFolio(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" onClick={apply}>Appliquer</button>
      </div>
      <div className="card p-4">
        {!out ? (
          <p className="text-sm text-parch-400">Le résultat s’affiche ici, ligne EVA d’origine au-dessus, transformation en dessous.</p>
        ) : (
          <div className="space-y-3">
            {out.map((l, i) => (
              <div key={i}>
                <div className="eva text-xs text-parch-400">{l.source}</div>
                <div className="eva text-sm text-parch-50">{l.output}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ImportTab({ info, onDone }: { info: CorpusInfo; onDone: () => void }) {
  const [url, setUrl] = useState(info.defaultUrl);
  const [transcriber, setTranscriber] = useState(info.transcriber ?? 'H');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(p: Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await p;
      toast.ok('Corpus importé.');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-gold-500" />
          <h3 className="h-display text-xl">Importer depuis une URL</h3>
        </div>
        <p className="text-sm text-parch-400">
          Les translittérations de référence au format IVTFF sont publiées par René Zandbergen sur voynich.nu (ex. Zandbergen-Landini <span className="font-mono">ZL3b-n.txt</span>, Landini-Stolfi <span className="font-mono">LSI_ivtff_0d.txt</span>). Vérifiez leurs conditions d’utilisation.
        </p>
        <Field label="URL du fichier IVTFF">
          <input className="input font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Transcripteur préféré" hint="Pour les fichiers à lectures multiples (LSI) : H = Takahashi, C = Currier, F = Friedman… Sinon ignoré.">
          <input className="input w-24 font-mono" value={transcriber} onChange={(e) => setTranscriber(e.target.value)} maxLength={3} />
        </Field>
        <button className="btn-primary" disabled={busy} onClick={() => run(api.post('/corpus/import/url', { url, transcriber }))}>
          {busy ? <Spinner /> : <Download className="h-4 w-4" />} Télécharger et importer
        </button>
      </div>
      <div className="card space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-gold-500" />
          <h3 className="h-display text-xl">Importer un fichier</h3>
        </div>
        <p className="text-sm text-parch-400">Chargez un fichier IVTFF téléchargé manuellement. L’import remplace le corpus actuel.</p>
        <input
          type="file"
          accept=".txt,.ivtff,.eva"
          disabled={busy}
          className="block text-sm text-parch-300 file:mr-3 file:rounded-lg file:border-0 file:bg-gold-500 file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink-950"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const fd = new FormData();
            fd.append('file', f);
            fd.append('transcriber', transcriber);
            run(api.post('/corpus/import/file', fd));
          }}
        />
        {info.lines > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-ink-850 p-3 text-sm text-parch-300">
            <ScrollText className="h-4 w-4 text-gold-500" /> Corpus actuel : {info.pages} folios, {info.lines.toLocaleString('fr-FR')} lignes.
          </div>
        )}
      </div>
      <div className="lg:col-span-2">
        <ErrorBox error={error} />
      </div>
    </div>
  );
}
