import assert from "node:assert/strict";
import { test } from "node:test";
import { assignHandles, baseHandle, parseMentions, rosterBlock } from "./mentions";

const known = ["neiro-pm", "forge", "lens"];

test("handles come from names; clashes get -2 in order", () => {
  assert.equal(baseHandle("Neiro PM"), "neiro-pm");
  assert.equal(baseHandle("Forge Backend!"), "forge-backend");
  assert.equal(baseHandle("all"), "bot-all");
  const map = assignHandles([
    { id: "a", name: "Forge" },
    { id: "b", name: "forge" },
    { id: "c", name: "FORGE" },
  ]);
  assert.deepEqual([...map.values()], ["forge", "forge-2", "forge-3"]);
});

test("known handles, @all, @user; unknown and email-like ignored", () => {
  const p = parseMentions("@forge and @Lens, ping @ghost. mail me at a@forge.dev @forge", known);
  assert.deepEqual(p.handles, ["forge", "lens"]);
  assert.equal(p.all, false);
  assert.equal(p.user, false);
  assert.equal(parseMentions("hey @everyone", known).all, true);
  assert.equal(parseMentions("@all go", known).all, true);
  assert.equal(parseMentions("@user please decide", known).user, true);
});

test("stop and pause directives", () => {
  assert.deepEqual(parseMentions("stop @forge", known).stops, [{ handle: "forge", kind: "stop" }]);
  assert.deepEqual(parseMentions("@lens pause for now", known).stops, [{ handle: "lens", kind: "pause" }]);
  assert.deepEqual(parseMentions("ok stop the room", known).stops, [{ handle: "room", kind: "stop" }]);
  assert.deepEqual(parseMentions("stop @ghost", known).stops, []);
});

test("roster block lists teammates and the attribution format", () => {
  const block = rosterBlock([{ handle: "forge", name: "Forge", role: "Backend" }]);
  assert.match(block, /- @forge — Forge \(Backend\)/);
  assert.match(block, /Message from 🤖 <Sender> \(@<handle>\):/);
  assert.equal(rosterBlock([]), "");
});
