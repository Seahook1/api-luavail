ALTER TABLE public.scripts
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_success_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS webhook_failure_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.script_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS script_versions_script_created_idx
  ON public.script_versions(script_id, created_at DESC);
ALTER TABLE public.script_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can read script versions" ON public.script_versions
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Owners can restore script versions" ON public.script_versions
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.capture_script_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.source IS DISTINCT FROM NEW.source THEN
    INSERT INTO public.script_versions(script_id, owner_id, source)
    VALUES (OLD.id, OLD.owner_id, OLD.source);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scripts_capture_version ON public.scripts;
CREATE TRIGGER scripts_capture_version
  BEFORE UPDATE OF source ON public.scripts
  FOR EACH ROW EXECUTE FUNCTION public.capture_script_version();

CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_owner_created_idx
  ON public.audit_events(owner_id, created_at DESC);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can read audit events" ON public.audit_events
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.capture_dashboard_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_id uuid;
  v_action text;
  v_type text := TG_TABLE_NAME;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id := OLD.id;
    IF TG_TABLE_NAME = 'scripts' THEN v_owner := OLD.owner_id;
    ELSE v_owner := OLD.owner_id; END IF;
    v_action := 'deleted';
  ELSIF TG_OP = 'INSERT' THEN
    v_id := NEW.id;
    v_owner := NEW.owner_id;
    v_action := 'created';
  ELSE
    v_id := NEW.id;
    v_owner := NEW.owner_id;
    v_action := 'updated';
  END IF;
  IF v_owner IS NOT NULL THEN
    INSERT INTO public.audit_events(owner_id, action, entity_type, entity_id)
    VALUES (v_owner, v_action, v_type, v_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scripts_audit_changes ON public.scripts;
CREATE TRIGGER scripts_audit_changes AFTER INSERT OR UPDATE OR DELETE ON public.scripts
  FOR EACH ROW EXECUTE FUNCTION public.capture_dashboard_audit();
DROP TRIGGER IF EXISTS keys_audit_changes ON public.license_keys;
CREATE TRIGGER keys_audit_changes AFTER INSERT OR UPDATE OR DELETE ON public.license_keys
  FOR EACH ROW EXECUTE FUNCTION public.capture_dashboard_audit();

CREATE TABLE IF NOT EXISTS public.api_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  method text NOT NULL,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_usage_owner_created_idx
  ON public.api_usage_events(owner_id, created_at DESC);
ALTER TABLE public.api_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can read API usage" ON public.api_usage_events
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
