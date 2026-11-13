-- API Luavail platform tools: per-script VM controls, owner lockdown, support tickets and webhook history.
ALTER TABLE public.scripts
  ADD COLUMN IF NOT EXISTS vm_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vm_passes smallint NOT NULL DEFAULT 2;
ALTER TABLE public.scripts
  DROP CONSTRAINT IF EXISTS scripts_vm_passes_check;
ALTER TABLE public.scripts
  ADD CONSTRAINT scripts_vm_passes_check CHECK (vm_passes BETWEEN 1 AND 3);

CREATE TABLE IF NOT EXISTS public.platform_settings (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  emergency_lockdown boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage platform settings" ON public.platform_settings;
CREATE POLICY "Owners manage platform settings" ON public.platform_settings
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
  message text NOT NULL CHECK (char_length(message) BETWEEN 5 AND 5000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  reply text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_owner_created_idx ON public.support_tickets(owner_id, created_at DESC);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read own tickets" ON public.support_tickets;
CREATE POLICY "Owners read own tickets" ON public.support_tickets FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "Owners create own tickets" ON public.support_tickets;
CREATE POLICY "Owners create own tickets" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  script_id uuid REFERENCES public.scripts(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('success','failed')),
  response_code integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_owner_created_idx ON public.webhook_deliveries(owner_id, created_at DESC);
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read own webhook deliveries" ON public.webhook_deliveries;
CREATE POLICY "Owners read own webhook deliveries" ON public.webhook_deliveries FOR SELECT TO authenticated USING (owner_id = auth.uid());
