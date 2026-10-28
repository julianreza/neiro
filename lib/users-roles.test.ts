import assert from "node:assert/strict";
import { test } from "node:test";
import { OWNER_SESSION, readSessionToken, roleAllows, signSessionToken } from "./auth";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { LoginLimiter, clientAddress, limiterKeys } from "./login-limiter";
import { RoleCache } from "./role-cache";

const SECRET = "test-secret-min-8-chars";

test("session tokens carry the user and role", async () => {
  const token = await signSessionToken(SECRET, Date.now() + 60_000, { sub: "u1", role: "viewer" });
  assert.deepEqual(await readSessionToken(token, SECRET), { sub: "u1", role: "viewer" });
});

test("default session token is the owner admin", async () => {
  const token = await signSessionToken(SECRET);
  assert.deepEqual(await readSessionToken(token, SECRET), OWNER_SESSION);
});

test("editing the role in a token breaks its signature", async () => {
  const token = await signSessionToken(SECRET, Date.now() + 60_000, { sub: "u1", role: "viewer" });
  const [v, exp, , sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "u1", role: "admin" })).toString("base64url");
  assert.equal(await readSessionToken(`${v}.${exp}.${forged}.${sig}`, SECRET), null);
});

test("legacy exp.hmac tokens still work as the owner", async () => {
  const exp = String(Date.now() + 60_000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(exp))).toString("hex");
  assert.deepEqual(await readSessionToken(`${exp}.${sig}`, SECRET), OWNER_SESSION);
});

test("expired v2 tokens are refused", async () => {
  const token = await signSessionToken(SECRET, Date.now() - 1, { sub: "u1", role: "admin" });
  assert.equal(await readSessionToken(token, SECRET), null);
});

test("viewers may read and sign out, never write or manage users", () => {
  assert.equal(roleAllows("viewer", "GET", "/api/missions"), true);
  assert.equal(roleAllows("viewer", "POST", "/api/missions"), false);
  assert.equal(roleAllows("viewer", "PATCH", "/api/agents/x"), false);
  assert.equal(roleAllows("viewer", "DELETE", "/api/auth"), true);
  assert.equal(roleAllows("viewer", "GET", "/api/users"), false);
  assert.equal(roleAllows("viewer", "GET", "/api/users/abc"), false);
  assert.equal(roleAllows("admin", "DELETE", "/api/users/abc"), true);
});

test("passwords hash and verify, and wrong ones fail", async () => {
  const stored = await hashPassword("correct horse battery", 1_000);
  assert.match(stored, /^pbkdf2\$1000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("wrong horse battery", stored), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
  assert.notEqual(await hashPassword("same", 1_000), await hashPassword("same", 1_000));
});

test("passwordProblem enforces a minimum length", () => {
  assert.ok(passwordProblem("short"));
  assert.equal(passwordProblem("long enough pw"), null);
});

test("limiter locks a key after 5 failures and reports the wait", () => {
  let now = 1_000_000;
  const limiter = new LoginLimiter(() => now, 5, 60_000);
  const keys = limiterKeys("1.2.3.4", "Reza");
  for (let i = 0; i < 4; i++) limiter.recordFailure(keys);
  assert.deepEqual(limiter.check(keys), { ok: true });
  limiter.recordFailure(keys);
  assert.deepEqual(limiter.check(keys), { ok: false, retryAfterSec: 60 });
  // The username is locked from another IP too.
  assert.equal(limiter.check(limiterKeys("9.9.9.9", "reza")).ok, false);
  now += 60_000;
  assert.deepEqual(limiter.check(keys), { ok: true });
});

test("limiter forgets failures after a success and after the window", () => {
  let now = 0;
  const limiter = new LoginLimiter(() => now, 3, 1_000);
  const keys = limiterKeys("ip", null);
  limiter.recordFailure(keys);
  limiter.recordFailure(keys);
  limiter.recordSuccess(keys);
  limiter.recordFailure(keys);
  limiter.recordFailure(keys);
  assert.equal(limiter.check(keys).ok, true);
  now = 1_000;
  limiter.recordFailure(keys);
  assert.equal(limiter.check(keys).ok, true);
});

test("clientAddress prefers the first forwarded hop", () => {
  assert.equal(clientAddress(new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })), "5.6.7.8");
  assert.equal(clientAddress(new Headers({ "x-real-ip": "1.1.1.1" })), "1.1.1.1");
  assert.equal(clientAddress(new Headers()), "local");
});

test("role cache uses the current role, drops deleted users, fails closed", async () => {
  let now = 0;
  const roles = new Map<string, "admin" | "viewer">([["u1", "admin"]]);
  let lookups = 0;
  const cache = new RoleCache(async (id) => {
    lookups++;
    if (id === "boom") throw new Error("db down");
    return roles.get(id) ?? null;
  }, () => now, 1_000);

  assert.deepEqual(await cache.refresh({ sub: "u1", role: "viewer" }), { sub: "u1", role: "admin" });
  roles.set("u1", "viewer");
  assert.deepEqual(await cache.refresh({ sub: "u1", role: "admin" }), { sub: "u1", role: "admin" });
  assert.equal(lookups, 1);
  cache.forget("u1");
  assert.deepEqual(await cache.refresh({ sub: "u1", role: "admin" }), { sub: "u1", role: "viewer" });

  roles.delete("u1");
  now = 2_000;
  assert.equal(await cache.refresh({ sub: "u1", role: "viewer" }), null);
  assert.equal(await cache.refresh({ sub: "boom", role: "admin" }), null);
  assert.deepEqual(await cache.refresh(OWNER_SESSION), OWNER_SESSION);
});
