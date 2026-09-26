import OpenAI from 'openai';
import { executeTool, } from './types.js';
const REASONING = /^(o\d|gpt-5)/;
function reasoningEffort(effort) {
    if (!effort)
        return undefined;
    return effort === 'xhigh' || effort === 'max' ? 'high' : effort;
}
/**
 * Adaptateur OpenAI.
 * - Compte OpenAI officiel : API Responses (outils de fonction + recherche web native `web_search`).
 * - Fournisseurs compatibles OpenAI (Mistral, DeepSeek, Groq, OpenRouter, Ollama, Gemini…) : API Chat Completions.
 */
export class OpenAIProvider {
    client;
    official;
    constructor(cfg) {
        this.official = cfg.kind === 'openai';
        this.client = new OpenAI({ apiKey: cfg.apiKey || 'not-needed', baseURL: cfg.baseUrl || undefined, maxRetries: 3 });
    }
    async listModels() {
        const ids = [];
        for await (const m of this.client.models.list())
            ids.push(m.id);
        return ids.sort();
    }
    runAgentLoop(req) {
        return this.official ? this.runResponses(req) : this.runChatCompletions(req);
    }
    // ───────────────────────── API Responses (OpenAI officiel) ─────────────────────────
    async runResponses(req) {
        const { model, events } = req;
        const reasoning = REASONING.test(model);
        const effort = reasoningEffort(req.effort);
        const input = req.messages.map((m) => m.role === 'assistant'
            ? { role: 'assistant', content: m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n') }
            : {
                role: 'user',
                content: m.content.map((p) => p.type === 'text'
                    ? { type: 'input_text', text: p.text }
                    : { type: 'input_image', image_url: `data:${p.mediaType};base64,${p.data}`, detail: 'auto' }),
            });
        const tools = req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.jsonSchema, strict: false }));
        if (req.webSearch)
            tools.push({ type: 'web_search', search_context_size: 'medium' });
        const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
        const sources = new Map();
        let text = '';
        let thinking = '';
        let stopReason = 'completed';
        let servedModel = model;
        for (let step = 0; step < req.maxSteps; step++) {
            const lastStep = step === req.maxSteps - 1;
            const stream = await this.client.responses.create({
                model,
                instructions: req.system,
                input,
                tools: tools.length ? tools : undefined,
                tool_choice: tools.length ? (lastStep ? 'none' : 'auto') : undefined,
                max_output_tokens: req.maxTokens,
                // Sans état côté OpenAI : on renvoie nous-mêmes les éléments de sortie (dont le raisonnement chiffré).
                store: false,
                include: [...(reasoning ? ['reasoning.encrypted_content'] : []), 'web_search_call.action.sources'],
                ...(reasoning ? { reasoning: { ...(effort ? { effort } : {}), summary: 'auto' } } : {}),
                ...(req.temperature != null && !reasoning ? { temperature: req.temperature } : {}),
                stream: true,
            }, { signal: req.signal });
            let stepText = '';
            let response = null;
            for await (const e of stream) {
                switch (e.type) {
                    case 'response.output_text.delta':
                        if (!stepText && text)
                            events.onText('\n\n');
                        stepText += e.delta;
                        events.onText(e.delta);
                        break;
                    case 'response.reasoning_summary_text.delta':
                        thinking += e.delta;
                        events.onThinking?.(e.delta);
                        break;
                    case 'response.output_text.annotation.added': {
                        const a = e.annotation;
                        if (a?.type === 'url_citation' && a.url)
                            sources.set(a.url, a.title ?? '');
                        break;
                    }
                    case 'response.output_item.done':
                        if (e.item.type === 'web_search_call') {
                            const action = e.item.action;
                            events.onToolCall({ id: e.item.id, name: 'web_search', input: action });
                            events.onToolResult({
                                id: e.item.id,
                                name: 'web_search',
                                output: action.type === 'search'
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
            if (!response)
                throw new Error('Flux OpenAI interrompu sans réponse finale');
            servedModel = response.model || servedModel;
            usage.inputTokens += response.usage?.input_tokens ?? 0;
            usage.outputTokens += response.usage?.output_tokens ?? 0;
            usage.cacheReadTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
            if (stepText)
                text += (text ? '\n\n' : '') + stepText;
            stopReason = response.status ?? 'completed';
            const calls = response.output.filter((o) => o.type === 'function_call');
            if (!calls.length || lastStep || response.status === 'incomplete')
                break;
            input.push(...response.output);
            const results = await Promise.all(calls.map(async (c) => {
                let parsed;
                try {
                    parsed = c.arguments ? JSON.parse(c.arguments) : {};
                }
                catch {
                    const output = `Arguments JSON invalides : ${c.arguments.slice(0, 200)}`;
                    events.onToolResult({ id: c.call_id, name: c.name, output, isError: true });
                    return { call_id: c.call_id, output, images: [] };
                }
                events.onToolCall({ id: c.call_id, name: c.name, input: parsed });
                const { output, images, isError } = await executeTool(req.tools, c.name, parsed);
                events.onToolResult({ id: c.call_id, name: c.name, output: images.length ? `${output}\n[${images.length} image(s) transmise(s) au modèle]` : output, isError });
                return { call_id: c.call_id, output, images };
            }));
            for (const r of results)
                input.push({
                    type: 'function_call_output',
                    call_id: r.call_id,
                    output: r.images.length
                        ? [
                            { type: 'input_text', text: r.output },
                            ...r.images.map((im) => ({ type: 'input_image', image_url: `data:${im.mediaType};base64,${im.data}`, detail: 'high' })),
                        ]
                        : r.output,
                });
        }
        if (sources.size) {
            const list = `\n\n**Sources web**\n${[...sources].map(([url, title]) => `- [${title || url}](${url})`).join('\n')}`;
            text += list;
            events.onText(list);
        }
        return { text, thinking, usage, model: servedModel, stopReason };
    }
    // ─────────────────── Chat Completions (fournisseurs compatibles OpenAI) ───────────────────
    async runChatCompletions(req) {
        const { model, events } = req;
        const messages = [{ role: 'system', content: req.system }, ...toChatMessages(req.messages)];
        let tools = req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.jsonSchema },
        }));
        const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
        let text = '';
        let stopReason = 'stop';
        let servedModel = model;
        for (let step = 0; step < req.maxSteps; step++) {
            const lastStep = step === req.maxSteps - 1;
            const params = () => ({
                model,
                messages,
                stream: true,
                ...(tools.length ? { tools, tool_choice: lastStep ? 'none' : 'auto' } : {}),
                max_tokens: req.maxTokens,
                ...(req.temperature != null ? { temperature: req.temperature } : {}),
            });
            let stream;
            try {
                stream = await this.client.chat.completions.create(params(), { signal: req.signal });
            }
            catch (err) {
                // Certains modèles gratuits / locaux ne gèrent pas les appels d'outils : on continue sans outils.
                if (!tools.length || !(err instanceof OpenAI.APIError) || ![400, 404, 422].includes(err.status ?? 0) || !/tool|function/i.test(err.message))
                    throw err;
                tools = [];
                const note = "_(Ce modèle ne prend pas en charge les outils : réponse sans accès à la bibliothèque, à la mémoire ni à internet.)_\n\n";
                text += note;
                events.onText(note);
                stream = await this.client.chat.completions.create(params(), { signal: req.signal });
            }
            let stepText = '';
            const calls = new Map();
            let finish = null;
            for await (const chunk of stream) {
                servedModel = chunk.model || servedModel;
                if (chunk.usage) {
                    usage.inputTokens += chunk.usage.prompt_tokens ?? 0;
                    usage.outputTokens += chunk.usage.completion_tokens ?? 0;
                    usage.cacheReadTokens += chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
                }
                const choice = chunk.choices?.[0];
                if (!choice)
                    continue;
                const delta = choice.delta;
                if (delta?.content) {
                    if (!stepText && text)
                        events.onText('\n\n');
                    stepText += delta.content;
                    events.onText(delta.content);
                }
                for (const tc of delta?.tool_calls ?? []) {
                    const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
                    if (tc.id)
                        cur.id = tc.id;
                    if (tc.function?.name)
                        cur.name += tc.function.name;
                    if (tc.function?.arguments)
                        cur.args += tc.function.arguments;
                    calls.set(tc.index, cur);
                }
                if (choice.finish_reason)
                    finish = choice.finish_reason;
            }
            if (stepText)
                text += (text && !text.endsWith('\n\n') ? '\n\n' : '') + stepText;
            stopReason = finish ?? 'stop';
            if (calls.size === 0 || lastStep)
                break;
            if (finish === 'length')
                break; // arguments d'outil possiblement tronqués : on n'exécute pas.
            const list = [...calls.values()];
            messages.push({
                role: 'assistant',
                content: stepText || null,
                tool_calls: list.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
            });
            const results = await Promise.all(list.map(async (c) => {
                let input;
                try {
                    input = c.args ? JSON.parse(c.args) : {};
                }
                catch {
                    const output = `Arguments JSON invalides : ${c.args.slice(0, 200)}`;
                    events.onToolResult({ id: c.id, name: c.name, output, isError: true });
                    return { id: c.id, output, images: [] };
                }
                events.onToolCall({ id: c.id, name: c.name, input });
                const { output, images, isError } = await executeTool(req.tools, c.name, input);
                events.onToolResult({ id: c.id, name: c.name, output: images.length ? `${output}\n[${images.length} image(s) transmise(s) au modèle]` : output, isError });
                return { id: c.id, output, images };
            }));
            for (const r of results)
                messages.push({ role: 'tool', tool_call_id: r.id, content: r.output });
            // Chat Completions n'accepte pas d'image dans un message d'outil : on les joint dans un message utilisateur.
            const imgs = results.flatMap((r) => r.images);
            if (imgs.length)
                messages.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Images renvoyées par les outils ci-dessus :' },
                        ...imgs.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.data}` } })),
                    ],
                });
        }
        return { text, thinking: '', usage, model: servedModel, stopReason };
    }
}
function toChatMessages(messages) {
    return messages.map((m) => {
        if (m.role === 'assistant') {
            return { role: 'assistant', content: m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n') };
        }
        const parts = m.content.map((p) => p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } });
        return { role: 'user', content: parts };
    });
}
//# sourceMappingURL=openai.js.map