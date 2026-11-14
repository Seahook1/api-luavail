-- Reconcile execution_tokens with every column used by the public session-init,
-- heartbeat, and delivery endpoints. This is a forward-only, idempotent repair
-- for databases where an earlier migration was skipped or partially applied.

CREATE TABLE IF NOT EXISTS public.execution_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  key_id uuid REFERENCES public.license_keys(id) ON DELETE SET NULL,
  hwid text NOT NULL,
  ip text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'),
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS idx_execution_tokens_token
  ON public.execution_tokens (token);

CREATE INDEX IF NOT EXISTS idx_execution_tokens_expires_at
  ON public.execution_tokens (expires_at);

ALTER TABLE public.execution_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.execution_tokens FROM anon, authenticated;
GRANT ALL ON public.execution_tokens TO service_role;

-- Refresh PostgREST's schema cache after the column repair.
NOTIFY pgrst, 'reload schema';
