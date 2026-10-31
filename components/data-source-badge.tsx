import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Visible marker that a surface is showing sample data. Renders nothing for
 * live data. Text plus icon, so the state is not conveyed by color alone.
 */
export function DataSourceBadge({
  source,
  reason,
  lastUpdated,
  staleReason,
}: {
  source: "loading" | "live" | "demo" | "error";
  reason?: string;
  lastUpdated?: string;
  staleReason?: string;
}) {
  if (source === "live" && staleReason) return <span role="status" className="text-xs text-muted-foreground">Refresh failed: {staleReason}. Last updated {lastUpdated ? new Date(lastUpdated).toLocaleString() : "unknown"}.</span>;
  if (source !== "demo") return null;
  return (
    <Badge variant="outline" role="status" aria-live="polite" className="gap-1">
      <FlaskConical aria-hidden="true" />
      Demo data{reason ? ` — ${reason}` : ""}
    </Badge>
  );
}

export function DataSourceFailure({ reason, retry, showDemo }: { reason: string; retry: () => void; showDemo?: () => void }) {
  return <p role="alert" className="text-sm text-muted-foreground">Unable to load live data: {reason}. <button className="text-primary underline" onClick={retry}>Try again</button>{showDemo && <> · <button className="text-primary underline" onClick={showDemo}>View demo</button></>}</p>;
}
