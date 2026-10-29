-- Link missions and questions to the project (folder) they ran in.
-- Run after 20261029000100_projects.sql. Idempotent: safe to run more than once.
-- mission_tasks and mission_artifacts reach their project through missions.

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS missions_project_idx ON missions (project_id, created_at DESC);

ALTER TABLE ask_questions
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ask_questions_project_idx ON ask_questions (project_id, created_at DESC);

-- Every folder a mission already ran in becomes a project.
INSERT INTO projects (path, name)
SELECT DISTINCT p, regexp_replace(p, '^.*/', '')
FROM (
  SELECT rtrim(COALESCE(NULLIF(repo_root, ''), NULLIF(workspace_path, '')), '/') AS p
  FROM missions
) s
WHERE p IS NOT NULL AND p <> ''
ON CONFLICT (path) DO NOTHING;

-- Question folders not inside any project become projects too.
INSERT INTO projects (path, name)
SELECT DISTINCT q.p, regexp_replace(q.p, '^.*/', '')
FROM (SELECT rtrim(workspace_path, '/') AS p FROM ask_questions) q
WHERE q.p <> ''
  AND NOT EXISTS (
    SELECT 1 FROM projects pr WHERE q.p = pr.path OR starts_with(q.p, pr.path || '/')
  )
ON CONFLICT (path) DO NOTHING;

-- Link each row to the deepest project folder that holds it.
UPDATE missions m
SET project_id = (
  SELECT pr.id FROM projects pr
  WHERE f.p = pr.path OR starts_with(f.p, pr.path || '/')
  ORDER BY length(pr.path) DESC
  LIMIT 1
)
FROM (
  SELECT id, rtrim(COALESCE(NULLIF(repo_root, ''), NULLIF(workspace_path, '')), '/') AS p FROM missions
) f
WHERE f.id = m.id AND m.project_id IS NULL AND f.p IS NOT NULL AND f.p <> '';

UPDATE ask_questions a
SET project_id = (
  SELECT pr.id FROM projects pr
  WHERE rtrim(a.workspace_path, '/') = pr.path OR starts_with(rtrim(a.workspace_path, '/'), pr.path || '/')
  ORDER BY length(pr.path) DESC
  LIMIT 1
)
WHERE a.project_id IS NULL AND a.workspace_path <> '';
