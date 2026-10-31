import assert from "node:assert/strict";
import { test } from "node:test";
import { listAllSchedules, parseScheduleInput, withBotPrefix } from "./schedules";
import type { Agent } from "./types";

const agent = (id: string, profile: string, extra: Partial<Agent> = {}) =>
  ({ id, name: id, profile, url: "", enabled: true, runtime: "hermes", ...extra }) as Agent;

test("bot prefix is added once and never to the default profile", () => {
  assert.equal(withBotPrefix("Daily digest", "scribe"), "[bot:scribe] Daily digest");
  assert.equal(withBotPrefix("[bot:old] Daily digest", "scribe"), "[bot:scribe] Daily digest");
  assert.equal(withBotPrefix("[bot:scribe] Daily digest", "default"), "Daily digest");
});

test("schedule input: required fields, limits, and unknown fields dropped", () => {
  const ok = parseScheduleInput({ name: " A ", schedule: "0 9 * * *", prompt: "Do it", skills: ["pdf"], provider: "x", evil: 1 });
  assert.deepEqual(ok, { ok: true, value: { name: "A", schedule: "0 9 * * *", prompt: "Do it", skills: ["pdf"] } });
  assert.equal(parseScheduleInput({ schedule: "x", prompt: "y" }).ok, false);
  assert.equal(parseScheduleInput({ name: "a", schedule: "x", prompt: "y".repeat(5001) }).ok, false);
  assert.equal(parseScheduleInput({ name: "a", schedule: "x", prompt: "y", skills: ["bad name!"] }).ok, false);
  assert.deepEqual(parseScheduleInput({ prompt: "only this" }, true), { ok: true, value: { prompt: "only this" } });
});

test("each profile is read once, and one failing profile does not sink the list", async () => {
  const calls: string[] = [];
  const items = await listAllSchedules(
    [
      agent("forge", "eng"),
      agent("lens", "eng"),
      agent("scribe", "docs"),
      agent("off", "x", { enabled: false }),
      agent("pi", "y", { runtime: "ohmypi" }),
    ],
    async (a) => {
      calls.push(a?.profile ?? "default");
      if (a?.profile === "docs") throw new Error("down");
      return a ? [{ id: `job-${a.profile}` }] : [{ id: "job-default" }];
    },
  );
  assert.deepEqual(calls.sort(), ["default", "docs", "eng"]);
  assert.deepEqual(
    items.map((i) => [i.id ?? null, i.agentId, i.error ?? null]),
    [
      ["job-default", null, null],
      ["job-eng", "forge", null],
      [null, "scribe", "down"],
    ],
  );
  assert.equal(items[1].agentName, "forge, lens");
});
