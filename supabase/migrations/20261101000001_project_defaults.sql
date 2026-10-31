-- Shared defaults affect only newly created missions.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS mission_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;
