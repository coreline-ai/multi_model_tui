import type {
  HostedToolConfig,
  NormalizedContentPart,
  NormalizedMessage,
  NormalizedToolDefinition,
  ProviderName,
  UnifiedRequest,
  UnifiedResponse,
} from "../types.js";
import { extractTextFromParts } from "../shared/normalized.js";

function inferProvider(model: string): ProviderName {
  const normalized = model.toLowerCase();
  if (normalized.startsWith("claude")) return "claude";
  if (normalized.startsWith("gemini")) return "gemini";
  return "codex";
}

function parseChatContent(content: unknown): NormalizedContentPart[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }

  if (!Array.isArray(content)) return [];

  return content
    .flatMap<NormalizedContentPart>((part) => {
      if (!part || typeof part !== "object") return [];
      const value = part as Record<string, unknown>;
      if ((value.type === "text" || value.type === "input_text") && typeof value.text === "string") {
        return [{ type: "text", text: value.text }];
      }
      if ((value.type === "image_url" || value.type === "input_image") && typeof value.image_url === "string") {
        return [{ type: "image", url: value.image_url }];
      }
      if (value.type === "file" && typeof value.file_id === "string") {
        return [{ type: "file", fileId: value.file_id }];
      }
      return [];
    })
    .filter(Boolean) as NormalizedContentPart[];
}

function parseOpenAiMessages(messages: unknown[]): UnifiedRequest["messages"] {
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return null;
      const item = message as Record<string, unknown>;
      const role = typeof item.role === "string" ? item.role : "user";
      if (!["system", "developer", "user", "assistant", "tool"].includes(role)) return null;

      const parts = parseChatContent(item.content);
      if (parts.length === 0 && typeof item.content === "string" && item.content.trim()) {
        parts.push({ type: "text", text: item.content.trim() });
      }

      if (Array.isArray(item.tool_calls)) {
        for (const call of item.tool_calls) {
          if (!call || typeof call !== "object") continue;
          const tool = call as Record<string, unknown>;
          const fn = tool.function;
          if (!fn || typeof fn !== "object") continue;
          const func = fn as Record<string, unknown>;
          if (typeof tool.id !== "string" || typeof func.name !== "string") continue;
          parts.push({
            type: "tool_call",
            id: tool.id,
            name: func.name,
            argumentsJson: typeof func.arguments === "string" ? func.arguments : "{}",
          });
        }
      }

      if (role === "tool" && typeof item.tool_call_id === "string") {
        return {
          role: "tool" as const,
          parts: [
            {
              type: "tool_result",
              id: item.tool_call_id,
              name: typeof item.name === "string" ? item.name : "tool_result",
              content: typeof item.content === "string" ? item.content : extractTextFromParts(parts),
            },
          ],
        };
      }

      return parts.length > 0 ? { role: role as NormalizedMessage["role"], parts } : null;
    })
    .filter((value): value is NormalizedMessage => value !== null);
}

function parseResponsesInput(input: unknown): UnifiedRequest["messages"] {
  if (!Array.isArray(input)) return undefined;

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const role = typeof item.role === "string" ? item.role : "user";
      if (!["system", "developer", "user", "assistant", "tool"].includes(role)) return null;
      const parts = parseChatContent(item.content);
      return parts.length > 0 ? { role: role as NormalizedMessage["role"], parts } : null;
    })
    .filter((value): value is NormalizedMessage => value !== null);
}

