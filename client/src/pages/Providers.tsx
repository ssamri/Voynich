import { useState } from 'react';
import { CheckCircle2, KeyRound, PlugZap, Plus, Trash2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import type { Provider, ProviderKind, ProviderKindInfo } from '../lib/types';
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, toast } from '../components/ui';

interface Draft {
  id?: number;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

export default function Providers() {
  const providers = useFetch(() => api.get<Provider[]>('/providers'));
  const kinds = useFetch(() => api.get<Record<ProviderKind, ProviderKindInfo>>('/providers/kinds'));
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

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body = { name: draft.name, kind: draft.kind, baseUrl: draft.baseUrl, defaultModel: draft.defaultModel, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) };
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
                    <div className="text-xs text-parch-400">{kinds.data?.[p.kind]?.label ?? p.kind}</div>
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
                  <dt className="text-parch-400">Clé API</dt>
                  <dd className="flex items-center gap-1.5 font-mono text-parch-200">
                    <KeyRound className="h-3.5 w-3.5 text-gold-500" /> {p.hasKey ? p.keyHint : '—'}
                  </dd>
                  <dt className="text-parch-400">Modèle par défaut</dt>
                  <dd className="font-mono text-parch-200">{p.defaultModel || '—'}</dd>
                  {p.baseUrl && (
                    <>
                      <dt className="text-parch-400">URL de base</dt>
                      <dd className="truncate font-mono text-parch-200">{p.baseUrl}</dd>
                    </>
                  )}
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button className="btn-ghost py-1.5" onClick={() => test(p)} disabled={t === 'loading'}>
                    {t === 'loading' ? <Spinner /> : <PlugZap className="h-4 w-4" />} Tester la connexion
                  </button>
                  {t && t !== 'loading' && (
                    <span className={`flex items-center gap-1.5 text-xs ${t.ok ? 'text-verdigris-400' : 'text-vermilion-400'}`}>
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

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Modifier la connexion' : 'Nouvelle connexion'}>
        {draft && (
          <div className="space-y-4">
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
            <Field label="Clé API" hint={draft.id ? 'Laisser vide pour conserver la clé actuelle.' : draft.kind === 'openai_compatible' ? 'Optionnelle pour un serveur local (Ollama).' : undefined}>
              <input className="input font-mono" type="password" autoComplete="off" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder={draft.kind === 'anthropic' ? 'sk-ant-…' : 'sk-…'} />
            </Field>
            {(draft.kind === 'openai_compatible' || draft.baseUrl) && (
              <Field label="URL de base" hint="Ex. https://api.mistral.ai/v1 · https://api.deepseek.com/v1 · https://generativelanguage.googleapis.com/v1beta/openai · http://localhost:11434/v1">
                <input className="input font-mono" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
              </Field>
            )}
            <Field label="Modèle par défaut">
              <input className="input font-mono" list="suggested-models" value={draft.defaultModel} onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })} />
              <datalist id="suggested-models">{k?.suggestedModels.map((m) => <option key={m} value={m} />)}</datalist>
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
