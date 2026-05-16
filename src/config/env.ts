import type { Env } from "../types/env";

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getConfig(env: Env): AppConfig {
  const apiKey = (env.AI_API_KEY || env.NVIDIA_API_KEY || "").trim();
  const baseUrl = trimTrailingSlash(env.AI_BASE_URL || "https://integrate.api.nvidia.com/v1");
  const model = env.AI_MODEL?.trim() || "z-ai/glm-5.1";

  if (!apiKey) {
    throw new Error("Missing AI_API_KEY or NVIDIA_API_KEY secret");
  }

  return { apiKey, baseUrl, model };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
