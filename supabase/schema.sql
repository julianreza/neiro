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
