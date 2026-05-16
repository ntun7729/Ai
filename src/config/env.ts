import type { Env } from "../types/env";

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getConfig(env: Env): AppConfig {
  const apiKey = env.AI_API_KEY?.trim();
  const baseUrl = trimTrailingSlash(env.AI_BASE_URL || "https://api.openai.com");
  const model = env.AI_MODEL?.trim() || "gpt-4.1-mini";

  if (!apiKey) {
    throw new Error("Missing AI_API_KEY secret");
  }

  return { apiKey, baseUrl, model };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
