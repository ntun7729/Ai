import type { ChatMessage } from "../ai/types";
import type { Env } from "../types/env";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SEARCH_RESULT_LIMIT = 8;
const REQUEST_TIMEOUT_MS = 8000;
const URL_PATTERN = /https?:\/\/[^\s<>)"']+/gi;
const fetchCooldownUntil = new Map<string, number>();

export async function buildSearchContext(env: Env, messages: ChatMessage[]): Promise<string> {
  const query = getLatestUserText(messages);
  if (!query) return "";

  const links = extractUrls(query);
  const pageResults = await fetchLinkedPages(env, links);
  const shouldSearch = shouldRunSearch(query, links, pageResults);
  const searchResults = shouldSearch ? await searchWeb(env, normalizeSearchQuery(query)) : [];
  const results = uniqueResults([...pageResults, ...searchResults]).slice(0, SEARCH_RESULT_LIMIT);

  if (results.length === 0) {
    return [
      "Web or link fetch was requested, but the Worker could not fetch direct web results, proxyip results, or page text.",
      "Do not invent current facts or sources. Tell the user the fetch failed and suggest trying again with a direct article URL.",
    ].join(" ");
  }

  return [
    `Current app date: ${new Date().toISOString().slice(0, 10)}.`,
    "Fresh web and/or linked-page results were fetched directly by the app before this answer.",
    "If linked pages were fetched, use that page text as the main source for the answer.",
    "Synthesize results into a useful answer instead of dumping raw links.",
    "For news, give a short summary, key details, why each item matters, and mention the published date if provided.",
    "Do not claim a story is from today unless a result includes a current published date.",
    "Prefer reliable/primary outlets when results overlap. Mention uncertainty when a result has weak detail.",
    "Do not output long raw URLs. Cite naturally using source names or short markdown links.",
    "Results:",
    ...results.map((result, index) => [
      `[${index + 1}] Title: ${result.title}`,
      `URL: ${result.url}`,
      result.snippet ? `Snippet: ${result.snippet}` : "",
    ].filter(Boolean).join("\n")),
  ].join("\n\n");
}

export function messageHasUrl(messages: ChatMessage[]): boolean {
  return extractUrls(getLatestUserText(messages)).length > 0;
}

export async function searchWeb(env: Env, query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const normalizedQuery = normalizeSearchQuery(query);

  if (isGeneralNewsQuery(normalizedQuery)) {
    results.push(...await googleNewsTopStories(env).catch(() => []));
  }
  if (results.length < SEARCH_RESULT_LIMIT && !isGeneralNewsQuery(normalizedQuery)) {
    results.push(...await googleSearch(env, normalizedQuery).catch(() => []));
  }
  if (results.length < SEARCH_RESULT_LIMIT) {
    results.push(...await googleNewsSearch(env, normalizedQuery).catch(() => []));
  }
  if (results.length < SEARCH_RESULT_LIMIT) {
    results.push(...await duckDuckGoLiteSearch(env, normalizedQuery).catch(() => []));
  }
  if (results.length < SEARCH_RESULT_LIMIT) {
    results.push(...await fallbackResultSearch(env, normalizedQuery).catch(() => []));
  }

  return uniqueResults(results).slice(0, SEARCH_RESULT_LIMIT);
}

