import type { AppConfig } from "../config/env";
import type { ChatCompletionResponse, ChatMessage } from "./types";

export async function createChatCompletion(
  config: AppConfig,
  messages: ChatMessage[],
): Promise<ChatCompletionResponse> {
  const chatUrl = getChatCompletionsUrl(config.baseUrl);
  const response = await fetch(chatUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
    }),
  });

  const data = await readProviderResponse(response, chatUrl, config.model);

  if (!response.ok) {
    const message = data.error?.message || `AI provider returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export function getChatCompletionsUrl(baseUrl: string): string {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  const suffix = cleanBaseUrl.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions";

  return `${cleanBaseUrl}${suffix}`;
}

async function readProviderResponse(
  response: Response,
  chatUrl: string,
  model: string,
): Promise<ChatCompletionResponse> {
  const text = await response.text();

  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    const preview = text.slice(0, 500) || "empty response body";

    throw new Error(
      `AI provider returned non-JSON response from ${chatUrl} using model ${model}: ${preview}`,
    );
  }
}
