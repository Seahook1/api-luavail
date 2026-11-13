-- Key center support. Uses existing license/session/audit tables and never stores network addresses.
ALTER TABLE public.license_keys
  ADD COLUMN IF NOT EXISTS max_concurrent_sessions integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS hwid_reset_at timestamptz;

CREATE INDEX IF NOT EXISTS license_keys_owner_script_created_idx
  ON public.license_keys(owner_id, script_id, created_at DESC);

-- Keep audit rows private to their owner; server-side service-role reads still work.
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_events'
      AND policyname = 'Owners can read audit events'
  ) THEN
    CREATE POLICY "Owners can read audit events" ON public.audit_events
      FOR SELECT TO authenticated USING (owner_id = auth.uid());
  END IF;
END $$;
