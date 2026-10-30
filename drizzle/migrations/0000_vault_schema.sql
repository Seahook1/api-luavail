CREATE TABLE public.scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  source text NOT NULL DEFAULT '',
  executions integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT true,
  keyless boolean NOT NULL DEFAULT false,
  getkey_enabled boolean NOT NULL DEFAULT false,
  checkpoints text[] NOT NULL DEFAULT '{}',
  getkey_hours integer NOT NULL DEFAULT 24,
  discord_webhook text
);
CREATE TABLE public.license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  key text NOT NULL UNIQUE,
  note text,
  hwid text,
  banned boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  last_used_at timestamptz,
  hwid_reset_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scripts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.license_keys TO authenticated;
GRANT ALL ON public.scripts TO service_role;
GRANT ALL ON public.license_keys TO service_role;
ALTER TABLE public.scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scripts" ON public.scripts FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own keys" ON public.license_keys FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid() AND EXISTS (SELECT 1 FROM public.scripts s WHERE s.id = script_id AND s.owner_id = auth.uid()));

CREATE TABLE public.execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  key_id uuid,
  key_note text,
  result text NOT NULL,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.execution_logs TO authenticated;
GRANT ALL ON public.execution_logs TO service_role;
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read logs" ON public.execution_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.scripts s WHERE s.id = script_id AND s.owner_id = auth.uid()));
CREATE POLICY "Owners delete logs" ON public.execution_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.scripts s WHERE s.id = script_id AND s.owner_id = auth.uid()));
CREATE INDEX ON public.execution_logs (script_id, created_at DESC);

CREATE TABLE public.getkey_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  step integer NOT NULL DEFAULT 0,
  step_started_at timestamptz,
  key text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.getkey_sessions TO service_role;
ALTER TABLE public.getkey_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.discord_links (
  user_id uuid PRIMARY KEY,
  guild_id text UNIQUE,
  link_code text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.discord_links TO authenticated;
GRANT ALL ON public.discord_links TO service_role;
ALTER TABLE public.discord_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own link select" ON public.discord_links FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own link insert" ON public.discord_links FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND guild_id IS NULL);
CREATE POLICY "Own link delete" ON public.discord_links FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own api keys select" ON public.api_keys FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Own api keys delete" ON public.api_keys FOR DELETE TO authenticated USING (owner_id = auth.uid());