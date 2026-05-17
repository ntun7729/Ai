const SEARCH_RESULT_LIMIT = 8;
const REQUEST_TIMEOUT_MS = 8000;
const URL_PATTERN = /https?:\/\/[^\s<>)"']+/gi;

export async function addSearchContext(env, messages, log = () => {}) {
  const rawQuery = latestUserText(messages);
  if (!rawQuery) return messages;

  const urls = extractUrls(rawQuery);
  const query = normalizeSearchQuery(rawQuery);

  const pageResults = await fetchLinkedPages(env, urls, log);
  const shouldSearch = shouldRunSearch(rawQuery, urls, pageResults);

  log("search.request", {
    query: preview(query),
    rawQuery: preview(rawQuery),
    urlCount: urls.length,
    pageCount: pageResults.length,
    shouldSearch,
  });

  const searchResults = shouldSearch ? await searchWeb(env, query, log) : [];
  const results = uniqueResults([...pageResults, ...searchResults]).slice(0, SEARCH_RESULT_LIMIT);

  log("search.results", { count: results.length, pageCount: pageResults.length, searchCount: searchResults.length });

  const context = results.length > 0
    ? [
        `Current app date: ${new Date().toISOString().slice(0, 10)}.`,
        "Fresh web results and linked-page text were fetched by the local fallback server before this answer.",
        "If a linked page was fetched, use that page text as the main source for the answer.",
        "Synthesize the results into a helpful answer instead of listing raw search links.",
        "For news, give a summary, key details, why each item matters, and mention the published date if provided.",
        "Do not claim a story is from today unless a result includes a current published date.",
        "Prefer reliable or primary outlets when results overlap, and mention uncertainty when details are thin.",
        "Use source names naturally. Do not print long raw URLs unless the user asks for links.",
        "Results:",
        ...results.map((item, index) => [
          `[${index + 1}] Title: ${item.title}`,
          `URL: ${item.url}`,
          item.snippet ? `Snippet: ${item.snippet}` : "",
        ].filter(Boolean).join("\n")),
      ].join("\n\n")
    : "Web/link fetch was requested, but the local fallback server could not fetch direct page text, direct web results, or fallback results. Say that fetch failed and ask the user to try a normal article URL instead of a Google News wrapper link.";

  return [...messages, { role: "system", content: context }];
}

export function messageHasUrl(content) {
  return extractUrls(textFromContent(content)).length > 0;
}

export function messageWantsSearch(content) {
  const text = textFromContent(content);
  return /\b(web\s*search|websearch|search web|latest|lastest|today|current|news|find latest|find lastest|find today|google search|search)\b/i.test(text) || messageHasUrl(text);
}

function shouldRunSearch(rawQuery, urls, pageResults) {
  if (urls.length === 0) return true;
  if (pageResults.length > 0 && isLinkSummaryRequest(rawQuery)) return false;
  return messageWantsSearch(rawQuery);
}

function isLinkSummaryRequest(text) {
  return /\b(read this|summari[sz]e|explain this|what is this|analy[sz]e this)\b/i.test(text);
}

