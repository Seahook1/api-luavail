CREATE TABLE public.execution_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  heartbeat_token text UNIQUE,
  canary text,
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  key_id uuid REFERENCES public.license_keys(id) ON DELETE CASCADE,
  hwid text NOT NULL,
  ip text,
  expires_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  revoked boolean NOT NULL DEFAULT false,
  session_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execution_tokens_key_idx ON public.execution_tokens (key_id) WHERE consumed AND NOT revoked;
CREATE INDEX execution_tokens_expires_idx ON public.execution_tokens (expires_at);
GRANT ALL ON public.execution_tokens TO service_role;
ALTER TABLE public.execution_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.banned_hwids (
  hwid text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.banned_hwids TO service_role;
ALTER TABLE public.banned_hwids ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.license_keys
  ADD COLUMN last_rebind_at timestamptz,
  ADD COLUMN max_concurrent_sessions integer NOT NULL DEFAULT 1;