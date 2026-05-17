import { getConfig } from "../config/env";
import { errorResponse, jsonResponse } from "../http/json";
import type { Env } from "../types/env";
import { createChatCompletion } from "./client";
import type { ChatMessage } from "./types";
import { parseChatRequest } from "./validation";

export async function handleChat(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json();
    const { messages, model, thinking } = parseChatRequest(body);
    const config = getConfig(env);
    const selectedModel = model || config.model;
    const completion = await createChatCompletion(
      { ...config, model: selectedModel },
      messages,
      { thinking: shouldSendThinking(selectedModel, Boolean(thinking)) },
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
