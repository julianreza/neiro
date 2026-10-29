import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/users/route";
import { PATCH, DELETE } from "../app/api/users/[id]/route";
import { SESSION_COOKIE, signSessionToken } from "./auth";
import { RoleCache } from "./role-cache";

test("users handlers reject direct requests with missing or forged admin identity", async () => {
  const saved = process.env.DASHBOARD_SECRET;
  process.env.DASHBOARD_SECRET = "users-api-test-secret";
  try {
    const viewer = await signSessionToken(process.env.DASHBOARD_SECRET, Date.now() + 60_000, {
      sub: "viewer-id", role: "viewer",
    });
    const headerSets: HeadersInit[] = [
      {},
      { "x-neiro-role": "admin", "x-neiro-user": "owner" },
      { cookie: `${SESSION_COOKIE}=${viewer}`, "x-neiro-role": "admin" },
    ];
    for (const headers of headerSets) {
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        const request = new NextRequest("http://localhost/api/users/invalid", { method, headers });
        const context = { params: Promise.resolve({ id: "invalid" }) };
        const response = method === "GET" ? await GET(request)
          : method === "POST" ? await POST(request)
          : method === "PATCH" ? await PATCH(request, context) : await DELETE(request, context);
        assert.equal(response.status, 403, method);
      }
    }
  } finally {
    if (saved === undefined) delete process.env.DASHBOARD_SECRET;
    else process.env.DASHBOARD_SECRET = saved;
  }
});

test("users handlers accept owner credentials and check account roles without the proxy", async () => {
  const globalRoles = globalThis as typeof globalThis & { __neiroRoleCache?: RoleCache };
  const savedRoles = globalRoles.__neiroRoleCache;
  const savedSecret = process.env.DASHBOARD_SECRET;
  process.env.DASHBOARD_SECRET = "users-api-test-secret";
  globalRoles.__neiroRoleCache = new RoleCache(async (id) => id === "admin-id" ? "admin" : "viewer");
  try {
    for (const [sub, expected] of [["admin-id", 400], ["demoted-id", 403]] as const) {
      const token = await signSessionToken(process.env.DASHBOARD_SECRET, Date.now() + 60_000, { sub, role: "admin" });
      const request = new NextRequest("http://localhost/api/users", {
        method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });
      assert.equal((await POST(request)).status, expected);
    }
    const request = new NextRequest("http://localhost/api/users", {
      method: "POST", headers: { authorization: `Bearer ${process.env.DASHBOARD_SECRET}` },
    });
    assert.equal((await POST(request)).status, 400);

    const id = "11111111-1111-4111-8111-111111111111";
    globalRoles.__neiroRoleCache = new RoleCache(async () => "admin");
    const token = await signSessionToken(process.env.DASHBOARD_SECRET, Date.now() + 60_000, { sub: id, role: "admin" });
    const self = new NextRequest(`http://localhost/api/users/${id}`, {
      method: "DELETE", headers: { cookie: `${SESSION_COOKIE}=${token}`, "x-neiro-user": "someone-else" },
    });
    assert.equal((await DELETE(self, { params: Promise.resolve({ id }) })).status, 409);
  } finally {
    globalRoles.__neiroRoleCache = savedRoles;
    if (savedSecret === undefined) delete process.env.DASHBOARD_SECRET;
    else process.env.DASHBOARD_SECRET = savedSecret;
  }
});
