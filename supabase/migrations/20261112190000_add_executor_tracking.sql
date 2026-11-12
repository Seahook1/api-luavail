ALTER TABLE public.execution_tokens
  ADD COLUMN IF NOT EXISTS executor text DEFAULT 'Unknown';

ALTER TABLE public.execution_logs
  ADD COLUMN IF NOT EXISTS executor text DEFAULT 'Unknown';
