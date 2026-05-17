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
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Chat request failed");
  }

  return data.answer || "";
}

export async function fetchModels() {
  const response = await fetch("/api/models");
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to load models");
  }

  return {
    models: Array.isArray(data.models) ? data.models : [],
    defaultModel: data.defaultModel || "",
  };
}
