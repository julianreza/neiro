import assert from "node:assert/strict";
import { test } from "node:test";
import { localTickEnabled, localTickIntervalMs } from "./local-ticker";

test("local ticker is on for next dev and off for next start by default", () => {
  assert.equal(localTickEnabled({ NODE_ENV: "development" }), true);
  assert.equal(localTickEnabled({ NODE_ENV: "production" }), false);
});

test("NEIRO_LOCAL_TICK overrides the default", () => {
  assert.equal(localTickEnabled({ NODE_ENV: "development", NEIRO_LOCAL_TICK: "off" }), false);
  assert.equal(localTickEnabled({ NODE_ENV: "production", NEIRO_LOCAL_TICK: "on" }), true);
});

test("tick interval defaults to 15s and never drops below 5s", () => {
  assert.equal(localTickIntervalMs({}), 15_000);
  assert.equal(localTickIntervalMs({ NEIRO_LOCAL_TICK_MS: "1000" }), 5_000);
  assert.equal(localTickIntervalMs({ NEIRO_LOCAL_TICK_MS: "30000" }), 30_000);
  assert.equal(localTickIntervalMs({ NEIRO_LOCAL_TICK_MS: "abc" }), 15_000);
});
