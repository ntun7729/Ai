export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  messages: ChatMessage[];
}

export interface ChatCompletionChoice {
  message?: ChatMessage;
  finish_reason?: string;
}

export interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: ChatCompletionChoice[];
  usage?: unknown;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}
