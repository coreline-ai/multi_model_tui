import type {
  AppConfig,
  NormalizedContentPart,
  NormalizedMessage,
  ProviderCapabilities,
  ProviderTransport,
  UnifiedChunk,
  UnifiedRequest,
  UnifiedResponse,
} from "../../types.js";
import { getValidCodexTokens } from "./auth.js";
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
import type { CodexFinalResponse, CodexResponseItem } from "./types.js";

function extractFinalText(response: CodexFinalResponse | null): string {
  if (!response?.output) return "";

  return response.output
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text as string)
    .join("");
}

function extractParts(response: CodexFinalResponse | null): NormalizedContentPart[] {
  if (!response?.output) return [];

  const parts: NormalizedContentPart[] = [];
  for (const item of response.output) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push({ type: "text", text: content.text });
      }
    }

    if (item.type === "function_call" && typeof item.name === "string") {
      parts.push({
        type: "tool_call",
        id: item.call_id ?? item.id ?? item.name,
        name: item.name,
        argumentsJson: typeof item.arguments === "string" ? item.arguments : "{}",
      });
    }

    if (typeof item.refusal === "string" && item.refusal) {
      parts.push({ type: "refusal", text: item.refusal });
    }
  }

  return parts;
}

function buildMessageContent(parts: NormalizedContentPart[]): Array<Record<string, unknown>> {
  return parts.flatMap<Record<string, unknown>>((part) => {
    if (part.type === "text") {
      return [{ type: "input_text", text: part.text }];
    }

    if (part.type === "image") {
      if (part.url) {
        return [{ type: "input_image", image_url: part.url, detail: part.detail ?? "auto" }];
      }
      if (part.dataUrl) {
        return [{ type: "input_image", image_url: part.dataUrl, detail: part.detail ?? "auto" }];
      }
    }

    if (part.type === "file") {
      if (part.fileId) {
        return [{ type: "input_file", file_id: part.fileId }];
      }
      if (part.url) {
        return [{ type: "input_file", file_url: part.url }];
      }
    }

    return [];
  });
}

function buildMessageItems(message: NormalizedMessage): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  const content = buildMessageContent(message.parts);
  if (content.length > 0) {
    items.push({
      type: "message",
      role: message.role === "tool" ? "user" : message.role,
      content,
    });
  }

  for (const part of message.parts) {
    if (part.type === "tool_call") {
      items.push({
        type: "function_call",
        call_id: part.id,
        name: part.name,
        arguments: part.argumentsJson,
      });
    }

    if (part.type === "tool_result") {
      items.push({
        type: "function_call_output",
        call_id: part.id,
        output: typeof part.content === "string" ? part.content : extractTextFromParts(part.content),
      });
    }
  }

  return items;
}

function buildInput(req: UnifiedRequest): Array<Record<string, unknown>> {
  const messages = filterChatMessages(ensureMessages(req));
  return messages.flatMap(buildMessageItems);
}

function buildTools(req: UnifiedRequest): Array<Record<string, unknown>> | undefined {
  if (!req.tools || req.tools.length === 0) return undefined;
  return req.tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: tool.strict === true,
  }));
}

function buildResponseFormat(req: UnifiedRequest): Record<string, unknown> | undefined {
  if (!req.responseFormat || req.responseFormat.type === "text") {
    return { verbosity: "medium" };
  }

  if (req.responseFormat.type === "json_object") {
    return {
      verbosity: "medium",
      format: {
        type: "json_schema",
        name: req.responseFormat.name ?? "json_object",
        schema: { type: "object", additionalProperties: true },
        strict: req.responseFormat.strict === true,
      },
    };
  }

  return {
    verbosity: "medium",
    format: {
      type: "json_schema",
      name: req.responseFormat.name ?? "response",
      schema: req.responseFormat.schema ?? { type: "object" },
      strict: req.responseFormat.strict === true,
    },
  };
}

export class CodexDirectTransport implements ProviderTransport {
  readonly provider = "codex" as const;
  readonly name = "direct";

