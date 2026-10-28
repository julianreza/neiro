import assert from "node:assert/strict";

import "next/dist/server/node-environment-baseline";
const { NextRequest } = await import("next/server");
const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external");
const { GET } = await import("../../app/api/missions/route");

async function checkMissionHistory() {
  const savedFetch = globalThis.fetch;
  const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"] as const;
  const savedEnv = envKeys.map((key) => process.env[key]);
  process.env.SUPABASE_URL = "https://history-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  const timestamp = "2026-10-28T00:00:00.123456+00:00";
  const queries: URL[] = [];
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "history-test.supabase.co");
    if (url.pathname.endsWith("/mission_tasks")) return Response.json([]);
    queries.push(url);
    // Simulate a page ending in the middle of a timestamp shared by two rows.
    const id = url.searchParams.has("or") ? "mission-a" : "mission-b";
    return Response.json([{ id, title: id, created_at: timestamp }]);
  }) as typeof fetch;

  // No rendering is under test; allow the route's connection() boundary.
  const workStore = { forceStatic: true } as NonNullable<ReturnType<typeof workAsyncStorage.getStore>>;
  const getPage = (params: URLSearchParams) => workAsyncStorage.run(workStore, () =>
    GET(new NextRequest(`http://localhost/api/missions?${params}`))
  );
  try {
    const first = await getPage(new URLSearchParams({ limit: "1" }));
    assert.equal(first.status, 200);
    const page1 = await first.json();
    assert.equal(queries[0].searchParams.get("order"), "created_at.desc,id.desc");
    assert.equal(page1.nextBefore, timestamp);
    assert.equal(page1.nextBeforeId, "mission-b");

    const second = await getPage(new URLSearchParams({ limit: "1", before: page1.nextBefore, beforeId: page1.nextBeforeId }));
    assert.equal(second.status, 200);
    const page2 = await second.json();
    assert.equal(queries[1].searchParams.get("or"), `(created_at.lt."${timestamp}",and(created_at.eq."${timestamp}",id.lt."mission-b"))`);
    assert.equal(queries[1].searchParams.get("created_at"), null);
    assert.deepEqual([...page1.missions, ...page2.missions].map((m) => m.id), ["mission-b", "mission-a"]);

    const invalidCursors: Record<string, string>[] = [
      { before: timestamp },
      { beforeId: "mission-b" },
      { before: "invalid", beforeId: "mission-b" },
      { before: `${timestamp},id.gt.anything`, beforeId: "mission-b" },
    ];
    for (const params of invalidCursors) {
      assert.equal((await getPage(new URLSearchParams(params))).status, 400);
    }
    assert.equal(queries.length, 2, "invalid cursors must not reach the database");

    const unpaged = await getPage(new URLSearchParams());
    const all = await unpaged.json();
    assert.equal(all.nextBefore, null);
    assert.equal(all.nextBeforeId, null);
  } finally {
    globalThis.fetch = savedFetch;
    envKeys.forEach((key, i) => {
      if (savedEnv[i] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[i];
    });
  }
}

await checkMissionHistory();
