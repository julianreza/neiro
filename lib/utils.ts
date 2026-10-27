import { formatDistanceToNowStrict } from "date-fns";

export { cn } from "cn";

const compactTokens = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompactTokens(tokens: number): string {
  return compactTokens.format(tokens);
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "never"
    : formatDistanceToNowStrict(date, { addSuffix: true });
}
