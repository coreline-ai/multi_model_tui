import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.js";
import { createProxyServer } from "../../src/proxy/server.js";
import { ensureMessages, extractTextFromParts } from "../../src/shared/normalized.js";
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderCapabilityReport,
  ProviderStatus,
  UnifiedChunk,
  UnifiedRequest,
  UnifiedResponse,
} from "../../src/types.js";

class MockAdapter implements ProviderAdapter {
  readonly provider;
  constructor(provider: "codex" | "claude" | "gemini") {
    this.provider = provider;
  }

  async getStatus(): Promise<ProviderStatus> {
    return {
      provider: this.provider,
      availability: "healthy",
      primaryTransport: "mock",
      fallbackTransport: null,
      reason: null,
    };
  }

  async getCapabilities(): Promise<ProviderCapabilityReport> {
    const capability: ProviderCapabilities = {
      provider: this.provider,
      transport: "mock",
      features: {
        messages: { platform: "full", transport: "full", effective: "full" },
        systemInstruction: { platform: "full", transport: "full", effective: "full" },
        streaming: { platform: "full", transport: "full", effective: "full" },
        usage: { platform: "full", transport: "full", effective: "full" },
        toolCalling: { platform: "full", transport: "full", effective: "full" },
        hostedTools: { platform: "full", transport: "full", effective: "full" },
        imageInput: { platform: "full", transport: "full", effective: "full" },
        fileInput: { platform: "full", transport: "full", effective: "full" },
        structuredOutput: { platform: "full", transport: "full", effective: "full" },
        reasoning: { platform: "full", transport: "full", effective: "full" },
        citations: { platform: "full", transport: "full", effective: "full" },
        caching: { platform: "full", transport: "full", effective: "full" },
        stateContinuation: { platform: "full", transport: "full", effective: "full" },
      },
    };

    return {
      provider: this.provider,
      availability: "healthy",
      selectedTransport: "mock",
      transports: [capability],
    };
  }

  async execute(req: UnifiedRequest): Promise<UnifiedResponse> {
    const prompt =
      req.prompt ?? ensureMessages(req).map((message) => extractTextFromParts(message.parts)).filter(Boolean).join("\n");
    return {
      provider: this.provider,
      ok: true,
      model: req.model ?? `${this.provider}-model`,
      transport: "mock",
      elapsedMs: 1,
      text: `${this.provider}:${prompt}`,
      parts: [{ type: "text", text: `${this.provider}:${prompt}` }],
      finishReason: "stop",
    };
  }

  async *stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk> {
    const prompt =
      req.prompt ?? ensureMessages(req).map((message) => extractTextFromParts(message.parts)).filter(Boolean).join("\n");
    yield { provider: this.provider, type: "start", model: req.model, transport: "mock" };
    if (prompt.includes("tool-stream")) {
      yield {
        provider: this.provider,
        type: "meta",
        model: req.model,
        transport: "mock",
        part: { type: "tool_call", id: "call_1", name: "lookup", argumentsJson: "{\"q\":\"hello\"}" },
      };
      yield {
        provider: this.provider,
        type: "end",
        model: req.model,
        transport: "mock",
        done: true,
        finishReason: "tool_call",
      };
      return;
    }
    yield { provider: this.provider, type: "delta", model: req.model, transport: "mock", text: prompt };
    yield { provider: this.provider, type: "end", model: req.model, transport: "mock", done: true };
  }
}

async function withServer(
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const config = { ...loadConfig(), proxyPort: 0 };
  const server = createProxyServer(config, {
    codex: new MockAdapter("codex"),
    claude: new MockAdapter("claude"),
    gemini: new MockAdapter("gemini"),
  });

  const handle = await new Promise<import("node:http").Server>((resolve) => {
    const httpServer = server.app.listen(0, "127.0.0.1", () => resolve(httpServer));
  });

  const address = handle.address();
  if (!address || typeof address === "string") {
    throw new Error("missing address");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => handle.close((error) => (error ? reject(error) : resolve())));
  }
}

test("health and provider routes respond", async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const providers = await fetch(`${baseUrl}/api/v1/providers`).then((response) => response.json());
    assert.equal(providers.providers.length, 3);
    assert.equal(providers.providers[0].primaryTransport, "mock");
  });
});

test("chat and batch routes use unified router", async () => {
  await withServer(async (baseUrl) => {
    const chat = await fetch(`${baseUrl}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "codex", prompt: "hello" }),
    }).then((response) => response.json());

    assert.equal(chat.text, "codex:hello");
    assert.equal(chat.transport, "mock");

    const batch = await fetch(`${baseUrl}/api/v1/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: ["codex", "claude"], prompt: "hi" }),
    }).then((response) => response.json());

    assert.equal(batch.results.length, 2);
    assert.equal(batch.results[0].provider, "codex");
    assert.equal(batch.results[1].provider, "claude");
  });
});

test("v2 capability and rich chat routes respond", async () => {
  await withServer(async (baseUrl) => {
    const capabilities = await fetch(`${baseUrl}/api/v2/capabilities`).then((response) => response.json());
    assert.equal(capabilities.providers.length, 3);
    assert.equal(capabilities.providers[0].transports[0].features.messages.effective, "full");

    const chat = await fetch(`${baseUrl}/api/v2/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude",
        messages: [{ role: "user", parts: [{ type: "text", text: "hello rich" }] }],
        responseFormat: { type: "json_object" },
      }),
    }).then((response) => response.json());

    assert.equal(chat.text, "claude:hello rich");
    assert.equal(chat.parts[0].text, "claude:hello rich");
  });
});

test("v2 chat returns human input payload for interactive hosted tools", async () => {
  await withServer(async (baseUrl) => {
    const chat = await fetch(`${baseUrl}/api/v2/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude",
        messages: [{ role: "user", parts: [{ type: "text", text: "click approve" }] }],
        hostedTools: [{ type: "computer_use" }],
        humanInputMode: "return",
      }),
    }).then((response) => response.json());

    assert.equal(chat.ok, false);
    assert.equal(chat.error.code, "human_input_required");
    assert.equal(chat.humanInput.toolType, "computer_use");
  });
});

test("compatibility streaming surfaces tool events", async () => {
  await withServer(async (baseUrl) => {
    const anthropic = await fetch(`${baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        stream: true,
        messages: [{ role: "user", content: "tool-stream" }],
      }),
    }).then((response) => response.text());

    assert.match(anthropic, /tool_use/);
    assert.match(anthropic, /input_json_delta/);

    const openai = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5",
        stream: true,
        messages: [{ role: "user", content: "tool-stream" }],
      }),
    }).then((response) => response.text());

    assert.match(openai, /response\.output_item\.added/);
    assert.match(openai, /function_call/);
  });
});