async function googleSearch(env: Env, query: string): Promise<SearchResult[]> {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");

  const html = await fetchText(env, url.toString());
  const results: SearchResult[] = [];
  const matches = html.matchAll(/<a\s+href="\/url\?q=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g);

  for (const match of matches) {
    const target = decodeURIComponent(match[1] || "");
    const title = clean(decodeHtml((match[2] || "").replace(/<[^>]+>/g, " ")));
    if (!target || !title || target.includes("google.com")) continue;
    results.push({ title, url: target, snippet: "" });
    if (results.length >= SEARCH_RESULT_LIMIT) break;
  }

  return results;
}

async function googleNewsTopStories(env: Env): Promise<SearchResult[]> {
  const url = new URL("https://news.google.com/rss");
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return googleNewsRss(env, url.toString());
}

async function googleNewsSearch(env: Env, query: string): Promise<SearchResult[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return googleNewsRss(env, url.toString());
}

async function googleNewsRss(env: Env, url: string): Promise<SearchResult[]> {
  const text = await fetchText(env, url);
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, SEARCH_RESULT_LIMIT);

  return items.map((match) => {
    const item = match[1] || "";
    const published = decodeXml(extractTag(item, "pubDate"));
    const description = decodeXml(extractTag(item, "description")).replace(/<[^>]+>/g, " ");
    return {
      title: decodeXml(extractTag(item, "title")),
      url: decodeXml(extractTag(item, "link")),
      snippet: clean([published ? `Published: ${published}.` : "", description].join(" ")),
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

async function fetchLinkedPages(env: Env, urls: string[]): Promise<SearchResult[]> {
  const safeUrls = urls.filter(isAllowedFetchUrl).slice(0, 3);
  const results = await Promise.all(safeUrls.map(async (url) => {
    const resolvedUrl = await resolveNewsUrl(env, url).catch(() => url);
    const html = await fetchText(env, resolvedUrl).catch(() => "");
    if (!html) return null;
    const title = extractHtmlTitle(html) || resolvedUrl;
    const text = htmlToReadableText(html).slice(0, 6000);
    if (!text || text.length < 120) return null;
    return { title, url: resolvedUrl, snippet: text };
  }));

  return results.filter((item): item is SearchResult => Boolean(item));
}

async function resolveNewsUrl(env: Env, inputUrl: string): Promise<string> {
  const url = new URL(inputUrl);
  if (!url.hostname.endsWith("news.google.com")) return inputUrl;

  const articleId = googleNewsArticleId(url);
  if (!articleId) return inputUrl;

  const articleUrl = await decodeGoogleNewsArticle(env, articleId).catch(() => "");
  if (articleUrl && isAllowedFetchUrl(articleUrl)) return articleUrl;

  const html = await fetchText(env, inputUrl).catch(() => "");
  const canonical = extractGoogleNewsCanonical(html);
  if (canonical && isAllowedFetchUrl(canonical)) return canonical;

  return inputUrl;
}

async function decodeGoogleNewsArticle(env: Env, articleId: string): Promise<string> {
  const articlePage = `https://news.google.com/articles/${articleId}`;
  const html = await fetchText(env, articlePage);
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1] || "";
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1] || "";
  if (!signature || !timestamp) return "";

  const rpc = [[["Fbv4je", JSON.stringify([articleId, signature, timestamp]), null, "generic"]]];
  const body = `f.req=${encodeURIComponent(JSON.stringify(rpc))}`;
  const response = await fetchWithTimeout(env, "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "Mozilla/5.0 CloudflareWorker AIChatSearch/1.0",
    },
    body,
  });

  if (!response.ok) return "";
  const text = await response.text();
  const match = text.match(/\[\"garturlres\",\"(https?:\\\/\\\/[^\"]+)/);
  return match ? JSON.parse(`"${match[1]}"`) : "";
}

function googleNewsArticleId(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part === "read" || part === "articles");
  return index >= 0 ? parts[index + 1] || "" : "";
}

function extractGoogleNewsCanonical(html: string): string {
  if (!html) return "";
  const href = html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/i)?.[1] || "";
  if (href && !href.includes("news.google.com")) return decodeHtml(href);
  return "";
}

async function fallbackResultSearch(env: Env, query: string): Promise<SearchResult[]> {
  const endpoint = (env.SEARCH_PROXY_URL || "").trim();
  if (!endpoint) return [];

  const url = new URL(endpoint);
  url.searchParams.set("q", query);

  const response = await fetchWithTimeout(env, url.toString(), { headers: { Accept: "application/json" } });
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
  const direct = await fetchWithTimeout(env, targetUrl, htmlFetchInit()).catch(() => null);
  if (direct?.ok) return direct.text();

  const proxyip = await fetchTextViaProxyIp(env, targetUrl).catch(() => "");
  if (proxyip) return proxyip;

  const relayText = await fetchTextViaFallback(env, targetUrl).catch(() => "");
  if (relayText) return relayText;

  throw new Error("direct/proxyip web fetch failed");
}

