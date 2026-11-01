import type { MissionResult } from "@/lib/mission-result";

export function buildProjectQuality(results: MissionResult[], missingCompletionDates: number) {
  const durations = results.flatMap((result) => result.durationMs === null ? [] : [result.durationMs]).sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return {
    missions: results.length,
    medianDurationMs: durations.length ? durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2 : null,
    missingDuration: results.length - durations.length,
    missingCompletionDates,
    retries: results.reduce((sum, result) => sum + result.retries, 0),
    qaPassed: results.reduce((sum, result) => sum + result.qaPassed, 0),
    qaKnown: results.reduce((sum, result) => sum + result.qaKnown, 0),
    qaUnknown: results.reduce((sum, result) => sum + result.tasks.length - result.qaKnown, 0),
  };
}
