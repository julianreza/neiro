import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AppConfigError } from "@/lib/types";

const STARTER_AGENTS = [
  {
    id: "pm-orchestrator",
    name: "Neiro PM",
    role: "PM",
    stage: "orchestrator",
    specialty: "Mission planning & delegation",
    model: "",
    profile: "default",
    prompt:
      "Break missions into clear deliverables. Delegate work, track dependencies, and escalate blockers. Never claim work is complete without evidence.",
    url: "",
    enabled: true,
    active_run: false,
  },
  {
    id: "spec-writer",
    name: "Scribe PRD",
    role: "PRD",
    stage: "spec",
    specialty: "Requirements & acceptance criteria",
    model: "",
    profile: "default",
    prompt:
      "Turn goals into precise requirements, constraints, and testable acceptance criteria. Surface unanswered questions before implementation.",
    url: "",
    enabled: true,
    active_run: false,
  },
  {
    id: "backend-worker",
    name: "Forge Backend",
    role: "Backend",
    stage: "workers",
    specialty: "Services, APIs & data models",
    model: "",
    profile: "default",
    prompt:
      "Implement maintainable backend services. Respect existing contracts, validate inputs, and explain evidence for correctness.",
    url: "",
    enabled: true,
    active_run: false,
  },
  {
    id: "frontend-worker",
    name: "Relay Frontend",
    role: "Frontend",
    stage: "workers",
    specialty: "Accessible product interfaces",
    model: "",
    profile: "default",
    prompt:
      "Build responsive, accessible interfaces using the existing design system. Handle empty, error, and keyboard interaction states.",
    url: "",
    enabled: true,
    active_run: false,
  },
  {
    id: "qa-inspector",
    name: "Sentinel QA",
    role: "QA",
    stage: "qa",
    specialty: "Regression & acceptance testing",
    model: "",
    profile: "default",
    prompt:
      "Evaluate work against acceptance criteria. Report reproducible defects and clearly distinguish executed tests from proposed tests.",
    url: "",
    enabled: true,
    active_run: false,
  },
  {
    id: "lead-reviewer",
    name: "Lens Reviewer",
    role: "Security",
    stage: "reviewer",
    specialty: "Security & risk review",
    model: "",
    profile: "default",
    prompt:
      "Review trust boundaries, permissions, and data handling. Report evidence-backed risks with practical remediation steps.",
    url: "",
    enabled: true,
    active_run: false,
  },
];

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("agents")
      .upsert(STARTER_AGENTS, { onConflict: "id", ignoreDuplicates: true })
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, seededCount: data?.length || 0 }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to seed agents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
