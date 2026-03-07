import type { Express, Request, Response } from "express";
import type { ProxyRouter } from "./router.js";
import { formatSseEvent } from "../shared/sse.js";
import {
  parseRichUnifiedBatchRequest,
  parseRichUnifiedRequest,
  parseSelfTestRequest,
  parseUnifiedBatchRequest,
  parseUnifiedRequest,
  toBatchResponse,
  toCapabilitiesResponse,
  toChatResponse,
  toRichBatchResponse,
} from "./contracts.js";

function sendError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({
    type: "error",
    error: {
      type: "invalid_request_error",
      message,
    },
  });
}

async function writeStream(
  res: Response,
  stream: AsyncGenerator<unknown>,
  eventName = "chunk"
): Promise<void> {
  for await (const chunk of stream) {
    res.write(formatSseEvent(eventName, chunk));
  }
}

export function registerUnifiedRoutes(app: Express, proxyRouter: ProxyRouter): void {
  app.get("/api/v1/providers", async (_req: Request, res: Response) => {
    res.json({ providers: await proxyRouter.getStatuses() });
  });

  app.get("/api/v2/capabilities", async (_req: Request, res: Response) => {
    res.json(toCapabilitiesResponse(await proxyRouter.getCapabilities()));
  });

  app.get("/api/v2/capabilities/:provider", async (req: Request, res: Response) => {
    const provider = req.params.provider;
    if (provider !== "codex" && provider !== "claude" && provider !== "gemini") {
      sendError(res, "provider is required");
      return;
    }
    res.json(toCapabilitiesResponse(await proxyRouter.getCapabilities(provider)));
  });

  app.post("/api/v1/chat", async (req: Request, res: Response) => {
    try {
      const result = await proxyRouter.execute(parseUnifiedRequest(req.body));
      res.json(toChatResponse(result));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/v2/chat", async (req: Request, res: Response) => {
    try {
      const result = await proxyRouter.execute(parseRichUnifiedRequest(req.body));
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/v1/batch", async (req: Request, res: Response) => {
    try {
      const result = await proxyRouter.batch(parseUnifiedBatchRequest(req.body));
      res.json(toBatchResponse(result));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/v2/batch", async (req: Request, res: Response) => {
    try {
      const result = await proxyRouter.batch(parseRichUnifiedBatchRequest(req.body));
      res.json(toRichBatchResponse(result));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/v1/self-test", async (req: Request, res: Response) => {
    try {
      res.json(await proxyRouter.selfTest(parseSelfTestRequest(req.body)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/v1/chat/stream", async (req: Request, res: Response) => {
    try {
      const parsed = parseUnifiedRequest(req.body);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      await writeStream(res, proxyRouter.stream({ ...parsed, stream: true }));
      res.write(formatSseEvent("done", { ok: true }));
      res.end();
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/v2/chat/stream", async (req: Request, res: Response) => {
    try {
      const parsed = parseRichUnifiedRequest(req.body);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      await writeStream(res, proxyRouter.stream({ ...parsed, stream: true }));
      res.write(formatSseEvent("done", { ok: true }));
      res.end();
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/v1/batch/stream", async (req: Request, res: Response) => {
    try {
      const parsed = parseUnifiedBatchRequest(req.body);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      await Promise.all(
        parsed.providers.map(async (provider) => {
          await writeStream(
            res,
            proxyRouter.stream({
              provider,
              prompt: parsed.prompt,
              messages: parsed.messages,
              stream: true,
              timeoutMs: parsed.timeoutMs,
              metadata: parsed.metadata,
              system: parsed.system,
              humanInputMode: parsed.humanInputMode,
            })
          );
        })
      );

      res.write(formatSseEvent("done", { ok: true }));
      res.end();
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/v2/batch/stream", async (req: Request, res: Response) => {
    try {
      const parsed = parseRichUnifiedBatchRequest(req.body);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      await Promise.all(
        parsed.providers.map(async (provider) => {
          await writeStream(
            res,
            proxyRouter.stream({
              provider,
              prompt: parsed.prompt,
              messages: parsed.messages,
              stream: true,
              timeoutMs: parsed.timeoutMs,
              metadata: parsed.metadata,
              system: parsed.system,
              maxTokens: parsed.maxTokens,
              maxOutputTokens: parsed.maxOutputTokens,
              temperature: parsed.temperature,
              tools: parsed.tools,
              hostedTools: parsed.hostedTools,
              toolChoice: parsed.toolChoice,
              responseFormat: parsed.responseFormat,
              state: parsed.state,
              capabilityPolicy: parsed.capabilityPolicy,
              humanInputMode: parsed.humanInputMode,
            })
          );
        })
      );

      res.write(formatSseEvent("done", { ok: true }));
      res.end();
    } catch (error) {
      sendError(res, error);
    }
  });
}
