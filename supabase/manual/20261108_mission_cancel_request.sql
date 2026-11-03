-- A request remains durable until all associated runs have actually stopped.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
