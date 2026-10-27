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
