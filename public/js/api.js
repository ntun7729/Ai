import { getAdminSettings } from "./admin.js";

function adminPayload() {
  const settings = getAdminSettings();
  return {
    apiBaseUrl: settings.apiBaseUrl || undefined,
    apiKey: settings.apiKey || undefined,
    logsEnabled: settings.logsEnabled,
    webFetchEnabled: settings.webFetchEnabled,
    googleSearchEnabled: settings.googleSearchEnabled,
  };
}

export async function sendChat(messages, model, options = {}) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      model,
      thinking: Boolean(options.thinking),
      webSearch: Boolean(options.webSearch),
      admin: adminPayload(),
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Chat request failed");
  }

  return data.answer || "";
}

export async function fetchModels() {
  const response = await fetch("/api/models", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ admin: adminPayload() }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to load models");
  }

  return {
    models: Array.isArray(data.models) ? data.models : [],
    defaultModel: data.defaultModel || "",
  };
}
