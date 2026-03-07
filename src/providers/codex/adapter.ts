import type { AppConfig, ProviderAdapter, ProviderStatus, UnifiedChunk, UnifiedRequest, UnifiedResponse } from "../../types.js";
import { CodexDirectTransport } from "./transport-direct.js";
import { mergeCapabilities } from "../../shared/capabilities.js";

export class CodexAdapter implements ProviderAdapter {
  readonly provider = "codex" as const;
  private readonly transport: CodexDirectTransport;

  constructor(config: AppConfig) {
    this.transport = new CodexDirectTransport(config);
  }

  async getStatus(): Promise<ProviderStatus> {
    const availability = await this.transport.checkAvailability();
    return {
      provider: this.provider,
      availability: availability.ok ? "healthy" : "unavailable",
      primaryTransport: availability.ok ? this.transport.name : null,
      fallbackTransport: null,
      reason: availability.ok ? null : availability.reason ?? "transport unavailable",
    };
  }

  async getCapabilities() {
    return mergeCapabilities(await this.getStatus(), [this.transport.getCapabilities()]);
  }

  execute(req: UnifiedRequest): Promise<UnifiedResponse> {
    return this.transport.execute(req);
  }

  stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk> {
    return this.transport.stream(req);
  }
}
