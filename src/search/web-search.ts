import type { ChatMessage } from "../ai/types";
import type { Env } from "../types/env";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SEARCH_RESULT_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 8000;

export async function buildSearchContext(env: Env, messages: ChatMessage[]): Promise<string> {
  const query = getLatestUserText(messages);
  if (!query) return "";

  const results = await searchWeb(env, query);
  if (results.length === 0) {
    return [
      "Web search was requested, but the Worker could not reach direct search sources or a configured fallback.",
      "Do not invent search results. Tell the user web search failed and suggest trying again.",
    ].join(" ");
  }

  return [
    "Fresh web search results fetched directly by the Cloudflare Worker. Use them only when relevant. Cite source URLs in the answer.",
    ...results.map((result, index) => [
      `[${index + 1}] ${result.title}`,
      result.url,
      result.snippet,
    ].filter(Boolean).join("\n")),
  ].join("\n\n");
}

export async function searchWeb(env: Env, query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  results.push(...await googleNewsSearch(env, query).catch(() => []));
  if (results.length < SEARCH_RESULT_LIMIT) {
    results.push(...await duckDuckGoLiteSearch(env, query).catch(() => []));
  }
  if (results.length < SEARCH_RESULT_LIMIT) {
    results.push(...await fallbackResultSearch(env, query).catch(() => []));
  }

  return uniqueResults(results).slice(0, SEARCH_RESULT_LIMIT);
}

async function googleNewsSearch(env: Env, query: string): Promise<SearchResult[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const text = await fetchText(env, url.toString());
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, SEARCH_RESULT_LIMIT);

  return items.map((match) => {
    const item = match[1] || "";
    return {
      title: decodeXml(extractTag(item, "title")),
      url: normalizeGoogleNewsUrl(decodeXml(extractTag(item, "link"))),
      snippet: decodeXml(extractTag(item, "description")).replace(/<[^>]+>/g, " "),
    };
  }).filter((result) => result.title && result.url);
}

async function duckDuckGoLiteSearch(env: Env, query: string): Promise<SearchResult[]> {
  const url = new URL("https://lite.duckduckgo.com/lite/");
  url.searchParams.set("q", query);

  const html = await fetchText(env, url.toString());
  const results: SearchResult[] = [];
  const matches = html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g);

  for (const match of matches) {
    const href = decodeHtml(match[1] || "");
    const title = clean(decodeHtml((match[2] || "").replace(/<[^>]+>/g, " ")));
    const realUrl = normalizeDuckDuckGoUrl(href);
    if (!title || !realUrl || realUrl.includes("duckduckgo.com")) continue;
    results.push({ title, url: realUrl, snippet: "" });
    if (results.length >= SEARCH_RESULT_LIMIT) break;
  }

  return results;
}

async function fallbackResultSearch(env: Env, query: string): Promise<SearchResult[]> {
  const endpoint = (env.SEARCH_PROXY_URL || "").trim();
  if (!endpoint) return [];

  const url = new URL(endpoint);
  url.searchParams.set("q", query);

  const response = await fetchWithTimeout(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) return [];

  const data = await response.json() as {
    results?: Array<{ title?: string; url?: string; snippet?: string; description?: string }>;
  };

  return (data.results || [])
    .map((item) => ({
      title: clean(item.title),
      url: clean(item.url),
      snippet: clean(item.snippet || item.description),
    }))
    .filter((item) => item.title && item.url);
}

async function fetchText(env: Env, targetUrl: string): Promise<string> {
  const direct = await fetchWithTimeout(targetUrl, {
    headers: {
      Accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 CloudflareWorker AIChatSearch/1.0",
    },
  }).catch(() => null);

  if (direct?.ok) return direct.text();

  const relayText = await fetchTextViaFallback(env, targetUrl).catch(() => "");
  if (relayText) return relayText;

  throw new Error("direct web fetch failed");
}

async function fetchTextViaFallback(env: Env, targetUrl: string): Promise<string> {
  const endpoint = (env.SEARCH_PROXY_URL || "").trim();
  if (!endpoint) return "";

  const url = new URL(endpoint);
  url.searchParams.set("url", targetUrl);

  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8" },
  });

  if (!response.ok) return "";
  return response.text();
}

function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

function getLatestUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;

    if (typeof message.content === "string") return message.content;

    const text = message.content.find((part) => part.type === "text");
    if (text?.type === "text") return text.text;
  }

  return "";
}

function extractTag(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "";
}

function normalizeGoogleNewsUrl(url: string): string {
  return clean(url);
}

function normalizeDuckDuckGoUrl(url: string): string {
  const cleaned = clean(url);
  if (!cleaned) return "";
  if (cleaned.startsWith("//")) return `https:${cleaned}`;
  if (cleaned.startsWith("/l/?")) {
    const parsed = new URL(`https://duckduckgo.com${cleaned}`);
    return parsed.searchParams.get("uddg") || "";
  }
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return cleaned;
  return "";
}

function uniqueResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];

  for (const result of results) {
    const key = result.url || result.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: clean(result.title),
      url: clean(result.url),
      snippet: clean(result.snippet),
    });
  }

  return out;
}

function decodeXml(value: string): string {
  return decodeHtml(value.replace(/^<!\[CDATA\[|\]\]>$/g, ""));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}
