import type {
  BatchResponse,
  CapabilitiesResponse,
  CapabilityFeature,
  ChatResponse,
  HostedToolConfig,
  NormalizedContentPart,
  NormalizedMessage,
  NormalizedResponseFormat,
  NormalizedState,
  NormalizedToolDefinition,
  ProviderCapabilityReport,
  ProviderName,
  SelfTestRequest,
  UnifiedBatchRequest,
  UnifiedRequest,
  UnifiedResponse,
} from "../types.js";
import { PROVIDER_ORDER } from "../types.js";
import { ensureMessages } from "../shared/normalized.js";

function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && PROVIDER_ORDER.includes(value as ProviderName);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseContentPart(value: unknown): NormalizedContentPart | null {
  if (!isObjectRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "text" && typeof value.text === "string") {
    return { type: "text", text: value.text };
  }

  if (value.type === "image") {
    return {
      type: "image",
      url: typeof value.url === "string" ? value.url : undefined,
      dataUrl: typeof value.dataUrl === "string" ? value.dataUrl : undefined,
      mimeType: typeof value.mimeType === "string" ? value.mimeType : undefined,
      detail: value.detail === "low" || value.detail === "high" || value.detail === "auto" ? value.detail : undefined,
    };
  }

  if (value.type === "file") {
    return {
      type: "file",
      fileId: typeof value.fileId === "string" ? value.fileId : undefined,
      url: typeof value.url === "string" ? value.url : undefined,
      dataUrl: typeof value.dataUrl === "string" ? value.dataUrl : undefined,
      mimeType: typeof value.mimeType === "string" ? value.mimeType : undefined,
      filename: typeof value.filename === "string" ? value.filename : undefined,
    };
  }

  if (value.type === "tool_call" && typeof value.id === "string" && typeof value.name === "string") {
    return {
      type: "tool_call",
      id: value.id,
      name: value.name,
      argumentsJson: typeof value.argumentsJson === "string" ? value.argumentsJson : "{}",
    };
  }

  if (value.type === "tool_result" && typeof value.id === "string" && typeof value.name === "string") {
    const content = typeof value.content === "string" ? value.content : parseContentParts(value.content);
    return {
      type: "tool_result",
      id: value.id,
      name: value.name,
      content: typeof content === "string" || Array.isArray(content) ? content : "",
      isError: value.isError === true,
    };
  }

  if (value.type === "reasoning") {
    return {
      type: "reasoning",
      text: typeof value.text === "string" ? value.text : undefined,
      summary: typeof value.summary === "string" ? value.summary : undefined,
      visibility: value.visibility === "summary" || value.visibility === "full" ? value.visibility : "hidden",
      signature: typeof value.signature === "string" ? value.signature : undefined,
    };
  }

  if (value.type === "citation") {
    return {
      type: "citation",
      title: typeof value.title === "string" ? value.title : undefined,
      url: typeof value.url === "string" ? value.url : undefined,
      start: typeof value.start === "number" ? value.start : undefined,
      end: typeof value.end === "number" ? value.end : undefined,
      sourceType:
        value.sourceType === "file" || value.sourceType === "search" || value.sourceType === "maps"
          ? value.sourceType
          : "web",
    };
  }

  if (value.type === "refusal" && typeof value.text === "string") {
    return {
      type: "refusal",
      text: value.text,
      reason: typeof value.reason === "string" ? value.reason : undefined,
    };
  }

  if (value.type === "json" && "value" in value) {
    return {
      type: "json",
      value: value.value,
    };
  }

  return null;
}

function parseContentParts(value: unknown): NormalizedContentPart[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseContentPart).filter(Boolean) as NormalizedContentPart[];
}

function parseMessages(value: unknown): NormalizedMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!isObjectRecord(entry) || typeof entry.role !== "string") return null;
      if (!["system", "developer", "user", "assistant", "tool"].includes(entry.role)) return null;
      const parts = parseContentParts(entry.parts);
      if (parts.length === 0 && typeof entry.content === "string" && entry.content.trim()) {
        parts.push({ type: "text", text: entry.content.trim() });
      }
      if (parts.length === 0) return null;
      return {
        role: entry.role as NormalizedMessage["role"],
        parts,
        name: typeof entry.name === "string" ? entry.name : undefined,
        metadata: isStringRecord(entry.metadata) ? entry.metadata : undefined,
      };
    })
    .filter(Boolean) as NormalizedMessage[];
}

function parseTools(value: unknown): NormalizedToolDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = value
    .map((tool) => {
      if (!isObjectRecord(tool) || typeof tool.name !== "string" || !isObjectRecord(tool.inputSchema)) return null;
      return {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : undefined,
        inputSchema: tool.inputSchema,
        strict: tool.strict === true,
      };
    })
    .filter(Boolean) as NormalizedToolDefinition[];

  return tools.length > 0 ? tools : undefined;
}

