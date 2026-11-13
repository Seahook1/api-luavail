-- Repair token columns used by the public session-init endpoint.
-- Safe to run even if the earlier feature migrations were already applied.
ALTER TABLE public.execution_tokens
  ADD COLUMN IF NOT EXISTS executor text DEFAULT 'Unknown',
  ADD COLUMN IF NOT EXISTS roblox_username text,
  ADD COLUMN IF NOT EXISTS roblox_display_name text,
  ADD COLUMN IF NOT EXISTS canary text,
  ADD COLUMN IF NOT EXISTS heartbeat_token text,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_tokens_heartbeat_token
  ON public.execution_tokens (heartbeat_token)
  WHERE heartbeat_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_execution_tokens_live_sessions
  ON public.execution_tokens (key_id, hwid, session_expires_at)
  WHERE consumed = true AND revoked = false;

ALTER TABLE public.execution_logs
  ADD COLUMN IF NOT EXISTS executor text DEFAULT 'Unknown',
  ADD COLUMN IF NOT EXISTS roblox_username text,
  ADD COLUMN IF NOT EXISTS roblox_display_name text;
