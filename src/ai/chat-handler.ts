import { getConfig } from "../config/env";
import { errorResponse, jsonResponse } from "../http/json";
import { buildSearchContext, messageHasUrl } from "../search/web-search";
import type { Env } from "../types/env";
import { createChatCompletion } from "./client";
import type { ChatMessage } from "./types";
import { parseChatRequest } from "./validation";

export async function handleChat(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json();
    const parsed = parseChatRequest(body);
    const config = getConfig(env, parsed.runtime);
    const selectedModel = parsed.model || config.model;
    const shouldUseWeb = parsed.webSearch || messageHasUrl(parsed.messages);
    const preparedMessages = shouldUseWeb
      ? await addWebResults(env, parsed.messages)
      : parsed.messages;

    log(config.logsEnabled, "chat.request", {
      model: selectedModel,
      webSearch: shouldUseWeb,
      messageCount: preparedMessages.length,
    });

    const completion = await createChatCompletion(
      { ...config, model: selectedModel },
      preparedMessages,
      { thinking: shouldSendThinking(selectedModel, Boolean(parsed.thinking)) },
    );
    const answer = getTextContent(completion.choices?.[0]?.message?.content);

    return jsonResponse({
      answer,
      model: completion.model,
      usage: completion.usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown chat error";
    const status = message.includes("Missing") ? 500 : 400;

    return errorResponse(message, status);
  }
}

async function addWebResults(env: Env, messages: ChatMessage[]): Promise<ChatMessage[]> {
  const context = await buildSearchContext(env, messages);
  if (!context) return messages;

  return [
    ...messages,
    {
      role: "system",
      content: context,
    },
  ];
}

function shouldSendThinking(model: string, thinking: boolean): boolean {
  if (!thinking) return false;

  const lower = model.toLowerCase();
  if (lower.includes("mistral") || lower.includes("mixtral")) return false;

  return true;
}

function getTextContent(value: ChatMessage["content"] | undefined): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

function log(enabled: boolean, event: string, details: Record<string, unknown>): void {
  if (!enabled) return;
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }));
}