function parseHostedTools(value: unknown): HostedToolConfig[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = value
    .map((tool) => {
      if (!isObjectRecord(tool) || typeof tool.type !== "string") return null;
      return {
        type: tool.type as HostedToolConfig["type"],
        provider: isProviderName(tool.provider) ? tool.provider : undefined,
        config: isObjectRecord(tool.config) ? tool.config : undefined,
      };
    })
    .filter(Boolean) as HostedToolConfig[];
  return tools.length > 0 ? tools : undefined;
}

function parseResponseFormat(value: unknown): NormalizedResponseFormat | undefined {
  if (!isObjectRecord(value) || typeof value.type !== "string") return undefined;
  if (!["text", "json_object", "json_schema"].includes(value.type)) return undefined;
  return {
    type: value.type as NormalizedResponseFormat["type"],
    name: typeof value.name === "string" ? value.name : undefined,
    schema: isObjectRecord(value.schema) ? value.schema : undefined,
    strict: value.strict === true,
  };
}

function parseState(value: unknown): NormalizedState | undefined {
  if (!isObjectRecord(value)) return undefined;
  const thoughtSignatures =
    Array.isArray(value.thoughtSignatures) && value.thoughtSignatures.every((entry) => typeof entry === "string")
      ? (value.thoughtSignatures as string[])
      : undefined;
  const parsed: NormalizedState = {
    previousResponseId: typeof value.previousResponseId === "string" ? value.previousResponseId : undefined,
    conversationId: typeof value.conversationId === "string" ? value.conversationId : undefined,
    thoughtSignatures,
    cacheKey: typeof value.cacheKey === "string" ? value.cacheKey : undefined,
  };
  return Object.values(parsed).some(Boolean) ? parsed : undefined;
}

function parseCapabilityPolicy(value: unknown): UnifiedRequest["capabilityPolicy"] {
  if (!isObjectRecord(value)) return undefined;
  const require =
    Array.isArray(value.require) &&
    value.require.every((entry) =>
      [
        "messages",
        "systemInstruction",
        "streaming",
        "usage",
        "toolCalling",
        "hostedTools",
        "imageInput",
        "fileInput",
        "structuredOutput",
        "reasoning",
        "citations",
        "caching",
        "stateContinuation",
      ].includes(String(entry))
    )
      ? (value.require as CapabilityFeature[])
      : undefined;

  return {
    require,
    allowBestEffort: value.allowBestEffort === true,
    allowProviderExtensions: value.allowProviderExtensions === true,
  };
}

function parseHumanInputMode(value: unknown): UnifiedRequest["humanInputMode"] {
  if (value === "forbid" || value === "return") {
    return value;
  }
  return undefined;
}

export function parseUnifiedRequest(body: unknown): UnifiedRequest {
  if (!body || typeof body !== "object") {
    throw new Error("invalid request body");
  }

  const value = body as Record<string, unknown>;
  if (!isProviderName(value.provider)) {
    throw new Error("provider is required");
  }
  if (typeof value.prompt !== "string" || !value.prompt.trim()) {
    throw new Error("prompt is required");
  }

  return {
    provider: value.provider,
    prompt: value.prompt.trim(),
    model: typeof value.model === "string" ? value.model : undefined,
    stream: value.stream === true,
    timeoutMs: typeof value.timeoutMs === "number" ? value.timeoutMs : undefined,
    metadata: isStringRecord(value.metadata) ? value.metadata : undefined,
    system: typeof value.system === "string" ? value.system : undefined,
    maxTokens: typeof value.maxTokens === "number" ? value.maxTokens : undefined,
    maxOutputTokens: typeof value.maxOutputTokens === "number" ? value.maxOutputTokens : undefined,
    temperature: typeof value.temperature === "number" ? value.temperature : undefined,
    tools: parseTools(value.tools),
    hostedTools: parseHostedTools(value.hostedTools),
    toolChoice: value.toolChoice,
    responseFormat: parseResponseFormat(value.responseFormat),
    state: parseState(value.state),
    capabilityPolicy: parseCapabilityPolicy(value.capabilityPolicy),
    humanInputMode: parseHumanInputMode(value.humanInputMode),
  };
}

