import { sendChat } from "./api.js";
import { addMessage, setLoading } from "./dom.js";

const systemMessage = {
  role: "system",
  content: "You are a helpful AI assistant on a small website.",
};

const conversation = [systemMessage];

export function setupChat({ form, prompt, sendButton, messages }) {
  addMessage(messages, "assistant", "Hi! Ask me something and I will help.");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const userText = prompt.value.trim();
    if (!userText) return;

    prompt.value = "";
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
  });
}
