import type { OAuth2Client } from "google-auth-library";
import type {
  AppConfig,
  ProviderCapabilities,
  ProviderTransport,
  UnifiedChunk,
  UnifiedRequest,
  UnifiedResponse,
} from "../../types.js";
import { createGeminiAuthClient } from "./auth.js";
import { elapsedMs, nowMs } from "../../shared/time.js";
import { HttpStatusError } from "../../shared/errors.js";
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
import type {
  CloudProjectsResponse,
  GeminiPart,
  GeminiStreamResponse,
  OnboardUserResponse,
  ProjectDiscoveryResponse,
  ServiceUsageResponse,
  ServiceUsageState,
} from "./types.js";

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_VERSION = "v1internal";
const GEMINI_SERVICE_NAME = "cloudaicompanion.googleapis.com";

function extractProjectId(response: ProjectDiscoveryResponse): string | undefined {
  const project = response.cloudaicompanionProject;
  if (typeof project === "string" && project) return project;
  if (project && typeof project === "object" && typeof project.id === "string") return project.id;
  return undefined;
}

async function getGeminiAccessToken(client: OAuth2Client): Promise<string> {
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error("missing gemini oauth credentials");
  }
  return token;
}

function buildGeminiActivationUrl(projectId: string): string {
  return `https://console.developers.google.com/apis/api/${GEMINI_SERVICE_NAME}/overview?project=${projectId}`;
}

function toGeminiRole(role: string): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function buildGeminiContents(req: UnifiedRequest): Array<Record<string, unknown>> {
  return filterChatMessages(ensureMessages(req)).map((message) => ({
    role: toGeminiRole(message.role),
    parts: message.parts
      .map((part) => {
        if (part.type === "text") return { text: part.text };
        return null;
      })
      .filter(Boolean),
  }));
}

function collectGeminiParts(parsed: GeminiStreamResponse): GeminiPart[] {
  return parsed.response?.candidates?.[0]?.content?.parts ?? [];
}

export class GeminiCodeAssistTransport implements ProviderTransport {
  readonly provider = "gemini" as const;
  readonly name = "code-assist";
  private projectIdCache: string | null = null;

  constructor(private readonly config: AppConfig) {}

  getCapabilities(): ProviderCapabilities {
    return {
      provider: this.provider,
      model: this.config.geminiModel,
      transport: this.name,
      features: {
        messages: { platform: "full", transport: "full", effective: "full" },
        systemInstruction: { platform: "full", transport: "full", effective: "full" },
        streaming: { platform: "full", transport: "full", effective: "full" },
        usage: { platform: "full", transport: "partial", effective: "partial" },
        toolCalling: {
          platform: "full",
          transport: "none",
          effective: "none",
          notes: "Code Assist transport does not yet expose Gemini function calling.",
        },
        hostedTools: { platform: "full", transport: "none", effective: "none" },
        imageInput: {
          platform: "full",
          transport: "none",
          effective: "none",
          notes: "Code Assist transport currently only forwards text parts.",
        },
        fileInput: { platform: "full", transport: "none", effective: "none" },
        structuredOutput: {
          platform: "full",
          transport: "partial",
          effective: "partial",
          notes: "responseMimeType/responseSchema are forwarded when provided.",
        },
        reasoning: {
          platform: "full",
          transport: "partial",
          effective: "partial",
          notes: "Thought parts are surfaced only as response extensions, not full visible deltas.",
        },
        citations: { platform: "full", transport: "none", effective: "none" },
        caching: { platform: "full", transport: "none", effective: "none" },
        stateContinuation: { platform: "partial", transport: "none", effective: "none" },
      },
    };
  }

