import { fetchModels, sendChat } from "./api.js";
import {
  addMessage,
  autoResizeTextarea,
  clearMessages,
  hideAttachmentPreview,
  renderConversationList,
  renderMessages,
  setLoading,
  setModelLabels,
  setupAttachmentPicker,
  setupMobileSidebar,
  showAttachmentPreview,
} from "./dom.js";

const STOP_WORDS = new Set(["a", "an", "the", "is", "are", "to", "of", "and", "or", "in", "on", "for", "with", "what", "where", "when", "why", "how"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function createSystemMessage(model) {
  return {
    role: "system",
    content: `You are a helpful AI assistant on a small website. The selected provider model id is ${model}. If asked which model you are, answer with exactly this model id: ${model}.`,
  };
}

function createSession(model) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    model,
    title: "New chat",
    hasUserMessage: false,
    messages: [createSystemMessage(model)],
    displayMessages: [{ role: "assistant", content: `New chat started with ${model}.` }],
  };
}

let sessions = [];
let activeSessionId = "";
let pendingAttachment = null;
let webSearchToggle = null;

export function setupChat(elements) {
  const { form, prompt, promptChips, modelSelect, modelBadge, mobileModelLabel, newChatButton } = elements;

  setupMobileSidebar(elements);
  setupAttachmentPicker(elements, (file) => handleAttachmentSelected(elements, file), () => {
    pendingAttachment = null;
  });
  webSearchToggle = createWebSearchToggle();
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
  const { prompt, sendButton, messages, modelSelect, thinkingToggle, attachmentPreview } = elements;
  const userText = prompt.value.trim();
  if ((!userText && !pendingAttachment) || sendButton.disabled) return;

  const session = getActiveSession();
  if (!session) return;

  const attachment = pendingAttachment;
  const displayText = buildDisplayText(userText, attachment);
  const providerContent = buildProviderContent(userText, attachment);

  document.body.classList.add("has-chat");
  prompt.value = "";
  autoResizeTextarea(prompt);
  pendingAttachment = null;
  hideAttachmentPreview(attachmentPreview);

  session.hasUserMessage = true;
  if (session.title === "New chat") session.title = makeLocalTitle(userText || attachment?.name || "Image");
  session.messages.push({ role: "user", content: providerContent });
  session.displayMessages.push({ role: "user", content: displayText });
  addMessage(messages, "user", displayText);
  renderSidebar(elements);
  setLoading(sendButton, true);

  try {
    const answer = await sendChat(session.messages, modelSelect.value, {
      thinking: thinkingToggle.checked,
      webSearch: Boolean(webSearchToggle?.checked),
    });
    session.messages.push({ role: "assistant", content: answer });
    session.displayMessages.push({ role: "assistant", content: answer || "No answer returned." });
    addMessage(messages, "assistant", answer || "No answer returned.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    session.displayMessages.push({ role: "error", content: message });
    addMessage(messages, "error", message);
  } finally {
    setLoading(sendButton, false);
    prompt.focus();
  }
}

function createWebSearchToggle() {
  const modelPicker = document.querySelector(".model-picker");
  if (!modelPicker || document.querySelector("#web-search-toggle")) return document.querySelector("#web-search-toggle");

  const label = document.createElement("label");
  label.className = "thinking-toggle";
  label.htmlFor = "web-search-toggle";
  label.innerHTML = `
    <input id="web-search-toggle" type="checkbox" />
    <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
    <span class="toggle-copy">
      <strong>Web search</strong>
      <small>Use Worker-side search results</small>
    </span>
  `;
  modelPicker.append(label);
  return label.querySelector("#web-search-toggle");
}

async function handleAttachmentSelected(elements, file) {
  if (!file.type.startsWith("image/")) {
    pendingAttachment = null;
    showAttachmentPreview(elements.attachmentPreview, {
      kind: "file",
      name: file.name,
    });
    return;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    pendingAttachment = null;
    showAttachmentPreview(elements.attachmentPreview, {
      kind: "file",
      name: "Image too large. Use an image under 5 MB.",
    });
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  pendingAttachment = {
    kind: "image",
    name: file.name,
    type: file.type || "image/png",
    dataUrl,
  };
  showAttachmentPreview(elements.attachmentPreview, pendingAttachment);
}

function buildProviderContent(text, attachment) {
  if (!attachment || attachment.kind !== "image") return text;

  return [
    { type: "text", text: text || "Describe this image" },
    { type: "image_url", image_url: { url: attachment.dataUrl } },
  ];
}

function buildDisplayText(text, attachment) {
  if (!attachment) return text;
  const label = attachment.kind === "image" ? `[Image: ${attachment.name}]` : `[File: ${attachment.name}]`;
  return text ? `${text}\n${label}` : label;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Failed to read file")));
    reader.readAsDataURL(file);
  });
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
    const preferredModel = models.some((model) => model.id === existingModel) ? existingModel : defaultModel || models[0].id;
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
  newChatButton.addEventListener("click", () => startNewSession(elements, elements.modelSelect.value, true));
}

function startNewSession(elements, model, showNotice) {
  const session = createSession(model);
  session.displayMessages = [{ role: "assistant", content: showNotice ? `New chat started with ${model}.` : "Hi! Ask me something and I will help." }];
  sessions.unshift(session);
  activeSessionId = session.id;
  pendingAttachment = null;
  hideAttachmentPreview(elements.attachmentPreview);
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
  renderConversationList(elements.conversationList, sessions, activeSessionId, (sessionId) => selectSession(elements, sessionId));
}

function getActiveSession() {
  return sessions.find((session) => session.id === activeSessionId);
}

function makeLocalTitle(text) {
  const words = String(text || "")
    .replace(/[.!?]+$/g, "")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const useful = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  const title = (useful.length ? useful : words).slice(0, 5).join(" ") || "New chat";
  return title.length > 32 ? `${title.slice(0, 32)}...` : title;
}
