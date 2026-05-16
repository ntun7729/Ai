export function getChatElements() {
  const form = document.querySelector("#chat-form");
  const prompt = document.querySelector("#prompt");
  const sendButton = document.querySelector("#send-button");
  const messages = document.querySelector("#messages");

  if (!form || !prompt || !sendButton || !messages) {
    throw new Error("Chat UI is missing required elements");
  }

  return { form, prompt, sendButton, messages };
}

export function addMessage(container, role, content) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.textContent = content;
  container.append(message);
  container.scrollTop = container.scrollHeight;
  return message;
}

export function setLoading(sendButton, isLoading) {
  sendButton.disabled = isLoading;
  sendButton.textContent = isLoading ? "Thinking..." : "Send";
}
