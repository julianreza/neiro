import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { missingColumn, writeDroppingMissing } from "@/lib/missing-column";

describe("missingColumn", () => {
  test("reads a PostgREST schema-cache error", () => {
    const err = { code: "PGRST204", message: "Could not find the 'model' column of 'ask_questions' in the schema cache" };
    assert.equal(missingColumn(err, ["session_id", "model"]), "model");
  });

  test("reads a Postgres undefined-column error", () => {
    const err = { code: "42703", message: 'column "reply_to" of relation "ask_questions" does not exist' };
    assert.equal(missingColumn(err, ["reply_to"]), "reply_to");
  });

  test("ignores errors that are not about a missing column", () => {
    assert.equal(missingColumn({ code: "23505", message: "duplicate key value violates unique constraint model" }, ["model"]), null);
    assert.equal(missingColumn(null, ["model"]), null);
  });

  test("ignores a missing column that is not optional", () => {
    const err = { code: "42703", message: 'column "question" does not exist' };
    assert.equal(missingColumn(err, ["model"]), null);
  });
});

describe("writeDroppingMissing", () => {
  test("drops only the missing optional columns and retries", async () => {
    const seen: Record<string, unknown>[] = [];
    const absent = new Set(["model", "reply_to"]);
    const write = async (row: Record<string, unknown>) => {
      seen.push(row);
      const col = Object.keys(row).find((k) => absent.has(k));
      return { error: col ? { code: "PGRST204", message: `Could not find the '${col}' column` } : null };
    };
    const { error, dropped } = await writeDroppingMissing(
      { id: "a", model: "m", reply_to: "telegram:1", session_id: "s" },
      ["model", "reply_to", "session_id"],
      write,
    );
    assert.equal(error, null);
    assert.deepEqual(dropped.sort(), ["model", "reply_to"]);
    assert.deepEqual(seen.at(-1), { id: "a", session_id: "s" });
  });

  test("returns the error when a required column is missing", async () => {
    const write = async () => ({ error: { code: "42703", message: 'column "id" does not exist' } });
    const { error, dropped } = await writeDroppingMissing({ id: "a", model: "m" }, ["model"], write);
    assert.equal(error?.code, "42703");
    assert.deepEqual(dropped, []);
  });
});
