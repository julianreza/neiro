import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCompactTokens, formatRelativeTime } from "./utils";

test("formats token magnitudes and handles absent or invalid timestamps", () => {
  assert.equal(formatCompactTokens(0), "0");
  assert.equal(formatCompactTokens(1250), "1.3K");
  assert.equal(formatCompactTokens(1500000), "1.5M");
  for (const value of [null, undefined, "", "not-a-date"]) {
    assert.equal(formatRelativeTime(value), "never");
  }
});
