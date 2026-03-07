import express, { type Express } from "express";
import type { AppConfig, ProviderAdapter } from "../types.js";
import { createLogger } from "../shared/logger.js";
import { registerHealthRoutes } from "./routes-health.js";
import { registerUnifiedRoutes } from "./routes-unified.js";
import { registerAnthropicRoutes } from "./routes-anthropic.js";
import { registerOpenAiRoutes } from "./routes-openai.js";
import { createProviderAdapters, createProxyRouter, type ProxyRouter } from "./router.js";

export interface ProxyServer {
  app: Express;
  proxyRouter: ProxyRouter;
  listen(): Promise<{ close(): Promise<void> }>;
}

export function createProxyServer(
  config: AppConfig,
  adapters: Record<string, ProviderAdapter> | null = null
): ProxyServer {
  const app = express();
  const logger = createLogger(config.proxyLogLevel);
  const resolvedAdapters = (adapters ?? createProviderAdapters(config)) as Record<
    "codex" | "claude" | "gemini",
    ProviderAdapter
  >;
  const proxyRouter = createProxyRouter(resolvedAdapters);

  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    logger.info("request", { method: req.method, path: req.path });
    next();
  });

  registerHealthRoutes(app, config);
  registerUnifiedRoutes(app, proxyRouter);
  registerAnthropicRoutes(app, proxyRouter);
  registerOpenAiRoutes(app, proxyRouter);

  app.use((req, res) => {
    res.status(404).json({
      error: {
        message: `route not found: ${req.path}`,
      },
    });
  });

  return {
    app,
    proxyRouter,
    listen(): Promise<{ close(): Promise<void> }> {
      return new Promise((resolve, reject) => {
        const server = app.listen(config.proxyPort, config.proxyHost, () => {
          logger.info("listening", { host: config.proxyHost, port: config.proxyPort });
          resolve({
            close: () =>
              new Promise<void>((closeResolve, closeReject) => {
                server.close((error) => {
                  if (error) {
                    closeReject(error);
                    return;
                  }
                  closeResolve();
                });
              }),
          });
        });

        server.on("error", reject);
      });
    },
  };
}
