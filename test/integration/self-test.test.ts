import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.js";
import { createProxyServer } from "../../src/proxy/server.js";
import type {
    ProviderAdapter,
    ProviderCapabilityReport,
    ProviderStatus,
    UnifiedRequest,
    UnifiedResponse,
} from "../../src/types.js";

// Mock Adapter specifically for Self-Test
class SelfTestMockAdapter implements ProviderAdapter {
    readonly provider;
    constructor(provider: "codex" | "claude" | "gemini") {
        this.provider = provider;
    }

    async getStatus(): Promise<ProviderStatus> {
        return { provider: this.provider, availability: "healthy", primaryTransport: "mock", fallbackTransport: null, reason: null };
    }

    async getCapabilities(): Promise<ProviderCapabilityReport> {
        return { provider: this.provider, availability: "healthy", selectedTransport: "mock", transports: [] };
    }

    async execute(req: UnifiedRequest): Promise<UnifiedResponse> {
        // Self-test prompt: "reply with exactly: {provider} ok"
        const isSelfTest = req.prompt?.includes("reply with exactly:");
        const text = isSelfTest ? `${this.provider} ok` : "normal response";

        return {
            provider: this.provider,
            ok: true,
            model: "mock-model",
            transport: "mock",
            elapsedMs: 1,
            text,
            parts: [{ type: "text", text }],
            finishReason: "stop",
        };
    }

    async *stream(_req: UnifiedRequest): AsyncGenerator<any> {
        yield { provider: this.provider, type: "start", model: "mock", transport: "mock" };
        yield { provider: this.provider, type: "end", model: "mock", transport: "mock", done: true };
    }
}

async function withSelfTestServer(
    run: (baseUrl: string) => Promise<void>
): Promise<void> {
    const config = { ...loadConfig(), proxyPort: 0 };
    const server = createProxyServer(config, {
        codex: new SelfTestMockAdapter("codex"),
        claude: new SelfTestMockAdapter("claude"),
        gemini: new SelfTestMockAdapter("gemini"),
    });

    const handle = await new Promise<import("node:http").Server>((resolve) => {
        const httpServer = server.app.listen(0, "127.0.0.1", () => resolve(httpServer));
    });

    const address = handle.address();
    if (!address || typeof address === "string") throw new Error("missing address");

    try {
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => handle.close((error) => (error ? reject(error) : resolve())));
    }
}

test("POST /api/v1/self-test returns success for all mock providers", async () => {
    await withSelfTestServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/self-test`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providers: ["codex", "claude", "gemini"] }),
        });

        assert.equal(response.status, 200);
        const data = await response.json();

        assert.equal(data.results.length, 3);
        data.results.forEach((res: any) => {
            assert.equal(res.ok, true, `Provider ${res.provider} should be ok`);
            assert.equal(res.actual, `${res.provider} ok`);
        });
    });
});

test("POST /api/v1/self-test handles partial failure", async () => {
    // Failing adapter
    class FailingAdapter extends SelfTestMockAdapter {
        async execute(_req: UnifiedRequest): Promise<UnifiedResponse> {
            return {
                provider: this.provider,
                ok: false,
                model: "mock",
                transport: "mock",
                elapsedMs: 1,
                text: "error",
                error: { code: "provider_error", message: "failed", transport: "mock" },
                finishReason: "error"
            };
        }
    }

    const config = { ...loadConfig(), proxyPort: 0 };
    const server = createProxyServer(config, {
        codex: new SelfTestMockAdapter("codex"),
        claude: new FailingAdapter("claude"),
        gemini: new SelfTestMockAdapter("gemini"),
    });

    const handle = await new Promise<import("node:http").Server>((resolve) => {
        const httpServer = server.app.listen(0, "127.0.0.1", () => resolve(httpServer));
    });
    const address = handle.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        const response = await fetch(`${baseUrl}/api/v1/self-test`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providers: ["codex", "claude"] }),
        });
        const data = await response.json();

        const codex = data.results.find((r: any) => r.provider === "codex");
        const claude = data.results.find((r: any) => r.provider === "claude");

        assert.equal(codex.ok, true);
        assert.equal(claude.ok, false);
        assert.equal(claude.error.code, "provider_error");
    } finally {
        handle.close();
    }
});
