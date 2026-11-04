-- supabase/migrations/YYYYMMDDHHMMSS_create_execution_tokens.sql

-- 1. Create the table
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

-- 2. Indexes for fast lookups and pruning
CREATE INDEX IF NOT EXISTS idx_execution_tokens_token
  ON public.execution_tokens (token);

CREATE INDEX IF NOT EXISTS idx_execution_tokens_expires_at
  ON public.execution_tokens (expires_at);

-- 3. Enable Row Level Security
ALTER TABLE public.execution_tokens ENABLE ROW LEVEL SECURITY;

-- 4. No policies are created → anon / authenticated cannot read or write.
--    The service_role (supabaseAdmin) bypasses RLS automatically.
--    [reference:1][reference:2]

-- 5. (Optional) Revoke direct grants from anon and authenticated
REVOKE ALL ON public.execution_tokens FROM anon, authenticated;

-- 6. Schedule a cron job to delete expired tokens older than 10 minutes.
--    pg_cron must be enabled. [reference:3]
SELECT cron.schedule(
  'cleanup-expired-execution-tokens',
  '*/5 * * * *',                       -- every 5 minutes
  $$
    DELETE FROM public.execution_tokens
    WHERE expires_at < now() - interval '10 minutes';
  $$
);