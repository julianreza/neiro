import assert from "node:assert/strict";
import { test } from "node:test";
import { roleAllows } from "./auth";
import { PrError } from "./github-pr";
import {
  callerFrom,
  createReviewApi,
  dismissFindingApi,
  getReviewApi,
  listReviewsApi,
  postFindingsApi,
  rerunReviewApi,
  type Caller,
  type ReviewsApiDeps,
} from "./reviews-api";
import { MemoryReviewStore } from "./test-fakes/memory-reviews";
import type { ReviewFinding } from "./types";

const ADMIN: Caller = { sub: "owner", role: "admin" };
const VIEWER: Caller = { sub: "v", role: "viewer" };
const ID = "00000000-0000-4000-8000-000000000001";

function setup(over: Partial<ReviewsApiDeps> = {}) {
  const reviews = new MemoryReviewStore();
  let kicks = 0;
  const posted: string[][] = [];
  const deps: ReviewsApiDeps = {
    reviews,
    pickReviewer: async () => ({ id: "rev" }),
    post: async (_ref, findings) => {
      posted.push(findings.map((f) => f.id));
      return findings.map((f) => f.id);
    },
    kick: () => {
      kicks++;
    },
    ...over,
  };
  return { reviews, deps, posted, kicks: () => kicks };
}

const finding = (id: string, posted = false): ReviewFinding => ({
  id,
  severity: "major",
  category: "correctness",
  observation: "",
  evidence: "",
  dismissed: false,
  file: "a.ts",
  line: 1,
  problem: "p",
  consequence: "c",
  suggestion: "s",
  posted,
});

test("the proxy refuses viewer writes on /api/reviews and allows reads", () => {
  assert.equal(roleAllows("viewer", "GET", "/api/reviews"), true);
  assert.equal(roleAllows("viewer", "POST", "/api/reviews"), false);
  assert.equal(roleAllows("viewer", "POST", `/api/reviews/${ID}/rerun`), false);
  assert.equal(roleAllows("viewer", "POST", `/api/reviews/${ID}/post`), false);
  assert.equal(roleAllows("admin", "POST", "/api/reviews"), true);
});

test("callerFrom reads only the proxy's session headers", () => {
  assert.deepEqual(callerFrom(new Headers({ "x-neiro-user": "u", "x-neiro-role": "admin" })), { sub: "u", role: "admin" });
  assert.equal(callerFrom(new Headers()), null);
  assert.equal(callerFrom(new Headers({ "x-neiro-user": "u", "x-neiro-role": "root" })), null);
});

test("without a session every handler answers 401", async () => {
  const { deps } = setup();
  for (const result of [
    await listReviewsApi(new URLSearchParams(), null, deps),
    await getReviewApi(ID, null, deps),
    await createReviewApi({ url: "https://github.com/o/r/pull/1" }, null, deps),
    await rerunReviewApi(ID, null, deps),
    await postFindingsApi(ID, { findingIds: ["f1"] }, null, deps),
  ]) {
    assert.equal(result.status, 401);
  }
});

test("a viewer can read but gets 403 on every write", async () => {
  const { deps, reviews } = setup();
  assert.equal((await listReviewsApi(new URLSearchParams(), VIEWER, deps)).status, 200);
  assert.equal((await createReviewApi({ url: "https://github.com/o/r/pull/1" }, VIEWER, deps)).status, 403);
  assert.equal((await rerunReviewApi(ID, VIEWER, deps)).status, 403);
  assert.equal((await postFindingsApi(ID, { findingIds: ["f1"] }, VIEWER, deps)).status, 403);
  assert.equal(reviews.rows.size, 0);
});

test("POST /api/reviews rejects a bad URL with 400 and no row", async () => {
  const { deps, reviews, kicks } = setup();
  for (const url of [undefined, "", "https://github.com/o/r/issues/1", "https://evil.example/o/r/pull/1"]) {
    assert.equal((await createReviewApi({ url }, ADMIN, deps)).status, 400, String(url));
  }
  assert.equal((await createReviewApi(null, ADMIN, deps)).status, 400);
  assert.equal(reviews.rows.size, 0);
  assert.equal(kicks(), 0);
});

test("POST /api/reviews answers 409 when no reviewer agent is on", async () => {
  const { deps, reviews } = setup({ pickReviewer: async () => null });
  const result = await createReviewApi({ url: "https://github.com/o/r/pull/1" }, ADMIN, deps);
  assert.equal(result.status, 409);
  assert.match(String(result.body.error), /\/agents/);
  assert.equal(reviews.rows.size, 0);
});

test("POST /api/reviews queues a manual review and kicks the runner", async () => {
  const { deps, reviews, kicks } = setup();
  const result = await createReviewApi({ url: "https://github.com/o/r/pull/12/" }, ADMIN, deps);
  assert.equal(result.status, 201);
  const [row] = [...reviews.rows.values()];
  assert.deepEqual([row.repo, row.prNumber, row.prUrl, row.source, row.status, row.createdBy], [
    "o/r",
    12,
    "https://github.com/o/r/pull/12",
    "manual",
    "queued",
    "owner",
  ]);
  assert.equal(kicks(), 1);
});

