import type { RuntimeSettings } from "../ai/types";
import type { Env } from "../types/env";

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  logsEnabled: boolean;
  webFetchEnabled: boolean;
  googleSearchEnabled: boolean;
}

export function getConfig(env: Env, runtime?: RuntimeSettings): AppConfig {
  const browserToken = getRuntimeToken(runtime);
  const apiKey = (browserToken || env.AI_API_KEY || env.NVIDIA_API_KEY || "").trim();
  const baseUrl = trimTrailingSlash(runtime?.providerBaseUrl || env.AI_BASE_URL || "https://integrate.api.nvidia.com/v1");
  const model = env.AI_MODEL?.trim() || "z-ai/glm-5.1";

  if (!apiKey) {
    throw new Error("Missing AI_API_KEY or NVIDIA_API_KEY secret");
  }
  if (!isHttpUrl(baseUrl)) {
    throw new Error("Invalid AI base URL");
  }

  return {
    apiKey,
    baseUrl,
    model,
    logsEnabled: runtime?.logsEnabled === true,
    webFetchEnabled: runtime?.webFetchEnabled !== false,
    googleSearchEnabled: runtime?.googleSearchEnabled !== false,
  };
}

function getRuntimeToken(runtime?: RuntimeSettings): string {
  const value = runtime as Record<string, unknown> | undefined;
  return typeof value?.providerToken === "string" ? value.providerToken : "";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
