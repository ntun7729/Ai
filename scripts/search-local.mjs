export async function addSearchContext(env, messages, log = () => {}) {
  const query = latestUserText(messages);
  if (!query) return messages;

  const results = await searchWeb(env, query, log);
  if (results.length === 0) return messages;

  const context = [
    "Fresh web search results. Use them only when relevant. Include source URLs in the answer.",
    ...results.map((item, index) => [
      `[${index + 1}] ${item.title}`,
      item.url,
      item.snippet,
    ].filter(Boolean).join("\n")),
  ].join("\n\n");

  return [...messages, { role: "system", content: context }];
}

async function searchWeb(env, query, log) {
  const apiKey = String(env.SEARCH_API_KEY || env.BRAVE_SEARCH_API_KEY || "").trim();

  if (apiKey) {
    const direct = await braveSearch(query, apiKey).catch((error) => {
      log("search.direct_error", { message: error instanceof Error ? error.message : String(error) });
      return [];
    });
    if (direct.length > 0) return direct;
  }

  const proxyUrl = String(env.SEARCH_PROXY_URL || "").trim();
  if (proxyUrl) {
    const proxied = await proxySearch(query, proxyUrl).catch((error) => {
      log("search.proxy_error", { message: error instanceof Error ? error.message : String(error) });
      return [];
    });
    if (proxied.length > 0) return proxied;
  }

  return [];
}

async function braveSearch(query, apiKey) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("text_decorations", "false");
  url.searchParams.set("safesearch", "moderate");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!response.ok) return [];

  const data = await response.json();
  return (data?.web?.results || []).map((item) => ({
    title: clean(item.title),
    url: clean(item.url),
    snippet: clean(item.description),
  })).filter((item) => item.title && item.url).slice(0, 5);
}

async function proxySearch(query, proxyUrl) {
  const url = new URL(proxyUrl);
  url.searchParams.set("q", query);

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return [];

  const data = await response.json();
  return (data?.results || []).map((item) => ({
    title: clean(item.title),
    url: clean(item.url),
    snippet: clean(item.snippet || item.description),
  })).filter((item) => item.title && item.url).slice(0, 5);
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      const text = message.content.find((part) => part?.type === "text");
      if (text?.text) return text.text;
    }
  }
  return "";
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
