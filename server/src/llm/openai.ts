import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionContentPart,
} from 'openai/resources/chat/completions';
import type {
  FunctionTool,
  Response,
  ResponseInputItem,
  ResponseInputContent,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses';
import {
  executeTool,
  type AgentLoopRequest,
  type AgentLoopResult,
  type Effort,
  type LLMProvider,
  type NeutralMessage,
  type ProviderConfig,
} from './types.js';

const REASONING = /^(o\d|gpt-5)/;

function reasoningEffort(effort?: Effort | null) {
  if (!effort) return undefined;
  return effort === 'xhigh' || effort === 'max' ? 'high' : effort;
}

/**
 * Adaptateur OpenAI.
 * - Compte OpenAI officiel : API Responses (outils de fonction + recherche web native `web_search`).
 * - Fournisseurs compatibles OpenAI (Mistral, DeepSeek, Groq, OpenRouter, Ollama, Gemini…) : API Chat Completions.
 */
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private official: boolean;

  constructor(cfg: ProviderConfig) {
    this.official = cfg.kind === 'openai';
    this.client = new OpenAI({ apiKey: cfg.apiKey || 'not-needed', baseURL: cfg.baseUrl || undefined, maxRetries: 3 });
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids.sort();
  }

  runAgentLoop(req: AgentLoopRequest): Promise<AgentLoopResult> {
    return this.official ? this.runResponses(req) : this.runChatCompletions(req);
  }

  // ───────────────────────── API Responses (OpenAI officiel) ─────────────────────────

  private async runResponses(req: AgentLoopRequest): Promise<AgentLoopResult> {
    const { model, events } = req;
    const reasoning = REASONING.test(model);
    const effort = reasoningEffort(req.effort);

    const input: ResponseInputItem[] = req.messages.map((m): ResponseInputItem =>
      m.role === 'assistant'
        ? { role: 'assistant', content: m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n') }
        : {
            role: 'user',
            content: m.content.map(
              (p): ResponseInputContent =>
                p.type === 'text'
                  ? { type: 'input_text', text: p.text }
                  : { type: 'input_image', image_url: `data:${p.mediaType};base64,${p.data}`, detail: 'auto' },
            ),
          },
    );
    const tools: ResponsesTool[] = req.tools.map(
      (t): FunctionTool => ({ type: 'function', name: t.name, description: t.description, parameters: t.jsonSchema, strict: false }),
    );
    if (req.webSearch) tools.push({ type: 'web_search', search_context_size: 'medium' });

    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const sources = new Map<string, string>();
    let text = '';
    let thinking = '';
    let stopReason = 'completed';
    let servedModel = model;

    for (let step = 0; step < req.maxSteps; step++) {
      const lastStep = step === req.maxSteps - 1;
      const stream = await this.client.responses.create(
        {
          model,
          instructions: req.system,
          input,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? (lastStep ? 'none' : 'auto') : undefined,
          max_output_tokens: req.maxTokens,
          // Sans état côté OpenAI : on renvoie nous-mêmes les éléments de sortie (dont le raisonnement chiffré).
          store: false,
          include: [...(reasoning ? (['reasoning.encrypted_content'] as const) : []), 'web_search_call.action.sources'],
          ...(reasoning ? { reasoning: { ...(effort ? { effort } : {}), summary: 'auto' } } : {}),
          ...(req.temperature != null && !reasoning ? { temperature: req.temperature } : {}),
          stream: true,
        },
        { signal: req.signal },
      );

      let stepText = '';
      let response: Response | null = null;
      for await (const e of stream) {
        switch (e.type) {
          case 'response.output_text.delta':
            if (!stepText && text) events.onText('\n\n');
            stepText += e.delta;
            events.onText(e.delta);
            break;
          case 'response.reasoning_summary_text.delta':
            thinking += e.delta;
            events.onThinking?.(e.delta);
            break;
          case 'response.output_text.annotation.added': {
            const a = e.annotation as { type?: string; url?: string; title?: string } | null;
            if (a?.type === 'url_citation' && a.url) sources.set(a.url, a.title ?? '');
            break;
          }
          case 'response.output_item.done':
            if (e.item.type === 'web_search_call') {
              const action = e.item.action as { type: string; query?: string; queries?: string[]; url?: string; sources?: { url: string }[] };
              events.onToolCall({ id: e.item.id, name: 'web_search', input: action });
              events.onToolResult({
                id: e.item.id,
                name: 'web_search',
                output:
                  action.type === 'search'
                    ? (action.sources ?? []).map((s) => s.url).join('\n') || `Recherche : ${action.query ?? action.queries?.join(' | ') ?? ''}`
                    : action.type === 'open_page'
                      ? `Page ouverte : ${action.url ?? ''}`
                      : `Action : ${action.type}`,
                isError: e.item.status === 'failed',
              });
            }
            break;
          case 'response.completed':
          case 'response.incomplete':
            response = e.response;
            break;
          case 'response.failed':
            throw new Error(e.response.error?.message ?? 'Réponse OpenAI en échec');
          case 'error':
            throw new Error(e.message);
        }
      }
      if (!response) throw new Error('Flux OpenAI interrompu sans réponse finale');

      servedModel = response.model || servedModel;
      usage.inputTokens += response.usage?.input_tokens ?? 0;
      usage.outputTokens += response.usage?.output_tokens ?? 0;
      usage.cacheReadTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
      if (stepText) text += (text ? '\n\n' : '') + stepText;
      stopReason = response.status ?? 'completed';

      const calls = response.output.filter((o) => o.type === 'function_call');
      if (!calls.length || lastStep || response.status === 'incomplete') break;

      input.push(...(response.output as ResponseInputItem[]));
      const results = await Promise.all(
        calls.map(async (c) => {
          let parsed: unknown;
          try {
            parsed = c.arguments ? JSON.parse(c.arguments) : {};
          } catch {
            const output = `Arguments JSON invalides : ${c.arguments.slice(0, 200)}`;
            events.onToolResult({ id: c.call_id, name: c.name, output, isError: true });
            return { call_id: c.call_id, output };
          }
          events.onToolCall({ id: c.call_id, name: c.name, input: parsed });
          const { output, isError } = await executeTool(req.tools, c.name, parsed);
          events.onToolResult({ id: c.call_id, name: c.name, output, isError });
          return { call_id: c.call_id, output };
        }),
      );
      for (const r of results) input.push({ type: 'function_call_output', call_id: r.call_id, output: r.output });
    }

    if (sources.size) {
      const list = `\n\n**Sources web**\n${[...sources].map(([url, title]) => `- [${title || url}](${url})`).join('\n')}`;
      text += list;
      events.onText(list);
    }
    return { text, thinking, usage, model: servedModel, stopReason };
  }

  // ─────────────────── Chat Completions (fournisseurs compatibles OpenAI) ───────────────────

  private async runChatCompletions(req: AgentLoopRequest): Promise<AgentLoopResult> {
    const { model, events } = req;
    const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: req.system }, ...toChatMessages(req.messages)];
    const tools: ChatCompletionTool[] = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.jsonSchema },
    }));
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    let text = '';
    let stopReason = 'stop';
    let servedModel = model;

    for (let step = 0; step < req.maxSteps; step++) {
      const lastStep = step === req.maxSteps - 1;
      const stream = await this.client.chat.completions.create(
        {
          model,
          messages,
          stream: true,
          ...(tools.length ? { tools, tool_choice: lastStep ? 'none' : 'auto' } : {}),
          max_tokens: req.maxTokens,
          ...(req.temperature != null ? { temperature: req.temperature } : {}),
        },
        { signal: req.signal },
      );

      let stepText = '';
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let finish: string | null = null;

      for await (const chunk of stream) {
        servedModel = chunk.model || servedModel;
        if (chunk.usage) {
          usage.inputTokens += chunk.usage.prompt_tokens ?? 0;
          usage.outputTokens += chunk.usage.completion_tokens ?? 0;
          usage.cacheReadTokens += chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) {
          if (!stepText && text) events.onText('\n\n');
          stepText += delta.content;
          events.onText(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(tc.index, cur);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }

      if (stepText) text += (text ? '\n\n' : '') + stepText;
      stopReason = finish ?? 'stop';
      if (calls.size === 0 || lastStep) break;
      if (finish === 'length') break; // arguments d'outil possiblement tronqués : on n'exécute pas.

      const list = [...calls.values()];
      messages.push({
        role: 'assistant',
        content: stepText || null,
        tool_calls: list.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
      });
      const results = await Promise.all(
        list.map(async (c) => {
          let input: unknown;
          try {
            input = c.args ? JSON.parse(c.args) : {};
          } catch {
            const output = `Arguments JSON invalides : ${c.args.slice(0, 200)}`;
            events.onToolResult({ id: c.id, name: c.name, output, isError: true });
            return { id: c.id, output };
          }
          events.onToolCall({ id: c.id, name: c.name, input });
          const { output, isError } = await executeTool(req.tools, c.name, input);
          events.onToolResult({ id: c.id, name: c.name, output, isError });
          return { id: c.id, output };
        }),
      );
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.output });
    }

    return { text, thinking: '', usage, model: servedModel, stopReason };
  }
}

function toChatMessages(messages: NeutralMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    if (m.role === 'assistant') {
      return { role: 'assistant', content: m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n') };
    }
    const parts: ChatCompletionContentPart[] = m.content.map((p) =>
      p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } },
    );
    return { role: 'user', content: parts };
  });
}
