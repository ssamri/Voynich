import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolUnion,
  BetaToolResultBlockParam,
  BetaContentBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  executeTool,
  type AgentLoopRequest,
  type AgentLoopResult,
  type Effort,
  type LLMProvider,
  type NeutralMessage,
  type ProviderConfig,
} from './types.js';

/** Modèles qui prennent la réflexion adaptative et le paramètre effort. */
const ADAPTIVE = /claude-(opus-4-[678]|sonnet-4-6|sonnet-5|opus-5|fable|mythos)/;
/** Modèles sur lesquels temperature/top_p sont refusés (400). */
const NO_SAMPLING = /claude-(opus-4-[78]|opus-5|sonnet-5|fable|mythos)/;
/** Modèles acceptant les repli serveur `fallbacks: "default"` en cas de refus. */
const FALLBACKS = /claude-(opus-5|fable-5|mythos-5)/;
const XHIGH = /claude-(opus-4-[78]|opus-5|sonnet-5|fable|mythos)/;

function toAnthropicMessages(messages: NeutralMessage[]): BetaMessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((p): BetaContentBlockParam =>
      p.type === 'text'
        ? { type: 'text', text: p.text }
        : {
            type: 'image',
            source: {
              type: 'base64',
              media_type: p.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: p.data,
            },
          },
    ),
  }));
}

function effortFor(model: string, effort?: Effort | null): Effort | undefined {
  if (!effort || !ADAPTIVE.test(model)) return undefined;
  if ((effort === 'xhigh' || effort === 'max') && !XHIGH.test(model)) return effort === 'max' ? 'max' : 'high';
  return effort;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(cfg: ProviderConfig) {
    this.client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined, maxRetries: 3 });
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }

  async runAgentLoop(req: AgentLoopRequest): Promise<AgentLoopResult> {
    const { model, events } = req;
    const adaptive = ADAPTIVE.test(model);
    const useFallbacks = FALLBACKS.test(model);

    const tools: BetaToolUnion[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.jsonSchema as BetaTool['input_schema'],
      eager_input_streaming: true,
    }));
    if (req.webSearch) {
      tools.push(
        adaptive
          ? { type: 'web_search_20260209', name: 'web_search', max_uses: 5 }
          : { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
      );
    }

    const messages = toAnthropicMessages(req.messages);
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    let text = '';
    let thinking = '';
    let stopReason = 'end_turn';
    let servedModel = model;
    let jsonRetries = 0;
    const effort = effortFor(model, req.effort);

    for (let step = 0; step < req.maxSteps; step++) {
      const lastStep = step === req.maxSteps - 1;
      const stream = this.client.beta.messages.stream(
        {
          model,
          max_tokens: req.maxTokens,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages,
          tools: tools.length ? tools : undefined,
          // À la dernière étape on interdit les outils pour obtenir une réponse rédigée.
          tool_choice: tools.length ? { type: lastStep ? 'none' : 'auto' } : undefined,
          ...(adaptive ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
          ...(effort ? { output_config: { effort } } : {}),
          ...(req.temperature != null && !NO_SAMPLING.test(model) ? { temperature: req.temperature } : {}),
          ...(useFallbacks ? { fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] } : {}),
        },
        { signal: req.signal },
      );

      let stepText = '';
      stream.on('text', (delta) => {
        if (!stepText && text) events.onText('\n\n');
        stepText += delta;
        events.onText(delta);
      });
      stream.on('thinking', (delta) => {
        thinking += delta;
        events.onThinking?.(delta);
      });

      let message: BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // Seule une entrée d'outil JSON illisible (streaming anticipé) est retentée.
        if (err instanceof Anthropic.APIError || req.signal.aborted || jsonRetries++ >= 2) throw err;
        continue;
      }

      servedModel = message.model ?? servedModel;
      usage.inputTokens +=
        (message.usage.input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
      usage.outputTokens += message.usage.output_tokens ?? 0;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
      if (stepText) text += (text ? '\n\n' : '') + stepText;
      stopReason = message.stop_reason ?? 'end_turn';

      if (stopReason === 'refusal') {
        const cat = message.stop_details?.category;
        text += `\n\n_[Réponse refusée par le modèle${cat ? ` — catégorie : ${cat}` : ''}]_`;
        break;
      }
      if (stopReason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      const toolUses = message.content.filter((b) => b.type === 'tool_use');
      if (stopReason !== 'tool_use' || toolUses.length === 0) break;
      if (lastStep) break;

      messages.push({ role: 'assistant', content: message.content });
      const results: BetaToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu) => {
          events.onToolCall({ id: tu.id, name: tu.name, input: tu.input });
          const { output, isError } = await executeTool(req.tools, tu.name, tu.input);
          events.onToolResult({ id: tu.id, name: tu.name, output, isError });
          return { type: 'tool_result', tool_use_id: tu.id, content: output, is_error: isError };
        }),
      );
      messages.push({ role: 'user', content: results });
    }

    return { text, thinking, usage, model: servedModel, stopReason };
  }
}
