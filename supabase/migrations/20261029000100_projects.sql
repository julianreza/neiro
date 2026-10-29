-- Project folders added by hand on the Projects page.
-- Folders that only appear through missions need no row here.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Real path of the folder on the machine running Neiro.
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_created_idx ON projects (created_at DESC);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
