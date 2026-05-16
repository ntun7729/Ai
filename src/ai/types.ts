export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  messages: ChatMessage[];
}

export interface ChatCompletionDelta {
  content?: string;
  reasoning_content?: string;
}

export interface ChatCompletionChoice {
  message?: ChatMessage;
  delta?: ChatCompletionDelta;
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
