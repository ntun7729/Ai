import type { AppConfig } from "../config/env";
import type { ChatCompletionResponse, ChatMessage } from "./types";

export async function createChatCompletion(
  config: AppConfig,
  messages: ChatMessage[],
): Promise<ChatCompletionResponse> {
  const response = await fetch(getChatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
    }),
  });

  const data = (await response.json()) as ChatCompletionResponse;

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
