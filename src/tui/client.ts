import type {
  AppConfig,
  BatchResponse,
  CapabilitiesResponse,
  ChatResponse,
  HealthResponse,
  LocalProxyClient,
  ProvidersResponse,
  SelfTestRequest,
  SelfTestResponse,
  UnifiedBatchRequest,
  UnifiedRequest,
  UnifiedResponse,
} from "../types.js";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `request failed: http ${response.status}`);
  }
  return (await response.json()) as T;
}

export function createLocalProxyClient(config: AppConfig): LocalProxyClient {
  const baseUrl = `http://${config.proxyHost}:${config.proxyPort}`;

  return {
    async getHealth(): Promise<HealthResponse> {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      return readJson<HealthResponse>(response);
    },
    async getProviders(): Promise<ProvidersResponse> {
      const response = await fetch(`${baseUrl}/api/v1/providers`);
      return readJson<ProvidersResponse>(response);
    },
    async getCapabilities(): Promise<CapabilitiesResponse> {
      const response = await fetch(`${baseUrl}/api/v2/capabilities`);
      return readJson<CapabilitiesResponse>(response);
    },
    async chat(req: UnifiedRequest): Promise<ChatResponse> {
      const response = await fetch(`${baseUrl}/api/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      return readJson<ChatResponse>(response);
    },
    async chatV2(req: UnifiedRequest): Promise<UnifiedResponse> {
      const response = await fetch(`${baseUrl}/api/v2/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      return readJson(response);
    },
    async batch(req: UnifiedBatchRequest): Promise<BatchResponse> {
      const response = await fetch(`${baseUrl}/api/v1/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      return readJson<BatchResponse>(response);
    },
    async batchV2(req: UnifiedBatchRequest): Promise<{ results: UnifiedResponse[] }> {
      const response = await fetch(`${baseUrl}/api/v2/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      return readJson(response);
    },
    async selfTest(req: SelfTestRequest): Promise<SelfTestResponse> {
      const response = await fetch(`${baseUrl}/api/v1/self-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      return readJson<SelfTestResponse>(response);
    },
  };
}
