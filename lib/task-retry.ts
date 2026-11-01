/** Resume integration or verification without rerunning a successful coding attempt. */
export function taskRetryPatch(task: { verification_wait_stage?: unknown; retries?: number | null; task_integration_pending?: boolean | null }) {
  const gate = task.verification_wait_stage === "QA check" || task.verification_wait_stage === "Final review" ? task.verification_wait_stage : null;
  const resume = task.task_integration_pending ? "Final review" : gate;
  return {
    stage: resume ?? "Queued",
    approval: false,
    retries: (task.retries || 0) + (resume ? 0 : 1),
    ...(task.verification_wait_stage !== undefined ? { verification_wait_stage: null } : {}),
    ...(resume ? {} : { result_output: null }),
    run_id: null,
    run_agent_id: null,
    run_started_at: null,
  };
}
