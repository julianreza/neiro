import assert from "node:assert/strict";
import { test } from "node:test";
import { mock } from "bun:test";
import * as nextServer from "next/server";

// The route normally runs in Next's request scope. Keep its response/request
// classes real; only bypass the connection() request-scope guard.
mock.module("next/server", () => ({ ...nextServer, connection: async () => {} }));
const { GET } = await import("../app/api/missions/route");

test("history orders tied timestamps by ID and pages with both boundary fields", async () => {
  const savedFetch = globalThis.fetch;
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://history-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const timestamp = "2026-10-28T04:00:00.123456+00:00";
  const requests = [];
  globalThis.fetch = (async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push(url);
    if (url.pathname.endsWith("/mission_tasks")) return Response.json([]);
    const id = url.searchParams.has("or") ? "mission-a" : "mission-b";
    return Response.json([{ id, title: id, created_at: timestamp }]);
  });
  try {
    const first = await GET(new nextServer.NextRequest("http://localhost/api/missions?limit=1"));
    const page = await first.json();
    assert.equal(first.status, 200);
    assert.equal(requests[0].searchParams.get("order"), "created_at.desc,id.desc");
    assert.equal(page.nextBefore, `${timestamp}|mission-b`);
    const params = new URLSearchParams({ limit: "1", before: page.nextBefore });
    const second = await GET(new nextServer.NextRequest(`http://localhost/api/missions?${params}`));
    assert.equal(second.status, 200);
    assert.equal(requests[2].searchParams.get("or"),
      '(created_at.lt.2026-10-28T04:00:00.123456+00:00,and(created_at.eq.2026-10-28T04:00:00.123456+00:00,id.lt."mission-b"))');
    assert.deepEqual((await second.json()).missions.map((m) => m.id), ["mission-a"]);

    // IDs are TEXT: delimiters and quotes must stay inside the filter value.
    const unusual = new URLSearchParams({ before: `${timestamp}|mission-"b,|x` });
    assert.equal((await GET(new nextServer.NextRequest(`http://localhost/api/missions?${unusual}`))).status, 200);
    assert.equal(requests[4].searchParams.get("or"),
      '(created_at.lt.2026-10-28T04:00:00.123456+00:00,and(created_at.eq.2026-10-28T04:00:00.123456+00:00,id.lt."mission-\\"b,|x"))');

    // Existing API callers can still supply timestamp-only boundaries.
    const legacy = new URLSearchParams({ before: timestamp });
    assert.equal((await GET(new nextServer.NextRequest(`http://localhost/api/missions?${legacy}`))).status, 200);
    assert.equal(requests[6].searchParams.get("created_at"), `lt.${timestamp}`);
    for (const before of ["invalid", `${timestamp}|`, `${timestamp},id.gt.a|mission-b`]) {
      const invalid = new URLSearchParams({ before });
      assert.equal((await GET(new nextServer.NextRequest(`http://localhost/api/missions?${invalid}`))).status, 400);
    }
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  }
});
