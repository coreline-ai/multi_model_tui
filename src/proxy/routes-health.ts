import type { Express, Request, Response } from "express";
import type { AppConfig, HealthResponse } from "../types.js";

export function registerHealthRoutes(app: Express, config: AppConfig): void {
  app.get("/api/v1/health", (_req: Request, res: Response<HealthResponse>) => {
    res.json({
      ok: true,
      proxy: {
        host: config.proxyHost,
        port: config.proxyPort,
        version: "0.1.0",
      },
    });
  });
}
