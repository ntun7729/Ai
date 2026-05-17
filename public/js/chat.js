import { fetchModels, sendChat } from "./api.js";
import {
  addConversationItem,
  addMessage,
  autoResizeTextarea,
  clearMessages,
  resetConversationList,
  setLoading,
  setModelLabels,
  setupMobileSidebar,
} from "./dom.js";

function createSystemMessage(model) {
  return {
    role: "system",
    content: `You are a helpful AI assistant on a small website. The selected provider model id is ${model}. If the user asks which model you are, answer with exactly this model id: ${model}.`,
  };
}

let conversation = [];
let hasConversationItem = false;
let activeModel = "";

export function setupChat(elements) {
  const { form, prompt, sendButton, messages, promptChips, modelSelect, modelBadge, mobileModelLabel, newChatButton } = elements;

  activeModel = modelSelect.value;
  conversation = [createSystemMessage(activeModel)];

  setupMobileSidebar(elements);
  setupPromptInput(prompt, form);
  setupPromptChips(promptChips, prompt);
  setupModelPicker(modelSelect, modelBadge, mobileModelLabel, elements);
  setupNewChat(newChatButton, elements);
  loadProviderModels(modelSelect, modelBadge, mobileModelLabel, elements);

  addMessage(messages, "assistant", "Hi! Ask me something and I will help.");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitMessage({ prompt, sendButton, messages, modelSelect, conversationList: elements.conversationList });
  });
}

async function submitMessage({ prompt, sendButton, messages, modelSelect, conversationList }) {
  const userText = prompt.value.trim();
  if (!userText || sendButton.disabled) return;

  ensureModelConversation(modelSelect.value);
  document.body.classList.add("has-chat");
  if (!hasConversationItem) {
    addConversationItem(conversationList, makeConversationTitle(userText));
    hasConversationItem = true;
  }

  prompt.value = "";
  autoResizeTextarea(prompt);
  conversation.push({ role: "user", content: userText });
  addMessage(messages, "user", userText);
  setLoading(sendButton, true);

  try {
    const answer = await sendChat(conversation, modelSelect.value);
    conversation.push({ role: "assistant", content: answer });
    addMessage(messages, "assistant", answer || "No answer returned.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    addMessage(messages, "error", message);
  } finally {
    setLoading(sendButton, false);
    prompt.focus();
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
    resetChatForModelChange(elements, modelSelect.value);
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
    resetChatForModelChange(elements, modelSelect.value, false);
  } catch (error) {
    console.warn("Failed to load provider models", error);
  }
}

function setupNewChat(newChatButton, elements) {
  if (!newChatButton) return;

  newChatButton.addEventListener("click", () => {
    resetChatForModelChange(elements, elements.modelSelect.value, true);
  });
}

function resetChatForModelChange(elements, model, showNotice = true) {
  activeModel = model;
  conversation = [createSystemMessage(model)];
  hasConversationItem = false;
  document.body.classList.remove("has-chat");
  clearMessages(elements.messages);
  resetConversationList(elements.conversationList);
  addMessage(elements.messages, "assistant", showNotice ? `New chat started with ${model}.` : "Hi! Ask me something and I will help.");
  elements.prompt.value = "";
  autoResizeTextarea(elements.prompt);
  elements.prompt.focus();
}

function ensureModelConversation(model) {
  if (model === activeModel && conversation.length > 0) return;

  activeModel = model;
  conversation = [createSystemMessage(model)];
  hasConversationItem = false;
}

function makeConversationTitle(text) {
  return text.length > 32 ? `${text.slice(0, 32)}...` : text;
}