export function parseRichUnifiedRequest(body: unknown): UnifiedRequest {
  if (!body || typeof body !== "object") {
    throw new Error("invalid request body");
  }

  const value = body as Record<string, unknown>;
  if (!isProviderName(value.provider)) {
    throw new Error("provider is required");
  }

  const messages = parseMessages(value.messages);
  const prompt = typeof value.prompt === "string" && value.prompt.trim() ? value.prompt.trim() : undefined;

  if (!prompt && messages.length === 0) {
    throw new Error("prompt or messages is required");
  }

  return {
    provider: value.provider,
    prompt,
    messages: messages.length > 0 ? messages : undefined,
    model: typeof value.model === "string" ? value.model : undefined,
    stream: value.stream === true,
    timeoutMs: typeof value.timeoutMs === "number" ? value.timeoutMs : undefined,
    metadata: isStringRecord(value.metadata) ? value.metadata : undefined,
    system: typeof value.system === "string" ? value.system : undefined,
    maxTokens: typeof value.maxTokens === "number" ? value.maxTokens : undefined,
    maxOutputTokens: typeof value.maxOutputTokens === "number" ? value.maxOutputTokens : undefined,
    temperature: typeof value.temperature === "number" ? value.temperature : undefined,
    tools: parseTools(value.tools),
    hostedTools: parseHostedTools(value.hostedTools),
    toolChoice: value.toolChoice,
    responseFormat: parseResponseFormat(value.responseFormat),
    state: parseState(value.state),
    capabilityPolicy: parseCapabilityPolicy(value.capabilityPolicy),
    humanInputMode: parseHumanInputMode(value.humanInputMode),
  };
}

export function parseUnifiedBatchRequest(body: unknown): UnifiedBatchRequest {
  if (!body || typeof body !== "object") {
    throw new Error("invalid request body");
  }

  const value = body as Record<string, unknown>;
  if (!Array.isArray(value.providers) || value.providers.length === 0 || !value.providers.every(isProviderName)) {
    throw new Error("providers is required");
  }
  if (typeof value.prompt !== "string" || !value.prompt.trim()) {
    throw new Error("prompt is required");
  }

  return {
    providers: value.providers,
    prompt: value.prompt.trim(),
    stream: value.stream === true,
    timeoutMs: typeof value.timeoutMs === "number" ? value.timeoutMs : undefined,
    metadata: isStringRecord(value.metadata) ? value.metadata : undefined,
    system: typeof value.system === "string" ? value.system : undefined,
    humanInputMode: parseHumanInputMode(value.humanInputMode),
  };
}

export function parseRichUnifiedBatchRequest(body: unknown): UnifiedBatchRequest {
  if (!body || typeof body !== "object") {
    throw new Error("invalid request body");
  }

  const value = body as Record<string, unknown>;
  if (!Array.isArray(value.providers) || value.providers.length === 0 || !value.providers.every(isProviderName)) {
    throw new Error("providers is required");
  }

  const messages = parseMessages(value.messages);
  const prompt = typeof value.prompt === "string" && value.prompt.trim() ? value.prompt.trim() : undefined;

  if (!prompt && messages.length === 0) {
    throw new Error("prompt or messages is required");
  }

  return {
    providers: value.providers,
    prompt,
    messages: messages.length > 0 ? messages : undefined,
    stream: value.stream === true,
    timeoutMs: typeof value.timeoutMs === "number" ? value.timeoutMs : undefined,
    metadata: isStringRecord(value.metadata) ? value.metadata : undefined,
    system: typeof value.system === "string" ? value.system : undefined,
    maxTokens: typeof value.maxTokens === "number" ? value.maxTokens : undefined,
    maxOutputTokens: typeof value.maxOutputTokens === "number" ? value.maxOutputTokens : undefined,
    temperature: typeof value.temperature === "number" ? value.temperature : undefined,
    tools: parseTools(value.tools),
    hostedTools: parseHostedTools(value.hostedTools),
    toolChoice: value.toolChoice,
    responseFormat: parseResponseFormat(value.responseFormat),
    state: parseState(value.state),
    capabilityPolicy: parseCapabilityPolicy(value.capabilityPolicy),
    humanInputMode: parseHumanInputMode(value.humanInputMode),
  };
}

export function parseSelfTestRequest(body: unknown): SelfTestRequest {
  if (!body || typeof body !== "object") {
    return { providers: [...PROVIDER_ORDER] };
  }
  const value = body as Record<string, unknown>;
  if (!Array.isArray(value.providers) || value.providers.length === 0 || !value.providers.every(isProviderName)) {
    return { providers: [...PROVIDER_ORDER] };
  }
  return { providers: value.providers };
}

export function toChatResponse(response: UnifiedResponse): ChatResponse {
  return {
    provider: response.provider,
    ok: response.ok,
    model: response.model,
    transport: response.transport,
    elapsedMs: response.elapsedMs,
    text: response.text,
    error: response.error ?? null,
  };
}

export function toBatchResponse(results: UnifiedResponse[]): BatchResponse {
  return {
    results: results.map(toChatResponse),
  };
}

export function toRichBatchResponse(results: UnifiedResponse[]): { results: UnifiedResponse[] } {
  return { results };
}

export function toCapabilitiesResponse(providers: ProviderCapabilityReport[]): CapabilitiesResponse {
  return { providers };
}

export function ensurePromptOrMessages(req: UnifiedRequest): UnifiedRequest {
  const messages = ensureMessages(req);
  if (messages.length === 0) {
    throw new Error("prompt or messages is required");
  }

  return {
    ...req,
    messages,
    prompt: req.prompt,
  };
}
