import { fetchModels, generateTitle, sendChat } from "./api.js";
import {
  addMessage,
  autoResizeTextarea,
  clearMessages,
  renderConversationList,
  renderMessages,
  setLoading,
  setModelLabels,
  setupMobileSidebar,
} from "./dom.js";

const BAD_TITLE_STARTS = [
  "the user",
  "user gave",
  "assistant",
  "conversation",
  "response",
  "answer",
];

function createSystemMessage(model) {
  return {
    role: "system",
    content: `You are a helpful AI assistant on a small website. The selected provider model id is ${model}. If the user asks which model you are, answer with exactly this model id: ${model}.`,
  };
}

function createSession(model) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    model,
    title: "New chat",
    titleStatus: "pending",
    hasUserMessage: false,
    messages: [createSystemMessage(model)],
    displayMessages: [{ role: "assistant", content: `New chat started with ${model}.` }],
  };
}

let sessions = [];
let activeSessionId = "";

export function setupChat(elements) {
  const { form, prompt, sendButton, promptChips, modelSelect, modelBadge, mobileModelLabel, newChatButton } = elements;

  setupMobileSidebar(elements);
  setupPromptInput(prompt, form);
  setupPromptChips(promptChips, prompt);
  setupModelPicker(modelSelect, modelBadge, mobileModelLabel, elements);
  setupNewChat(newChatButton, elements);

  const firstSession = createSession(modelSelect.value);
  firstSession.displayMessages = [{ role: "assistant", content: "Hi! Ask me something and I will help." }];
  sessions = [firstSession];
  activeSessionId = firstSession.id;
  renderActiveSession(elements);
  loadProviderModels(modelSelect, modelBadge, mobileModelLabel, elements);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitMessage(elements);
  });
}

async function submitMessage(elements) {
  const { prompt, sendButton, messages, modelSelect, thinkingToggle } = elements;
  const userText = prompt.value.trim();
  if (!userText || sendButton.disabled) return;

  const session = getActiveSession();
  if (!session) return;

  document.body.classList.add("has-chat");
  prompt.value = "";
  autoResizeTextarea(prompt);

  session.hasUserMessage = true;
  if (session.title === "New chat") {
    session.title = makeConversationTitle(userText);
    session.titleStatus = "fallback";
  }
  session.messages.push({ role: "user", content: userText });
  session.displayMessages.push({ role: "user", content: userText });
  addMessage(messages, "user", userText);
  renderSidebar(elements);
  setLoading(sendButton, true);

  try {
    const answer = await sendChat(session.messages, modelSelect.value, {
      thinking: thinkingToggle.checked,
    });
    session.messages.push({ role: "assistant", content: answer });
    session.displayMessages.push({ role: "assistant", content: answer || "No answer returned." });
    addMessage(messages, "assistant", answer || "No answer returned.");
    maybeGenerateSessionTitle(elements, session, userText, answer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    session.displayMessages.push({ role: "error", content: message });
    addMessage(messages, "error", message);
  } finally {
    setLoading(sendButton, false);
    prompt.focus();
  }
}

async function maybeGenerateSessionTitle(elements, session, userText, answer) {
  if (!answer || session.titleStatus === "ai") return;

  session.titleStatus = "generating";
  renderSidebar(elements);

  try {
    const title = await generateTitle({
      model: session.model,
      userMessage: userText,
      assistantMessage: answer,
    });

    session.title = cleanTitle(title) || makeConversationTitle(userText);
    session.titleStatus = "ai";
  } catch (error) {
    console.warn("Failed to generate chat title", error);
    session.title = makeConversationTitle(userText);
    session.titleStatus = "fallback";
  } finally {
    renderSidebar(elements);
  }
}

function setupPromptInput(prompt, form) {
  prompt.addEventListener("input", () => autoResizeTextarea(prompt));

  prompt.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    form.requestSubmit();
  });
}

function setupPromptChips(promptChips, prompt) {
  for (const chip of promptChips) {
    chip.addEventListener("click", () => {
      prompt.value = chip.dataset.prompt || chip.textContent || "";
      autoResizeTextarea(prompt);
      prompt.focus();
    });
  }
}

function setupModelPicker(modelSelect, modelBadge, mobileModelLabel, elements) {
  setModelLabels(modelSelect.value, modelBadge, mobileModelLabel);

  modelSelect.addEventListener("change", () => {
    setModelLabels(modelSelect.value, modelBadge, mobileModelLabel);
    startNewSession(elements, modelSelect.value, true);
  });
}

async function loadProviderModels(modelSelect, modelBadge, mobileModelLabel, elements) {
  const existingModel = modelSelect.value;

  try {
    const { models, defaultModel } = await fetchModels();
    if (models.length === 0) return;

    const preferredModel = models.some((model) => model.id === existingModel)
      ? existingModel
      : defaultModel || models[0].id;

    modelSelect.textContent = "";

    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.id;
      modelSelect.append(option);
    }

    modelSelect.value = preferredModel;
    setModelLabels(modelSelect.value, modelBadge, mobileModelLabel);

    const session = getActiveSession();
    if (session && !session.hasUserMessage) {
      session.model = preferredModel;
      session.messages = [createSystemMessage(preferredModel)];
      session.displayMessages = [{ role: "assistant", content: "Hi! Ask me something and I will help." }];
      renderActiveSession(elements);
    }
  } catch (error) {
    console.warn("Failed to load provider models", error);
  }
}

function setupNewChat(newChatButton, elements) {
  if (!newChatButton) return;

  newChatButton.addEventListener("click", () => {
    startNewSession(elements, elements.modelSelect.value, true);
  });
}

function startNewSession(elements, model, showNotice) {
  const session = createSession(model);
  session.displayMessages = [
    { role: "assistant", content: showNotice ? `New chat started with ${model}.` : "Hi! Ask me something and I will help." },
  ];
  sessions.unshift(session);
  activeSessionId = session.id;
  document.body.classList.remove("has-chat");
  elements.prompt.value = "";
  autoResizeTextarea(elements.prompt);
  renderActiveSession(elements);
  elements.prompt.focus();
}

function selectSession(elements, sessionId) {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;

  activeSessionId = sessionId;
  elements.modelSelect.value = session.model;
  setModelLabels(session.model, elements.modelBadge, elements.mobileModelLabel);
  renderActiveSession(elements);
  document.body.classList.toggle("has-chat", session.hasUserMessage);
  document.body.classList.remove("sidebar-open");
  if (elements.sidebarBackdrop) elements.sidebarBackdrop.hidden = true;
}

function renderActiveSession(elements) {
  const session = getActiveSession();
  if (!session) return;

  clearMessages(elements.messages);
  renderMessages(elements.messages, session.displayMessages);
  renderSidebar(elements);
}

function renderSidebar(elements) {
  renderConversationList(elements.conversationList, sessions, activeSessionId, (sessionId) => {
    selectSession(elements, sessionId);
  });
}

function getActiveSession() {
  return sessions.find((session) => session.id === activeSessionId);
}

function makeConversationTitle(text) {
  const clean = String(text || "").replace(/[.!?]+$/g, "").trim();
  return clean.length > 32 ? `${clean.slice(0, 32)}...` : clean;
}

function cleanTitle(title) {
  const cleaned = String(title || "")
    .replace(/^Title:\s*/i, "")
    .replace(/["'`]/g, "")
    .replace(/[.!?]+$/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");

  const lower = cleaned.toLowerCase();
  if (BAD_TITLE_STARTS.some((start) => lower.startsWith(start))) {
    return "";
  }

  return cleaned;
}
