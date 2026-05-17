import { sendChat } from "./api.js";
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

const systemMessage = {
  role: "system",
  content: "You are a helpful AI assistant on a small website.",
};

let conversation = [systemMessage];
let hasConversationItem = false;

export function setupChat(elements) {
  const { form, prompt, sendButton, messages, promptChips, modelSelect, modelBadge, mobileModelLabel, newChatButton } = elements;

  setupMobileSidebar(elements);
  setupPromptInput(prompt, form);
  setupPromptChips(promptChips, prompt);
  setupModelPicker(modelSelect, modelBadge, mobileModelLabel);
  setupNewChat(newChatButton, elements);

  addMessage(messages, "assistant", "Hi! Ask me something and I will help.");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitMessage({ prompt, sendButton, messages, modelSelect, conversationList: elements.conversationList });
  });
}

async function submitMessage({ prompt, sendButton, messages, modelSelect, conversationList }) {
  const userText = prompt.value.trim();
  if (!userText || sendButton.disabled) return;

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

function setupModelPicker(modelSelect, modelBadge, mobileModelLabel) {
  setModelLabels(modelSelect.value, modelBadge, mobileModelLabel);

  modelSelect.addEventListener("change", () => {
    setModelLabels(modelSelect.value, modelBadge, mobileModelLabel);
  });
}

function setupNewChat(newChatButton, elements) {
  if (!newChatButton) return;

  newChatButton.addEventListener("click", () => {
    conversation = [systemMessage];
    hasConversationItem = false;
    document.body.classList.remove("has-chat");
    clearMessages(elements.messages);
    resetConversationList(elements.conversationList);
    addMessage(elements.messages, "assistant", "Hi! Ask me something and I will help.");
    elements.prompt.value = "";
    autoResizeTextarea(elements.prompt);
    elements.prompt.focus();
  });
}

function makeConversationTitle(text) {
  return text.length > 32 ? `${text.slice(0, 32)}...` : text;
}
