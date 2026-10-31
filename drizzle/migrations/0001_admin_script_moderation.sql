CREATE TYPE public.app_role AS ENUM ('admin');
CREATE TABLE public.user_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role public.app_role NOT NULL,
 UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS (SELECT 1 FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id WHERE r.user_id = _user_id AND r.role = _role AND u.email_confirmed_at IS NOT NULL AND lower(u.email) = 'bypaddasja@gmail.com')
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
CREATE FUNCTION public.assign_designated_admin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.email_confirmed_at IS NOT NULL AND lower(NEW.email) = 'bypaddasja@gmail.com' THEN
 INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER assign_designated_admin_on_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.assign_designated_admin();
CREATE TRIGGER assign_designated_admin_on_verification AFTER UPDATE OF email_confirmed_at, email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.assign_designated_admin();
INSERT INTO public.user_roles(user_id, role) SELECT id, 'admin'::public.app_role FROM auth.users WHERE lower(email) = 'bypaddasja@gmail.com' AND email_confirmed_at IS NOT NULL ON CONFLICT DO NOTHING;
ALTER TABLE public.scripts ADD COLUMN moderation_disabled boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.protect_script_moderation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF auth.role() = 'authenticated' THEN
 IF (TG_OP = 'INSERT' AND NEW.moderation_disabled) OR (TG_OP = 'UPDATE' AND NEW.moderation_disabled IS DISTINCT FROM OLD.moderation_disabled) THEN
 IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only administrators can change moderation status'; END IF;
 END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER protect_script_moderation BEFORE INSERT OR UPDATE ON public.scripts FOR EACH ROW EXECUTE FUNCTION public.protect_script_moderation();
CREATE FUNCTION public.admin_list_scripts() RETURNS SETOF public.scripts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrator access required'; END IF;
 RETURN QUERY SELECT * FROM public.scripts ORDER BY created_at DESC;
END;
$$;
CREATE FUNCTION public.admin_moderate_script(_script_id uuid, _action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrator access required'; END IF;
 IF _action = 'delete' THEN
 DELETE FROM public.scripts WHERE id = _script_id;
 ELSIF _action IN ('disable','restore') THEN
 UPDATE public.scripts SET moderation_disabled = (_action = 'disable') WHERE id = _script_id;
 ELSE RAISE EXCEPTION 'Invalid moderation action';
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Script not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_scripts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_moderate_script(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_scripts(), public.admin_moderate_script(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.assign_designated_admin(), public.protect_script_moderation() FROM PUBLIC;