  async checkAvailability(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const client = await createGeminiAuthClient(this.config.geminiAuthPath);
      await this.discoverProjectId(client);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, reason };
    }
  }

  async execute(req: UnifiedRequest): Promise<UnifiedResponse> {
    assertTransportSupportsRequest(req, this.getCapabilities());
    const startedAt = nowMs();
    const client = await createGeminiAuthClient(this.config.geminiAuthPath);
    const projectId = await this.discoverProjectId(client);
    const payload = await this.generateResponse(client, projectId, req);
    const parts = collectGeminiParts(payload)
      .filter((part) => typeof part.text === "string" && !part.thought)
      .map((part) => ({ type: "text", text: part.text as string }) as const);
    const text = parts.map((part) => part.text).join("");

    return {
      provider: this.provider,
      ok: true,
      model: req.model ?? this.config.geminiModel,
      transport: this.name,
      elapsedMs: elapsedMs(startedAt),
      text,
      parts,
      finishReason: payload.response?.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "max_tokens" : "stop",
      usage: payload.response?.usageMetadata
        ? {
            inputTokens: payload.response.usageMetadata.promptTokenCount,
            outputTokens: payload.response.usageMetadata.candidatesTokenCount,
            totalTokens: payload.response.usageMetadata.totalTokenCount,
            cachedInputTokens: payload.response.usageMetadata.cachedContentTokenCount,
            reasoningTokens: payload.response.usageMetadata.thoughtsTokenCount,
          }
        : undefined,
      rawExtensions: {
        thoughtParts: collectGeminiParts(payload).filter((part) => part.thought === true),
      },
    };
  }

  async *stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk> {
    assertTransportSupportsRequest(req, this.getCapabilities());
    const client = await createGeminiAuthClient(this.config.geminiAuthPath);
    const projectId = await this.discoverProjectId(client);
    const token = await getGeminiAccessToken(client);
    const model = req.model ?? this.config.geminiModel;

    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_VERSION}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(this.buildRequestBody(req, model, projectId)),
      signal: AbortSignal.timeout(req.timeoutMs ?? this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("gemini request failed", response.status, await readResponseBody(response));
    }
    if (!response.body) {
      throw new Error("invalid provider response");
    }

    yield { provider: this.provider, type: "start", model, transport: this.name };

    let usage: UnifiedResponse["usage"];
    let finish: UnifiedResponse["finishReason"] = "stop";

    for await (const event of parseSseEvents(response.body)) {
      const parsed = JSON.parse(event.data) as GeminiStreamResponse;
      const parts = collectGeminiParts(parsed);
      for (const part of parts) {
        if (part.thought || typeof part.text !== "string") continue;
        yield {
          provider: this.provider,
          type: "delta",
          model,
          transport: this.name,
          text: part.text,
        };
      }
      if (parsed.response?.usageMetadata) {
        usage = {
          inputTokens: parsed.response.usageMetadata.promptTokenCount,
          outputTokens: parsed.response.usageMetadata.candidatesTokenCount,
          totalTokens: parsed.response.usageMetadata.totalTokenCount,
          cachedInputTokens: parsed.response.usageMetadata.cachedContentTokenCount,
          reasoningTokens: parsed.response.usageMetadata.thoughtsTokenCount,
        };
      }
      if (parsed.response?.candidates?.[0]?.finishReason === "MAX_TOKENS") {
        finish = "max_tokens";
      }
    }

    yield {
      provider: this.provider,
      type: "end",
      model,
      transport: this.name,
      done: true,
      finishReason: finish,
      usage,
    };
  }

  private buildRequestBody(req: UnifiedRequest, model: string, projectId: string): Record<string, unknown> {
    return {
      model,
      project: projectId,
      request: {
        contents: buildGeminiContents(req),
        ...(collectSystemInstruction(ensureMessages(req), req.system)
          ? { systemInstruction: { parts: [{ text: collectSystemInstruction(ensureMessages(req), req.system) }] } }
          : {}),
        generationConfig: {
          ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
          ...(req.maxOutputTokens || req.maxTokens ? { maxOutputTokens: req.maxOutputTokens ?? req.maxTokens } : {}),
          ...(req.responseFormat?.type === "json_object" ? { responseMimeType: "application/json" } : {}),
          ...(req.responseFormat?.type === "json_schema"
            ? {
                responseMimeType: "application/json",
                responseSchema: req.responseFormat.schema ?? { type: "object" },
              }
            : {}),
        },
      },
    };
  }

  private async discoverProjectId(client: OAuth2Client): Promise<string> {
    if (this.projectIdCache) {
      return this.projectIdCache;
    }

    if (this.config.geminiProject) {
      this.projectIdCache = this.config.geminiProject;
      return this.projectIdCache;
    }

    const token = await getGeminiAccessToken(client);
    const defaultDiscovery = await this.loadCodeAssist(token, "default-project");
    const discovered = extractProjectId(defaultDiscovery);
    if (discovered && !defaultDiscovery.projectValidationError) {
      const state = await this.getServiceState(token, discovered);
      if (state === "ENABLED") {
        this.projectIdCache = discovered;
        return this.projectIdCache;
      }
      throw new Error(`Gemini API disabled for project ${discovered}: enable ${buildGeminiActivationUrl(discovered)}`);
    }

    const accessibleProjects = await this.listAccessibleProjectIds(token);
    const disabledProjects: string[] = [];

    for (const projectId of accessibleProjects) {
      const response = await this.loadCodeAssist(token, projectId);
      const candidateProjectId = extractProjectId(response) ?? projectId;
      if (response.projectValidationError) continue;

      const state = await this.getServiceState(token, candidateProjectId);
      if (state === "ENABLED") {
        this.projectIdCache = candidateProjectId;
        return this.projectIdCache;
      }

      disabledProjects.push(candidateProjectId);
    }

    if (disabledProjects.length > 0) {
      throw new Error(
        `Gemini API disabled for accessible projects. Enable one and set TUI_GEMINI_PROJECT. Example: ${buildGeminiActivationUrl(disabledProjects[0] ?? "project-id")}`
      );
    }

    if (defaultDiscovery.currentTier?.userDefinedCloudaicompanionProject) {
      const reason = defaultDiscovery.projectValidationError?.message;
      throw new Error(
        reason
          ? `missing Gemini project: set TUI_GEMINI_PROJECT (${reason})`
          : "missing Gemini project: set TUI_GEMINI_PROJECT"
      );
    }

    this.projectIdCache = await this.onboardProject(token);
    return this.projectIdCache;
  }

  private async loadCodeAssist(token: string, projectId: string): Promise<ProjectDiscoveryResponse> {
    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_VERSION}:loadCodeAssist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        cloudaicompanionProject: projectId,
        metadata: {
          ideType: "IDE_UNSPECIFIED",
          platform: "PLATFORM_UNSPECIFIED",
          pluginType: "GEMINI",
          duetProject: projectId,
        },
      }),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("gemini loadCodeAssist failed", response.status, await readResponseBody(response));
    }

    return (await response.json()) as ProjectDiscoveryResponse;
  }

  private async listAccessibleProjectIds(token: string): Promise<string[]> {
    const response = await fetch("https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=100", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("gemini list projects failed", response.status, await readResponseBody(response));
    }

    const payload = (await response.json()) as CloudProjectsResponse;
    return (payload.projects ?? [])
      .filter((project) => project.lifecycleState === "ACTIVE" && typeof project.projectId === "string")
      .map((project) => project.projectId as string);
  }

  private async getServiceState(token: string, projectId: string): Promise<ServiceUsageState> {
    const response = await fetch(
      `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${GEMINI_SERVICE_NAME}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      }
    );

    if (!response.ok) {
      throw new HttpStatusError("gemini serviceusage lookup failed", response.status, await readResponseBody(response));
    }

    const payload = (await response.json()) as ServiceUsageResponse;
    return payload.state ?? "STATE_UNSPECIFIED";
  }

  private async onboardProject(token: string): Promise<string> {
    const initialProject = "default-project";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const loadData = await this.loadCodeAssist(token, initialProject);
    const defaultTier = loadData.allowedTiers?.find((tier) => tier.isDefault) ?? { id: "free-tier" };
    const onboardBody = {
      tierId: defaultTier.id ?? "free-tier",
      cloudaicompanionProject: initialProject,
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
        duetProject: initialProject,
      },
    };

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const onboardResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_VERSION}:onboardUser`, {
        method: "POST",
        headers,
        body: JSON.stringify(onboardBody),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });

      if (!onboardResponse.ok) {
        throw new HttpStatusError("gemini onboardUser failed", onboardResponse.status, await readResponseBody(onboardResponse));
      }

      const onboardData = (await onboardResponse.json()) as OnboardUserResponse;
      if (onboardData.done) {
        return onboardData.response?.cloudaicompanionProject?.id ?? initialProject;
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error("Could not discover project ID.");
  }

  private async generateResponse(
    client: OAuth2Client,
    projectId: string,
    req: UnifiedRequest
  ): Promise<GeminiStreamResponse> {
    const token = await getGeminiAccessToken(client);
    const model = req.model ?? this.config.geminiModel;
    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_VERSION}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(this.buildRequestBody(req, model, projectId)),
      signal: AbortSignal.timeout(req.timeoutMs ?? this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("gemini request failed", response.status, await readResponseBody(response));
    }
    if (!response.body) {
      throw new Error("invalid provider response");
    }

    let lastPayload: GeminiStreamResponse = {};
    let text = "";

    for await (const event of parseSseEvents(response.body)) {
      const parsed = JSON.parse(event.data) as GeminiStreamResponse;
      lastPayload = parsed;
      const parts = collectGeminiParts(parsed);
      for (const part of parts) {
        if (part.thought || typeof part.text !== "string") continue;
        text += part.text;
      }
    }

    if (collectGeminiParts(lastPayload).length === 0 && text) {
      lastPayload = {
        response: {
          candidates: [
            {
              content: {
                parts: [{ text }],
              },
            },
          ],
          usageMetadata: lastPayload.response?.usageMetadata,
        },
      };
    }

    return lastPayload;
  }
}
