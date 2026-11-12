ALTER TABLE public.execution_tokens
  ADD COLUMN IF NOT EXISTS roblox_username text,
  ADD COLUMN IF NOT EXISTS roblox_display_name text;

ALTER TABLE public.execution_logs
  ADD COLUMN IF NOT EXISTS roblox_username text,
  ADD COLUMN IF NOT EXISTS roblox_display_name text;
