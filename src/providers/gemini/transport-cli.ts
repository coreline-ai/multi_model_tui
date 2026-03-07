import type { AppConfig, ProviderCapabilities, ProviderTransport, UnifiedChunk, UnifiedRequest, UnifiedResponse } from "../../types.js";
import { commandExists, extractJsonPayload, runCliCommand } from "../../shared/cli.js";
import { elapsedMs, nowMs } from "../../shared/time.js";
import { assertTransportSupportsRequest } from "../../shared/capabilities.js";
import { collapseMessagesToPrompt, ensureMessages, makeTextResponseParts } from "../../shared/normalized.js";
import type { GeminiCliResponse } from "./types.js";

export class GeminiCliTransport implements ProviderTransport {
  readonly provider = "gemini" as const;
  readonly name = "cli";

  constructor(private readonly config: AppConfig) {}

  getCapabilities(): ProviderCapabilities {
    return {
      provider: this.provider,
      model: this.config.geminiModel,
      transport: this.name,
      features: {
        messages: { platform: "full", transport: "full", effective: "full" },
        systemInstruction: { platform: "full", transport: "partial", effective: "partial" },
        streaming: { platform: "full", transport: "partial", effective: "partial" },
        usage: { platform: "full", transport: "none", effective: "none" },
        toolCalling: { platform: "full", transport: "none", effective: "none" },
        hostedTools: { platform: "full", transport: "none", effective: "none" },
        imageInput: { platform: "full", transport: "none", effective: "none" },
        fileInput: { platform: "full", transport: "none", effective: "none" },
        structuredOutput: { platform: "full", transport: "none", effective: "none" },
        reasoning: { platform: "full", transport: "none", effective: "none" },
        citations: { platform: "full", transport: "none", effective: "none" },
        caching: { platform: "full", transport: "none", effective: "none" },
        stateContinuation: { platform: "partial", transport: "none", effective: "none" },
      },
    };
  }

  async checkAvailability(): Promise<{ ok: boolean; reason?: string }> {
    return (await commandExists("gemini")) ? { ok: true } : { ok: false, reason: "gemini CLI not found" };
  }

  async execute(req: UnifiedRequest): Promise<UnifiedResponse> {
    assertTransportSupportsRequest(req, this.getCapabilities());
    const startedAt = nowMs();
    const model = req.model ?? this.config.geminiModel;
    const prompt = req.prompt?.trim() || collapseMessagesToPrompt(ensureMessages(req), req.system);
    const { stdout } = await runCliCommand(
      "gemini",
      ["-p", prompt, "-o", "json"],
      req.timeoutMs ?? this.config.requestTimeoutMs,
      process.cwd()
    );

    const payload = extractJsonPayload<GeminiCliResponse>(stdout);
    if (!payload?.response) {
      throw new Error("invalid provider response");
    }

    return {
      provider: this.provider,
      ok: true,
      model,
      transport: this.name,
      elapsedMs: elapsedMs(startedAt),
      text: payload.response,
      parts: makeTextResponseParts(payload.response),
      finishReason: "stop",
    };
  }

  async *stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk> {
    const response = await this.execute(req);
    yield { provider: this.provider, type: "start", model: response.model, transport: this.name };
    if (response.text) {
      yield {
        provider: this.provider,
        type: "delta",
        model: response.model,
        transport: this.name,
        text: response.text,
      };
    }
    yield { provider: this.provider, type: "end", model: response.model, transport: this.name, done: true };
  }
}
