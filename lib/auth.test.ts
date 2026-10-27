import assert from "node:assert/strict";
import { test } from "node:test";
import { signSessionToken, verifySessionToken, timingSafeEqualString } from "./auth";
import { AppConfigError } from "./types";
import { getSupabaseAdmin } from "./supabase";

test("signSessionToken and verifySessionToken round-trip", async () => {
  const secret = "test-secret-min-8-chars";
  const token = await signSessionToken(secret);
  assert.ok(token.length > 20);

  const isValid = await verifySessionToken(token, secret);
  assert.strictEqual(isValid, true);

  const isInvalidSecret = await verifySessionToken(token, "wrong-secret-8-chars");
  assert.strictEqual(isInvalidSecret, false);

  const tampered = token.slice(0, -4) + "0000";
  const isInvalidToken = await verifySessionToken(tampered, secret);
  assert.strictEqual(isInvalidToken, false);
});

test("verifySessionToken rejects expired tokens", async () => {
  const secret = "test-secret-min-8-chars";
  // Expired 1 second ago
  const expiredToken = await signSessionToken(secret, Date.now() - 1000);
  const isValid = await verifySessionToken(expiredToken, secret);
  assert.strictEqual(isValid, false);
});

test("timingSafeEqualString correctly compares strings", () => {
  assert.strictEqual(timingSafeEqualString("hello", "hello"), true);
  assert.strictEqual(timingSafeEqualString("hello", "world"), false);
  assert.strictEqual(timingSafeEqualString("hello", "hell"), false);
});

test("getSupabaseAdmin throws AppConfigError when env is missing", () => {
  const origUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;

  assert.throws(
    () => getSupabaseAdmin(),
    (err: unknown) => {
      assert.ok(err instanceof AppConfigError);
      assert.strictEqual(err.code, "missing_supabase_env");
      return true;
    }
  );

  if (origUrl) process.env.SUPABASE_URL = origUrl;
});

const SUPABASE_ENV_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

function withSupabaseEnv(env: Partial<Record<(typeof SUPABASE_ENV_KEYS)[number], string>>, fn: () => void) {
  const saved = new Map<string, string | undefined>();
  for (const key of SUPABASE_ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function assertConfigError(code: string) {
  return (err: unknown) => {
    assert.ok(err instanceof AppConfigError);
    assert.strictEqual(err.code, code);
    return true;
  };
}

test("getSupabaseAdmin refuses public anon/publishable keys as the admin key", () => {
  withSupabaseEnv(
    {
      SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    },
    () => assert.throws(() => getSupabaseAdmin(), assertConfigError("missing_supabase_env")),
  );
});

test("getSupabaseAdmin refuses a NEXT_PUBLIC_ service-role key", () => {
  withSupabaseEnv(
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "server-key",
      NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "leaked-key",
    },
    () => assert.throws(() => getSupabaseAdmin(), assertConfigError("public_service_role_key")),
  );
});
