import { describe, expect, it } from "vitest";
import { hostingAllowed, moderationInput } from "@/lib/moderation";

describe("Script moderation", () => {
  it("blocks admin-disabled hosting even when the owner enables it", () => {
    expect(hostingAllowed({ enabled: true, moderation_disabled: true })).toBe(false);
  });
  it("restores hosting only if the seller also enables it", () => {
    expect(hostingAllowed({ enabled: true, moderation_disabled: false })).toBe(true);
    expect(hostingAllowed({ enabled: false, moderation_disabled: false })).toBe(false);
  });
  it("allows disable, restore and delete but rejects arbitrary commands", () => {
    const scriptId = "00000000-0000-4000-8000-000000000001";
    for (const action of ["disable", "restore", "delete"]) {
      expect(moderationInput.safeParse({ scriptId, action }).success).toBe(true);
    }
    expect(moderationInput.safeParse({ scriptId, action: "grant-admin" }).success).toBe(false);
  });
});
