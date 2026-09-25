import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionContentPart,
} from 'openai/resources/chat/completions';
import {
  executeTool,
  type AgentLoopRequest,
  type AgentLoopResult,
  type LLMProvider,
  type NeutralMessage,
  type ProviderConfig,
} from './types.js';

const REASONING = /^(o\d|gpt-5)/;

function toOpenAIMessages(system: string, messages: NeutralMessage[], developerRole: boolean): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: developerRole ? 'developer' : 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n') });
    } else {
      const parts: ChatCompletionContentPart[] = m.content.map((p) =>
        p.type === 'text'
          ? { type: 'text', text: p.text }
          : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } },
      );
      out.push({ role: 'user', content: parts });
    }
  }
  return out;
}

/**
 * Adaptateur OpenAI (Chat Completions). Sert aussi pour tout fournisseur compatible
 * OpenAI (Mistral, DeepSeek, Groq, OpenRouter, Ollama, Gemini via endpoint OpenAI…).
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

  async runAgentLoop(req: AgentLoopRequest): Promise<AgentLoopResult> {
    const { model, events } = req;
    const reasoning = this.official && REASONING.test(model);
    const messages = toOpenAIMessages(req.system, req.messages, reasoning);
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
      const effort = req.effort ? (req.effort === 'xhigh' || req.effort === 'max' ? 'high' : req.effort) : undefined;
      const stream = await this.client.chat.completions.create(
        {
          model,
          messages,
          stream: true,
          ...(this.official ? { stream_options: { include_usage: true } } : {}),
          ...(tools.length ? { tools, tool_choice: lastStep ? 'none' : 'auto' } : {}),
          ...(this.official ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
          ...(reasoning && effort ? { reasoning_effort: effort } : {}),
          ...(req.temperature != null && !reasoning ? { temperature: req.temperature } : {}),
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
