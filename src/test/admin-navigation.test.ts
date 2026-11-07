import { describe, expect, it } from "vitest";
import { canShowAdminTab } from "@/lib/admin-navigation";

describe("Admin navigation access", () => {
  it("hides the tab from signed-out visitors even with stale access", () => {
    expect(canShowAdminTab(true, undefined, true)).toBe(false);
  });
  it("hides the tab from non-admin users", () => {
    expect(canShowAdminTab(true, "ordinary-user", false)).toBe(false);
  });
  it("hides the tab until session and access checks finish", () => {
    expect(canShowAdminTab(false, "admin-user", true)).toBe(false);
    expect(canShowAdminTab(true, "admin-user", undefined)).toBe(false);
  });
  it("shows the tab to verified administrators", () => {
    expect(canShowAdminTab(true, "admin-user", true)).toBe(true);
  });
});