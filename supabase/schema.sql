-- Neiro Supabase Schema
-- Idempotent initialization with RLS enabled on all tables

-- 1. Agents table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'workers',
  specialty TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'Claude Sonnet 4.6',
  profile TEXT NOT NULL DEFAULT 'default',
  prompt TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  key_enc TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  active_run BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Missions table
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_plan_approval',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Mission Tasks table
CREATE TABLE IF NOT EXISTS mission_tasks (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'Queued',
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  tokens INT NOT NULL DEFAULT 0,
  depends JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval BOOLEAN NOT NULL DEFAULT false,
  retries INT NOT NULL DEFAULT 0,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mission_tasks_mission_id ON mission_tasks(mission_id);

-- 4. Mission Artifacts table
CREATE TABLE IF NOT EXISTS mission_artifacts (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES mission_tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'document',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mission_artifacts_mission_id ON mission_artifacts(mission_id);

-- 5. App State table (key-value store for singleton states / tick tracking)
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Enable Row Level Security (RLS) on all tables with zero public policies (server-only via service role)
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

-- 7. Seed 6 default starter agents (on conflict do nothing)
INSERT INTO agents (id, name, role, stage, specialty, model, profile, prompt, url, enabled, active_run)
VALUES
  (
    'pm-orchestrator',
    'Neiro PM',
    'PM',
    'orchestrator',
    'Mission planning & delegation',
    'Claude Opus 4.6',
    'coordinator',
    'Break missions into clear deliverables. Delegate work, track dependencies, and escalate blockers. Never claim work is complete without evidence.',
    '',
    true,
    false
  ),
  (
    'spec-writer',
    'Scribe PRD',
    'PRD',
    'spec',
    'Requirements & acceptance criteria',
    'Claude Sonnet 4.6',
    'product',
    'Turn goals into precise requirements, constraints, and testable acceptance criteria. Surface unanswered questions before implementation.',
    '',
    true,
    false
  ),
  (
    'backend-worker',
    'Forge Backend',
    'Backend',
    'workers',
    'Services, APIs & data models',
    'GPT-5.4',
    'engineering',
    'Implement maintainable backend services. Respect existing contracts, validate inputs, and explain evidence for correctness.',
    '',
    true,
    false
  ),
  (
    'frontend-worker',
    'Relay Frontend',
    'Frontend',
    'workers',
    'Accessible product interfaces',
    'Claude Sonnet 4.6',
    'operations',
    'Build responsive, accessible interfaces using the existing design system. Handle empty, error, and keyboard interaction states.',
    '',
    true,
    false
  ),
  (
    'qa-inspector',
    'Sentinel QA',
    'QA',
    'qa',
    'Regression & acceptance testing',
    'GPT-5.4',
    'quality',
    'Evaluate work against acceptance criteria. Report reproducible defects and clearly distinguish executed tests from proposed tests.',
    '',
    true,
    false
  ),
  (
    'lead-reviewer',
    'Lens Reviewer',
    'Security',
    'reviewer',
    'Security & risk review',
    'Claude Opus 4.6',
    'security',
    'Review trust boundaries, permissions, and data handling. Report evidence-backed risks with practical remediation steps.',
    '',
    true,
    false
  )
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 8. Migration: orchestrator correctness fixes (PR #1 review)
--    Idempotent: safe to re-run on an existing database.
-- =====================================================================

-- 8.1 missions: operator controls, engine phase + run tracking, last error
ALTER TABLE missions ADD COLUMN IF NOT EXISTS pause_after_planning BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS max_parallel_workers INT NOT NULL DEFAULT 3;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS max_retries INT NOT NULL DEFAULT 2;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS workspace_path TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'planning';
ALTER TABLE missions ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS run_agent_id TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS run_started_at TIMESTAMPTZ;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_max_parallel_workers_chk') THEN
    ALTER TABLE missions ADD CONSTRAINT missions_max_parallel_workers_chk
      CHECK (max_parallel_workers BETWEEN 1 AND 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_max_retries_chk') THEN
    ALTER TABLE missions ADD CONSTRAINT missions_max_retries_chk
      CHECK (max_retries BETWEEN 0 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missions_phase_chk') THEN
    ALTER TABLE missions ADD CONSTRAINT missions_phase_chk
      CHECK (phase IN ('planning', 'spec', 'executing', 'summarizing', 'done'));
  END IF;
END $$;

-- 8.2 mission_tasks: DAG key, run tracking, coding output
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS task_key TEXT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS run_agent_id TEXT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS run_started_at TIMESTAMPTZ;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS result_output TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_tasks_key
  ON mission_tasks(mission_id, task_key) WHERE task_key IS NOT NULL;

-- 8.3 mission_artifacts: idempotent inserts
--     dedupe_key: plan:<missionId> | prd:<missionId> | summary:<missionId>
--                 | qa:<taskId>:<retries> | review:<taskId>:<retries>
ALTER TABLE mission_artifacts ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_artifacts_dedupe
  ON mission_artifacts(dedupe_key);

-- 8.4 Atomic task claim honoring missions.max_parallel_workers.
--     Serialized per mission with a transaction-scoped advisory lock so two
--     concurrent ticks cannot both see spare capacity and both claim.
CREATE OR REPLACE FUNCTION neiro_claim_task(p_task_id TEXT, p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_mission TEXT;
  v_max INT;
  v_active INT;
  v_rows INT;
BEGIN
  SELECT t.mission_id, m.max_parallel_workers
    INTO v_mission, v_max
    FROM mission_tasks t
    JOIN missions m ON m.id = t.mission_id
   WHERE t.id = p_task_id;

  IF v_mission IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_mission));

  SELECT count(*) INTO v_active
    FROM mission_tasks
   WHERE mission_id = v_mission
     AND (stage IN ('Coding', 'QA check', 'Final review') OR run_id IS NOT NULL);

  IF v_active >= v_max THEN
    RETURN false;
  END IF;

  UPDATE mission_tasks
     SET stage = 'Coding',
         run_id = p_token,
         run_started_at = NOW(),
         updated_at = NOW()
   WHERE id = p_task_id
     AND stage = 'Queued'
     AND run_id IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

-- Callable only by the service role (matches the zero-policy RLS model).
REVOKE ALL ON FUNCTION neiro_claim_task(TEXT, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION neiro_claim_task(TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION neiro_claim_task(TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION neiro_claim_task(TEXT, TEXT) TO service_role;
  END IF;
END $$;
