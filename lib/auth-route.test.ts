import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { NextRequest } from "next/server";
import { POST } from "../app/api/auth/route";
import { LoginLimiter } from "./login-limiter";

test("invalid usernames never seed account limiter keys", async () => {
  const globals = globalThis as typeof globalThis & { __neiroLoginLimiter?: LoginLimiter };
  const savedLimiter = globals.__neiroLoginLimiter;
  const savedSecret = process.env.DASHBOARD_SECRET;
  const savedHops = process.env.NEIRO_TRUSTED_PROXY_HOPS;
  const savedWarn = console.warn;
  process.env.DASHBOARD_SECRET = "auth-route-test-secret";
  process.env.NEIRO_TRUSTED_PROXY_HOPS = "";
  globals.__neiroLoginLimiter = new LoginLimiter(Date.now, 1);
  console.warn = () => {};
  try {
    const response = await POST(new NextRequest("http://localhost/api/auth", {
      method: "POST", body: JSON.stringify({ username: "x", password: "wrong-password" }),
    }));
    assert.equal(response.status, 401);
    assert.equal(globals.__neiroLoginLimiter.check(["user:x"]).ok, true);
    assert.equal(globals.__neiroLoginLimiter.check(["ip:local"]).ok, false);
  } finally {
    globals.__neiroLoginLimiter = savedLimiter;
    console.warn = savedWarn;
    if (savedSecret === undefined) delete process.env.DASHBOARD_SECRET;
    else process.env.DASHBOARD_SECRET = savedSecret;
    if (savedHops === undefined) delete process.env.NEIRO_TRUSTED_PROXY_HOPS;
    else process.env.NEIRO_TRUSTED_PROXY_HOPS = savedHops;
  }
});

test("rotating untrusted XFF cannot bypass owner lockout", async () => {
  const globals = globalThis as typeof globalThis & { __neiroLoginLimiter?: LoginLimiter };
  const savedLimiter = globals.__neiroLoginLimiter;
  const savedSecret = process.env.DASHBOARD_SECRET;
  const savedHops = process.env.NEIRO_TRUSTED_PROXY_HOPS;
  const savedWarn = console.warn;
  const logs: unknown[][] = [];
  process.env.DASHBOARD_SECRET = "auth-route-test-secret";
  process.env.NEIRO_TRUSTED_PROXY_HOPS = "";
  globals.__neiroLoginLimiter = new LoginLimiter(() => 0);
  console.warn = (...args: unknown[]) => { logs.push(args); };
  try {
    for (let i = 0; i < 6; i++) {
      const response = await POST(new NextRequest("http://localhost/api/auth", {
        method: "POST", headers: { "x-forwarded-for": `192.0.2.${i}` },
        body: JSON.stringify({ passcode: "private-wrong-passcode" }),
      }));
      assert.equal(response.status, i < 5 ? 401 : 429);
      if (i === 5) assert.equal(response.headers.get("Retry-After"), "900");
    }
    assert.equal(logs.length, 1);
    assert.doesNotMatch(inspect(logs), /private-wrong-passcode|auth-route-test-secret/);
    globals.__neiroLoginLimiter = new LoginLimiter();
    const success = await POST(new NextRequest("http://localhost/api/auth", {
      method: "POST", body: JSON.stringify({ passcode: process.env.DASHBOARD_SECRET }),
    }));
    assert.equal(success.status, 200);
    assert.equal(logs.length, 1);
  } finally {
    globals.__neiroLoginLimiter = savedLimiter;
    console.warn = savedWarn;
    if (savedSecret === undefined) delete process.env.DASHBOARD_SECRET;
    else process.env.DASHBOARD_SECRET = savedSecret;
    if (savedHops === undefined) delete process.env.NEIRO_TRUSTED_PROXY_HOPS;
    else process.env.NEIRO_TRUSTED_PROXY_HOPS = savedHops;
  }
});

test("login backend failures log the underlying error without credentials", async () => {
  const envKeys = ["DASHBOARD_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"] as const;
  const savedEnv = envKeys.map((key) => process.env[key]);
  const globals = globalThis as typeof globalThis & { __neiroLoginLimiter?: LoginLimiter };
  const savedLimiter = globals.__neiroLoginLimiter;
  const savedFetch = globalThis.fetch;
  const savedError = console.error;
  const logs: unknown[][] = [];
  process.env.DASHBOARD_SECRET = "auth-route-test-secret";
  process.env.SUPABASE_URL = "https://auth-test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  delete process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  globals.__neiroLoginLimiter = new LoginLimiter();
  // Replace only the external DB transport; exercise the real store and handler.
  globalThis.fetch = Object.assign(async () => Response.json({ message: "auth backend unavailable", code: "XX000" }, { status: 400 }), savedFetch);
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/auth", {
      method: "POST", body: JSON.stringify({ username: "valid-user", password: "private-password" }),
    }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Internal server error" });
    assert.equal(logs.length, 1);
    const detail = logs[0][1] as { event: string; error: Error };
    assert.equal(detail.event, "login_error");
    assert.equal(detail.error.message, "auth backend unavailable");
    assert.doesNotMatch(inspect(logs), /private-password|auth-route-test-secret|test-service-role/);
  } finally {
    globalThis.fetch = savedFetch;
    console.error = savedError;
    globals.__neiroLoginLimiter = savedLimiter;
    envKeys.forEach((key, i) => {
      if (savedEnv[i] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[i];
    });
  }
});
