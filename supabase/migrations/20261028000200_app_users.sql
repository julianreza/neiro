-- Dashboard user accounts with a role. The DASHBOARD_SECRET passcode still
-- signs in as the built-in owner (admin), so this table may stay empty.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usernames are unique regardless of case.
CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_lower_idx ON app_users (lower(username));

-- Only the server (service role) touches this table.
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
