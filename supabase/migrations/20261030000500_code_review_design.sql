-- Code review page, Sage-style layout: the reviewer's design gate
-- (problem / why it matters / solution fit) for the whole change.
-- Finding fields (title, category, observation, evidence, dismissed) live
-- inside code_reviews.findings (JSONB), so they need no column.
-- Idempotent: safe to run more than once.

ALTER TABLE code_reviews ADD COLUMN IF NOT EXISTS design JSONB;

NOTIFY pgrst, 'reload schema';
