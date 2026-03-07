export type ProviderName = "codex" | "claude" | "gemini";

export const PROVIDER_ORDER: ProviderName[] = ["codex", "claude", "gemini"];

export type Availability = "healthy" | "degraded" | "unavailable";
export type SupportLevel = "full" | "partial" | "none" | "unverified";
export type FinishReason = "stop" | "max_tokens" | "tool_call" | "content_filter" | "error" | "unknown";
export type UnifiedChunkType = "start" | "delta" | "end" | "error" | "meta";
export type NormalizedRole = "system" | "developer" | "user" | "assistant" | "tool";
export type CapabilityFeature =
  | "messages"
  | "systemInstruction"
  | "streaming"
  | "usage"
  | "toolCalling"
  | "hostedTools"
  | "imageInput"
  | "fileInput"
  | "structuredOutput"
  | "reasoning"
  | "citations"
  | "caching"
  | "stateContinuation";

export interface UnifiedError {
  code:
    | "auth_missing"
    | "auth_invalid"
    | "human_input_required"
    | "transport_unavailable"
    | "timeout"
    | "rate_limited"
    | "invalid_response"
    | "unsupported_feature"
    | "provider_error";
  message: string;
  transport?: string;
  raw?: string;
  feature?: CapabilityFeature | string;
}

export interface HumanInputRequest {
  kind: "approval" | "text";
  title: string;
  instructions: string;
  provider?: ProviderName;
  toolType?: string;
  resumable: boolean;
}

export type NormalizedContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url?: string; dataUrl?: string; mimeType?: string; detail?: "low" | "high" | "auto" }
  | { type: "file"; fileId?: string; url?: string; dataUrl?: string; mimeType?: string; filename?: string }
  | { type: "tool_call"; id: string; name: string; argumentsJson: string }
  | { type: "tool_result"; id: string; name: string; content: string | NormalizedContentPart[]; isError?: boolean }
  | { type: "reasoning"; text?: string; summary?: string; visibility: "hidden" | "summary" | "full"; signature?: string }
  | { type: "citation"; title?: string; url?: string; start?: number; end?: number; sourceType: "web" | "file" | "search" | "maps" }
  | { type: "refusal"; text: string; reason?: string }
  | { type: "json"; value: unknown };

export interface NormalizedMessage {
  role: NormalizedRole;
  parts: NormalizedContentPart[];
  name?: string;
  metadata?: Record<string, string>;
}

export interface NormalizedToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  strict?: boolean;
}

export interface HostedToolConfig {
  type:
    | "web_search"
    | "file_search"
    | "code_execution"
    | "code_interpreter"
    | "remote_mcp"
    | "computer_use"
    | "google_search"
    | "google_maps"
    | "url_context";
  provider?: ProviderName;
  config?: Record<string, unknown>;
}

export interface NormalizedResponseFormat {
  type: "text" | "json_object" | "json_schema";
  name?: string;
  schema?: Record<string, unknown>;
  strict?: boolean;
}

export interface NormalizedState {
  previousResponseId?: string;
  conversationId?: string;
  thoughtSignatures?: string[];
  cacheKey?: string;
}

export interface CapabilityPolicy {
  require?: CapabilityFeature[];
  allowBestEffort?: boolean;
  allowProviderExtensions?: boolean;
}

export interface NormalizedUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export interface UnifiedRequest {
  provider: ProviderName;
  prompt?: string;
  messages?: NormalizedMessage[];
  model?: string;
  stream?: boolean;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  system?: string;
  maxTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
  tools?: NormalizedToolDefinition[];
  hostedTools?: HostedToolConfig[];
  toolChoice?: "auto" | "none" | "required" | { type: "tool"; name: string } | unknown;
  responseFormat?: NormalizedResponseFormat;
  state?: NormalizedState;
  capabilityPolicy?: CapabilityPolicy;
  humanInputMode?: "forbid" | "return";
}

export interface UnifiedBatchRequest {
  providers: ProviderName[];
  prompt?: string;
  messages?: NormalizedMessage[];
  stream?: boolean;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  system?: string;
  maxTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
  tools?: NormalizedToolDefinition[];
  hostedTools?: HostedToolConfig[];
  toolChoice?: "auto" | "none" | "required" | { type: "tool"; name: string } | unknown;
  responseFormat?: NormalizedResponseFormat;
  state?: NormalizedState;
  capabilityPolicy?: CapabilityPolicy;
  humanInputMode?: "forbid" | "return";
}

export interface UnifiedResponse {
  provider: ProviderName;
  ok: boolean;
  model: string;
  transport: string;
  elapsedMs: number;
  text: string;
  parts?: NormalizedContentPart[];
  finishReason?: FinishReason;
  usage?: NormalizedUsage;
  error?: UnifiedError;
  rawExtensions?: Record<string, unknown>;
  humanInput?: HumanInputRequest;
}

