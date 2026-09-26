import type { z } from 'zod';

export type ProviderKind = 'anthropic' | 'openai' | 'openai_compatible';

export interface ProviderConfig {
  id: number;
  name: string;
  kind: ProviderKind;
  baseUrl?: string | null;
  apiKey: string;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string };

/** Message neutre vis-à-vis du fournisseur, construit par l'orchestrateur. */
export interface NeutralMessage {
  role: 'user' | 'assistant';
  content: ContentPart[];
}

export interface ToolDefinition<I = unknown> {
  name: string;
  description: string;
  /** Schéma JSON envoyé au modèle. */
  jsonSchema: Record<string, unknown>;
  /** Schéma zod pour valider l'entrée avant exécution. */
  input: z.ZodType<I>;
  run: (input: I) => Promise<string | ToolOutput> | string | ToolOutput;
}

/** Résultat d'outil enrichi : texte + images (ex. un folio du manuscrit pour les modèles multimodaux). */
export interface ToolOutput {
  text: string;
  images?: { mediaType: string; data: string }[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface AgentLoopEvents {
  onText: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolCall: (call: { id: string; name: string; input: unknown }) => void;
  onToolResult: (result: { id: string; name: string; output: string; isError: boolean }) => void;
}

export interface AgentLoopRequest {
  model: string;
  system: string;
  messages: NeutralMessage[];
  tools: ToolDefinition<any>[];
  maxTokens: number;
  temperature?: number | null;
  effort?: Effort | null;
  webSearch?: boolean;
  maxSteps: number;
  signal: AbortSignal;
  events: AgentLoopEvents;
}

export interface AgentLoopResult {
  text: string;
  thinking: string;
  usage: Usage;
  model: string;
  stopReason: string;
}

export interface LLMProvider {
  runAgentLoop(req: AgentLoopRequest): Promise<AgentLoopResult>;
  listModels(): Promise<string[]>;
}

export async function executeTool(
  tools: ToolDefinition<any>[],
  name: string,
  rawInput: unknown,
): Promise<{ output: string; images: { mediaType: string; data: string }[]; isError: boolean }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { output: `Outil inconnu : ${name}`, images: [], isError: true };
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return { output: `Entrée invalide pour ${name} : ${parsed.error.message}`, images: [], isError: true };
  }
  try {
    const out = await tool.run(parsed.data);
    const text = typeof out === 'string' ? out : out.text;
    const images = typeof out === 'string' ? [] : out.images ?? [];
    return { output: text.length > 60_000 ? `${text.slice(0, 60_000)}\n…[tronqué]` : text, images, isError: false };
  } catch (err) {
    return { output: `Erreur de l'outil ${name} : ${(err as Error).message}`, images: [], isError: true };
  }
}
