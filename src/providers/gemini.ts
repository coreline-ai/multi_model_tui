import type { OAuth2Client } from "google-auth-library";
import type { AppConfig, AuthStatus } from "../types.js";
import { createGeminiAuthClient } from "../auth/gemini.js";
import { BaseProvider, HttpStatusError } from "./base.js";
import { parseSseEvents, readResponseBody } from "../utils/http.js";
import { commandExists, extractJsonPayload, runCliCommand } from "../utils/cli.js";

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_VERSION = "v1internal";
const GEMINI_SERVICE_NAME = "cloudaicompanion.googleapis.com";

type ServiceUsageState = "STATE_UNSPECIFIED" | "DISABLED" | "ENABLED";

type ProjectDiscoveryResponse = {
  cloudaicompanionProject?: string | { id?: string };
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
  currentTier?: {
    id?: string;
    userDefinedCloudaicompanionProject?: boolean;
  };
  projectValidationError?: {
    message?: string;
  };
};

type CloudProjectsResponse = {
  projects?: Array<{ projectId?: string; lifecycleState?: string; name?: string }>;
};

type OnboardUserResponse = {
  done?: boolean;
  response?: { cloudaicompanionProject?: { id?: string } };
};

type GeminiStreamResponse = {
  response?: {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string; thought?: boolean }>;
      };
    }>;
  };
};

type ServiceUsageResponse = {
  state?: ServiceUsageState;
};

type GeminiCliResponse = {
  response?: string;
};

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

export class GeminiProvider extends BaseProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private projectIdCache: string | null = null;

  constructor(private readonly config: AppConfig) {
    super();
    this.model = config.geminiModel;
  }

  async checkAuth(): Promise<AuthStatus> {
    try {
      const client = await createGeminiAuthClient(this.config.geminiAuthPath);
      await this.discoverProjectId(client);
      return { ok: true, detail: "ok" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (await commandExists("gemini")) {
        return { ok: true, detail: "ok" };
      }
      if (message.includes("disabled for accessible projects") || message.includes("API disabled for project")) {
        return { ok: false, detail: "api-disabled" };
      }
      if (message.includes("missing Gemini project")) {
        return { ok: false, detail: "missing-project" };
      }
      return { ok: false, detail: "missing-auth" };
    }
  }

  protected async runPrompt(prompt: string): Promise<string> {
    try {
      const client = await createGeminiAuthClient(this.config.geminiAuthPath);
      const projectId = await this.discoverProjectId(client);
      return await this.generateText(client, projectId, prompt);
    } catch (error) {
      if (error instanceof HttpStatusError || error instanceof Error) {
        return this.runGeminiCli(prompt);
      }
      throw error;
    }
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
      throw new Error(
        `Gemini API disabled for project ${discovered}: enable ${buildGeminiActivationUrl(discovered)}`
      );
    }

    const accessibleProjects = await this.listAccessibleProjectIds(token);
    const disabledProjects: string[] = [];

    for (const projectId of accessibleProjects) {
      const response = await this.loadCodeAssist(token, projectId);
      const candidateProjectId = extractProjectId(response) ?? projectId;
      if (response.projectValidationError) {
        continue;
      }

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
      throw new HttpStatusError(
        "gemini list projects failed",
        response.status,
        await readResponseBody(response)
      );
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      }
    );

    if (!response.ok) {
      throw new HttpStatusError(
        "gemini serviceusage lookup failed",
        response.status,
        await readResponseBody(response)
      );
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
        throw new HttpStatusError(
          "gemini onboardUser failed",
          onboardResponse.status,
          await readResponseBody(onboardResponse)
        );
      }

      const onboardData = (await onboardResponse.json()) as OnboardUserResponse;
      if (onboardData.done) {
        return onboardData.response?.cloudaicompanionProject?.id ?? initialProject;
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error("Could not discover project ID.");
  }

  private async generateText(client: OAuth2Client, projectId: string, prompt: string): Promise<string> {
    const token = await getGeminiAccessToken(client);
    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_VERSION}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: this.model,
        project: projectId,
        request: {
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 1,
          },
        },
      }),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("gemini request failed", response.status, await readResponseBody(response));
    }

    if (!response.body) {
      throw new Error("invalid provider response");
    }

    let text = "";

    for await (const event of parseSseEvents(response.body)) {
      let parsed: GeminiStreamResponse;
      try {
        parsed = JSON.parse(event.data) as GeminiStreamResponse;
      } catch {
        continue;
      }

      const parts = parsed.response?.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.thought) continue;
        if (typeof part.text === "string") {
          text += part.text;
        }
      }
    }

    return text;
  }

  private async runGeminiCli(prompt: string): Promise<string> {
    const { stdout } = await runCliCommand(
      "gemini",
      ["-p", prompt, "-o", "json"],
      this.config.requestTimeoutMs,
      process.cwd()
    );

    const payload = extractJsonPayload<GeminiCliResponse>(stdout);
    if (!payload?.response) {
      throw new Error("invalid provider response");
    }

    return payload.response;
  }
}