async function fetchTextViaProxyIp(env: Env, targetUrl: string): Promise<string> {
  const proxyHosts = proxyIpHosts(env);
  if (proxyHosts.length === 0) return "";

  const target = new URL(targetUrl);
  if (target.protocol !== "https:") return "";

  for (const proxyHost of proxyHosts) {
    const parsed = parseProxyHost(proxyHost);
    if (!parsed.host || isProxyCoolingDown(parsed.host)) continue;

    const init = htmlFetchInit();
    const response = await fetchWithTimeout(env, target.toString(), {
      ...init,
      cf: { ...(init.cf || {}), resolveOverride: parsed.host },
    } as RequestInit).catch(() => null);

    if (response?.ok) return response.text();
    rememberProxyFailure(parsed.host, env);
  }

  return "";
}

async function fetchTextViaFallback(env: Env, targetUrl: string): Promise<string> {
  const endpoint = (env.SEARCH_PROXY_URL || "").trim();
  if (!endpoint) return "";

  const url = new URL(endpoint);
  url.searchParams.set("url", targetUrl);

  const response = await fetchWithTimeout(env, url.toString(), htmlFetchInit());

  if (!response.ok) return "";
  return response.text();
}

function htmlFetchInit(): RequestInit {
  return {
    headers: {
      Accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 CloudflareWorker AIChatSearch/1.0",
    },
  };
}

function fetchWithTimeout(env: Env, input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const finalInit: RequestInit = { ...init, signal: controller.signal };

  return fetch(input, finalInit).finally(() => clearTimeout(id));
}

function proxyIpHosts(env: Env): string[] {
  return csvFirst(env.PROXY_HOSTS, env.PROXY_IPS, env.PROXYIP);
}

function parseProxyHost(value: string): { host: string; port: number } {
  const trimmed = value.trim();
  if (!trimmed) return { host: "", port: 443 };
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return { host: url.hostname, port: Number(url.port || 443) };
  } catch {
    const [host, rawPort] = trimmed.split(":");
    return { host: host || "", port: Number(rawPort || 443) };
  }
}

function isProxyCoolingDown(host: string): boolean {
  const until = fetchCooldownUntil.get(host) || 0;
  if (!until) return false;
  if (Date.now() > until) {
    fetchCooldownUntil.delete(host);
    return false;
  }
  return true;
}

function rememberProxyFailure(host: string, env: Env): void {
  fetchCooldownUntil.set(host, Date.now() + proxyCooldownMs(env));
}

function proxyCooldownMs(env: Env): number {
  const value = Number(env.PROXY_FAIL_COOLDOWN_MS || 120000);
  if (!Number.isFinite(value)) return 120000;
  return Math.max(0, Math.min(900000, value));
}

function csvFirst(...values: Array<string | undefined>): string[] {
  for (const value of values) {
    const parsed = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (parsed.length) return parsed;
  }
  return [];
}

function shouldRunSearch(query: string, links: string[], pageResults: SearchResult[]): boolean {
  if (links.length === 0) return true;
  if (pageResults.length > 0 && /\b(read this|summari[sz]e|explain this|what is this|analy[sz]e this)\b/i.test(query)) return false;
  return /\b(web\s*search|websearch|search web|latest|today|news|current|find|search)\b/i.test(query);
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

function normalizeSearchQuery(query: string): string {
  const cleaned = clean(query)
    .replace(/lastest/gi, "latest")
    .replace(URL_PATTERN, "")
    .replace(/\b(web\s*search|websearch|search web|read this|summari[sz]e it|summari[sz]e|find)\b/gi, "")
    .replace(/[\s:;,.!?-]+$/g, "")
    .replace(/^[\s:;,.!?-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (isGeneralNewsQuery(cleaned) || cleaned.length === 0) return "top stories today";
  return cleaned;
}

function isGeneralNewsQuery(query: string): boolean {
  const normalized = clean(query).replace(/lastest/gi, "latest").toLowerCase();
  return /^(top stories today|latest news|today news|current news|news today|news|latest|today)$/.test(normalized);
}

function extractUrls(text: string): string[] {
  return Array.from(new Set((text.match(URL_PATTERN) || []).map((url) => url.replace(/[.,!?;:]+$/g, ""))));
}

function isAllowedFetchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(host)) return false;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function extractHtmlTitle(html: string): string {
  return clean(decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""));
}

function htmlToReadableText(html: string): string {
  return clean(decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")));
}

function extractTag(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "";
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
    out.push({ title: clean(result.title), url: clean(result.url), snippet: clean(result.snippet) });
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
