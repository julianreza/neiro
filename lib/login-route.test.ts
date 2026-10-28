import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/auth/route";
import { limiterKeys, loginLimiter } from "./login-limiter";

test("passcode route returns 429 across rotating client IPs and keeps account login available", async () => {
  const savedSecret = process.env.DASHBOARD_SECRET;
  const savedHops = process.env.NEIRO_TRUSTED_PROXY_HOPS;
  process.env.DASHBOARD_SECRET = "test-owner-secret";
  process.env.NEIRO_TRUSTED_PROXY_HOPS = "1";
  function request(ip: string, body: object) {
    return new NextRequest("http://localhost/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": `203.0.113.99, ${ip}` },
      body: JSON.stringify(body),
    });
  }
  try {
    for (let i = 0; i < 5; i++) {
      assert.equal((await POST(request(`192.0.2.${i}`, { passcode: "wrong" }))).status, 401);
    }
    const blocked = await POST(request("198.51.100.1", { passcode: "test-owner-secret" }));
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
    // An invalid account name avoids a real DB lookup but proves this path
    // isn't blocked by the passcode counter.
    assert.equal((await POST(request("198.51.100.2", { username: "invalid name", password: "wrong" }))).status, 401);
  } finally {
    for (let i = 0; i < 5; i++) loginLimiter().recordSuccess(limiterKeys(`192.0.2.${i}`, null));
    loginLimiter().recordSuccess(limiterKeys("198.51.100.2", "invalid name"));
    if (savedSecret === undefined) delete process.env.DASHBOARD_SECRET;
    else process.env.DASHBOARD_SECRET = savedSecret;
    if (savedHops === undefined) delete process.env.NEIRO_TRUSTED_PROXY_HOPS;
    else process.env.NEIRO_TRUSTED_PROXY_HOPS = savedHops;
  }
});
