-- Hermes full suite: memory, recovery, approvals, cache tokens, sub-agents,
-- Bot Mode rooms, two-way bot replies and image attachments.
-- Idempotent: safe to run more than once.

-- agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reasoning_effort TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS service_tier TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS canonical_session_id TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS bot_section TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS bot_hidden BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_reasoning_effort_check') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_reasoning_effort_check CHECK (
      reasoning_effort IS NULL OR reasoning_effort IN
      ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra')
    );
  END IF;
END $$;

-- missions
ALTER TABLE missions ADD COLUMN IF NOT EXISTS learn_skill_on_done BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- mission_tasks
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS cache_read_tokens INT NOT NULL DEFAULT 0;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS cache_write_tokens INT NOT NULL DEFAULT 0;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS runtime_provider TEXT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS runtime_model TEXT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS pending_controls JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS admission_id TEXT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS execution_generation INT;
ALTER TABLE mission_tasks ADD COLUMN IF NOT EXISTS subagent_runs JSONB NOT NULL DEFAULT '[]'::jsonb;

-- notifications: action buttons (Telegram callback lookups)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ask_questions: send a /ask answer back to a chat app once
ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS reply_to TEXT;
ALTER TABLE ask_questions ADD COLUMN IF NOT EXISTS reply_sent_at TIMESTAMPTZ;

-- bot_rooms: Hermes Bot Mode group chats (2-6 bots)
CREATE TABLE IF NOT EXISTS bot_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  member_agent_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  detect_stop_directives BOOLEAN NOT NULL DEFAULT true,
  needs_you BOOLEAN NOT NULL DEFAULT false,
  pinned BOOLEAN NOT NULL DEFAULT false,
  section TEXT,
  member_sessions JSONB NOT NULL DEFAULT '{}'::jsonb,
  driver JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bot_rooms ADD COLUMN IF NOT EXISTS driver JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_rooms_member_count_check') THEN
    ALTER TABLE bot_rooms ADD CONSTRAINT bot_rooms_member_count_check CHECK (
      jsonb_typeof(member_agent_ids) = 'array'
      AND jsonb_array_length(member_agent_ids) BETWEEN 2 AND 6
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bot_room_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES bot_rooms(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('user', 'bot', 'system')),
  sender_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  thread_root_id TEXT,
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_room_messages_room_created_idx
  ON bot_room_messages (room_id, created_at);

-- Server-only access through the service role; no public policy.
ALTER TABLE bot_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_room_messages ENABLE ROW LEVEL SECURITY;