  constructor(private readonly config: AppConfig) {}

  getCapabilities(): ProviderCapabilities {
    return {
      provider: this.provider,
      model: this.config.codexModel,
      transport: this.name,
      features: {
        messages: { platform: "full", transport: "full", effective: "full" },
        systemInstruction: { platform: "full", transport: "full", effective: "full" },
        streaming: { platform: "full", transport: "full", effective: "full" },
        usage: { platform: "full", transport: "full", effective: "full" },
        toolCalling: {
          platform: "full",
          transport: "partial",
          effective: "partial",
          notes: "Codex backend request shape is inferred from Responses-style function tools.",
        },
        hostedTools: {
          platform: "full",
          transport: "none",
          effective: "none",
          notes: "Hosted tools are not yet wired for the backend endpoint used by this project.",
        },
        imageInput: { platform: "full", transport: "partial", effective: "partial" },
        fileInput: { platform: "full", transport: "partial", effective: "partial" },
        structuredOutput: {
          platform: "full",
          transport: "unverified",
          effective: "unverified",
          notes: "JSON schema is forwarded using Responses-style text.format.",
        },
        reasoning: {
          platform: "partial",
          transport: "partial",
          effective: "partial",
          notes: "Reasoning controls are fixed to medium/auto and response reasoning blocks are not streamed separately.",
        },
        citations: { platform: "partial", transport: "none", effective: "none" },
        caching: { platform: "full", transport: "none", effective: "none" },
        stateContinuation: {
          platform: "full",
          transport: "unverified",
          effective: "unverified",
          notes: "Only previousResponseId is forwarded. conversationId and thoughtSignatures are not wired.",
        },
      },
    };
  }

  async checkAvailability(): Promise<{ ok: boolean; reason?: string }> {
    const tokens = await getValidCodexTokens(this.config.codexAuthPath, this.config.codexFallbackAuthPath);
    if (!tokens) {
      return { ok: false, reason: "missing codex auth" };
    }
    if (!tokens.accountId) {
      return { ok: false, reason: "missing codex account id" };
    }
    return { ok: true };
  }

