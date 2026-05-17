import { getConfig } from "../config/env";
import { errorResponse, jsonResponse } from "../http/json";
import type { Env } from "../types/env";
import { createChatCompletion } from "./client";
import type { ChatMessage } from "./types";

const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const BAD_TITLE_STARTS = ["the user", "user gave", "assistant", "conversation", "response", "answer"];

export async function handleTitle(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      model?: string;
      userMessage?: string;
      assistantMessage?: string;
    };

    const config = getConfig(env);
    const model = parseModel(body.model) || config.model;
    const userMessage = parseText(body.userMessage, "userMessage");
    const assistantMessage = parseText(body.assistantMessage, "assistantMessage");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: "Create a concise topic title for a chat sidebar. Return only the title. Maximum 5 words.",
      },
      {
        role: "user",
        content: `Topic source:\nQuestion: ${userMessage}\nAnswer: ${assistantMessage}`,
      },
    ];

    const completion = await createChatCompletion(
      { ...config, model },
      messages,
      { thinking: false, maxTokens: 24, temperature: 0.1, stream: false },
    );

    const rawTitle = getTextContent(completion.choices?.[0]?.message?.content);
    const title = cleanTitle(rawTitle) || fallbackTitle(userMessage);

    return jsonResponse({ title });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown title error";
    const status = message.includes("Missing AI_API_KEY") ? 500 : 400;

    return errorResponse(message, status);
  }
}

function parseModel(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;

  const model = value.trim();
  if (model.length > 160 || !MODEL_ID_PATTERN.test(model)) {
    throw new Error("Unsupported model selected");
  }

  return model;
}

function parseText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }

  return value.trim().slice(0, 1200);
}

function getTextContent(value: ChatMessage["content"] | undefined): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

function cleanTitle(value: string): string {
  const title = value
    .replace(/^Title:\s*/i, "")
    .replace(/["'`]/g, "")
    .replace(/[.!?]+$/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");

  const lower = title.toLowerCase();
  if (BAD_TITLE_STARTS.some((start) => lower.startsWith(start))) {
    return "";
  }

  return title;
}

function fallbackTitle(value: string): string {
  return value.trim().split(/\s+/).slice(0, 5).join(" ");
}
