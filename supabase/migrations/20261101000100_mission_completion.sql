-- Existing mission timestamps do not reliably prove when the mission finished.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS missions_completed_at_idx ON missions (completed_at DESC) WHERE status = 'completed';
