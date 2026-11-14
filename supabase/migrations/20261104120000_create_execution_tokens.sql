-- Create the short-lived, single-use execution-token table.
-- Keep this migration independent of pg_cron: managed Supabase projects may
-- not have the pg_cron extension enabled, and a failed cron.schedule call
-- would roll back the table creation itself.

CREATE TABLE IF NOT EXISTS public.execution_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text NOT NULL UNIQUE,
  script_id   uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  key_id      uuid REFERENCES public.license_keys(id) ON DELETE SET NULL,
  hwid        text NOT NULL,
  ip          text,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'),
  consumed    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_tokens_token
  ON public.execution_tokens (token);

CREATE INDEX IF NOT EXISTS idx_execution_tokens_expires_at
  ON public.execution_tokens (expires_at);

ALTER TABLE public.execution_tokens ENABLE ROW LEVEL SECURITY;

-- No client policies: only the server-side service-role client may access this table.
REVOKE ALL ON public.execution_tokens FROM anon, authenticated;

-- Expired-token cleanup is also performed opportunistically by the API.
-- Do not require pg_cron during schema setup.
