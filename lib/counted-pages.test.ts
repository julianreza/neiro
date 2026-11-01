import { test } from "node:test";
import assert from "node:assert/strict";
import { readCountedPages } from "./counted-pages";

test("dashboard paging reads past server page caps and reports failures", async () => {
  const source = Array.from({ length: 1200 }, (_, index) => ({ id: index }));
  const rows = await readCountedPages(async (from, to) => ({ data: source.slice(from, Math.min(to + 1, from + 300)), count: source.length, error: null }));
  assert.equal(rows.length, 1200);
  assert.equal(rows[1199].id, 1199);
  await assert.rejects(readCountedPages(async () => ({ data: null, count: null, error: { message: "offline" } })), /offline/);
  await assert.rejects(readCountedPages(async () => ({ data: [], count: 2, error: null })), /incomplete/);
});
