import type { AppConfig } from "../config/env";
import type { ChatCompletionResponse, ChatMessage } from "./types";

export interface ProviderModel {
  id: string;
}

export interface ChatOptions {
  thinking: boolean;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface StreamDelta {
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
}

interface StreamChunk {
  choices?: Array<{
    delta?: StreamDelta;
  }>;
}

export async function createChatCompletion(
  config: AppConfig,
  messages: ChatMessage[],
  options: ChatOptions = { thinking: false },
): Promise<ChatCompletionResponse> {
  const chatUrl = getChatCompletionsUrl(config.baseUrl);
  const payload = buildChatPayload(config, messages, { ...options, stream: options.stream ?? true });
  const response = await fetch(chatUrl, {
    method: "POST",
    headers: chatHeaders(config, "text/event-stream, application/json"),
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    const errorData = parseJsonOrNull(text);
    const message = errorData?.error?.message || text.slice(0, 500) || `AI provider returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return parseProviderResponse(text, chatUrl, config.model);
}

export async function streamChatCompletion(
  config: AppConfig,
  messages: ChatMessage[],
  options: ChatOptions = { thinking: false },
): Promise<Response> {
  const chatUrl = getChatCompletionsUrl(config.baseUrl);
  const payload = buildChatPayload(config, messages, { ...options, stream: true });
  const response = await fetch(chatUrl, {
    method: "POST",
    headers: chatHeaders(config, "text/event-stream, application/json"),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    const errorData = parseJsonOrNull(text);
    const message = errorData?.error?.message || text.slice(0, 500) || `AI provider returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return response;
}

export async function listProviderModels(config: AppConfig): Promise<ProviderModel[]> {
  const response = await fetch(getModelsUrl(config.baseUrl), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  const data = parseModelsJson(text);

  if (!response.ok) {
    const message = data?.error?.message || text.slice(0, 500) || `AI provider returned HTTP ${response.status}`;
    throw new Error(message);
  }

  const models = Array.isArray(data?.data) ? data.data : [];

  return models
    .map((model) => ({ id: String(model?.id || "").trim() }))
    .filter((model) => model.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getChatCompletionsUrl(baseUrl: string): string {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  const suffix = cleanBaseUrl.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions";

  return `${cleanBaseUrl}${suffix}`;
}

export function getModelsUrl(baseUrl: string): string {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  const suffix = cleanBaseUrl.endsWith("/v1") ? "/models" : "/v1/models";

  return `${cleanBaseUrl}${suffix}`;
}

function buildChatPayload(config: AppConfig, messages: ChatMessage[], options: ChatOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 1,
    top_p: 1,
    max_tokens: options.maxTokens ?? 16384,
    stream: options.stream ?? true,
  };

  if (options.thinking) {
    payload.chat_template_kwargs = {
      enable_thinking: true,
      clear_thinking: false,
    };
  }

  return payload;
}

function chatHeaders(config: AppConfig, accept: string): HeadersInit {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    Accept: accept,
  };
}

function parseProviderResponse(text: string, chatUrl: string, model: string): ChatCompletionResponse {
  const json = parseJsonOrNull(text);

  if (json) {
    return json;
  }

  const answer = parseServerSentEvents(text);
  if (answer) {
    return {
      model,
      choices: [
        {
          message: {
            role: "assistant",
            content: answer,
          },
        },
      ],
    };
  }

  const preview = text.slice(0, 500) || "empty response body";
  throw new Error(`AI provider returned non-JSON response from ${chatUrl} using model ${model}: ${preview}`);
}

function parseServerSentEvents(text: string): string {
  let answer = "";
  let reasoning = "";

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;

    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;

    const chunk = parseStreamChunk(payload);
    const delta = chunk?.choices?.[0]?.delta;

    if (typeof delta?.content === "string") {
      answer += delta.content;
    }

    if (typeof delta?.reasoning_content === "string") {
      reasoning += delta.reasoning_content;
    } else if (typeof delta?.reasoning === "string") {
      reasoning += delta.reasoning;
    }
  }

  return answer || reasoning;
}

function parseJsonOrNull(text: string): ChatCompletionResponse | null {
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    return null;
  }
}

function parseStreamChunk(text: string): StreamChunk | null {
  try {
    return JSON.parse(text) as StreamChunk;
  } catch {
    return null;
  }
}

function parseModelsJson(text: string): { data?: Array<{ id?: string }>; error?: { message?: string } } | null {
  try {
    return JSON.parse(text) as { data?: Array<{ id?: string }>; error?: { message?: string } };
  } catch {
    return null;
  }
}