test("the list hides raw output and finding text, and filters", async () => {
  const { deps, reviews } = setup();
  reviews.seed({ id: ID, rawOutput: "secret-ish", findings: [finding("f1"), finding("f2")], status: "done" });
  reviews.seed({ source: "mission", missionId: "mission-1" });
  const all = await listReviewsApi(new URLSearchParams(), ADMIN, deps);
  const rows = all.body.reviews as Record<string, unknown>[];
  assert.equal(rows.length, 2);
  const done = rows.find((r) => r.id === ID)!;
  assert.equal("rawOutput" in done, false);
  assert.equal("findings" in done, false);
  assert.equal(done.findingCount, 2);
  assert.deepEqual(done.counts, { blocker: 0, major: 2, minor: 0, nit: 0 });

  const mission = await listReviewsApi(new URLSearchParams({ missionId: "mission-1" }), ADMIN, deps);
  assert.equal((mission.body.reviews as unknown[]).length, 1);
  assert.equal((await listReviewsApi(new URLSearchParams({ missionId: "a b" }), ADMIN, deps)).status, 400);
});

test("GET and rerun answer 404 for an unknown or malformed id", async () => {
  const { deps } = setup();
  assert.equal((await getReviewApi("not-a-uuid", ADMIN, deps)).status, 404);
  assert.equal((await getReviewApi(ID, ADMIN, deps)).status, 404);
  assert.equal((await rerunReviewApi(ID, ADMIN, deps)).status, 404);
});

test("rerun adds a new row and keeps the old one; a running review is refused", async () => {
  const { deps, reviews } = setup();
  reviews.seed({ id: ID, status: "reviewing" });
  assert.equal((await rerunReviewApi(ID, ADMIN, deps)).status, 409);
  reviews.rows.get(ID)!.status = "failed";
  assert.equal((await rerunReviewApi(ID, ADMIN, deps)).status, 201);
  assert.equal(reviews.rows.size, 2);
  assert.equal(reviews.rows.get(ID)!.status, "failed");
});

test("post sends only unposted chosen findings and marks them", async () => {
  const { deps, reviews, posted } = setup();
  reviews.seed({ id: ID, status: "done", findings: [finding("f1"), finding("f2"), finding("f3", true)] });
  assert.equal((await postFindingsApi(ID, { findingIds: [] }, ADMIN, deps)).status, 400);
  assert.equal((await postFindingsApi(ID, { findingIds: [1] }, ADMIN, deps)).status, 400);
  assert.equal((await postFindingsApi(ID, { findingIds: ["f3"] }, ADMIN, deps)).status, 400);

  const result = await postFindingsApi(ID, { findingIds: ["f1", "f3", "nope"] }, ADMIN, deps);
  assert.equal(result.status, 200);
  assert.deepEqual(posted, [["f1"]]);
  const row = reviews.rows.get(ID)!;
  assert.deepEqual(row.findings.map((f) => f.posted), [true, false, true]);
  assert.ok(row.postedAt);
});

test("post refuses unfinished reviews and reports gh errors as 502", async () => {
  const { deps, reviews } = setup({
    post: async () => {
      throw new PrError("gh_auth", "The gh CLI is not logged in.");
    },
  });
  reviews.seed({ id: ID, status: "reviewing", findings: [finding("f1")] });
  assert.equal((await postFindingsApi(ID, { findingIds: ["f1"] }, ADMIN, deps)).status, 409);
  reviews.rows.get(ID)!.status = "done";
  const result = await postFindingsApi(ID, { findingIds: ["f1"] }, ADMIN, deps);
  assert.equal(result.status, 502);
  assert.equal(reviews.rows.get(ID)!.findings[0].posted, false);
});

test("dismiss hides a finding from posting and can be undone", async () => {
  const { deps, reviews, posted } = setup();
  reviews.seed({ id: ID, status: "done", findings: [finding("f1"), finding("f2", true)] });
  assert.equal((await dismissFindingApi(ID, { findingId: "f1" }, ADMIN, deps)).status, 400);
  assert.equal((await dismissFindingApi(ID, { findingId: "f9", dismissed: true }, ADMIN, deps)).status, 404);
  assert.equal((await dismissFindingApi(ID, { findingId: "f2", dismissed: true }, ADMIN, deps)).status, 409);
  assert.equal((await dismissFindingApi(ID, { findingId: "f1", dismissed: true }, VIEWER, deps)).status, 403);

  assert.equal((await dismissFindingApi(ID, { findingId: "f1", dismissed: true }, ADMIN, deps)).status, 200);
  assert.equal(reviews.rows.get(ID)!.findings[0].dismissed, true);
  assert.equal((await postFindingsApi(ID, { findingIds: ["f1"] }, ADMIN, deps)).status, 400);
  assert.deepEqual(posted, []);

  await dismissFindingApi(ID, { findingId: "f1", dismissed: false }, ADMIN, deps);
  assert.equal(reviews.rows.get(ID)!.findings[0].dismissed, false);
});
