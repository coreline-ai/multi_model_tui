import type {
  AppConfig,
  HostedToolConfig,
  NormalizedContentPart,
  NormalizedMessage,
  ProviderCapabilities,
  ProviderTransport,
  UnifiedChunk,
  UnifiedRequest,
  UnifiedResponse,
} from "../../types.js";
import { getClaudeOAuthToken } from "../../auth/claude.js";
import { elapsedMs, nowMs } from "../../shared/time.js";
import { HttpStatusError, unsupportedFeatureError } from "../../shared/errors.js";
import { readResponseBody } from "../../shared/http.js";
import { parseSseEvents } from "../../shared/sse.js";
import { assertTransportSupportsRequest } from "../../shared/capabilities.js";
import {
  collectSystemInstruction,
  ensureMessages,
  extractTextFromParts,
  filterChatMessages,
  makeTextResponseParts,
} from "../../shared/normalized.js";
import type { ClaudeResponse } from "./types.js";

const JSON_SHIM_TOOL_NAME = "emit_json";
const CLAUDE_WEB_SEARCH_TOOL = "web_search_20250305";
const CLAUDE_CODE_EXECUTION_TOOL = "code_execution_20250825";

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return {
    mediaType: match[1] ?? "application/octet-stream",
    data: match[2] ?? "",
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapPartToClaude(part: NormalizedContentPart): Record<string, unknown>[] {
  if (part.type === "text") {
    return [{ type: "text", text: part.text }];
  }

  if (part.type === "image") {
    if (part.dataUrl) {
      const parsed = parseDataUrl(part.dataUrl);
      if (parsed) {
        return [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: parsed.mediaType,
              data: parsed.data,
            },
          },
        ];
      }
    }

    if (part.url) {
      return [
        {
          type: "image",
          source: {
            type: "url",
            url: part.url,
          },
        },
      ];
    }
  }

  if (part.type === "tool_result") {
    return [
      {
        type: "tool_result",
        tool_use_id: part.id,
        content: typeof part.content === "string" ? part.content : extractTextFromParts(part.content),
        is_error: part.isError === true,
      },
    ];
  }

  if (part.type === "tool_call") {
    return [
      {
        type: "tool_use",
        id: part.id,
        name: part.name,
        input: parseJsonObject(part.argumentsJson),
      },
    ];
  }

  if (part.type === "json") {
    return [{ type: "text", text: JSON.stringify(part.value) }];
  }

  return [];
}

function toClaudeMessages(req: UnifiedRequest): Array<Record<string, unknown>> {
  const messages = filterChatMessages(ensureMessages(req));

  return messages
    .map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          content: message.parts.flatMap(mapPartToClaude),
        };
      }

      return {
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.parts.flatMap(mapPartToClaude),
      };
    })
    .filter((message) => Array.isArray(message.content) && message.content.length > 0);
}

function mapHostedTool(tool: HostedToolConfig): {
  definition: Record<string, unknown>;
  betaHeader?: string;
} {
  if (tool.type === "web_search") {
    return {
      definition: {
        type: CLAUDE_WEB_SEARCH_TOOL,
        ...(tool.config ?? {}),
      },
    };
  }

  if (tool.type === "code_execution") {
    return {
      definition: {
        type: CLAUDE_CODE_EXECUTION_TOOL,
        ...(tool.config ?? {}),
      },
      betaHeader: "code-execution-2025-08-25",
    };
  }

  throw unsupportedFeatureError(
    "hostedTools",
    "api",
    `hosted tool ${tool.type} is not supported by transport api`
  );
}

function appendStructuredOutputShim(req: UnifiedRequest): {
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
  betaHeaders?: string[];
} {
  const customTools =
    req.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    })) ?? [];

  const hostedTools: Array<Record<string, unknown>> = [];
  const betaHeaders: string[] = [];
  for (const hostedTool of req.hostedTools ?? []) {
    const mapped = mapHostedTool(hostedTool);
    hostedTools.push(mapped.definition);
    if (mapped.betaHeader) {
      betaHeaders.push(mapped.betaHeader);
    }
  }

  if (!req.responseFormat || req.responseFormat.type === "text") {
    return {
      tools: [...customTools, ...hostedTools],
      tool_choice: normalizeClaudeToolChoice(req.toolChoice),
      betaHeaders,
    };
  }

  const tools = [
    ...customTools,
    ...hostedTools,
    {
      name: JSON_SHIM_TOOL_NAME,
      description: "Emit the final response as JSON matching the requested schema.",
      input_schema:
        req.responseFormat.type === "json_schema"
          ? req.responseFormat.schema ?? { type: "object" }
          : { type: "object", additionalProperties: true },
    },
  ];

  return {
    tools,
    tool_choice: {
      type: "tool",
      name: JSON_SHIM_TOOL_NAME,
    },
    betaHeaders,
  };
}

