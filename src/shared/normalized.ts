import type {
  CapabilityFeature,
  FeatureSupport,
  HostedToolConfig,
  NormalizedContentPart,
  NormalizedMessage,
  ProviderCapabilities,
  SupportLevel,
  UnifiedRequest,
} from "../types.js";

export function textPart(text: string): NormalizedContentPart {
  return { type: "text", text };
}

export function ensureMessages(req: Pick<UnifiedRequest, "messages" | "prompt">): NormalizedMessage[] {
  if (Array.isArray(req.messages) && req.messages.length > 0) {
    return req.messages;
  }

  if (typeof req.prompt === "string" && req.prompt.trim()) {
    return [{ role: "user", parts: [textPart(req.prompt.trim())] }];
  }

  return [];
}

export function extractTextFromParts(parts: NormalizedContentPart[] | undefined): string {
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "json") return JSON.stringify(part.value);
      if (part.type === "tool_result") {
        return typeof part.content === "string" ? part.content : extractTextFromParts(part.content);
      }
      if (part.type === "refusal") return part.text;
      if (part.type === "reasoning") return part.summary ?? part.text ?? "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function collapseMessagesToPrompt(messages: NormalizedMessage[], system?: string): string {
  const promptParts: string[] = [];

  if (system?.trim()) {
    promptParts.push(`SYSTEM:\n${system.trim()}`);
  }

  for (const message of messages) {
    const text = extractTextFromParts(message.parts);
    if (!text) continue;
    promptParts.push(`${message.role.toUpperCase()}:\n${text}`);
  }

  return promptParts.join("\n\n").trim();
}

export function collectSystemInstruction(messages: NormalizedMessage[], fallback?: string): string | undefined {
  const systemBlocks = messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => extractTextFromParts(message.parts))
    .filter(Boolean);

  if (fallback?.trim()) {
    systemBlocks.unshift(fallback.trim());
  }

  const joined = systemBlocks.join("\n\n").trim();
  return joined || undefined;
}

export function filterChatMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  return messages.filter((message) => message.role !== "system" && message.role !== "developer");
}

export function makeTextResponseParts(text: string): NormalizedContentPart[] {
  return text ? [{ type: "text", text }] : [];
}

export function inferRequestedFeatures(req: UnifiedRequest): Set<CapabilityFeature> {
  const features = new Set<CapabilityFeature>();
  const messages = ensureMessages(req);

  if (messages.length > 0) {
    features.add("messages");
  }
  if (req.system || messages.some((message) => message.role === "system" || message.role === "developer")) {
    features.add("systemInstruction");
  }
  if (req.stream) {
    features.add("streaming");
  }
  if (Array.isArray(req.tools) && req.tools.length > 0) {
    features.add("toolCalling");
  }
  if (Array.isArray(req.hostedTools) && req.hostedTools.length > 0) {
    features.add("hostedTools");
  }
  if (req.responseFormat && req.responseFormat.type !== "text") {
    features.add("structuredOutput");
  }
  if (req.state?.cacheKey) {
    features.add("caching");
  }
  if (req.state?.previousResponseId || req.state?.conversationId || req.state?.thoughtSignatures?.length) {
    features.add("stateContinuation");
  }

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "image") features.add("imageInput");
      if (part.type === "file") features.add("fileInput");
      if (part.type === "reasoning") features.add("reasoning");
      if (part.type === "citation") features.add("citations");
      if (part.type === "tool_call" || part.type === "tool_result") features.add("toolCalling");
    }
  }

  return features;
}

export function inferHostedToolFeature(tools: HostedToolConfig[] | undefined): CapabilityFeature | null {
  return Array.isArray(tools) && tools.length > 0 ? "hostedTools" : null;
}

export function effectiveSupport(platform: SupportLevel, transport: SupportLevel): SupportLevel {
  const rank: Record<SupportLevel, number> = {
    none: 0,
    unverified: 1,
    partial: 2,
    full: 3,
  };
  return rank[platform] <= rank[transport] ? platform : transport;
}

export function feature(platform: SupportLevel, transport: SupportLevel, notes?: string): FeatureSupport {
  return {
    platform,
    transport,
    effective: effectiveSupport(platform, transport),
    ...(notes ? { notes } : {}),
  };
}

export function summarizeCapabilities(capabilities: ProviderCapabilities): string {
  const highlights = [
    ["msg", capabilities.features.messages.effective],
    ["tool", capabilities.features.toolCalling.effective],
    ["json", capabilities.features.structuredOutput.effective],
    ["img", capabilities.features.imageInput.effective],
  ]
    .map(([name, support]) => `${name}=${support}`)
    .join(" ");

  return `${capabilities.provider}:${capabilities.transport} ${highlights}`;
}
