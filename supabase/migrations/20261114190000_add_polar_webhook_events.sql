-- Store verified Polar webhook IDs for idempotent delivery handling.
-- Only event metadata is retained here; payment payloads can contain customer data.
CREATE TABLE IF NOT EXISTS public.polar_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.polar_webhook_events ENABLE ROW LEVEL SECURITY;