export function openAiToUnified(body: Record<string, unknown>): UnifiedRequest {
  const model = typeof body.model === "string" ? body.model : "gpt-5";
  const provider = inferProvider(model);
  const messages = Array.isArray(body.messages)
    ? parseOpenAiMessages(body.messages)
    : parseResponsesInput(body.input);

  const parsedTools = Array.isArray(body.tools)
    ? (() => {
        const custom: NormalizedToolDefinition[] = [];
        const hosted: HostedToolConfig[] = [];
        for (const tool of body.tools) {
          if (!tool || typeof tool !== "object") continue;
          const value = tool as Record<string, unknown>;
          if (value.type === "function" && value.function && typeof value.function === "object") {
            const fn = value.function as Record<string, unknown>;
            if (typeof fn.name !== "string") continue;
            custom.push({
              name: fn.name,
              description: typeof fn.description === "string" ? fn.description : undefined,
              inputSchema: (fn.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
              strict: fn.strict === true,
            });
            continue;
          }

          if (typeof value.type !== "string") continue;
          if (value.type === "web_search_preview" || value.type === "web_search") {
            hosted.push({ type: "web_search" });
            continue;
          }
          if (value.type === "file_search") {
            hosted.push({ type: "file_search" });
            continue;
          }
          if (value.type === "code_interpreter") {
            hosted.push({ type: "code_interpreter" });
            continue;
          }
          if (value.type === "computer_use" || value.type === "computer_use_preview") {
            hosted.push({ type: "computer_use" });
            continue;
          }
          if (value.type === "mcp" || value.type === "remote_mcp") {
            hosted.push({ type: "remote_mcp" });
          }
        }
        return { custom, hosted };
      })()
    : undefined;

  const responseFormat =
    body.text && typeof body.text === "object" && (body.text as Record<string, unknown>).format
      ? (() => {
          const format = (body.text as Record<string, unknown>).format as Record<string, unknown>;
          if (format.type === "json_schema") {
            return {
              type: "json_schema" as const,
              name: typeof format.name === "string" ? format.name : undefined,
              schema: typeof format.schema === "object" ? (format.schema as Record<string, unknown>) : undefined,
              strict: format.strict === true,
            };
          }
          return undefined;
        })()
      : body.response_format && typeof body.response_format === "object"
        ? (() => {
            const format = body.response_format as Record<string, unknown>;
            if (format.type === "json_object") return { type: "json_object" as const };
            if (format.type === "json_schema") {
              return {
                type: "json_schema" as const,
                name: typeof format.name === "string" ? format.name : undefined,
                schema: typeof format.schema === "object" ? (format.schema as Record<string, unknown>) : undefined,
                strict: format.strict === true,
              };
            }
            return undefined;
          })()
        : undefined;

  return {
    provider,
    prompt: undefined,
    messages: messages && messages.length > 0 ? messages : undefined,
    model,
    stream: body.stream === true,
    temperature: typeof body.temperature === "number" ? body.temperature : undefined,
    maxOutputTokens:
      typeof body.max_output_tokens === "number"
        ? body.max_output_tokens
        : typeof body.max_tokens === "number"
          ? body.max_tokens
          : undefined,
    tools: parsedTools?.custom && parsedTools.custom.length > 0 ? parsedTools.custom : undefined,
    hostedTools: parsedTools?.hosted && parsedTools.hosted.length > 0 ? parsedTools.hosted : undefined,
    toolChoice: body.tool_choice,
    responseFormat,
    state:
      typeof body.previous_response_id === "string"
        ? {
            previousResponseId: body.previous_response_id,
          }
        : undefined,
    humanInputMode: body.human_input_mode === "return" ? "return" : body.human_input_mode === "forbid" ? "forbid" : undefined,
  };
}

export function unifiedToChatCompletion(response: UnifiedResponse): Record<string, unknown> {
  const toolCalls = (response.parts ?? [])
    .filter((part) => part.type === "tool_call")
    .map((part) => ({
      id: part.id,
      type: "function",
      function: {
        name: part.name,
        arguments: part.argumentsJson,
      },
    }));

  return {
    id: `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        finish_reason:
          response.finishReason === "tool_call"
            ? "tool_calls"
            : response.finishReason === "max_tokens"
              ? "length"
              : "stop",
        message: {
          role: "assistant",
          content: response.text,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: response.usage?.inputTokens ?? 0,
      completion_tokens: response.usage?.outputTokens ?? 0,
      total_tokens: response.usage?.totalTokens ?? 0,
    },
  };
}

export function unifiedToOpenAiResponse(response: UnifiedResponse): Record<string, unknown> {
  const content = (response.parts ?? [])
    .flatMap<Record<string, unknown>>((part) => {
      if (part.type === "text") {
        return [{ type: "output_text", text: part.text }];
      }
      if (part.type === "json") {
        return [{ type: "output_text", text: JSON.stringify(part.value) }];
      }
      return [];
    });

  const toolCalls = (response.parts ?? [])
    .filter((part) => part.type === "tool_call")
    .map((part) => ({
      type: "function_call",
      id: part.id,
      call_id: part.id,
      name: part.name,
      arguments: part.argumentsJson,
    }));

  return {
    id: `resp_${Date.now()}`,
    object: "response",
    model: response.model,
    output: [
      {
        type: "message",
        role: "assistant",
        content: content.length > 0 ? content : [{ type: "output_text", text: response.text }],
      },
      ...toolCalls,
    ],
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
      total_tokens: response.usage?.totalTokens ?? 0,
    },
  };
}
