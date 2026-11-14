-- Add fields used by single-use delivery tokens and active-session heartbeats.
-- This migration intentionally does not depend on pg_cron being installed.

ALTER TABLE public.execution_tokens
  ADD COLUMN IF NOT EXISTS heartbeat_token      text,
  ADD COLUMN IF NOT EXISTS canary               text,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at    timestamptz,
  ADD COLUMN IF NOT EXISTS session_expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS revoked              boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_tokens_heartbeat_token
  ON public.execution_tokens (heartbeat_token) WHERE heartbeat_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_execution_tokens_live_sessions
  ON public.execution_tokens (key_id, hwid, session_expires_at)
  WHERE consumed = true AND revoked = false;

ALTER TABLE public.license_keys
  ADD COLUMN IF NOT EXISTS last_rebind_at          timestamptz,
  ADD COLUMN IF NOT EXISTS max_concurrent_sessions int NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.banned_hwids (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hwid       text NOT NULL UNIQUE,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.banned_hwids ENABLE ROW LEVEL SECURITY;

-- Session expiry is enforced by the heartbeat endpoint itself. Avoid making
-- this migration fail on projects where the optional pg_cron extension is absent.
