"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, EyeOff, GitPullRequest, Loader2, Plus, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Picker } from "@/components/ui/picker";
import { BotRig, agentLook, roleForAgent } from "@/components/agent-bot";
import { useRole } from "@/hooks/use-role";
import { formatTokens, missionHref, sendJson, timeAgo } from "@/lib/client-api";
import { countBySeverity, focusFiles } from "@/lib/code-review";
import type { ReviewSummary } from "@/lib/reviews-api";
import type { CodeReview, ReviewFinding, ReviewSeverity, ReviewStatus, ReviewVerdict } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Labels and colours                                                  */
/* ------------------------------------------------------------------ */

const SEVERITY: Record<ReviewSeverity, { label: string; color: string }> = {
  blocker: { label: "Must fix", color: "#e11d48" },
  major: { label: "Should fix", color: "#f97316" },
  minor: { label: "Worth a glance", color: "#0ea5e9" },
  nit: { label: "Nit", color: "#94a3b8" },
};
const SEVERITIES = Object.keys(SEVERITY) as ReviewSeverity[];

const VERDICT: Record<ReviewVerdict, { label: string; color: string }> = {
  approve: { label: "Approve", color: "#16a34a" },
  request_changes: { label: "Request changes", color: "#e11d48" },
  comment: { label: "Comments", color: "#64748b" },
};

const ACTIVE: ReviewStatus[] = ["queued", "fetching", "reviewing"];
const isActive = (s: ReviewStatus) => ACTIVE.includes(s);

const STEPS: { status: ReviewStatus; label: string }[] = [
  { status: "queued", label: "Queued" },
  { status: "fetching", label: "Reading the PR" },
  { status: "reviewing", label: "Reviewing" },
];

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

type SourceTab = "all" | "manual" | "mission";
type DetailTab = "review" | "files" | "raw";
type AgentName = { id: string; name: string };
type ProjectRepoOption = { repo: string; projects: string[] };

const sevStyle = (s: ReviewSeverity) => ({ "--sev": SEVERITY[s].color }) as CSSProperties;

function prLabel(r: Pick<CodeReview, "repo" | "prNumber">) {
  return `${r.repo.split("/")[1] ?? r.repo}#${r.prNumber}`;
}

function statusText(r: Pick<CodeReview, "status" | "verdict">) {
  if (r.status === "queued") return "Queued";
  if (r.status === "fetching") return "Reading the PR";
  if (r.status === "reviewing") return "Reviewing";
  if (r.status === "failed") return "Failed";
  return r.verdict ? VERDICT[r.verdict].label : "Done";
}