function normalizeClaudeToolChoice(toolChoice: UnifiedRequest["toolChoice"]): Record<string, unknown> | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "auto" || toolChoice === "none") return { type: toolChoice };
  if (toolChoice === "required") return { type: "any" };
  if (typeof toolChoice === "object" && toolChoice && "type" in toolChoice && toolChoice.type === "tool" && "name" in toolChoice) {
    return { type: "tool", name: toolChoice.name };
  }
  return undefined;
}

function extractParts(payload: ClaudeResponse): NormalizedContentPart[] {
  const parts: NormalizedContentPart[] = [];
  for (const item of payload.content ?? []) {
    if (item.type === "text" && typeof item.text === "string") {
      parts.push({ type: "text", text: item.text });
    }
    if (item.type === "tool_use" && typeof item.id === "string" && typeof item.name === "string") {
      const input = item.input ?? {};
      if (item.name === JSON_SHIM_TOOL_NAME) {
        parts.push({ type: "json", value: input });
      } else {
        parts.push({
          type: "tool_call",
          id: item.id,
          name: item.name,
          argumentsJson: JSON.stringify(input),
        });
      }
    }
  }
  return parts;
}

function finishReason(stopReason: string | null | undefined): UnifiedResponse["finishReason"] {
  if (stopReason === "tool_use") return "tool_call";
  if (stopReason === "max_tokens") return "max_tokens";
  if (stopReason === "end_turn") return "stop";
  return stopReason ? "unknown" : "stop";
}

export class ClaudeApiTransport implements ProviderTransport {
  readonly provider = "claude" as const;
  readonly name = "api";

  constructor(private readonly config: AppConfig) {}

  getCapabilities(): ProviderCapabilities {
    return {
      provider: this.provider,
      model: this.config.claudeModel,
      transport: this.name,
      features: {
        messages: { platform: "full", transport: "full", effective: "full" },
        systemInstruction: { platform: "partial", transport: "full", effective: "partial" },
        streaming: { platform: "full", transport: "full", effective: "full" },
        usage: { platform: "full", transport: "full", effective: "full" },
        toolCalling: { platform: "full", transport: "full", effective: "full" },
        hostedTools: {
          platform: "full",
          transport: "partial",
          effective: "partial",
          notes: "web_search and code_execution are wired. Other hosted tools fail fast.",
        },
        imageInput: { platform: "full", transport: "full", effective: "full" },
        fileInput: {
          platform: "full",
          transport: "none",
          effective: "none",
          notes: "Files/PDF are not yet wired through the Files API.",
        },
        structuredOutput: {
          platform: "partial",
          transport: "partial",
          effective: "partial",
          notes: "Structured output uses a synthetic emit_json tool shim.",
        },
        reasoning: {
          platform: "full",
          transport: "partial",
          effective: "partial",
          notes: "Thinking summaries are preserved only as final response parts, not stream deltas.",
        },
        citations: { platform: "partial", transport: "partial", effective: "partial" },
        caching: { platform: "full", transport: "none", effective: "none" },
        stateContinuation: { platform: "partial", transport: "none", effective: "none" },
      },
    };
  }

  async checkAvailability(): Promise<{ ok: boolean; reason?: string }> {
    const token = getClaudeOAuthToken(this.config.claudeToken);
    return token ? { ok: true } : { ok: false, reason: "direct token missing" };
  }

