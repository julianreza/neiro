import assert from "node:assert/strict";
import { test } from "node:test";
import { rankSearchResults, type SearchResult } from "./workspace-search";

test("search prefers exact and prefix matches, then newest; deduplicates and limits", () => {
  const row = (id: string, title: string, date: string): SearchResult => ({ id, title, createdAt: date, kind: "Tasks", href: "/" });
  const input = [row("1", "other needle", "2026-11-05"), row("2", "Needle extra", "2026-11-02"), row("3", "needle", "2026-11-01"), row("4", "needle next", "2026-11-03"), row("5", "a needle", "2026-11-04"), row("6", "a needle", "2026-11-01")];
  assert.deepEqual(rankSearchResults([...input, input[0]], "Needle").map((r) => r.id), ["3", "4", "2", "1", "5"]);
});
