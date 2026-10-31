import { z } from "zod";

export const moderationInput = z.object({
  scriptId: z.string().uuid(),
  action: z.enum(["disable", "restore", "delete"]),
});

export function hostingAllowed(script: { enabled: boolean; moderation_disabled: boolean }) {
  return script.enabled && !script.moderation_disabled;
}