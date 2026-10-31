"use client";
import { useEffect, useState } from "react";

type Quality = { missions: number; medianDurationMs: number | null; missingDuration: number; missingCompletionDates: number; retries: number; qaPassed: number; qaKnown: number; qaUnknown: number };
export function ProjectQuality({ projectId }: { projectId: string }) {
  const [state, setState] = useState<{ quality?: Quality; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/quality`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load project quality");
      setState({ quality: data.quality });
    }).catch((error: Error) => { if (error.name !== "AbortError") setState({ error: error.message }); });
    return () => controller.abort();
  }, [projectId]);
  const q = state.quality;
  return <section aria-label="Project quality" className="rounded-xl p-4 text-sm neu-raised"><h3 className="font-semibold">Project quality · last 30 days</h3>{q ? <><p>{q.missions} completed · {q.medianDurationMs === null ? "Median duration unavailable" : `Median ${Math.round(q.medianDurationMs / 60000)} min`} · {q.retries} retries · QA {q.qaPassed}/{q.qaKnown} known passed</p>{(q.missingDuration > 0 || q.missingCompletionDates > 0 || q.qaUnknown > 0) && <p className="text-xs text-muted-foreground">Excluded: {q.missingDuration} missing durations, {q.qaUnknown} unverified task results, {q.missingCompletionDates} older missions without completion dates.</p>}</> : <p className="text-muted-foreground">{state.error ?? "Loading quality…"}</p>}</section>;
}
