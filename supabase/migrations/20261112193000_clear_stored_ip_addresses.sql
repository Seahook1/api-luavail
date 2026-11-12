-- Clear previously stored client IP addresses and prevent old values remaining in execution history.
UPDATE public.execution_tokens SET ip = NULL WHERE ip IS NOT NULL;
UPDATE public.execution_logs SET ip = NULL WHERE ip IS NOT NULL;
