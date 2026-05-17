const SEARCH_RESULT_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 8000;

export async function addSearchContext(env, messages, log = () => {}) {
  const query = latestUserText(messages);
  if (!query) return messages;

  log("search.request", { query: preview(query) });
  const results = await searchWeb(env, query, log);
  log("search.results", { count: results.length });

  const context = results.length > 0
    ? [
        "Fresh web search results fetched by the local fallback server. Use them only when relevant. Include source URLs in the answer.",
        ...results.map((item, index) => [
          `[${index + 1}] ${item.title}`,
          item.url,
          item.snippet,
        ].filter(Boolean).join("\n")),
      ].join("\n\n")
    : "Web search was requested, but the local fallback server could not fetch direct search sources or fallback results. Do not invent search results. Tell the user web search failed and suggest trying again.";

  return [...messages, { role: "system", content: context }];
}

async function searchWeb(env, query, log) {
  const results = [];

  results.push(...await googleNewsSearch(env, query, log).catch((error) => {
    log("search.google_news_error", { message: message(error) });
    return [];
  }));

  if (results.length < SEARCH_RESULT_LIMIT) {
    results.push(...await duckDuckGoLiteSearch(env, query, log).catch((error) => {
      log("search.duckduckgo_error", { message: message(error) });
      return [];
    }));
  }

  if (results.length < SEARCH_RESULT_LIMIT) {
    results.push(...await fallbackResultSearch(env, query, log).catch((error) => {
      log("search.fallback_error", { message: message(error) });
      return [];
    }));
  }

  return uniqueResults(results).slice(0, SEARCH_RESULT_LIMIT);
}

async function googleNewsSearch(env, query) {
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
      url: decodeXml(extractTag(item, "link")),
      snippet: decodeXml(extractTag(item, "description")).replace(/<[^>]+>/g, " "),
    };
  }).filter((result) => result.title && result.url);
}

async function duckDuckGoLiteSearch(env, query) {
  const url = new URL("https://lite.duckduckgo.com/lite/");
  url.searchParams.set("q", query);

  const html = await fetchText(env, url.toString());
  const results = [];
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

async function fallbackResultSearch(env, query) {
  const endpoint = String(env.SEARCH_PROXY_URL || "").trim();
  if (!endpoint) return [];

  const url = new URL(endpoint);
  url.searchParams.set("q", query);

  const response = await fetchWithTimeout(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) return [];

  const data = await response.json();
  return (data?.results || []).map((item) => ({
    title: clean(item.title),
    url: clean(item.url),
    snippet: clean(item.snippet || item.description),
  })).filter((item) => item.title && item.url);
}

async function fetchText(env, targetUrl) {
  const direct = await fetchWithTimeout(targetUrl, {
    headers: {
      Accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 AIChatLocalSearch/1.0",
    },
  }).catch(() => null);

  if (direct?.ok) return direct.text();

  const fallbackText = await fetchTextViaFallback(env, targetUrl).catch(() => "");
  if (fallbackText) return fallbackText;

  throw new Error("direct web fetch failed");
}

async function fetchTextViaFallback(env, targetUrl) {
  const endpoint = String(env.SEARCH_PROXY_URL || "").trim();
  if (!endpoint) return "";

  const url = new URL(endpoint);
  url.searchParams.set("url", targetUrl);

  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8" },
  });

  if (!response.ok) return "";
  return response.text();
}

function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if (current?.role !== "user") continue;
    if (typeof current.content === "string") return current.content;
    if (Array.isArray(current.content)) {
      const text = current.content.find((part) => part?.type === "text");
      if (text?.text) return text.text;
    }
  }
  return "";
}

function normalizeDuckDuckGoUrl(value) {
  const cleaned = clean(value);
  if (!cleaned) return "";
  if (cleaned.startsWith("//")) return `https:${cleaned}`;
  if (cleaned.startsWith("/l/?")) {
    const parsed = new URL(`https://duckduckgo.com${cleaned}`);
    return parsed.searchParams.get("uddg") || "";
  }
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return cleaned;
  return "";
}

function extractTag(xml, tag) {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "";
}

function uniqueResults(results) {
  const seen = new Set();
  const out = [];
  for (const result of results) {
    const key = result.url || result.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: clean(result.title), url: clean(result.url), snippet: clean(result.snippet) });
  }
  return out;
}

function decodeXml(value) {
  return decodeHtml(String(value || "").replace(/^<!\[CDATA\[|\]\]>$/g, ""));
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function preview(value) {
  return clean(value).slice(0, 160);
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
