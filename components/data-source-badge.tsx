import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Visible marker that a surface is showing sample data. Renders nothing for
 * live data. Text plus icon, so the state is not conveyed by color alone.
 */
export function DataSourceBadge({
  source,
  reason,
}: {
  source: "loading" | "live" | "demo";
  reason?: string;
}) {
  if (source !== "demo") return null;
  return (
    <Badge variant="outline" role="status" aria-live="polite" className="gap-1">
      <FlaskConical aria-hidden="true" />
      Demo data{reason ? ` — ${reason}` : ""}
    </Badge>
  );
}
