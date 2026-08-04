import { describe, it, expect } from "vitest";
import { roleRank, atLeast, mapClerkRole, type OrgRole } from "@/lib/roles";

describe("roleRank", () => {
  it("ranks owner > admin > member", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("member"));
  });
  it("returns 0 for an unknown role", () => {
    expect(roleRank("ghost" as OrgRole)).toBe(0);
  });
});

describe("atLeast", () => {
  it("passes when role meets or exceeds the minimum", () => {
    expect(atLeast("owner", "admin")).toBe(true);
    expect(atLeast("admin", "admin")).toBe(true);
    expect(atLeast("admin", "member")).toBe(true);
  });
  it("fails when role is below the minimum", () => {
    expect(atLeast("member", "admin")).toBe(false);
    expect(atLeast("member", "owner")).toBe(false);
    expect(atLeast("admin", "owner")).toBe(false);
  });
});

describe("mapClerkRole", () => {
  it("treats a principal with no active org as the owner of their workspace", () => {
    expect(mapClerkRole(null, false)).toBe("owner");
    expect(mapClerkRole("org:member", false)).toBe("owner");
  });
  it("maps Clerk org roles to internal roles", () => {
    expect(mapClerkRole("org:admin", true)).toBe("admin");
    expect(mapClerkRole("org:member", true)).toBe("member");
    expect(mapClerkRole("org:owner", true)).toBe("owner");
  });
  it("is case-insensitive and tolerates the missing org: prefix", () => {
    expect(mapClerkRole("ADMIN", true)).toBe("admin");
    expect(mapClerkRole("Admin", true)).toBe("admin");
  });
  it("fails safe to member for unknown/custom roles inside an org", () => {
    expect(mapClerkRole("org:billing_manager", true)).toBe("member");
    expect(mapClerkRole(null, true)).toBe("member");
    expect(mapClerkRole(undefined, true)).toBe("member");
  });
});
