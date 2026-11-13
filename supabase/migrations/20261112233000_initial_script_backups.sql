-- Keep an initial snapshot as well as each previous source version.
-- Updates save OLD.source before replacement; inserts save the initial NEW.source.
CREATE OR REPLACE FUNCTION public.capture_script_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source IS NOT NULL AND NEW.source <> '' THEN
      INSERT INTO public.script_versions(script_id, owner_id, source)
      VALUES (NEW.id, NEW.owner_id, NEW.source);
    END IF;
  ELSIF OLD.source IS DISTINCT FROM NEW.source THEN
    IF OLD.source IS NOT NULL AND OLD.source <> '' THEN
      INSERT INTO public.script_versions(script_id, owner_id, source)
      VALUES (OLD.id, OLD.owner_id, OLD.source);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scripts_capture_version ON public.scripts;
CREATE TRIGGER scripts_capture_version
  BEFORE INSERT OR UPDATE OF source ON public.scripts
  FOR EACH ROW EXECUTE FUNCTION public.capture_script_version();
