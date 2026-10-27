import assert from "node:assert/strict";
import { test } from "node:test";
import { isExemptPath } from "./proxy";

test("isExemptPath allows login, auth API and the listed public SVGs", () => {
  for (const path of ["/login", "/api/auth", "/api/auth/logout", "/next.svg", "/vercel.svg"]) {
    assert.equal(isExemptPath(path), true, path);
  }
});

test("isExemptPath does not exempt arbitrary .svg-suffixed paths", () => {
  for (const path of ["/api/x.svg", "/missions/a.svg", "/next.svg/x", "/api/authx", "/"]) {
    assert.equal(isExemptPath(path), false, path);
  }
});
