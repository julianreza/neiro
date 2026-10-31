export type SearchKind = "Projects" | "Missions" | "Tasks" | "Artifacts";
export type SearchResult = { id: string; title: string; kind: SearchKind; href: string; createdAt: string };

/** Rank literal matches consistently, preferring newest within each match class. */
export function rankSearchResults(results: SearchResult[], query: string): SearchResult[] {
  const needle = query.toLocaleLowerCase();
  const rank = (title: string) => {
    const value = title.toLocaleLowerCase();
    return value === needle ? 0 : value.startsWith(needle) ? 1 : 2;
  };
  return [...new Map(results.map((result) => [result.id, result])).values()]
    .sort((a, b) => rank(a.title) - rank(b.title) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, 5);
}
