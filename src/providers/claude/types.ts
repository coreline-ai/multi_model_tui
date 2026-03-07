export interface ClaudeContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ClaudeResponse {
  id?: string;
  model?: string;
  type?: string;
  role?: string;
  content?: ClaudeContentBlock[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface ClaudeCliResponse {
  result?: string;
}
