import { sendChat } from "./api.js";
import { addMessage, autoResizeTextarea, setLoading, setupMobileSidebar } from "./dom.js";

const systemMessage = {
  role: "system",
  content: "You are a helpful AI assistant on a small website.",
};

const conversation = [systemMessage];

export function setupChat(elements) {
  const { form, prompt, sendButton, messages, promptChips } = elements;

  setupMobileSidebar(elements);
  setupPromptInput(prompt, form);
  setupPromptChips(promptChips, prompt);

  addMessage(messages, "assistant", "Hi! Ask me something and I will help.");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitMessage({ prompt, sendButton, messages });
  });
}

async function submitMessage({ prompt, sendButton, messages }) {
  const userText = prompt.value.trim();
  if (!userText || sendButton.disabled) return;

  prompt.value = "";
  autoResizeTextarea(prompt);
  conversation.push({ role: "user", content: userText });
  addMessage(messages, "user", userText);
  setLoading(sendButton, true);

  try {
    const answer = await sendChat(conversation);
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
