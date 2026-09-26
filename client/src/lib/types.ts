export type ProviderKind = 'anthropic' | 'openai' | 'openai_compatible';

export interface Provider {
  id: number;
  name: string;
  kind: ProviderKind;
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  defaultModel: string | null;
}

export interface ProviderKindInfo {
  label: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  suggestedModels: string[];
}

export interface ProviderPreset {
  id: string;
  name: string;
  description: string;
  access: 'local' | 'free_tier';
  baseUrl: string;
  keyRequired: boolean;
  signupUrl?: string;
  defaultModel: string;
  suggestedModels: string[];
  maxTokens: number;
  color: string;
  notes?: string;
}

export interface WebSearchSettings {
  engine: 'wikipedia' | 'tavily' | 'brave';
  hasKey: boolean;
  keyHint: string | null;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Agent {
  id: number;
  name: string;
  providerId: number | null;
  model: string;
  roleTitle: string;
  systemPrompt: string;
  temperature: number | null;
  maxTokens: number;
  effort: Effort | null;
  color: string;
  tools: string[];
  webSearch: boolean;
  enabled: boolean;
}

export interface RolePreset {
  key: string;
  name: string;
  title: string;
  color: string;
  prompt: string;
}

export interface DocumentSummary {
  id: number;
  title: string;
  filename: string | null;
  mime: string | null;
  kind: 'text' | 'pdf' | 'image';
  size: number;
  tags: string;
  source: string | null;
  notes: string | null;
  created_at: string;
  chars: number;
}

export interface LibraryHit {
  document_id: number;
  title: string;
  start_offset: number;
  snippet: string;
}

export type MemoryType = 'hypothesis' | 'finding' | 'fact' | 'dead_end' | 'glossary' | 'question' | 'plan';
export type MemoryStatus = 'active' | 'confirmed' | 'refuted' | 'archived';

export interface Memory {
  id: number;
  type: MemoryType;
  title: string;
  content: string;
  tags: string;
  confidence: number;
  status: MemoryStatus;
  pinned: number;
  author_label: string | null;
  session_id: number | null;
  evidence?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchSession {
  id: number;
  title: string;
  objective: string;
  mode: 'roundtable' | 'orchestrated' | 'cycle';
  agentIds: number[];
  leadAgentId: number | null;
  roundsPerRun: number;
  contextDocIds: number[];
  status: string;
  summary: string | null;
  tokenBudget?: number | null;
  messageCount?: number;
  tokens?: number;
  updatedAt?: string;
}

export interface Message {
  id: number;
  session_id: number;
  kind: 'user' | 'agent' | 'tool' | 'system';
  agent_id: number | null;
  agent_name: string | null;
  content: string;
  thinking: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  parent_id: number | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface CorpusInfo {
  source: string | null;
  importedAt: string | null;
  transcriber: string | null;
  transcribers: string[];
  pages: number;
  lines: number;
  defaultUrl: string;
  sections: Record<string, string>;
}

export const MEMORY_LABELS: Record<MemoryType, string> = {
  hypothesis: 'Hypothèse',
  finding: 'Découverte',
  fact: 'Fait établi',
  dead_end: 'Impasse',
  glossary: 'Glossaire',
  question: 'Question ouverte',
  plan: 'Plan',
};

export const STATUS_LABELS: Record<MemoryStatus, string> = {
  active: 'Active',
  confirmed: 'Confirmée',
  refuted: 'Réfutée',
  archived: 'Archivée',
};
