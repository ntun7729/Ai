import type { Env } from "../types/env";
import type { ChatMessage } from "../ai/types";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function buildSearchContext(env: Env, messages: ChatMessage[]): Promise<string> {
  const query = getLatestUserText(messages);
  if (!query) return "";

  const results = await searchWeb(env, query);
  if (results.length === 0) return "";

  return [
    "Use these fresh web search results when they are relevant. Cite sources by title and URL in the answer.",
    ...results.map((result, index) => [
      `[${index + 1}] ${result.title}`,
      result.url,
      result.snippet,
    ].filter(Boolean).join("\n")),
  ].join("\n\n");
}

export async function searchWeb(env: Env, query: string): Promise<SearchResult[]> {
  const apiKey = (env.SEARCH_API_KEY || env.BRAVE_SEARCH_API_KEY || "").trim();

  if (apiKey) {
    const results = await searchBrave(query, apiKey).catch(() => []);
    if (results.length > 0) return results;
  }

  const proxyUrl = (env.SEARCH_PROXY_URL || "").trim();
  if (proxyUrl) {
    const results = await searchViaProxy(query, proxyUrl).catch(() => []);
    if (results.length > 0) return results;
  }

  return [];
}

async function searchBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("text_decorations", "false");
  url.searchParams.set("safesearch", "moderate");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) return [];

  const data = await response.json() as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };

  return (data.web?.results || [])
    .map((item) => ({
      title: clean(item.title),
      url: clean(item.url),
      snippet: clean(item.description),
    }))
    .filter((item) => item.title && item.url)
    .slice(0, 5);
}

async function searchViaProxy(query: string, proxyUrl: string): Promise<SearchResult[]> {
  const url = new URL(proxyUrl);
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

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
    .filter((item) => item.title && item.url)
    .slice(0, 5);
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

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}
