/** Counted pages avoid silent truncation even if PostgREST caps a page below 500 rows. */
export async function readCountedPages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; count: number | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await read(rows.length, rows.length + 499);
    if (page.error) throw new Error(page.error.message);
    if (page.count === null) throw new Error("Dashboard result count is unavailable.");
    rows.push(...(page.data ?? []));
    if (rows.length >= page.count) return rows;
    if (!page.data?.length) throw new Error("Dashboard result page was incomplete.");
  }
}
