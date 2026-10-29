import { Suspense } from "react";
import { DashboardShell } from "@/components/dashboard-shell";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  // The shell reads the pathname. On /projects/<id> that is only known at
  // request time, so it needs a Suspense boundary (cacheComponents). Static
  // pages resolve it while prerendering and never show the fallback.
  return (
    <Suspense fallback={<div className="neiro-console app-canvas min-h-svh" aria-busy="true" />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
