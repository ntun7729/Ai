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
const SUGGESTED_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "moonshotai/kimi-k2.6",
  "mistralai/mistral-small-4-119b-2603",
  "z-ai/glm-5.1",
  "qwen/qwen3-coder-480b-a35b-instruct",
];

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
let modelPickerUi = null;

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
  modelPickerUi = createModelPickerUi(modelSelect);
  setModelLabels(modelSelect.value, modelBadge, mobileModelLabel);
  modelPickerUi.sync();

  modelSelect.addEventListener("change", () => {
    setModelLabels(modelSelect.value, modelBadge, mobileModelLabel);
    modelPickerUi.sync();
    startNewSession(elements, modelSelect.value, true);
  });
}

function createModelPickerUi(modelSelect) {
  const shell = modelSelect.closest(".model-select-shell");
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "model-picker-trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.innerHTML = `
    <span class="model-trigger-copy">
      <strong></strong>
      <small></small>
    </span>
    <span class="model-trigger-chevron" aria-hidden="true">⌄</span>
  `;
  shell.append(trigger);

  const overlay = document.createElement("div");
  overlay.className = "model-sheet-backdrop";
  overlay.hidden = true;

  const sheet = document.createElement("section");
  sheet.className = "model-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Choose model");
  sheet.innerHTML = `
    <div class="model-sheet-grabber" aria-hidden="true"></div>
    <div class="model-sheet-header">
      <button class="model-sheet-close" type="button" aria-label="Close model picker">×</button>
      <div>
        <h2>Intelligence</h2>
        <p>Choose the model for the next chat.</p>
      </div>
    </div>
    <div class="model-sheet-current">
      <span>Model</span>
      <strong></strong>
    </div>
    <label class="model-search-label">
      <span>Search models</span>
      <input class="model-search-input" type="search" placeholder="Search provider models..." autocomplete="off" />
    </label>
    <div class="model-option-list"></div>
  `;
  overlay.append(sheet);
  document.body.append(overlay);

  const searchInput = sheet.querySelector(".model-search-input");
  const list = sheet.querySelector(".model-option-list");
  const currentValue = sheet.querySelector(".model-sheet-current strong");
  const closeButton = sheet.querySelector(".model-sheet-close");
  const triggerName = trigger.querySelector("strong");
  const triggerMeta = trigger.querySelector("small");

  const open = () => {
    render();
    overlay.hidden = false;
    document.body.classList.add("model-sheet-open");
    trigger.setAttribute("aria-expanded", "true");
    window.setTimeout(() => searchInput.focus(), 50);
  };

  const close = () => {
    overlay.hidden = true;
    document.body.classList.remove("model-sheet-open");
    trigger.setAttribute("aria-expanded", "false");
    searchInput.value = "";
  };

  const choose = (model) => {
    if (modelSelect.value !== model) {
      modelSelect.value = model;
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      sync();
    }
    close();
  };

  const renderSection = (title, models) => {
    const unique = uniqueStrings(models).filter(Boolean);
    if (unique.length === 0) return;

    const section = document.createElement("div");
    section.className = "model-option-section";
    const heading = document.createElement("p");
    heading.className = "model-option-heading";
    heading.textContent = title;
    section.append(heading);

    for (const model of unique) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "model-option";
      button.setAttribute("aria-pressed", model === modelSelect.value ? "true" : "false");
      button.innerHTML = `
        <span class="model-option-text">
          <strong></strong>
          <small></small>
        </span>
        <span class="model-option-check" aria-hidden="true">✓</span>
      `;
      button.querySelector("strong").textContent = prettyModelName(model);
      button.querySelector("small").textContent = describeModel(model);
      button.addEventListener("click", () => choose(model));
      section.append(button);
    }

    list.append(section);
  };

  const render = () => {
    const all = getOptionValues(modelSelect);
    const query = searchInput.value.trim().toLowerCase();
    list.textContent = "";

    if (query) {
      renderSection("Search results", all.filter((model) => model.toLowerCase().includes(query)));
      if (!list.children.length) {
        const empty = document.createElement("p");
        empty.className = "model-option-empty";
        empty.textContent = "No matching models.";
        list.append(empty);
      }
      return;
    }

    const suggested = SUGGESTED_MODELS.filter((model) => all.includes(model));
    const allWithoutSuggested = all.filter((model) => !suggested.includes(model));
    renderSection("Suggested", suggested);
    renderSection("All provider models", allWithoutSuggested);
  };

  const sync = () => {
    const model = modelSelect.value;
    const meta = describeModel(model);
    triggerName.textContent = prettyModelName(model);
    triggerMeta.textContent = meta;
    currentValue.textContent = prettyModelName(model);
    render();
  };

  trigger.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  searchInput.addEventListener("input", render);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) close();
  });

  return { sync, render };
}

async function loadProviderModels(modelSelect, modelBadge, mobileModelLabel, elements) {
  const existingModel = modelSelect.value;
  try {
    const { models, defaultModel } = await fetchModels();
    if (models.length === 0) return;
    const uniqueModels = uniqueStrings(models.map((model) => model.id));
    const preferredModel = uniqueModels.includes(existingModel) ? existingModel : defaultModel || uniqueModels[0];
    modelSelect.textContent = "";
    for (const model of uniqueModels) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.append(option);
    }
    modelSelect.value = preferredModel;
    setModelLabels(modelSelect.value, modelBadge, mobileModelLabel);
    modelPickerUi?.sync();
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
  modelPickerUi?.sync();
  renderActiveSession(elements);
  elements.prompt.focus();
}

function selectSession(elements, sessionId) {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  activeSessionId = sessionId;
  elements.modelSelect.value = session.model;
  setModelLabels(session.model, elements.modelBadge, elements.mobileModelLabel);
  modelPickerUi?.sync();
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

function getOptionValues(select) {
  return uniqueStrings(Array.from(select.options).map((option) => option.value).filter(Boolean));
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function prettyModelName(model) {
  return model;
}

function describeModel(model) {
  const lower = model.toLowerCase();
  const tags = [];
  if (lower.includes("vision") || lower.includes("mistral-small-4")) tags.push("Vision");
  if (lower.includes("coder") || lower.includes("code")) tags.push("Coding");
  if (lower.includes("thinking") || lower.includes("glm") || lower.includes("kimi") || lower.includes("oss")) tags.push("Thinking-capable");
  if (lower.includes("embed")) tags.push("Embedding");
  if (lower.includes("audio")) tags.push("Audio");
  if (tags.length === 0) tags.push("Chat model");
  return tags.join(" • ");
}