export interface UnifiedChunk {
  provider: ProviderName;
  type: UnifiedChunkType;
  model?: string;
  transport?: string;
  text?: string;
  part?: NormalizedContentPart;
  error?: UnifiedError;
  done?: boolean;
  metadata?: Record<string, string>;
  finishReason?: FinishReason;
  usage?: NormalizedUsage;
  humanInput?: HumanInputRequest;
}

export interface FeatureSupport {
  platform: SupportLevel;
  transport: SupportLevel;
  effective: SupportLevel;
  notes?: string;
}

export interface ProviderCapabilities {
  provider: ProviderName;
  model?: string;
  transport: string;
  features: {
    messages: FeatureSupport;
    systemInstruction: FeatureSupport;
    streaming: FeatureSupport;
    usage: FeatureSupport;
    toolCalling: FeatureSupport;
    hostedTools: FeatureSupport;
    imageInput: FeatureSupport;
    fileInput: FeatureSupport;
    structuredOutput: FeatureSupport;
    reasoning: FeatureSupport;
    citations: FeatureSupport;
    caching: FeatureSupport;
    stateContinuation: FeatureSupport;
  };
}

export interface ProviderCapabilityReport {
  provider: ProviderName;
  availability: Availability;
  selectedTransport: string | null;
  transports: ProviderCapabilities[];
}

export interface ProviderStatus {
  provider: ProviderName;
  availability: Availability;
  primaryTransport: string | null;
  fallbackTransport: string | null;
  reason: string | null;
}

export interface HealthResponse {
  ok: true;
  proxy: {
    host: string;
    port: number;
    version: string;
  };
}

export interface ProvidersResponse {
  providers: ProviderStatus[];
}

export interface CapabilitiesResponse {
  providers: ProviderCapabilityReport[];
}

export interface ChatResponse {
  provider: ProviderName;
  ok: boolean;
  model: string;
  transport: string;
  elapsedMs: number;
  text: string;
  error: UnifiedError | null;
}

export interface BatchResponse {
  results: ChatResponse[];
}

export interface SelfTestRequest {
  providers: ProviderName[];
}

export interface SelfTestResult {
  provider: ProviderName;
  ok: boolean;
  expected: string;
  actual: string;
  transport?: string;
  error?: UnifiedError;
}

export interface SelfTestResponse {
  results: SelfTestResult[];
}

export interface ParsedCommand {
  kind: "provider" | "help" | "exit" | "invalid" | "status" | "self-test";
  provider?: ProviderName | "all";
  prompt?: string;
  raw: string;
  error?: string;
}

export interface ProviderResult {
  provider: ProviderName;
  ok: boolean;
  model: string;
  elapsedMs: number;
  text: string;
  transport?: string;
  error?: string | UnifiedError;
}

export interface AuthStatus {
  ok: boolean;
  detail: string;
}

export interface ProviderClient {
  readonly name: ProviderName;
  readonly model: string;
  checkAuth(): Promise<AuthStatus>;
  sendPrompt(prompt: string): Promise<ProviderResult>;
}

export interface AppConfig {
  codexModel: string;
  geminiModel: string;
  claudeModel: string;
  geminiProject?: string;
  claudeToken?: string;
  codexBaseUrl: string;
  claudeBaseUrl: string;
  codexAuthPath: string;
  codexFallbackAuthPath: string;
  geminiAuthPath: string;
  requestTimeoutMs: number;
  proxyHost: string;
  proxyPort: number;
  proxyLogLevel: "debug" | "info" | "error";
  proxyStartupTimeoutMs: number;
}

export interface ProviderAdapter {
  readonly provider: ProviderName;
  getStatus(): Promise<ProviderStatus>;
  getCapabilities(): Promise<ProviderCapabilityReport>;
  execute(req: UnifiedRequest): Promise<UnifiedResponse>;
  stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk>;
}

export interface ProviderTransport {
  readonly provider: ProviderName;
  readonly name: string;
  checkAvailability(): Promise<{ ok: boolean; reason?: string }>;
  getCapabilities(): ProviderCapabilities;
  execute(req: UnifiedRequest): Promise<UnifiedResponse>;
  stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk>;
}

export interface LocalProxyClient {
  getHealth(): Promise<HealthResponse>;
  getProviders(): Promise<ProvidersResponse>;
  getCapabilities(): Promise<CapabilitiesResponse>;
  chat(req: UnifiedRequest): Promise<ChatResponse>;
  chatV2(req: UnifiedRequest): Promise<UnifiedResponse>;
  batch(req: UnifiedBatchRequest): Promise<BatchResponse>;
  batchV2(req: UnifiedBatchRequest): Promise<{ results: UnifiedResponse[] }>;
  selfTest(req: SelfTestRequest): Promise<SelfTestResponse>;
}
