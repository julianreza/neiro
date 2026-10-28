import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("history uses both timestamp and id to page across tied timestamps", () => {
  // Isolate Next's request storage and the Supabase singleton from other tests.
  execFileSync(process.execPath, [
    "--conditions=react-server",
    fileURLToPath(new URL("./test-fakes/check-mission-history.ts", import.meta.url)),
  ], { stdio: "pipe" });
});
