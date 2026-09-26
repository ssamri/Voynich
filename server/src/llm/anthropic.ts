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
      // Recherche web + lecture de pages, exécutées côté Anthropic (outils serveur).
      tools.push(
        ...(adaptive
          ? ([
              { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
              { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5, citations: { enabled: true } },
            ] as BetaToolUnion[])
          : ([
              { type: 'web_search_20250305', name: 'web_search', max_uses: 8 },
              { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5, citations: { enabled: true } },
            ] as BetaToolUnion[])),
      );
    }
    const sources = new Map<string, string>();

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
      reportServerTools(message, events, sources);

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
          const { output, images, isError } = await executeTool(req.tools, tu.name, tu.input);
          events.onToolResult({ id: tu.id, name: tu.name, output: images.length ? `${output}\n[${images.length} image(s) transmise(s) au modèle]` : output, isError });
          return {
            type: 'tool_result',
            tool_use_id: tu.id,
            is_error: isError,
            content: images.length
              ? [
                  { type: 'text', text: output },
                  ...images.map((im) => ({
                    type: 'image' as const,
                    source: { type: 'base64' as const, media_type: im.mediaType as 'image/jpeg', data: im.data },
                  })),
                ]
              : output,
          };
        }),
      );
      messages.push({ role: 'user', content: results });
    }

    if (sources.size) {
      const list = `\n\n**Sources web**\n${[...sources].map(([url, title]) => `- [${title || url}](${url})`).join('\n')}`;
      text += list;
      events.onText(list);
    }
    return { text, thinking, usage, model: servedModel, stopReason };
  }
}

type LooseBlock = {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  citations?: { url?: string; title?: string }[] | null;
};

/**
 * Les outils serveur (recherche web, lecture de page) s'exécutent chez Anthropic :
 * on les rapporte à l'interface comme des appels d'outils, et on collecte les sources citées.
 */
function reportServerTools(message: BetaMessage, events: AgentLoopRequest['events'], sources: Map<string, string>) {
  const names = new Map<string, string>();
  for (const raw of message.content) {
    const b = raw as unknown as LooseBlock;
    if (b.type === 'server_tool_use' && b.id) {
      names.set(b.id, b.name ?? 'web');
      events.onToolCall({ id: b.id, name: b.name ?? 'web', input: b.input });
    } else if (b.type === 'web_search_tool_result' && b.tool_use_id) {
      const results = Array.isArray(b.content) ? (b.content as { url: string; title: string }[]) : null;
      events.onToolResult({
        id: b.tool_use_id,
        name: 'web_search',
        output: results ? results.map((r) => `${r.title} — ${r.url}`).join('\n') || 'Aucun résultat' : `Erreur : ${JSON.stringify(b.content)}`,
        isError: !results,
      });
    } else if (b.type === 'web_fetch_tool_result' && b.tool_use_id) {
      const c = b.content as { type?: string; url?: string; error_code?: string } | undefined;
      const ok = c?.type === 'web_fetch_result';
      events.onToolResult({
        id: b.tool_use_id,
        name: names.get(b.tool_use_id) ?? 'web_fetch',
        output: ok ? `Page lue : ${c?.url}` : `Erreur : ${c?.error_code ?? 'inconnue'}`,
        isError: !ok,
      });
    } else if (b.type === 'text' && b.citations) {
      for (const c of b.citations) if (c.url) sources.set(c.url, c.title ?? '');
    }
  }
}
