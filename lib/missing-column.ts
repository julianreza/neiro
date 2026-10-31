/**
 * Optional columns, each added by a later migration. When one is missing from
 * the database, the write is retried without it, so one migration that was
 * never run never costs the other columns (or the row itself).
 */

export type WriteError = { message: string; code?: string } | null | undefined;

/** Postgres "undefined column" and PostgREST "column not in schema cache". */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

/** The optional column a write error names as missing, or null. */
export function missingColumn(error: WriteError, optional: readonly string[]): string | null {
  if (!error) return null;
  const text = error.message ?? "";
  const looksMissing =
    (error.code !== undefined && MISSING_COLUMN_CODES.has(error.code)) ||
    /column|schema cache/i.test(text);
  if (!looksMissing) return null;
  return optional.find((col) => new RegExp(`\\b${col}\\b`).test(text)) ?? null;
}

/**
 * Runs `write(row)`. While it fails because an optional column is missing,
 * drops that column and tries again. Returns the last error (null on success)
 * and the columns that were dropped.
 */
export async function writeDroppingMissing<E extends WriteError>(
  row: Record<string, unknown>,
  optional: readonly string[],
  write: (row: Record<string, unknown>) => Promise<{ error: E }>,
  label = "db",
): Promise<{ error: E; dropped: string[] }> {
  const values = { ...row };
  const left = optional.filter((col) => col in values);
  const dropped: string[] = [];
  let { error } = await write(values);
  while (error) {
    const missing = missingColumn(error, left);
    if (!missing) break;
    console.warn(`[${label}] column ${missing} is missing; saving without it`);
    delete values[missing];
    left.splice(left.indexOf(missing), 1);
    dropped.push(missing);
    ({ error } = await write(values));
  }
  return { error, dropped };
}
