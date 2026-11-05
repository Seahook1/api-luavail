CREATE OR REPLACE FUNCTION public.assign_designated_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
 IF NEW.email_confirmed_at IS NOT NULL AND lower(NEW.email) = 'apiluavail@proton.me' THEN
 INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT EXISTS (SELECT 1 FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id WHERE r.user_id = _user_id AND r.role = _role AND u.email_confirmed_at IS NOT NULL AND (_role <> 'admin' OR lower(u.email) = 'apiluavail@proton.me'))
$$;