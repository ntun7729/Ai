export type ChatRole = "system" | "user" | "assistant";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageUrlContentPart {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export interface RuntimeSettings {
  providerBaseUrl?: string;
  providerToken?: string;
  logsEnabled?: boolean;
  webFetchEnabled?: boolean;
  googleSearchEnabled?: boolean;
}

export type ChatContentPart = TextContentPart | ImageUrlContentPart;
export type ChatContent = string | ChatContentPart[];

export interface ChatMessage {
  role: ChatRole;
  content: ChatContent;
}

export interface ChatRequestBody {
  messages: ChatMessage[];
  model?: string;
  thinking?: boolean;
  webSearch?: boolean;
  memory?: boolean;
  conversationId?: string;
  conversationTitle?: string;
  runtime?: RuntimeSettings;
}

export interface ChatCompletionDelta {
  content?: string;
  reasoning?: string;
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
