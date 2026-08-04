// ─── ROLES ────────────────────────────────────────────────────────────────────
// Pure, dependency-free role logic shared by tenancy resolution and route
// guards. Kept free of Clerk/Next imports so it stays unit-testable.
//
// SourceIQ recognizes three internal roles, ranked:
//   owner  (3) — the sole principal of a personal workspace, or a Clerk org owner
//   admin  (2) — a Clerk org admin: manages billing, settings, members
//   member (1) — a Clerk org member: runs discovery/outreach, no billing/admin
//
// Clerk's default roles are `org:admin` and `org:member` (the creator is an
// admin). A user with no active Clerk org is acting in their own personal
// workspace and is therefore its owner.

export type OrgRole = "owner" | "admin" | "member";

const RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

/** Numeric rank for a role (unknown → 0). */
export function roleRank(role: OrgRole): number {
  return RANK[role] ?? 0;
}

/** True when `role` meets or exceeds the `min` required role. */
export function atLeast(role: OrgRole, min: OrgRole): boolean {
  return roleRank(role) >= roleRank(min);
}

/**
 * Map a Clerk org role string (e.g. "org:admin") to an internal role.
 * When the principal has no active Clerk org, they own their personal workspace.
 * Unknown/custom roles fall back to the least-privileged `member` (fail-safe).
 */
export function mapClerkRole(clerkRole: string | null | undefined, hasOrg: boolean): OrgRole {
  if (!hasOrg) return "owner";
  if (!clerkRole) return "member";
  const r = clerkRole.replace(/^org:/, "").toLowerCase();
  if (r === "owner") return "owner";
  if (r === "admin") return "admin";
  return "member";
}