function elapsed(fromIso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

export function CodeReviewBoard() {
  const role = useRole();
  const canAct = role === "admin";

  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [repo, setRepo] = useState("all");
  const [source, setSource] = useState<SourceTab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CodeReview | null>(null);
  const [agents, setAgents] = useState<AgentName[]>([]);
  const [projectRepos, setProjectRepos] = useState<ProjectRepoOption[]>([]);
  const [composing, setComposing] = useState(false);
  const [url, setUrl] = useState("");
  const [starting, setStarting] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { reviews?: ReviewSummary[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const list = data.reviews ?? [];
      setReviews(list);
      setListError(null);
      // First load: open ?id= (a link from a mission), else the newest review.
      setSelectedId((cur) => cur ?? (new URLSearchParams(window.location.search).get("id") || list[0]?.id || null));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load reviews.");
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/reviews/${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { review?: CodeReview };
    if (res.ok && data.review) setDetail(data.review);
  }, []);

  // First load: the list and the agent names.
  useEffect(() => {
    const first = setTimeout(loadList, 0);
    fetch("/api/agents", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { agents?: AgentName[] } | null) => setAgents(data?.agents ?? []))
      .catch(() => {});
    // Repos of the saved projects (their GitHub origin), so the picker lists
    // them before any review exists.
    fetch("/api/reviews/repos", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { repos?: ProjectRepoOption[] } | null) => setProjectRepos(data?.repos ?? []))
      .catch(() => {});
    return () => clearTimeout(first);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    const first = setTimeout(() => void loadDetail(selectedId), 0);
    const url = new URL(window.location.href);
    url.searchParams.set("id", selectedId);
    window.history.replaceState(null, "", url);
    return () => clearTimeout(first);
  }, [selectedId, loadDetail]);

  // Poll faster while anything is still running.
  const anyActive = (reviews ?? []).some((r) => isActive(r.status));
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadList();
      if (selectedId && detail && isActive(detail.status)) void loadDetail(selectedId);
    }, anyActive || (detail && isActive(detail.status)) ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyActive, detail, selectedId, loadList, loadDetail]);

  const repoOptions = useMemo(() => {
    const names = new Map(projectRepos.map((r) => [r.repo, r.projects.join(", ")]));
    const all = [...new Set([...projectRepos.map((r) => r.repo), ...(reviews ?? []).map((r) => r.repo)])].sort();
    return all.map((r) => ({ value: r, label: r, hint: names.get(r), group: names.has(r) ? "Projects" : "Other reviews" }));
  }, [projectRepos, reviews]);
  const visible = useMemo(
    () =>
      (reviews ?? []).filter(
        (r) => (repo === "all" || r.repo === repo) && (source === "all" || r.source === source),
      ),
    [reviews, repo, source],
  );
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? null;

  async function startReview() {
    setStarting(true);
    const result = await sendJson<{ review: ReviewSummary }>("/api/reviews", "POST", { url: url.trim() });
    setStarting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Review started.");
    setUrl("");
    setComposing(false);
    setReviews((list) => [result.data.review, ...(list ?? [])]);
    setSelectedId(result.data.review.id);
  }

  return (
    <div className="cr-board">
      <aside className="cr-side" aria-label="Reviews">
        <Picker
          value={repo}
          onChange={setRepo}
          aria-label="Repository"
          options={[{ value: "all", label: "All repositories" }, ...repoOptions]}
          searchable={repoOptions.length > 8}
        />
        <div className="cr-tabs" role="tablist" aria-label="Source">
          {(["all", "manual", "mission"] as SourceTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={source === tab}
              className="cr-tab"
              onClick={() => setSource(tab)}
            >
              {tab === "all" ? "All" : tab === "manual" ? "Manual" : "Missions"}
            </button>
          ))}
        </div>

        {canAct &&
          (composing ? (
            <form
              className="cr-new"
              onSubmit={(e) => {
                e.preventDefault();
                void startReview();
              }}
            >
              <label htmlFor="cr-url" className="eyebrow">
                Pull request URL
              </label>
              <Input
                id="cr-url"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/pull/12"
                inputMode="url"
                spellCheck={false}
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={starting || !url.trim()} className="flex-1">
                  {starting ? <Loader2 className="animate-spin" /> : <GitPullRequest />}
                  Review
                </Button>
                <Button type="button" variant="ghost" onClick={() => setComposing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <button type="button" className="cr-new-btn" onClick={() => setComposing(true)}>
              <Plus className="size-4" aria-hidden="true" /> New review
            </button>
          ))}

        {listError && <p className="text-xs text-destructive">{listError}</p>}
        {reviews === null && !listError && <p className="cr-muted">Loading…</p>}
        {reviews !== null && visible.length === 0 && (
          <p className="cr-muted">
            {reviews.length === 0
              ? "No reviews yet. Start one with New review, or launch a Build or Fix mission."
              : "No review matches these filters."}
          </p>
        )}

        <ul className="cr-list">
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="cr-item"
                aria-current={r.id === selectedId || undefined}
                data-active={isActive(r.status) || undefined}
                onClick={() => setSelectedId(r.id)}
              >
                <span className="cr-item-top">
                  <span className="cr-item-pr">{prLabel(r)}</span>
                  <span className="cr-item-status" data-status={r.status} data-verdict={r.verdict ?? undefined}>
                    {statusText(r)}
                  </span>
                </span>
                <span className="cr-item-title">{r.prTitle || r.repo}</span>
                <span className="cr-item-meta">
                  <span>
                    {r.source === "mission" ? "Mission" : "Manual"} · {timeAgo(r.createdAt)}
                  </span>
                  {r.status === "done" && (
                    <span className="cr-dots">
                      {r.findingCount === 0
                        ? "clean"
                        : SEVERITIES.filter((s) => r.counts[s] > 0).map((s) => (
                            <span key={s} style={sevStyle(s)}>
                              <i aria-hidden="true" /> {r.counts[s]}
                              <span className="sr-only"> {SEVERITY[s].label}</span>
                            </span>
                          ))}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="cr-main" aria-live="polite">
        {!selectedId || !detail || detail.id !== selectedId ? (
          <div className="cr-empty">
            {selectedId ? <Loader2 className="animate-spin" /> : "Pick a review on the left."}
          </div>
        ) : (
          <ReviewDetail
            key={detail.id}
            review={detail}
            agentName={agentName(detail.agentId)}
            canAct={canAct}
            onChange={setDetail}
            onRerun={(r) => {
              setReviews((list) => [r, ...(list ?? [])]);
              setSelectedId(r.id);
            }}
          />
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

function ReviewDetail({
  review,
  agentName,
  canAct,
  onChange,
  onRerun,
}: {
  review: CodeReview;
  agentName: string | null;
  canAct: boolean;
  onChange: (r: CodeReview) => void;
  onRerun: (r: ReviewSummary) => void;
}) {
  const [tab, setTab] = useState<DetailTab>("review");
  const [rerunning, setRerunning] = useState(false);
  const active = isActive(review.status);
  const additions = review.files.reduce((n, f) => n + f.additions, 0);
  const deletions = review.files.reduce((n, f) => n + f.deletions, 0);

  async function rerun() {
    setRerunning(true);
    const result = await sendJson<{ review: ReviewSummary }>(`/api/reviews/${review.id}/rerun`, "POST");
    setRerunning(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Reviewing again. The old review is kept.");
    onRerun(result.data.review);
  }

  return (
    <article className="cr-detail">
      <header className="cr-head">
        <div className="min-w-0">
          <h1 className="cr-title">{review.prTitle || prLabel(review)}</h1>
          <p className="cr-meta">
            <a href={review.prUrl} target="_blank" rel="noopener noreferrer" className="cr-link">
              {review.repo}#{review.prNumber} ↗
            </a>
            {review.headRef && (
              <span className="code-chip">
                {review.headRef} → {review.baseRef || "?"}
              </span>
            )}
            {review.files.length > 0 && (
              <span>
                {review.files.length} files <span className="cr-add">+{additions}</span>{" "}
                <span className="cr-del">−{deletions}</span>
              </span>
            )}
            <span>
              {review.source === "mission" && review.missionId ? (
                <Link href={missionHref(review.missionId)} className="cr-link">
                  Mission
                </Link>
              ) : (
                "Manual"
              )}
            </span>
            {agentName && <span>{agentName}</span>}
            {review.tokens > 0 && <span>{formatTokens(review.tokens)} tokens</span>}
            <span className="cr-pill" data-status={review.status} data-verdict={review.verdict ?? undefined}>
              {statusText(review)}
            </span>
          </p>
        </div>
        {canAct && !active && (
          <Button onClick={() => void rerun()} disabled={rerunning}>
            {rerunning ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Review again
          </Button>
        )}
      </header>

      {active ? (
        <ReviewInProgress review={review} agentName={agentName} />
      ) : (
        <>
          <div className="cr-tabs cr-tabs-wide" role="tablist" aria-label="Review views">
            <button type="button" role="tab" className="cr-tab" aria-selected={tab === "review"} onClick={() => setTab("review")}>
              Review <b>{review.findings.filter((f) => !f.dismissed).length}</b>
            </button>
            <button type="button" role="tab" className="cr-tab" aria-selected={tab === "files"} onClick={() => setTab("files")}>
              Files
            </button>
            <button type="button" role="tab" className="cr-tab" aria-selected={tab === "raw"} onClick={() => setTab("raw")}>
              Raw answer
            </button>
          </div>
          <div className="cr-done-bar" data-failed={review.status === "failed" || undefined} aria-hidden="true">
            <i />
          </div>
          {review.status === "failed" && (
            <div className="cr-card cr-failed" role="alert">
              <p className="eyebrow">Review failed</p>
              <p>{review.error || "The review stopped without an answer."}</p>
            </div>
          )}
          {tab === "review" && review.status === "done" && (
            <FindingsView review={review} canAct={canAct} onChange={onChange} />
          )}
          {tab === "files" && <FilesView review={review} />}
          {tab === "raw" && (
            <pre className="cr-raw">{review.rawOutput || "The reviewer has not answered."}</pre>
          )}
        </>
      )}
    </article>
  );
}

/** Option C: the reviewer robot at work, with the real step it is on. */
function ReviewInProgress({ review, agentName }: { review: CodeReview; agentName: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const botRole = roleForAgent(agentName ?? "Lens Reviewer");
  const step = STEPS.findIndex((s) => s.status === review.status);
  const files = [...review.files].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions)).slice(0, 8);
  const widest = Math.max(1, ...files.map((f) => f.additions + f.deletions));

  return (
    <div className="cr-progress">
      <div className="cr-card cr-robot-row">
        <span className="agent-bot cr-bot" data-state="working" style={agentLook(botRole)} aria-hidden="true">
          <BotRig role={botRole} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {review.status === "queued"
              ? "Waiting for a reviewer"
              : review.status === "fetching"
                ? "Reading the pull request"
                : `${agentName ?? "The reviewer"} is reviewing the change`}
          </p>
          <ol className="cr-steps">
            {STEPS.map((s, i) => (
              <li key={s.status} data-state={i < step ? "done" : i === step ? "now" : "next"}>
                {s.label}
              </li>
            ))}
          </ol>
        </div>
        <span className="cr-elapsed">{elapsed(review.updatedAt || review.createdAt, now)}</span>
      </div>
      <div className="cr-stripe" role="progressbar" aria-label="Review in progress" aria-valuetext={statusText(review)}>
        <i />
      </div>
      {files.length > 0 && (
        <div className="cr-card">
          <p className="eyebrow mb-2">Files in this change</p>
          <ul className="cr-file-bars">
            {files.map((f) => (
              <li key={f.path}>
                <span className="cr-file-path">{f.path}</span>
                <span className="cr-bar cr-bar-scan">
                  <i style={{ width: `${Math.max(6, ((f.additions + f.deletions) / widest) * 100)}%` }} />
                </span>
                <span className="cr-file-size">
                  +{f.additions} −{f.deletions}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="cr-muted">Findings appear here when the reviewer finishes. This page updates by itself.</p>
    </div>
  );
}

type Filter = "all" | ReviewSeverity;

function FindingsView({
  review,
  canAct,
  onChange,
}: {
  review: CodeReview;
  canAct: boolean;
  onChange: (r: CodeReview) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [posting, setPosting] = useState(false);
  const counts = countBySeverity(review.findings);
  const live = review.findings.filter((f) => !f.dismissed);
  const dismissedCount = review.findings.length - live.length;
  const shown = review.findings.filter(
    (f) => (showDismissed || !f.dismissed) && (filter === "all" || f.severity === filter),
  );
  const postable = (f: ReviewFinding) => canAct && !f.posted && !f.dismissed;
  const chosenNow = [...chosen].filter((id) => review.findings.some((f) => f.id === id && postable(f)));

  async function post(ids: string[]) {
    setPosting(true);
    const result = await sendJson<{ review: CodeReview }>(`/api/reviews/${review.id}/post`, "POST", { findingIds: ids });
    setPosting(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Posted ${ids.length} comment${ids.length === 1 ? "" : "s"} to GitHub.`);
    setChosen(new Set());
    onChange(result.data.review);
  }

  async function dismiss(f: ReviewFinding) {
    const result = await sendJson<{ review: CodeReview }>(`/api/reviews/${review.id}/dismiss`, "POST", {
      findingId: f.id,
      dismissed: !f.dismissed,
    });
    if (!result.ok) return void toast.error(result.error);
    onChange(result.data.review);
  }

  return (
    <div className="cr-findings">
      <div className="cr-filter-row">
        <div className="cr-chips" role="group" aria-label="Show findings">
          <button type="button" className="cr-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All {live.length}
          </button>
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              className="cr-chip"
              style={sevStyle(s)}
              aria-pressed={filter === s}
              onClick={() => setFilter(s)}
            >
              <i aria-hidden="true" /> {SEVERITY[s].label} {counts[s]}
            </button>
          ))}
          {dismissedCount > 0 && (
            <button type="button" className="cr-chip" aria-pressed={showDismissed} onClick={() => setShowDismissed((v) => !v)}>
              {showDismissed ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} Dismissed {dismissedCount}
            </button>
          )}
        </div>
        {canAct && (
          <Button disabled={posting || chosenNow.length === 0} onClick={() => void post(chosenNow)}>
            {posting ? <Loader2 className="animate-spin" /> : <Send />}
            Post to GitHub ({chosenNow.length})
          </Button>
        )}
      </div>

      <section className="cr-card cr-summary">
        {review.design && (
          <>
            <p className="eyebrow" data-gate={review.design.gate}>
              Design gate · {review.design.gate === "pass" ? "pass" : "concern"}
            </p>
            <dl className="cr-design">
              {review.design.problem && (
                <>
                  <dt>Problem</dt>
                  <dd>{review.design.problem}</dd>
                </>
              )}
              {review.design.whyItMatters && (
                <>
                  <dt>Why it matters</dt>
                  <dd>{review.design.whyItMatters}</dd>
                </>
              )}
              {review.design.solutionFit && (
                <>
                  <dt>Solution fit</dt>
                  <dd>{review.design.solutionFit}</dd>
                </>
              )}
            </dl>
          </>
        )}
        <p className="eyebrow mt-3">Ship-readiness summary</p>
        <p>{review.summary || "The reviewer gave no summary."}</p>
        {review.error && <p className="cr-muted mt-2">{review.error}</p>}
      </section>

      {shown.length === 0 && (
        <p className="cr-muted">{live.length === 0 ? "No findings. The reviewer found nothing to fix." : "No finding at this level."}</p>
      )}

      {shown.map((f) => (
        <article key={f.id} className="cr-card cr-finding" style={sevStyle(f.severity)} data-dismissed={f.dismissed || undefined}>
          <p className="eyebrow cr-sev">
            {SEVERITY[f.severity].label} · {f.category}
          </p>
          <h2 className="cr-finding-title">{f.problem}</h2>
          <p>
            <span className="code-chip">
              {f.file}
              {f.line ? `:${f.line}` : ""}
            </span>
          </p>
          <dl className="cr-design cr-finding-body">
            {f.observation && (
              <>
                <dt>Observation</dt>
                <dd>{f.observation}</dd>
              </>
            )}
            {f.evidence && (
              <>
                <dt>Evidence</dt>
                <dd>
                  <pre className="cr-evidence">{f.evidence}</pre>
                </dd>
              </>
            )}
            {f.consequence && (
              <>
                <dt>Consequence</dt>
                <dd>{f.consequence}</dd>
              </>
            )}
            {f.suggestion && (
              <>
                <dt>Suggestion</dt>
                <dd>{f.suggestion}</dd>
              </>
            )}
          </dl>
          <footer className="cr-finding-foot">
            {f.posted ? (
              <span className="cr-posted">On GitHub</span>
            ) : (
              <label className="cr-select">
                <input
                  type="checkbox"
                  disabled={!postable(f)}
                  checked={chosen.has(f.id) && postable(f)}
                  onChange={(e) =>
                    setChosen((set) => {
                      const next = new Set(set);
                      if (e.target.checked) next.add(f.id);
                      else next.delete(f.id);
                      return next;
                    })
                  }
                />
                Select for post
              </label>
            )}
            {canAct && !f.posted && (
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void dismiss(f)}>
                  {f.dismissed ? <Eye /> : <EyeOff />}
                  {f.dismissed ? "Restore" : "Dismiss"}
                </Button>
                {!f.dismissed && (
                  <Button size="sm" variant="outline" disabled={posting} onClick={() => void post([f.id])}>
                    <Send /> Post this one
                  </Button>
                )}
              </span>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}

function FilesView({ review }: { review: CodeReview }) {
  const files = focusFiles(review.findings, review.files);
  const widest = Math.max(1, ...files.map((f) => f.additions + f.deletions));
  if (files.length === 0) return <p className="cr-muted">No file list for this review.</p>;
  return (
    <div className="cr-card">
      <p className="eyebrow mb-2">Focus files · worst finding first</p>
      <ul className="cr-file-bars">
        {files.map((f) => (
          <li key={f.path} style={f.worst ? sevStyle(f.worst) : undefined}>
            <span className="cr-file-path">{f.path}</span>
            <span className="cr-bar" data-clean={f.worst === null || undefined}>
              <i style={{ width: `${Math.max(6, ((f.additions + f.deletions) / widest) * 100)}%` }} />
            </span>
            <span className="cr-file-size">
              {f.worst ? `${SEVERITY[f.worst].label} · ` : ""}+{f.additions} −{f.deletions}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
