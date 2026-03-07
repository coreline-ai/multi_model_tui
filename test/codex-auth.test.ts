import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCodexRefreshParams,
  parseCodexAuthPayload,
  shouldRefreshCodexToken,
} from "../src/auth/codex.js";

test("parses codex cli auth.json payload", () => {
  const parsed = parseCodexAuthPayload("/tmp/auth.json", {
    auth_mode: "chatgpt",
    tokens: {
      id_token: "header.payload.signature",
      access_token:
        "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE5MDAwMDAwMDAsImh0dHBzOi8vYXBpLm9wZW5haS5jb20vYXV0aCI6eyJjaGF0Z3B0X2FjY291bnRfaWQiOiJhYmMifX0.signature",
      refresh_token: "refresh",
      account_id: "account",
    },
  });

  assert.equal(parsed?.sourceFormat, "codex-cli");
  assert.equal(parsed?.accessToken.includes("eyJ"), true);
  assert.equal(parsed?.refreshToken, "refresh");
  assert.equal(parsed?.accountId, "account");
});

test("parses proxy tokens payload", () => {
  const parsed = parseCodexAuthPayload("/tmp/tokens.json", {
    access_token: "access",
    refresh_token: "refresh",
    expires_at: 123,
    chatgpt_account_id: "account",
  });

  assert.equal(parsed?.sourceFormat, "proxy");
  assert.equal(parsed?.expiresAt, 123);
  assert.equal(parsed?.accountId, "account");
});

test("detects refresh window", () => {
  assert.equal(shouldRefreshCodexToken({ expiresAt: 1_000 }, 1_000), true);
  assert.equal(shouldRefreshCodexToken({ expiresAt: 10 * 60 * 1000 }, 1_000), false);
});

test("builds refresh form body", () => {
  const params = buildCodexRefreshParams("refresh-token");
  assert.equal(params.get("grant_type"), "refresh_token");
  assert.equal(params.get("refresh_token"), "refresh-token");
  assert.ok(params.get("client_id"));
});
