import type { AppConfig, ProviderAdapter, ProviderStatus, ProviderTransport, UnifiedChunk, UnifiedRequest, UnifiedResponse } from "../../types.js";
import { GeminiCodeAssistTransport } from "./transport-code-assist.js";
import { GeminiCliTransport } from "./transport-cli.js";
import { mergeCapabilities } from "../../shared/capabilities.js";

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "gemini" as const;
  private readonly transports: ProviderTransport[];

  constructor(config: AppConfig) {
    this.transports = [new GeminiCodeAssistTransport(config), new GeminiCliTransport(config)];
  }

  async getStatus(): Promise<ProviderStatus> {
    const [primary, fallback] = await Promise.all(this.transports.map((transport) => transport.checkAvailability()));
    if (primary?.ok) {
      return {
        provider: this.provider,
        availability: "healthy",
        primaryTransport: this.transports[0]?.name ?? null,
        fallbackTransport: fallback?.ok ? this.transports[1]?.name ?? null : null,
        reason: null,
      };
    }

    if (fallback?.ok) {
      return {
        provider: this.provider,
        availability: "degraded",
        primaryTransport: this.transports[1]?.name ?? null,
        fallbackTransport: null,
        reason: primary?.reason ?? "direct transport unavailable",
      };
    }

    return {
      provider: this.provider,
      availability: "unavailable",
      primaryTransport: null,
      fallbackTransport: null,
      reason: fallback?.reason ?? primary?.reason ?? "no transport available",
    };
  }

  async getCapabilities() {
    return mergeCapabilities(
      await this.getStatus(),
      this.transports.map((transport) => transport.getCapabilities())
    );
  }

  async execute(req: UnifiedRequest): Promise<UnifiedResponse> {
    let lastError: unknown;
    for (const transport of this.transports) {
      try {
        return await transport.execute(req);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async *stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk> {
    let lastError: unknown;
    for (const transport of this.transports) {
      let yielded = false;
      try {
        for await (const chunk of transport.stream(req)) {
          yielded = true;
          yield chunk;
        }
        return;
      } catch (error) {
        lastError = error;
        if (yielded) {
          throw error;
        }
      }
    }
    throw lastError;
  }
}
