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

export interface ProviderPreset {
  id: string;
  name: string;
  description: string;
  /** local = tourne sur votre machine (100 % gratuit, open source) ; free_tier = service en ligne avec offre gratuite. */
  access: 'local' | 'free_tier';
  baseUrl: string;
  keyRequired: boolean;
  signupUrl?: string;
  defaultModel: string;
  /** Exemples ; la liste réelle est récupérée auprès du fournisseur (« Tester la connexion »). */
  suggestedModels: string[];
  maxTokens: number;
  color: string;
  notes?: string;
}

/**
 * IA gratuites ou open source, toutes accessibles via l'interface compatible OpenAI.
 * Les offres gratuites évoluent souvent : vérifier les conditions et quotas sur le site du fournisseur.
 */
export const FREE_PRESETS: ProviderPreset[] = [
  {
    id: 'ollama',
    name: 'Ollama (local)',
    description: 'Modèles open source (Qwen, Llama, Mistral, gpt-oss…) exécutés sur votre ordinateur. Gratuit, illimité et privé.',
    access: 'local',
    baseUrl: 'http://localhost:11434/v1',
    keyRequired: false,
    signupUrl: 'https://ollama.com/download',
    defaultModel: 'qwen3:14b',
    suggestedModels: ['qwen3:14b', 'qwen3:8b', 'gpt-oss:20b', 'llama3.1:8b', 'mistral-small3.2'],
    maxTokens: 8192,
    color: '#8b95a7',
    notes:
      'Installez Ollama puis « ollama pull qwen3:14b ». Augmentez le contexte (OLLAMA_CONTEXT_LENGTH=32768), sinon les longues séances sont tronquées. Choisissez un modèle qui gère les outils (Qwen3, Llama 3.1, gpt-oss, Mistral).',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    description: 'Application de bureau pour télécharger et exécuter des modèles open source en local, avec serveur compatible OpenAI.',
    access: 'local',
    baseUrl: 'http://localhost:1234/v1',
    keyRequired: false,
    signupUrl: 'https://lmstudio.ai',
    defaultModel: '',
    suggestedModels: [],
    maxTokens: 8192,
    color: '#6d7fd8',
    notes: 'Dans LM Studio, chargez un modèle puis démarrez le serveur local (onglet Developer).',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Offre gratuite de Google AI Studio (quotas quotidiens). Très bon contexte long et vision.',
    access: 'free_tier',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyRequired: true,
    signupUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.8-flash',
    suggestedModels: ['gemini-3.8-flash'],
    maxTokens: 16000,
    color: '#4285f4',
    notes: 'En offre gratuite, Google peut utiliser les données pour améliorer ses produits.',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Modèles open source (Llama, gpt-oss, Qwen, Kimi) servis très rapidement. Offre gratuite avec limites de débit.',
    access: 'free_tier',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyRequired: true,
    signupUrl: 'https://console.groq.com/keys',
    defaultModel: 'openai/gpt-oss-120b',
    suggestedModels: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'moonshotai/kimi-k2-instruct'],
    maxTokens: 8192,
    color: '#f55036',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (modèles :free)',
    description: 'Accès à de nombreux modèles open source gratuits (suffixe « :free »), avec quotas journaliers.',
    access: 'free_tier',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyRequired: true,
    signupUrl: 'https://openrouter.ai/keys',
    defaultModel: 'deepseek/deepseek-chat-v3.1:free',
    suggestedModels: ['deepseek/deepseek-chat-v3.1:free', 'qwen/qwen3-235b-a22b:free', 'meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-20b:free'],
    maxTokens: 8192,
    color: '#7c5cff',
    notes: 'Tous les modèles gratuits ne gèrent pas les outils ; l’application bascule alors en mode sans outils.',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Modèles Mistral (open weights et propriétaires), offre « Experiment » gratuite. IA française.',
    access: 'free_tier',
    baseUrl: 'https://api.mistral.ai/v1',
    keyRequired: true,
    signupUrl: 'https://console.mistral.ai/api-keys',
    defaultModel: 'mistral-small-latest',
    suggestedModels: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'],
    maxTokens: 8192,
    color: '#fa520f',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Inférence ultra-rapide de modèles open source (Llama, Qwen, gpt-oss), offre gratuite.',
    access: 'free_tier',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyRequired: true,
    signupUrl: 'https://cloud.cerebras.ai',
    defaultModel: 'gpt-oss-120b',
    suggestedModels: ['gpt-oss-120b', 'llama-3.3-70b', 'qwen-3-32b'],
    maxTokens: 8192,
    color: '#f97316',
  },
  {
    id: 'github',
    name: 'GitHub Models',
    description: 'Modèles gratuits (quotas) avec un simple jeton GitHub : GPT, Llama, DeepSeek, Mistral…',
    access: 'free_tier',
    baseUrl: 'https://models.github.ai/inference',
    keyRequired: true,
    signupUrl: 'https://github.com/settings/tokens',
    defaultModel: 'openai/gpt-4.1-mini',
    suggestedModels: ['openai/gpt-4.1-mini', 'meta/Llama-3.3-70B-Instruct', 'deepseek/DeepSeek-V3-0324'],
    maxTokens: 4000,
    color: '#8b949e',
    notes: 'Utilisez un jeton GitHub (fine-grained) avec la permission « Models : read ».',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description: 'Routeur d’inférence vers des milliers de modèles open source, crédits mensuels gratuits.',
    access: 'free_tier',
    baseUrl: 'https://router.huggingface.co/v1',
    keyRequired: true,
    signupUrl: 'https://huggingface.co/settings/tokens',
    defaultModel: 'openai/gpt-oss-120b',
    suggestedModels: ['openai/gpt-oss-120b', 'meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen3-235B-A22B'],
    maxTokens: 8192,
    color: '#ffb000',
  },
];

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
