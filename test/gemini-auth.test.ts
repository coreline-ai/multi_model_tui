import test from "node:test";
import assert from "node:assert/strict";
import {
  isGeminiCredentialExpired,
  mergeGeminiCredentials,
  parseGeminiCredentials,
} from "../src/auth/gemini.js";

test("parses oauth_creds payload", () => {
  const parsed = parseGeminiCredentials({
    access_token: "access",
    refresh_token: "refresh",
    expiry_date: 123,
  });

  assert.equal(parsed?.access_token, "access");
  assert.equal(parsed?.refresh_token, "refresh");
  assert.equal(parsed?.expiry_date, 123);
});

test("detects expired credential", () => {
  assert.equal(isGeminiCredentialExpired({ expiry_date: 1_000 }, 1_000), true);
  assert.equal(isGeminiCredentialExpired({ expiry_date: 10 * 60 * 1000 }, 1_000), false);
});

test("merges refreshed credentials without losing refresh token", () => {
  const merged = mergeGeminiCredentials(
    {
      access_token: "old-access",
      refresh_token: "keep-me",
      expiry_date: 1_000,
    },
    {
      access_token: "new-access",
      expiry_date: 2_000,
    }
  );

  assert.equal(merged.access_token, "new-access");
  assert.equal(merged.refresh_token, "keep-me");
  assert.equal(merged.expiry_date, 2_000);
});
