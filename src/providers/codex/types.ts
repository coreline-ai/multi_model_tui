export interface CodexOutputText {
  type?: string;
  text?: string;
}

export interface CodexFunctionCall {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
}

export interface CodexResponseItem {
  type?: string;
  role?: string;
  id?: string;
  status?: string;
  content?: Array<CodexOutputText>;
  name?: string;
  arguments?: string;
  call_id?: string;
  refusal?: string;
}

export interface CodexFinalResponse {
  id?: string;
  status?: string;
  output?: CodexResponseItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    };
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}
