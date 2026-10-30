-- Code review: one row per review of a GitHub pull request, started by hand
-- from /reviews (source = 'manual') or by a Build / Fix mission before its
-- Final review stage (source = 'mission'). Re-running a review adds a new row,
-- so earlier versions are kept.
-- Missions also remember their composer mode and the PR the mission opened.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS code_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- "owner/repo"
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  pr_url TEXT NOT NULL,
  pr_title TEXT,
  head_ref TEXT,
  base_ref TEXT,
  -- [{ "path": "...", "additions": 1, "deletions": 0 }]
  files JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL CHECK (source IN ('manual', 'mission')),
  mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES mission_tasks(id) ON DELETE SET NULL,
  -- Which attempt of the task this review belongs to (mission_tasks.retries).
  task_attempt INTEGER,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  model TEXT,
  runtime TEXT,
  run_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'fetching', 'reviewing', 'done', 'failed')),
  verdict TEXT CHECK (verdict IN ('approve', 'request_changes', 'comment')),
  summary TEXT,
  -- [{ "id", "severity", "file", "line", "problem", "consequence", "suggestion", "posted" }]
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_output TEXT,
  error TEXT,
  tokens INTEGER NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  posted_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS code_reviews_created_idx ON code_reviews (created_at DESC);
CREATE INDEX IF NOT EXISTS code_reviews_mission_idx ON code_reviews (mission_id);
CREATE INDEX IF NOT EXISTS code_reviews_task_idx ON code_reviews (task_id, task_attempt);
CREATE INDEX IF NOT EXISTS code_reviews_active_idx ON code_reviews (status)
  WHERE status IN ('queued', 'fetching', 'reviewing');

ALTER TABLE code_reviews ENABLE ROW LEVEL SECURITY;

-- Composer mode of the mission; NULL for missions made before this.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS mode TEXT
  CHECK (mode IN ('build', 'fix', 'plan'));
-- The draft PR the mission opened from its neiro/<mission> branch.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS pr_url TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS pr_number INTEGER;

NOTIFY pgrst, 'reload schema';
