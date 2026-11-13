-- Security telemetry intentionally excludes IP addresses, network addresses and raw HWIDs.
CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  script_id uuid REFERENCES public.scripts(id) ON DELETE CASCADE,
  key_id uuid REFERENCES public.license_keys(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_events_owner_created_idx ON public.security_events(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_script_type_created_idx ON public.security_events(script_id, event_type, created_at DESC);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners can read security events" ON public.security_events;
CREATE POLICY "Owners can read security events" ON public.security_events
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
