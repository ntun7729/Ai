import { getConfig } from "../config/env";
import { errorResponse, jsonResponse } from "../http/json";
import type { Env } from "../types/env";
import { listProviderModels } from "./client";

export async function handleModels(env: Env): Promise<Response> {
  try {
    const config = getConfig(env);
    const models = await listProviderModels(config);

    return jsonResponse({
      models,
      defaultModel: config.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown models error";
    const status = message.includes("Missing AI_API_KEY") ? 500 : 400;

    return errorResponse(message, status);
  }
}