  async execute(req: UnifiedRequest): Promise<UnifiedResponse> {
    assertTransportSupportsRequest(req, this.getCapabilities());
    const startedAt = nowMs();
    const token = getClaudeOAuthToken(this.config.claudeToken);
    if (!token) {
      throw new Error("missing CLAUDE_CODE_OAUTH_TOKEN");
    }

    const model = req.model ?? this.config.claudeModel;
    const toolConfig = appendStructuredOutputShim(req);
    const response = await fetch(`${this.config.claudeBaseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        ...(toolConfig.betaHeaders && toolConfig.betaHeaders.length > 0
          ? { "anthropic-beta": toolConfig.betaHeaders.join(",") }
          : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxOutputTokens ?? req.maxTokens ?? 4096,
        messages: toClaudeMessages(req),
        stream: false,
        ...(req.system || req.messages ? { system: collectSystemInstruction(ensureMessages(req), req.system) } : {}),
        ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
        ...(toolConfig.tools ? { tools: toolConfig.tools } : {}),
        ...(toolConfig.tool_choice ? { tool_choice: toolConfig.tool_choice } : {}),
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("claude request failed", response.status, await readResponseBody(response));
    }

    const payload = (await response.json()) as ClaudeResponse;
    const parts = extractParts(payload);
    const text = extractTextFromParts(parts);

    return {
      provider: this.provider,
      ok: true,
      model,
      transport: this.name,
      elapsedMs: elapsedMs(startedAt),
      text,
      parts,
      finishReason: finishReason(payload.stop_reason),
      usage: payload.usage
        ? {
            inputTokens: payload.usage.input_tokens,
            outputTokens: payload.usage.output_tokens,
            totalTokens:
              typeof payload.usage.input_tokens === "number" && typeof payload.usage.output_tokens === "number"
                ? payload.usage.input_tokens + payload.usage.output_tokens
                : undefined,
          }
        : undefined,
    };
  }

  async *stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk> {
    assertTransportSupportsRequest(req, this.getCapabilities());
    const token = getClaudeOAuthToken(this.config.claudeToken);
    if (!token) {
      throw new Error("missing CLAUDE_CODE_OAUTH_TOKEN");
    }

    const model = req.model ?? this.config.claudeModel;
    const toolConfig = appendStructuredOutputShim(req);
    const response = await fetch(`${this.config.claudeBaseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        ...(toolConfig.betaHeaders && toolConfig.betaHeaders.length > 0
          ? { "anthropic-beta": toolConfig.betaHeaders.join(",") }
          : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxOutputTokens ?? req.maxTokens ?? 4096,
        messages: toClaudeMessages(req),
        stream: true,
        ...(req.system || req.messages ? { system: collectSystemInstruction(ensureMessages(req), req.system) } : {}),
        ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
        ...(toolConfig.tools ? { tools: toolConfig.tools } : {}),
        ...(toolConfig.tool_choice ? { tool_choice: toolConfig.tool_choice } : {}),
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("claude request failed", response.status, await readResponseBody(response));
    }
    if (!response.body) {
      throw new Error("invalid provider response");
    }

    yield { provider: this.provider, type: "start", model, transport: this.name };

    let usage: UnifiedResponse["usage"];
    let reason: UnifiedResponse["finishReason"] = "stop";
    const toolBlocks = new Map<number, { id: string; name: string; partialJson: string }>();

    for await (const event of parseSseEvents(response.body)) {
      if (event.data === "[DONE]") break;
      const parsed = JSON.parse(event.data) as {
        type?: string;
        index?: number;
        delta?: { text?: string; stop_reason?: string; partial_json?: string; type?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
        content_block?: {
          type?: string;
          text?: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        };
      };

      if (parsed.type === "content_block_delta" && typeof parsed.delta?.text === "string") {
        yield {
          provider: this.provider,
          type: "delta",
          model,
          transport: this.name,
          text: parsed.delta.text,
        };
      }

      if (
        parsed.type === "content_block_delta" &&
        typeof parsed.index === "number" &&
        typeof parsed.delta?.partial_json === "string"
      ) {
        const current = toolBlocks.get(parsed.index);
        if (current) {
          current.partialJson += parsed.delta.partial_json;
          toolBlocks.set(parsed.index, current);
        }
      }

      if (parsed.type === "content_block_start" && parsed.content_block?.type === "text" && parsed.content_block.text) {
        yield {
          provider: this.provider,
          type: "delta",
          model,
          transport: this.name,
          text: parsed.content_block.text,
        };
      }

      if (
        parsed.type === "content_block_start" &&
        typeof parsed.index === "number" &&
        parsed.content_block?.type === "tool_use" &&
        typeof parsed.content_block.id === "string" &&
        typeof parsed.content_block.name === "string"
      ) {
        const initialInput =
          parsed.content_block.input && Object.keys(parsed.content_block.input).length > 0
            ? JSON.stringify(parsed.content_block.input)
            : "";
        toolBlocks.set(parsed.index, {
          id: parsed.content_block.id,
          name: parsed.content_block.name,
          partialJson: initialInput,
        });
      }

      if (parsed.type === "content_block_stop" && typeof parsed.index === "number") {
        const current = toolBlocks.get(parsed.index);
        if (current) {
          const parsedInput = parseJsonObject(current.partialJson);
          yield {
            provider: this.provider,
            type: "meta",
            model,
            transport: this.name,
            part:
              current.name === JSON_SHIM_TOOL_NAME
                ? { type: "json", value: parsedInput }
                : {
                    type: "tool_call",
                    id: current.id,
                    name: current.name,
                    argumentsJson: JSON.stringify(parsedInput),
                  },
          };
          toolBlocks.delete(parsed.index);
        }
      }

      if (parsed.type === "message_delta" && parsed.delta?.stop_reason) {
        reason = finishReason(parsed.delta.stop_reason);
      }

      if (parsed.usage) {
        usage = {
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
          totalTokens:
            typeof parsed.usage.input_tokens === "number" && typeof parsed.usage.output_tokens === "number"
              ? parsed.usage.input_tokens + parsed.usage.output_tokens
              : undefined,
        };
      }
    }

    yield {
      provider: this.provider,
      type: "end",
      model,
      transport: this.name,
      done: true,
      finishReason: reason,
      usage,
    };
  }
}
