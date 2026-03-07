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

function inferProvider(model: string, metadataProvider?: string): ProviderName {
  if (metadataProvider === "codex" || metadataProvider === "claude" || metadataProvider === "gemini") {
    return metadataProvider;
  }

  const normalized = model.toLowerCase();
  if (normalized.startsWith("claude")) return "claude";
  if (normalized.startsWith("gemini")) return "gemini";
  return "codex";
}

function parseImageSource(source: Record<string, unknown>): NormalizedContentPart | null {
  if (source.type === "url" && typeof source.url === "string") {
    return { type: "image", url: source.url };
  }

  if (source.type === "base64" && typeof source.media_type === "string" && typeof source.data === "string") {
    return {
      type: "image",
      dataUrl: `data:${source.media_type};base64,${source.data}`,
      mimeType: source.media_type,
    };
  }

  return null;
}

function parseAnthropicContent(content: unknown): NormalizedContentPart[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  return content
    .flatMap<NormalizedContentPart>((block) => {
      if (!block || typeof block !== "object") return [];
      const value = block as Record<string, unknown>;

      if (value.type === "text" && typeof value.text === "string") {
        return [{ type: "text", text: value.text }];
      }

      if (value.type === "image" && value.source && typeof value.source === "object") {
        const image = parseImageSource(value.source as Record<string, unknown>);
        return image ? [image] : [];
      }

      if (value.type === "tool_use" && typeof value.id === "string" && typeof value.name === "string") {
        return [
          {
            type: "tool_call",
            id: value.id,
            name: value.name,
            argumentsJson: JSON.stringify(value.input ?? {}),
          },
        ];
      }

      if (value.type === "tool_result" && typeof value.tool_use_id === "string") {
        const resultText =
          typeof value.content === "string"
            ? value.content
            : Array.isArray(value.content)
              ? parseAnthropicContent(value.content)
              : "";
        return [
          {
            type: "tool_result",
            id: value.tool_use_id,
            name: typeof value.name === "string" ? value.name : "tool_result",
            content: resultText,
            isError: value.is_error === true,
          },
        ];
      }

      return [];
    })
    .filter(Boolean) as NormalizedContentPart[];
}

function normalizeAnthropicSystem(system: unknown): string | undefined {
  if (typeof system === "string" && system.trim()) return system.trim();
  if (!Array.isArray(system)) return undefined;
  const text = system
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const value = part as Record<string, unknown>;
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("\n\n")
    .trim();
  return text || undefined;
}

export function anthropicToUnified(body: Record<string, unknown>): UnifiedRequest {
  const model = typeof body.model === "string" ? body.model : "gpt-5";
  const metadataProvider =
    body.metadata && typeof body.metadata === "object" && typeof (body.metadata as Record<string, unknown>).provider === "string"
      ? ((body.metadata as Record<string, unknown>).provider as string)
      : undefined;
  const provider = inferProvider(model, metadataProvider);
  const messages: NormalizedMessage[] | undefined = Array.isArray(body.messages)
    ? (() => {
        const parsed: NormalizedMessage[] = [];
        for (const message of body.messages) {
          if (!message || typeof message !== "object") continue;
          const item = message as Record<string, unknown>;
          const role = typeof item.role === "string" ? item.role : "user";
          if (!["user", "assistant"].includes(role)) continue;
          const parts = parseAnthropicContent(item.content);
          if (parts.length === 0) continue;
          parsed.push({
            role: role as "user" | "assistant",
            parts,
          });
        }
        return parsed;
      })()
    : undefined;
  const system = normalizeAnthropicSystem(body.system);
  const parsedTools = Array.isArray(body.tools)
    ? (() => {
        const custom: NormalizedToolDefinition[] = [];
        const hosted: HostedToolConfig[] = [];
        for (const tool of body.tools) {
          if (!tool || typeof tool !== "object") continue;
          const value = tool as Record<string, unknown>;

          if (typeof value.type === "string") {
            if (value.type.startsWith("web_search")) {
              hosted.push({ type: "web_search", provider: "claude" });
              continue;
            }
            if (value.type.startsWith("code_execution")) {
              hosted.push({ type: "code_execution", provider: "claude" });
              continue;
            }
            if (value.type.startsWith("computer")) {
              hosted.push({ type: "computer_use", provider: "claude" });
              continue;
            }
          }

          if (typeof value.name !== "string") continue;
          custom.push({
            name: value.name,
            description: typeof value.description === "string" ? value.description : undefined,
            inputSchema:
              value.input_schema && typeof value.input_schema === "object"
                ? (value.input_schema as Record<string, unknown>)
                : { type: "object", properties: {} },
          });
        }
        return { custom, hosted };
      })()
    : undefined;

  return {
    provider,
    prompt: undefined,
    messages: messages && messages.length > 0 ? messages : undefined,
    model,
    stream: body.stream === true,
    system,
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
    temperature: typeof body.temperature === "number" ? body.temperature : undefined,
    tools: parsedTools?.custom && parsedTools.custom.length > 0 ? parsedTools.custom : undefined,
    hostedTools: parsedTools?.hosted && parsedTools.hosted.length > 0 ? parsedTools.hosted : undefined,
    toolChoice: body.tool_choice,
    metadata: metadataProvider ? { provider: metadataProvider } : undefined,
    humanInputMode: body.human_input_mode === "return" ? "return" : body.human_input_mode === "forbid" ? "forbid" : undefined,
  };
}

export function unifiedToAnthropic(response: UnifiedResponse): Record<string, unknown> {
  const content = (response.parts ?? [])
    .flatMap<Record<string, unknown>>((part) => {
      if (part.type === "text") {
        return [{ type: "text", text: part.text }];
      }
      if (part.type === "tool_call") {
        return [
          {
            type: "tool_use",
            id: part.id,
            name: part.name,
            input: JSON.parse(part.argumentsJson || "{}"),
          },
        ];
      }
      if (part.type === "json") {
        return [{ type: "text", text: JSON.stringify(part.value) }];
      }
      if (part.type === "refusal") {
        return [{ type: "text", text: part.text }];
      }
      return [];
    });

  const normalizedContent = content.length > 0 ? content : [{ type: "text", text: response.text || extractTextFromParts(response.parts) }];

  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: response.model,
    content: normalizedContent,
    stop_reason:
      response.finishReason === "tool_call"
        ? "tool_use"
        : response.finishReason === "max_tokens"
          ? "max_tokens"
          : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
    },
  };
}
