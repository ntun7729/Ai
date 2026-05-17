import { getAdminSettings } from "./admin.js";
import { getMemoryEnabled } from "./memory.js";

function getRuntimeOptions() {
  const value = getAdminSettings();
  return {
    providerBaseUrl: value.apiBaseUrl || undefined,
    logsEnabled: value.logsEnabled,
    webFetchEnabled: value.webFetchEnabled,
    googleSearchEnabled: value.googleSearchEnabled,
  };
}

function buildChatBody(messages, model, options = {}, stream = false) {
  return {
    messages,
    model,
    thinking: Boolean(options.thinking),
    webSearch: Boolean(options.webSearch),
    memory: getMemoryEnabled(),
    stream,
    conversationId: options.conversationId,
    conversationTitle: options.conversationTitle,
    runtime: getRuntimeOptions(),
  };
}

export async function sendChat(messages, model, options = {}) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildChatBody(messages, model, options, false)),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Chat request failed");
  }

  return data.answer || "";
}

export async function streamChat(messages, model, options = {}, handlers = {}) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(buildChatBody(messages, model, options, true)),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Chat request failed");
  }

  if (!response.body) {
    throw new Error("Streaming is not supported by this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const result = drainClientSse(buffer, handlers, (content) => {
      answer += content;
    });
    buffer = result.remainder;
    if (result.done) break;
  }

  buffer += decoder.decode();
  drainClientSse(`${buffer}\n\n`, handlers, (content) => {
    answer += content;
  });

  return answer;
}

function drainClientSse(buffer, handlers, onDelta) {
  const parts = buffer.split(/\n\n/);
  const remainder = parts.pop() || "";
  let done = false;

  for (const part of parts) {
    const lines = part.split(/\r?\n/);
    const eventLine = lines.find((line) => line.startsWith("event:"));
    const dataLine = lines.find((line) => line.startsWith("data:"));
    const event = eventLine ? eventLine.slice(6).trim() : "message";
    const data = dataLine ? parseJson(dataLine.slice(5).trim()) : {};

    if (event === "delta") {
      const content = typeof data.content === "string" ? data.content : "";
      if (content) {
        onDelta(content);
        handlers.onDelta?.(content);
      }
    } else if (event === "error") {
      handlers.onError?.(data.error || "Stream error");
    } else if (event === "done") {
      done = true;
      handlers.onDone?.(data);
    }
  }

  return { remainder, done };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function fetchModels() {
  const response = await fetch("/api/models");
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to load models");
  }

  return {
    models: Array.isArray(data.models) ? data.models : [],
    defaultModel: data.defaultModel || "",
  };
}
