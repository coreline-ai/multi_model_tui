import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Credentials, OAuth2Client } from "google-auth-library";

export const GEMINI_OAUTH_CLIENT_ID =
  process.env.GEMINI_OAUTH_CLIENT_ID ?? "";
export const GEMINI_OAUTH_CLIENT_SECRET =
  process.env.GEMINI_OAUTH_CLIENT_SECRET ?? "";

export interface GeminiStoredCredentials extends Credentials {
  expiry_date?: number | null;
}

export function parseGeminiCredentials(raw: unknown): GeminiStoredCredentials | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const credentials = raw as GeminiStoredCredentials;
  if (!credentials.refresh_token && !credentials.access_token) {
    return null;
  }

  return credentials;
}

export function isGeminiCredentialExpired(
  credentials: Pick<GeminiStoredCredentials, "expiry_date">,
  now = Date.now()
): boolean {
  if (!credentials.expiry_date) return false;
  return now >= credentials.expiry_date - 5 * 60 * 1000;
}

export function mergeGeminiCredentials(
  current: GeminiStoredCredentials,
  updated: GeminiStoredCredentials
): GeminiStoredCredentials {
  return {
    ...current,
    ...updated,
    refresh_token: updated.refresh_token ?? current.refresh_token,
    access_token: updated.access_token ?? current.access_token,
    expiry_date: updated.expiry_date ?? current.expiry_date,
    scope: updated.scope ?? current.scope,
    token_type: updated.token_type ?? current.token_type,
    id_token: updated.id_token ?? current.id_token,
  };
}

async function persistGeminiCredentials(authPath: string, credentials: GeminiStoredCredentials): Promise<void> {
  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(authPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
}

export async function loadGeminiCredentials(authPath: string): Promise<GeminiStoredCredentials | null> {
  if (!existsSync(authPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(await readFile(authPath, "utf-8")) as unknown;
    return parseGeminiCredentials(raw);
  } catch {
    return null;
  }
}

export async function createGeminiAuthClient(authPath: string): Promise<OAuth2Client> {
  const cached = await loadGeminiCredentials(authPath);
  if (!cached) {
    throw new Error("missing gemini oauth credentials");
  }

  const client = new OAuth2Client({
    clientId: GEMINI_OAUTH_CLIENT_ID,
    clientSecret: GEMINI_OAUTH_CLIENT_SECRET,
  });

  client.setCredentials(cached);
  client.on("tokens", async (tokens: Credentials) => {
    const merged = mergeGeminiCredentials(cached, tokens);
    await persistGeminiCredentials(authPath, merged);
  });

  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error("missing gemini oauth credentials");
  }

  await persistGeminiCredentials(authPath, mergeGeminiCredentials(cached, client.credentials));
  return client;
}