async function searchWeb(env, query, log) {
  const results = [];

  if (isGeneralNewsQuery(query)) {
    results.push(...await googleNewsTopStories(env, log).catch((error) => {
      log("search.google_top_news_error", { message: message(error) });
      return [];
    }));
  }

  if (results.length < SEARCH_RESULT_LIMIT && !isGeneralNewsQuery(query)) {
    results.push(...await googleSearch(env, query, log).catch((error) => {
      log("search.google_error", { message: message(error) });
      return [];
    }));
  }

  if (results.length < SEARCH_RESULT_LIMIT) {
    results.push(...await googleNewsSearch(env, query, log).catch((error) => {
      log("search.google_news_error", { message: message(error) });
      return [];
    }));
  }

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

async function fetchLinkedPages(env, urls, log) {
  const safeUrls = urls.filter(isAllowedFetchUrl).slice(0, 3);
  const out = [];

  for (const inputUrl of safeUrls) {
    const resolvedUrl = await resolveNewsUrl(env, inputUrl, log).catch((error) => {
      log("link.resolve_error", { url: inputUrl, message: message(error) });
      return inputUrl;
    });

    const html = await fetchText(env, resolvedUrl).catch((error) => {
      log("link.fetch_error", { url: resolvedUrl, message: message(error) });
      return "";
    });

    if (!html) continue;

    const title = extractHtmlTitle(html) || resolvedUrl;
    const text = htmlToReadableText(html).slice(0, 6000);
    if (!text || text.length < 120) continue;

    log("link.fetched", { inputUrl, resolvedUrl, title: preview(title), textLength: text.length });
    out.push({ title, url: resolvedUrl, snippet: text });
  }

  return out;
}

async function resolveNewsUrl(env, inputUrl, log) {
  const url = new URL(inputUrl);
  if (!url.hostname.endsWith("news.google.com")) return inputUrl;

  const articleId = googleNewsArticleId(url);
  if (!articleId) return inputUrl;

  const articleUrl = await decodeGoogleNewsArticle(env, articleId).catch(() => "");
  if (articleUrl && isAllowedFetchUrl(articleUrl)) {
    log("link.google_news_resolved", { inputUrl, articleUrl });
    return articleUrl;
  }

  const html = await fetchText(env, inputUrl).catch(() => "");
  const canonical = extractGoogleNewsCanonical(html);
  if (canonical && isAllowedFetchUrl(canonical)) {
    log("link.google_news_canonical", { inputUrl, articleUrl: canonical });
    return canonical;
  }

  return inputUrl;
}

function googleNewsArticleId(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part === "read" || part === "articles");
  return index >= 0 ? parts[index + 1] || "" : "";
}

async function decodeGoogleNewsArticle(env, articleId) {
  const articlePage = `https://news.google.com/articles/${articleId}`;
  const html = await fetchText(env, articlePage);
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1] || "";
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1] || "";
  if (!signature || !timestamp) return "";

  const rpc = [[["Fbv4je", JSON.stringify([articleId, signature, timestamp]), null, "generic"]]];
  const body = `f.req=${encodeURIComponent(JSON.stringify(rpc))}`;
  const response = await fetchWithTimeout("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "Mozilla/5.0 AIChatLocalSearch/1.0",
    },
    body,
  });

  if (!response.ok) return "";
  const text = await response.text();
  const match = text.match(/\[\"garturlres\",\"(https?:\\\/\\\/[^\"]+)/);
  return match ? JSON.parse(`"${match[1]}"`) : "";
}

function extractGoogleNewsCanonical(html) {
  if (!html) return "";
  const href = html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/i)?.[1] || "";
  if (href && !href.includes("news.google.com")) return decodeHtml(href);
  return "";
}

async function googleSearch(env, query) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");

  const html = await fetchText(env, url.toString());
  const results = [];
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

async function googleNewsTopStories(env) {
  const url = new URL("https://news.google.com/rss");
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return googleNewsRss(env, url.toString());
}

async function googleNewsSearch(env, query) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return googleNewsRss(env, url.toString());
}

async function googleNewsRss(env, url) {
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

  throw new Error(`direct web fetch failed with status ${direct?.status || "network"}`);
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
    return textFromContent(current.content);
  }
  return "";
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.find((part) => part?.type === "text")?.text || "";
  return String(content || "");
}

function normalizeSearchQuery(query) {
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

function isGeneralNewsQuery(query) {
  const normalized = clean(query).replace(/lastest/gi, "latest").toLowerCase();
  return /^(top stories today|latest news|today news|current news|news today|news|latest|today)$/.test(normalized);
}

function extractUrls(text) {
  return Array.from(new Set(String(text || "").match(URL_PATTERN) || [])).map((url) => url.replace(/[.,!?;:]+$/g, ""));
}

function isAllowedFetchUrl(value) {
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

function extractHtmlTitle(html) {
  return clean(decodeHtml(String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""));
}

function htmlToReadableText(html) {
  return clean(decodeHtml(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")));
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
