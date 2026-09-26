import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Globe, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import type { Agent, Effort, Provider, RolePreset } from '../lib/types';
import { Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle, toast } from '../components/ui';

type Draft = Omit<Agent, 'id'> & { id?: number };
const EFFORTS: { value: Effort | ''; label: string }[] = [
  { value: '', label: 'Par défaut du modèle' },
  { value: 'low', label: 'Faible (rapide, économique)' },
  { value: 'medium', label: 'Moyen' },
  { value: 'high', label: 'Élevé (recommandé)' },
  { value: 'xhigh', label: 'Très élevé' },
  { value: 'max', label: 'Maximum' },
];

export default function Agents() {
  const agents = useFetch(() => api.get<Agent[]>('/agents'));
  const providers = useFetch(() => api.get<Provider[]>('/providers'));
  const meta = useFetch(() => api.get<{ presets: RolePreset[]; toolGroups: Record<string, string> }>('/agents/meta'));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const provider = providers.data?.find((p) => p.id === draft?.providerId);

  useEffect(() => {
    setModels([]);
    if (!draft?.providerId) return;
    api
      .get<{ models: string[] }>(`/providers/${draft.providerId}/models`)
      .then((r) => setModels(r.models))
      .catch(() => setModels([]));
  }, [draft?.providerId]);

  function newAgent(preset?: RolePreset, providerKind?: 'anthropic' | 'openai') {
    const p = providers.data?.find((x) => x.kind === providerKind) ?? providers.data?.[0];
    setError(null);
    setDraft({
      name: preset?.name ?? 'Nouvel agent',
      providerId: p?.id ?? null,
      model: p?.defaultModel ?? '',
      roleTitle: preset?.title ?? '',
      systemPrompt: preset?.prompt ?? '',
      temperature: null,
      maxTokens: 16000,
      effort: 'high',
      color: preset?.color ?? '#5b8def',
      tools: Object.keys(meta.data?.toolGroups ?? {}),
      webSearch: p?.kind === 'anthropic' || p?.kind === 'openai',
      enabled: true,
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { id, ...body } = draft;
      if (id) await api.put(`/agents/${id}`, body);
      else await api.post('/agents', body);
      setDraft(null);
      toast.ok('Agent enregistré.');
      agents.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function quickTeam() {
    const presets = meta.data?.presets ?? [];
    const claude = providers.data?.find((p) => p.kind === 'anthropic');
    const gpt = providers.data?.find((p) => p.kind === 'openai');
    if (!claude && !gpt) {
      toast.err('Ajoutez d’abord une connexion Claude et/ou ChatGPT.');
      return;
    }
    const plan: [string, Provider | undefined][] = [
      ['cryptanalyst', claude ?? gpt],
      ['linguist', gpt ?? claude],
      ['skeptic', claude ?? gpt],
    ];
    for (const [key, p] of plan) {
      const preset = presets.find((x) => x.key === key)!;
      await api.post('/agents', {
        name: `${preset.name}${p?.kind === 'anthropic' ? ' (Claude)' : p?.kind === 'openai' ? ' (GPT)' : ''}`,
        providerId: p!.id,
        model: p!.defaultModel || (p!.kind === 'anthropic' ? 'claude-opus-5' : 'gpt-5'),
        roleTitle: preset.title,
        systemPrompt: preset.prompt,
        color: p?.kind === 'openai' ? '#10a37f' : preset.color,
        webSearch: p?.kind === 'anthropic' || p?.kind === 'openai',
      });
    }
    toast.ok('Équipe créée : cryptanalyste, linguiste, critique.');
    agents.reload();
  }

  async function remove(a: Agent) {
    if (!confirm(`Supprimer l’agent « ${a.name} » ?`)) return;
    await api.del(`/agents/${a.id}`);
    agents.reload();
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <PageHeader
        title="Agents"
        subtitle="Chaque agent associe un modèle (Claude, GPT…) à un rôle et à des outils : bibliothèque interne, mémoire partagée, recherche internet, corpus EVA, tests de substitution et consultation des autres agents."
        actions={
          <>
            <button className="btn-ghost" onClick={quickTeam}>
              <Sparkles className="h-4 w-4" /> Équipe recommandée
            </button>
            <button className="btn-primary" onClick={() => newAgent()}>
              <Plus className="h-4 w-4" /> Nouvel agent
            </button>
          </>
        }
      />
      {!providers.loading && !providers.data?.length && (
        <div className="mb-4 rounded-lg border border-primary-500/30 bg-primary-500/5 px-4 py-3 text-sm text-fg-200">
          Aucune connexion IA : commencez par <Link to="/providers" className="text-primary-400 underline">ajouter Claude et ChatGPT</Link>.
        </div>
      )}
      <ErrorBox error={agents.error} />
      {agents.loading && !agents.data ? (
        <Spinner />
      ) : !agents.data?.length ? (
        <Empty icon={<Bot className="h-10 w-10" />} title="Aucun agent">
          Créez vos agents un par un à partir des rôles types, ou générez l’équipe recommandée en un clic.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.data.map((a) => {
            const p = providers.data?.find((x) => x.id === a.providerId);
            return (
              <div key={a.id} className={`card flex flex-col p-5 ${a.enabled ? '' : 'opacity-60'}`}>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-lg font-bold text-[#0f1420]" style={{ background: a.color }}>
                    {a.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="h-display truncate text-xl">{a.name}</div>
                    <div className="line-clamp-2 text-xs text-fg-400">{a.roleTitle || 'Sans rôle défini'}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="chip">{p?.name ?? 'Sans connexion'}</span>
                  <span className="chip font-mono">{a.model}</span>
                  {a.effort && <span className="chip">effort {a.effort}</span>}
                  {a.webSearch && (
                    <span className="chip">
                      <Globe className="h-3 w-3" /> internet
                    </span>
                  )}
                  <span className="chip">{a.tools.length} outils</span>
                </div>
                <div className="mt-auto flex justify-end gap-2 pt-4">
                  <button className="btn-ghost py-1.5" onClick={() => { setError(null); setDraft({ ...a }); }}>
                    Configurer
                  </button>
                  <button className="btn-danger px-2.5 py-1.5" onClick={() => remove(a)} aria-label="Supprimer">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {meta.data && (
        <div className="mt-10">
          <h2 className="h-display mb-3 text-2xl">Rôles types</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {meta.data.presets.map((p) => (
              <button key={p.key} onClick={() => newAgent(p)} className="card p-4 text-left transition hover:border-primary-500/50">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                  <span className="font-medium text-fg-50">{p.name}</span>
                </div>
                <div className="mt-1 text-xs text-fg-400">{p.title}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `Configurer ${draft.name}` : 'Nouvel agent'} wide>
        {draft && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom">
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Couleur">
              <div className="flex gap-2">
                <input type="color" className="h-9 w-12 cursor-pointer rounded border border-surface-600 bg-surface-850" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                <input className="input font-mono" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
              </div>
            </Field>
            <Field label="Connexion IA">
              <select
                className="input"
                value={draft.providerId ?? ''}
                onChange={(e) => {
                  const p = providers.data?.find((x) => x.id === Number(e.target.value));
                  setDraft({ ...draft, providerId: p?.id ?? null, model: p?.defaultModel ?? draft.model, webSearch: p?.kind === 'anthropic' || p?.kind === 'openai' });
                }}
              >
                <option value="">—</option>
                {providers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Modèle" hint={models.length ? `${models.length} modèles disponibles sur ce compte` : 'Saisissez l’identifiant exact du modèle'}>
              <input className="input font-mono" list="agent-models" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
              <datalist id="agent-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
            <div className="md:col-span-2">
              <Field label="Rôle (titre)">
                <input className="input" value={draft.roleTitle} onChange={(e) => setDraft({ ...draft, roleTitle: e.target.value })} placeholder="Ex. Cryptanalyste — statistiques et chiffres historiques" />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Instructions de rôle" hint="S’ajoutent au brief commun sur le manuscrit (contexte, méthode scientifique, collaboration).">
                <textarea className="input min-h-48 font-mono text-xs leading-relaxed" value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
              </Field>
            </div>
            <Field label="Effort de raisonnement">
              <select className="input" value={draft.effort ?? ''} onChange={(e) => setDraft({ ...draft, effort: (e.target.value || null) as Effort | null })}>
                {EFFORTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </Field>
            <Field label="Tokens de sortie max.">
              <input className="input" type="number" min={256} max={128000} step={256} value={draft.maxTokens} onChange={(e) => setDraft({ ...draft, maxTokens: Number(e.target.value) })} />
            </Field>
            <Field label="Température" hint="Vide = défaut. Ignorée par les modèles de raisonnement récents.">
              <input
                className="input"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature ?? ''}
                onChange={(e) => setDraft({ ...draft, temperature: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <div className="flex flex-col justify-end gap-3 pb-1">
              <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label="Agent actif" />
              {(provider?.kind === 'anthropic' || provider?.kind === 'openai') && (
                <Toggle checked={draft.webSearch} onChange={(v) => setDraft({ ...draft, webSearch: v })} label="Recherche internet" />
              )}
            </div>
            <div className="md:col-span-2">
              <span className="label">Outils</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(meta.data?.toolGroups ?? {}).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-surface-700 px-3 py-2 text-sm text-fg-200 hover:border-surface-600">
                    <input
                      type="checkbox"
                      className="accent-primary-500"
                      checked={draft.tools.includes(key)}
                      onChange={(e) => setDraft({ ...draft, tools: e.target.checked ? [...draft.tools, key] : draft.tools.filter((t) => t !== key) })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <ErrorBox error={error} />
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
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
