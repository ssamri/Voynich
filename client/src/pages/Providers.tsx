import { useState } from 'react';
import { CheckCircle2, ExternalLink, Globe, HardDrive, KeyRound, PlugZap, Plus, Sparkles, Trash2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import type { Provider, ProviderKind, ProviderKindInfo, ProviderPreset, WebSearchSettings } from '../lib/types';
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, toast } from '../components/ui';

interface Draft {
  id?: number;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  preset?: ProviderPreset;
}

export default function Providers() {
  const providers = useFetch(() => api.get<Provider[]>('/providers'));
  const kinds = useFetch(() => api.get<Record<ProviderKind, ProviderKindInfo>>('/providers/kinds'));
  const presets = useFetch(() => api.get<ProviderPreset[]>('/providers/presets'));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<number, { ok: boolean; text: string } | 'loading'>>({});

  function openNew(kind: ProviderKind) {
    const k = kinds.data?.[kind];
    setError(null);
    setDraft({
      name: kind === 'anthropic' ? 'Claude' : kind === 'openai' ? 'ChatGPT' : 'Mistral',
      kind,
      baseUrl: k?.defaultBaseUrl ?? '',
      apiKey: '',
      defaultModel: k?.defaultModel ?? '',
    });
  }

  function openPreset(p: ProviderPreset) {
    setError(null);
    setDraft({ name: p.name, kind: 'openai_compatible', baseUrl: p.baseUrl, apiKey: '', defaultModel: p.defaultModel, preset: p });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body = { name: draft.name, kind: draft.kind, baseUrl: draft.baseUrl, defaultModel: draft.defaultModel, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) };
      if (draft.preset?.keyRequired && !draft.id && !draft.apiKey) throw new Error('Clé API requise pour ce service (gratuite, voir le lien).');
      if (draft.id) await api.put(`/providers/${draft.id}`, body);
      else await api.post('/providers', body);
      setDraft(null);
      toast.ok('Connexion enregistrée (clé chiffrée côté serveur).');
      providers.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function test(p: Provider) {
    setTests((t) => ({ ...t, [p.id]: 'loading' }));
    try {
      const r = await api.get<{ latencyMs: number; models: string[] }>(`/providers/${p.id}/models`);
      setTests((t) => ({ ...t, [p.id]: { ok: true, text: `Connexion OK · ${r.models.length} modèles · ${r.latencyMs} ms` } }));
    } catch (e) {
      setTests((t) => ({ ...t, [p.id]: { ok: false, text: (e as Error).message } }));
    }
  }

  async function remove(p: Provider) {
    if (!confirm(`Supprimer la connexion « ${p.name} » ? Les agents qui l'utilisent devront être reconfigurés.`)) return;
    await api.del(`/providers/${p.id}`);
    providers.reload();
  }

  const k = draft && kinds.data?.[draft.kind];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <PageHeader
        title="Connexions IA"
        subtitle="Branchez vos comptes Claude, ChatGPT ou tout fournisseur compatible OpenAI. Les clés API sont chiffrées (AES-256-GCM) et ne sont jamais renvoyées au navigateur."
        actions={
          <>
            <button className="btn-primary" onClick={() => openNew('anthropic')}>
              <Plus className="h-4 w-4" /> Claude
            </button>
            <button className="btn-primary" onClick={() => openNew('openai')}>
              <Plus className="h-4 w-4" /> ChatGPT
            </button>
            <button className="btn-ghost" onClick={() => openNew('openai_compatible')}>
              <Plus className="h-4 w-4" /> Autre fournisseur
            </button>
          </>
        }
      />
      <ErrorBox error={providers.error} />
      {providers.loading && !providers.data ? (
        <Spinner />
      ) : !providers.data?.length ? (
        <Empty icon={<PlugZap className="h-10 w-10" />} title="Aucune connexion">
          Ajoutez une clé API Anthropic (console.anthropic.com) et une clé OpenAI (platform.openai.com) pour créer vos agents.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {providers.data.map((p) => {
            const t = tests[p.id];
            return (
              <div key={p.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="h-display text-2xl">{p.name}</div>
                    <div className="text-xs text-fg-400">{kinds.data?.[p.kind]?.label ?? p.kind}</div>
                  </div>
                  <div className="flex gap-1">
                    <button className="btn-ghost px-2.5 py-1.5" onClick={() => setDraft({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl ?? '', apiKey: '', defaultModel: p.defaultModel ?? '' })}>
                      Modifier
                    </button>
                    <button className="btn-danger px-2.5 py-1.5" onClick={() => remove(p)} aria-label="Supprimer">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
                  <dt className="text-fg-400">Clé API</dt>
                  <dd className="flex items-center gap-1.5 font-mono text-fg-200">
                    <KeyRound className="h-3.5 w-3.5 text-primary-500" /> {p.hasKey ? p.keyHint : '—'}
                  </dd>
                  <dt className="text-fg-400">Modèle par défaut</dt>
                  <dd className="font-mono text-fg-200">{p.defaultModel || '—'}</dd>
                  {p.baseUrl && (
                    <>
                      <dt className="text-fg-400">URL de base</dt>
                      <dd className="truncate font-mono text-fg-200">{p.baseUrl}</dd>
                    </>
                  )}
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button className="btn-ghost py-1.5" onClick={() => test(p)} disabled={t === 'loading'}>
                    {t === 'loading' ? <Spinner /> : <PlugZap className="h-4 w-4" />} Tester la connexion
                  </button>
                  {t && t !== 'loading' && (
                    <span className={`flex items-center gap-1.5 text-xs ${t.ok ? 'text-success-400' : 'text-danger-400'}`}>
                      {t.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                      {t.text}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {presets.data && (
        <section className="mt-10">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary-500" />
            <h2 className="h-display text-2xl">IA gratuites et open source</h2>
          </div>
          <p className="mb-4 max-w-3xl text-sm text-fg-400">
            Sans paiement : modèles open source exécutés sur votre ordinateur, ou services en ligne avec offre gratuite (une clé gratuite suffit).
            Chaque connexion peut ensuite servir à créer un ou plusieurs agents.
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {presets.data.map((p) => {
              const added = providers.data?.some((x) => x.baseUrl === p.baseUrl);
              return (
                <div key={p.id} className="card flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-fg-50">{p.name}</div>
                      <span className="chip mt-1">
                        {p.access === 'local' ? <HardDrive className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                        {p.access === 'local' ? 'Local · open source · 100 % gratuit' : 'En ligne · offre gratuite'}
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-fg-300">{p.description}</p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    {p.signupUrl ? (
                      <a href={p.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary-400 hover:underline">
                        {p.keyRequired ? 'Obtenir une clé gratuite' : 'Installer'} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span />
                    )}
                    <button className={added ? 'btn-ghost py-1.5' : 'btn-primary py-1.5'} onClick={() => openPreset(p)}>
                      <Plus className="h-4 w-4" /> {added ? 'Ajouter encore' : 'Connecter'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <WebSearchPanel />

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Modifier la connexion' : 'Nouvelle connexion'}>
        {draft && (
          <div className="space-y-4">
            {draft.preset?.notes && (
              <div className="rounded-lg border border-primary-500/30 bg-primary-500/5 px-3 py-2 text-sm text-fg-200">{draft.preset.notes}</div>
            )}
            <Field label="Nom">
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Type">
              <select
                className="input"
                value={draft.kind}
                onChange={(e) => {
                  const kind = e.target.value as ProviderKind;
                  setDraft({ ...draft, kind, baseUrl: kinds.data?.[kind]?.defaultBaseUrl ?? '', defaultModel: kinds.data?.[kind]?.defaultModel ?? '' });
                }}
              >
                {kinds.data && Object.entries(kinds.data).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Clé API" hint={
                draft.id
                  ? 'Laisser vide pour conserver la clé actuelle.'
                  : draft.preset && !draft.preset.keyRequired
                    ? 'Inutile pour un modèle local.'
                    : draft.preset?.signupUrl
                      ? <a className="text-primary-400 underline" href={draft.preset.signupUrl} target="_blank" rel="noreferrer">Obtenir une clé gratuite</a>
                      : draft.kind === 'openai_compatible'
                        ? 'Optionnelle pour un serveur local (Ollama).'
                        : undefined
              }>
              <input className="input font-mono" type="password" autoComplete="off" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder={draft.kind === 'anthropic' ? 'sk-ant-…' : 'sk-…'} />
            </Field>
            {(draft.kind === 'openai_compatible' || draft.baseUrl) && (
              <Field label="URL de base" hint="Ex. https://api.mistral.ai/v1 · https://api.deepseek.com/v1 · https://generativelanguage.googleapis.com/v1beta/openai · http://localhost:11434/v1">
                <input className="input font-mono" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
              </Field>
            )}
            <Field label="Modèle par défaut">
              <input className="input font-mono" list="suggested-models" value={draft.defaultModel} onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })} />
              <datalist id="suggested-models">{(draft.preset?.suggestedModels ?? k?.suggestedModels ?? []).map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
            <ErrorBox error={error} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setDraft(null)}>Annuler</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving && <Spinner />} Enregistrer
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const ENGINES: { value: WebSearchSettings['engine']; label: string; hint: string; url?: string }[] = [
  { value: 'wikipedia', label: 'Wikipédia (sans clé)', hint: 'Gratuit, sans inscription. Couverture limitée à Wikipédia (FR + EN).' },
  { value: 'tavily', label: 'Tavily', hint: 'Moteur conçu pour les agents IA. Offre gratuite mensuelle.', url: 'https://app.tavily.com' },
  { value: 'brave', label: 'Brave Search', hint: 'Index web indépendant. Offre gratuite mensuelle.', url: 'https://api-dashboard.search.brave.com' },
];

/** Moteur de recherche internet utilisé par les IA qui n'ont pas de recherche web intégrée. */
function WebSearchPanel() {
  const settings = useFetch(() => api.get<WebSearchSettings>('/providers/web-search'));
  const [engine, setEngine] = useState<WebSearchSettings['engine'] | null>(null);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const current = engine ?? settings.data?.engine ?? 'wikipedia';
  const info = ENGINES.find((e) => e.value === current)!;

  async function save() {
    try {
      await api.put('/providers/web-search', { engine: current, ...(key ? { apiKey: key } : {}) });
      setKey('');
      settings.reload();
      toast.ok('Moteur de recherche enregistré.');
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function test() {
    setStatus('…');
    try {
      const r = await api.post<{ engine: string; count: number; first: string | null }>('/providers/web-search/test');
      setStatus(`OK · ${r.engine} · ${r.count} résultat(s)${r.first ? ` · « ${r.first} »` : ''}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <section className="card mt-10 p-5">
      <div className="flex items-center gap-2">
        <Globe className="h-5 w-5 text-primary-500" />
        <h2 className="h-display text-xl">Recherche internet des IA gratuites</h2>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-fg-400">
        Claude et ChatGPT utilisent leur recherche web intégrée. Les autres IA (Ollama, Gemini, Groq, Mistral…) passent par les outils
        <span className="font-mono"> web_search</span> et <span className="font-mono">fetch_url</span> de l’application, avec le moteur choisi ici.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-[16rem_1fr_auto] md:items-end">
        <Field label="Moteur">
          <select className="input" value={current} onChange={(e) => setEngine(e.target.value as WebSearchSettings['engine'])}>
            {ENGINES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </Field>
        {current !== 'wikipedia' ? (
          <Field
            label="Clé API"
            hint={
              <>
                {info.hint}{' '}
                {info.url && <a className="text-primary-400 underline" href={info.url} target="_blank" rel="noreferrer">Obtenir une clé gratuite</a>}
                {settings.data?.hasKey && settings.data.engine === current && ` · clé enregistrée : ${settings.data.keyHint}`}
              </>
            }
          >
            <input className="input font-mono" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={settings.data?.hasKey && settings.data.engine === current ? 'Laisser vide pour conserver' : ''} />
          </Field>
        ) : (
          <p className="pb-2 text-xs text-fg-400">{info.hint}</p>
        )}
        <div className="flex gap-2 pb-0.5">
          <button className="btn-primary" onClick={save}>Enregistrer</button>
          <button className="btn-ghost" onClick={test}>Tester</button>
        </div>
      </div>
      {status && <p className="mt-2 text-xs text-fg-300">{status}</p>}
    </section>
  );
}