  async execute(req: UnifiedRequest): Promise<UnifiedResponse> {
    assertTransportSupportsRequest(req, this.getCapabilities());
    this.assertStateSupport(req);
    const startedAt = nowMs();
    const response = await this.runRequest(req);
    const text = extractFinalText(response) || extractTextFromParts(extractParts(response));

    return {
      provider: this.provider,
      ok: true,
      model: req.model ?? this.config.codexModel,
      transport: this.name,
      elapsedMs: elapsedMs(startedAt),
      text,
      parts: extractParts(response),
      finishReason: response?.status === "incomplete" ? "max_tokens" : "stop",
      usage: response?.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
            cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
            reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
          }
        : undefined,
    };
  }

  async *stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk> {
    assertTransportSupportsRequest(req, this.getCapabilities());
    this.assertStateSupport(req);
    const tokens = await getValidCodexTokens(this.config.codexAuthPath, this.config.codexFallbackAuthPath);
    if (!tokens) {
      throw new Error("missing codex auth");
    }
    if (!tokens.accountId) {
      throw new Error("missing codex account id");
    }

    const model = req.model ?? this.config.codexModel;
    const response = await fetch(`${this.config.codexBaseUrl}/codex/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.accessToken}`,
        "chatgpt-account-id": tokens.accountId,
        "OpenAI-Beta": "responses=experimental",
        originator: "codex_cli_rs",
      },
      body: JSON.stringify(this.buildRequestBody(req, model)),
      signal: AbortSignal.timeout(req.timeoutMs ?? this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("codex request failed", response.status, await readResponseBody(response));
    }
    if (!response.body) {
      throw new Error("invalid provider response");
    }

    yield { provider: this.provider, type: "start", model, transport: this.name };

    let finalResponse: CodexFinalResponse | null = null;
    let accumulated = "";

    for await (const event of parseSseEvents(response.body)) {
      if (event.data === "[DONE]") break;
      const parsed = JSON.parse(event.data) as { type?: string; delta?: string; response?: CodexFinalResponse };
      if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
        accumulated += parsed.delta;
        yield {
          provider: this.provider,
          type: "delta",
          model,
          transport: this.name,
          text: parsed.delta,
        };
      }
      if ((parsed.type === "response.done" || parsed.type === "response.completed") && parsed.response) {
        finalResponse = parsed.response;
      }
    }

    const finalText = extractFinalText(finalResponse);
    if (!accumulated && finalText) {
      yield { provider: this.provider, type: "delta", model, transport: this.name, text: finalText };
    }

    for (const part of extractParts(finalResponse).filter((entry) => entry.type !== "text")) {
      yield {
        provider: this.provider,
        type: "meta",
        model,
        transport: this.name,
        part,
      };
    }

    yield {
      provider: this.provider,
      type: "end",
      model,
      transport: this.name,
      done: true,
      finishReason: finalResponse?.status === "incomplete" ? "max_tokens" : "stop",
      usage: finalResponse?.usage
        ? {
            inputTokens: finalResponse.usage.input_tokens,
            outputTokens: finalResponse.usage.output_tokens,
            totalTokens: finalResponse.usage.total_tokens,
            cachedInputTokens: finalResponse.usage.input_tokens_details?.cached_tokens,
            reasoningTokens: finalResponse.usage.output_tokens_details?.reasoning_tokens,
          }
        : undefined,
    };
  }

  private buildRequestBody(req: UnifiedRequest, model: string): Record<string, unknown> {
    return {
      model,
      instructions: collectSystemInstruction(ensureMessages(req), req.system) ?? "",
      input: buildInput(req),
      stream: true,
      store: false,
      reasoning: { effort: "medium", summary: "auto" },
      text: buildResponseFormat(req),
      ...(req.maxOutputTokens || req.maxTokens ? { max_output_tokens: req.maxOutputTokens ?? req.maxTokens } : {}),
      ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
      ...(buildTools(req) ? { tools: buildTools(req) } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      ...(req.state?.previousResponseId ? { previous_response_id: req.state.previousResponseId } : {}),
    };
  }

  private assertStateSupport(req: UnifiedRequest): void {
    if (req.state?.conversationId || (req.state?.thoughtSignatures?.length ?? 0) > 0) {
      throw unsupportedFeatureError(
        "stateContinuation",
        this.name,
        "codex direct currently supports only state.previousResponseId"
      );
    }
  }

  private async runRequest(req: UnifiedRequest): Promise<CodexFinalResponse | null> {
    const tokens = await getValidCodexTokens(this.config.codexAuthPath, this.config.codexFallbackAuthPath);
    if (!tokens) {
      throw new Error("missing codex auth");
    }
    if (!tokens.accountId) {
      throw new Error("missing codex account id");
    }

    const model = req.model ?? this.config.codexModel;
    const response = await fetch(`${this.config.codexBaseUrl}/codex/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.accessToken}`,
        "chatgpt-account-id": tokens.accountId,
        "OpenAI-Beta": "responses=experimental",
        originator: "codex_cli_rs",
      },
      body: JSON.stringify(this.buildRequestBody(req, model)),
      signal: AbortSignal.timeout(req.timeoutMs ?? this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("codex request failed", response.status, await readResponseBody(response));
    }

    if (!response.body) {
      throw new Error("invalid provider response");
    }

    let finalResponse: CodexFinalResponse | null = null;

    for await (const event of parseSseEvents(response.body)) {
      if (event.data === "[DONE]") {
        break;
      }

      const parsed = JSON.parse(event.data) as { type?: string; response?: CodexFinalResponse };
      if ((parsed.type === "response.done" || parsed.type === "response.completed") && parsed.response) {
        finalResponse = parsed.response;
      }
    }

    return finalResponse;
  }
}
