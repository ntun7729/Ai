import { getConfig } from "../config/env";
import { errorResponse, jsonResponse } from "../http/json";
import { buildSearchContext } from "../search/web-search";
import type { Env } from "../types/env";
import { createChatCompletion } from "./client";
import type { ChatMessage } from "./types";
import { parseChatRequest } from "./validation";

export async function handleChat(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json();
    const parsed = parseChatRequest(body);
    const config = getConfig(env);
    const selectedModel = parsed.model || config.model;
    const preparedMessages = parsed.webSearch
      ? await addWebResults(env, parsed.messages)
      : parsed.messages;

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
    const status = message.includes("Missing AI_API_KEY") ? 500 : 400;

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
