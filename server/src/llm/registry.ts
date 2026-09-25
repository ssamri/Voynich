import { db } from '../db.js';
import { decrypt } from '../security/crypto.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider, ProviderConfig, ProviderKind } from './types.js';

export interface ProviderRow {
  id: number;
  name: string;
  kind: ProviderKind;
  base_url: string | null;
  api_key_enc: string | null;
  api_key_hint: string | null;
  default_model: string | null;
  created_at: string;
  updated_at: string;
}

/** Catalogue des types de fournisseurs. Ajouter un fournisseur = une entrée ici + un adaptateur. */
export const PROVIDER_KINDS: Record<ProviderKind, { label: string; defaultModel: string; defaultBaseUrl?: string; suggestedModels: string[] }> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-opus-5',
    suggestedModels: ['claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    defaultModel: 'gpt-5',
    suggestedModels: ['gpt-5', 'gpt-5-mini', 'o3', 'gpt-4.1'],
  },
  openai_compatible: {
    label: 'Compatible OpenAI (Mistral, DeepSeek, Gemini, Ollama, OpenRouter…)',
    defaultModel: '',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    suggestedModels: [],
  },
};

const cache = new Map<number, { stamp: string; provider: LLMProvider }>();

export function getProviderRow(id: number) {
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | undefined;
}

export function buildProvider(row: ProviderRow): LLMProvider {
  const hit = cache.get(row.id);
  if (hit && hit.stamp === row.updated_at) return hit.provider;
  const cfg: ProviderConfig = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.base_url,
    apiKey: row.api_key_enc ? decrypt(row.api_key_enc) : '',
  };
  const provider = row.kind === 'anthropic' ? new AnthropicProvider(cfg) : new OpenAIProvider(cfg);
  cache.set(row.id, { stamp: row.updated_at, provider });
  return provider;
}

export function invalidateProvider(id: number) {
  cache.delete(id);
}
