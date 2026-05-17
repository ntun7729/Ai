import { getConfig } from "../config/env";
import { errorResponse, jsonResponse } from "../http/json";
import type { Env } from "../types/env";
import { createChatCompletion } from "./client";
import { parseChatRequest } from "./validation";

export async function handleChat(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json();
    const { messages, model, thinking } = parseChatRequest(body);
    const config = getConfig(env);
    const completion = await createChatCompletion(
      model ? { ...config, model } : config,
      messages,
      { thinking: Boolean(thinking) },
    );
    const answer = completion.choices?.[0]?.message?.content || "";

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
