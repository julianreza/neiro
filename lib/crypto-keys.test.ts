import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptAgentKey, encryptAgentKey } from "./crypto-keys";

test("agent keys use authenticated encryption with a fresh nonce and legacy plaintext remains readable", async () => {
  const previous = process.env.NEIRO_ENCRYPTION_KEY;
  process.env.NEIRO_ENCRYPTION_KEY = "test-key-for-neiro-only";
  try {
    const first = await encryptAgentKey("secret-value");
    const second = await encryptAgentKey("secret-value");
    assert.ok(first.startsWith("enc:v1:"));
    assert.notEqual(first, second);
    assert.ok(!first.includes("secret-value"));
    assert.equal(await decryptAgentKey(first), "secret-value");
    assert.equal(await decryptAgentKey("legacy-key"), "legacy-key");
    const parts = first.split(":");
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 1;
    parts[3] = bytes.toString("base64url");
    await assert.rejects(decryptAgentKey(parts.join(":")));
    process.env.NEIRO_ENCRYPTION_KEY = "different-key";
    await assert.rejects(decryptAgentKey(first));
  } finally {
    if (previous === undefined) delete process.env.NEIRO_ENCRYPTION_KEY;
    else process.env.NEIRO_ENCRYPTION_KEY = previous;
  }
});

test("agent key encryption falls back to DASHBOARD_SECRET", async () => {
  const previousKey = process.env.NEIRO_ENCRYPTION_KEY;
  const previousSecret = process.env.DASHBOARD_SECRET;
  delete process.env.NEIRO_ENCRYPTION_KEY;
  process.env.DASHBOARD_SECRET = "test-dashboard-secret";
  try {
    const encrypted = await encryptAgentKey("custom-api-key");
    assert.ok(encrypted.startsWith("enc:v1:"));
    assert.equal(await decryptAgentKey(encrypted), "custom-api-key");
  } finally {
    if (previousKey === undefined) delete process.env.NEIRO_ENCRYPTION_KEY; else process.env.NEIRO_ENCRYPTION_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.DASHBOARD_SECRET; else process.env.DASHBOARD_SECRET = previousSecret;
  }
});
