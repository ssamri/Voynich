import dns from 'node:dns/promises';
import net from 'node:net';
import { extractText } from 'unpdf';
import { getSetting, setSetting } from '../db.js';
import { decrypt, encrypt, maskKey } from '../security/crypto.js';

/**
 * Recherche internet « générique » pour les modèles sans recherche native
 * (Ollama, Groq, Gemini via endpoint OpenAI, OpenRouter, Mistral…).
 * Moteurs : Tavily ou Brave (clé gratuite) ; à défaut Wikipédia (sans clé).
 */
export type SearchEngine = 'wikipedia' | 'tavily' | 'brave';

export interface SearchSettings {
  engine: SearchEngine;
  hasKey: boolean;
  keyHint: string | null;
}

export function getSearchSettings(): SearchSettings {
  const raw = JSON.parse(getSetting('web_search') ?? '{}') as { engine?: SearchEngine; keyEnc?: string; keyHint?: string };
  return { engine: raw.engine ?? 'wikipedia', hasKey: Boolean(raw.keyEnc), keyHint: raw.keyHint ?? null };
}

export function saveSearchSettings(engine: SearchEngine, apiKey?: string) {
  const raw = JSON.parse(getSetting('web_search') ?? '{}') as { keyEnc?: string; keyHint?: string; engine?: SearchEngine };
  const keepKey = !apiKey && raw.engine === engine;
  setSetting(
    'web_search',
    JSON.stringify({
      engine,
      keyEnc: apiKey ? encrypt(apiKey) : keepKey ? raw.keyEnc : undefined,
      keyHint: apiKey ? maskKey(apiKey) : keepKey ? raw.keyHint : undefined,
    }),
  );
}

function searchKey(): string | null {
  const raw = JSON.parse(getSetting('web_search') ?? '{}') as { keyEnc?: string };
  return raw.keyEnc ? decrypt(raw.keyEnc) : null;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const UA = 'VoynichLab/1.0 (research assistant)';

async function wikipedia(query: string, lang: string, limit: number): Promise<SearchResult[]> {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit), format: 'json', utf8: '1' }).toString();
  const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Wikipédia ${res.status}`);
  const data = (await res.json()) as { query?: { search?: { title: string; snippet: string }[] } };
  return (data.query?.search ?? []).map((r) => ({
    title: `${r.title} (Wikipédia ${lang})`,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: r.snippet.replace(/<[^>]+>/g, ''),
  }));
}

export async function webSearch(query: string, limit = 6): Promise<{ engine: SearchEngine; results: SearchResult[] }> {
  const { engine } = getSearchSettings();
  const key = searchKey();

  if (engine === 'tavily' && key) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: limit, search_depth: 'basic' }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}`);
    const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    return { engine, results: (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })) };
  }

  if (engine === 'brave' && key) {
    const u = new URL('https://api.search.brave.com/res/v1/web/search');
    u.search = new URLSearchParams({ q: query, count: String(limit) }).toString();
    const res = await fetch(u, { headers: { Accept: 'application/json', 'X-Subscription-Token': key }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Brave ${res.status}`);
    const data = (await res.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
    return {
      engine,
      results: (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description.replace(/<[^>]+>/g, '') })),
    };
  }

  // Sans clé : Wikipédia français + anglais.
  const [fr, en] = await Promise.allSettled([wikipedia(query, 'fr', Math.ceil(limit / 2)), wikipedia(query, 'en', limit)]);
  const results = [...(fr.status === 'fulfilled' ? fr.value : []), ...(en.status === 'fulfilled' ? en.value : [])].slice(0, limit);
  if (!results.length && fr.status === 'rejected' && en.status === 'rejected') throw new Error('Wikipédia injoignable');
  return { engine: 'wikipedia', results };
}

// ───────────────────────── Lecture d'une page web ─────────────────────────

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/** Refuse les adresses internes (protection SSRF) : l'URL vient d'un modèle, donc non fiable. */
async function assertPublicUrl(u: URL) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Seules les URL http(s) sont autorisées');
  if (u.username || u.password) throw new Error('URL avec identifiants refusée');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error('Adresse interne ou privée refusée');
}

function htmlToText(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
  return { title, text: body };
}

const MAX_BYTES = 5 * 1024 * 1024;

export async function fetchUrl(url: string): Promise<{ url: string; title: string; text: string }> {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Document trop volumineux (> 5 Mo)');
    if (type.includes('pdf') || current.pathname.toLowerCase().endsWith('.pdf')) {
      const { text } = await extractText(new Uint8Array(buf), { mergePages: true });
      return { url: current.toString(), title: current.pathname.split('/').pop() ?? 'PDF', text };
    }
    const raw = buf.toString('utf8');
    if (type.includes('html') || /<html|<body/i.test(raw.slice(0, 2000))) return { url: current.toString(), ...htmlToText(raw) };
    return { url: current.toString(), title: '', text: raw };
  }
  throw new Error('Trop de redirections');
}
