import { getDb } from "@/lib/db";
import type { Organization } from "@/lib/db";
type Db = ReturnType<typeof getDb>;

// ─── QUICK-START CHECKLIST ────────────────────────────────────────────────────
// A per-org activation checklist that fuses onboarding with the referral
// growth loop: each completed task grants bonus events, the same currency
// referrals use (see lib/usage.ts's effectiveEventLimit). Three tasks are
// auto-detected from existing org data (event created, supplier shortlisted,
// outreach launched); the fourth (sharing the referral link) is reported
// explicitly by the client. Progress persists as a JSON {taskKey: isoTimestamp}
// blob on organizations.checklist_progress, so it's per-org (not per-user like
// the old Clerk-metadata dismissal) and survives across sessions/devices.

// Single source of truth for the checklist reward — tune here only.
export const CHECKLIST_TASK_BONUS_EVENTS = 1;

export type ChecklistTaskKey =
  | "create_event"
  | "shortlist_supplier"
  | "launch_outreach"
  | "share_referral";

export type ChecklistTaskDef = {
  key: ChecklistTaskKey;
  title: string;
  description: string;
  auto: boolean; // true = server detects completion from existing data; false = client must report it
};

export const CHECKLIST_TASKS: ChecklistTaskDef[] = [
  {
    key: "create_event",
    title: "Create your first sourcing event",
    description: "Describe what you need — our AI drafts the brief in seconds.",
    auto: true,
  },
  {
    key: "shortlist_supplier",
    title: "Shortlist a supplier",
    description: "Review the AI-built long list and shortlist a supplier you like.",
    auto: true,
  },
  {
    key: "launch_outreach",
    title: "Launch outreach",
    description: "Send your first outreach message to a shortlisted supplier.",
    auto: true,
  },
  {
    key: "share_referral",
    title: "Share your referral link",
    description: "Invite a colleague — you both earn bonus events when they subscribe.",
    auto: false,
  },
];

/** Whether a task key exists and is one the client may explicitly mark complete. */
export function isExplicitlyCompletable(key: string): key is ChecklistTaskKey {
  const def = CHECKLIST_TASKS.find((t) => t.key === key);
  return !!def && !def.auto;
}

export type ChecklistTaskState = ChecklistTaskDef & { completedAt: string | null };

export type ChecklistState = {
  tasks: ChecklistTaskState[];
  completedCount: number;
  totalCount: number;
  bonusEventsEarned: number;
  allComplete: boolean;
  /** Most recently created event's id, or null if the org has none yet — lets
   * the checklist's "Shortlist a supplier"/"Launch outreach" CTAs deep-link
   * into that actual event instead of dumping the buyer on /dashboard. */
  latestEventId: number | null;
};

/** Parse the persisted checklist_progress JSON blob, tolerating bad/missing data. */
export function parseChecklistProgress(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    /* malformed JSON — treat as empty */
  }
  return {};
}

/** Build the full checklist view from a progress map. */
export function buildChecklistState(
  progress: Record<string, string>,
  latestEventId: number | null = null
): ChecklistState {
  const tasks = CHECKLIST_TASKS.map((def) => ({
    ...def,
    completedAt: progress[def.key] ?? null,
  }));
  const completedCount = tasks.filter((t) => t.completedAt).length;
  return {
    tasks,
    completedCount,
    totalCount: tasks.length,
    bonusEventsEarned: completedCount * CHECKLIST_TASK_BONUS_EVENTS,
    allComplete: completedCount === tasks.length,
    latestEventId,
  };
}

/** The org's most recently created event id, or null if it has none yet. */
async function getLatestEventId(db: Db, orgId: number): Promise<number | null> {
  const row = (await db
    .prepare("SELECT id FROM sourcing_events WHERE org_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(orgId)) as { id: number } | undefined;
  return row ? Number(row.id) : null;
}

/**
 * Merge freshly-detected/completed task keys into a progress map without
 * clobbering already-recorded completion timestamps. Returns the merged map
 * plus exactly which keys were newly completed by this merge, so the caller
 * knows precisely how many bonus events to grant (and never double-grants).
 */
export function mergeAutoDetected(
  progress: Record<string, string>,
  detectedKeys: ChecklistTaskKey[],
  now: string = new Date().toISOString()
): { merged: Record<string, string>; newlyCompleted: ChecklistTaskKey[] } {
  const merged = { ...progress };
  const newlyCompleted: ChecklistTaskKey[] = [];
  for (const key of detectedKeys) {
    if (!merged[key]) {
      merged[key] = now;
      newlyCompleted.push(key);
    }
  }
  return { merged, newlyCompleted };
}

/** Which auto-detectable tasks are objectively true for this org right now. */
async function detectAutoTasks(db: Db, orgId: number): Promise<ChecklistTaskKey[]> {
  const detected: ChecklistTaskKey[] = [];

  const evt = (await db
    .prepare("SELECT 1 AS x FROM sourcing_events WHERE org_id = ? LIMIT 1")
    .get(orgId)) as { x: number } | undefined;
  if (evt) detected.push("create_event");

  // 'long_list' is the sole starting funnel_stage, so "<> 'long_list'" means
  // the buyer has shortlisted (or moved further past) at least one supplier.
  const shortlisted = (await db
    .prepare(
      `SELECT 1 AS x FROM suppliers s
       JOIN sourcing_events se ON se.id = s.event_id
       WHERE se.org_id = ? AND s.funnel_stage <> 'long_list' LIMIT 1`
    )
    .get(orgId)) as { x: number } | undefined;
  if (shortlisted) detected.push("shortlist_supplier");

  // 'pending' is the sole starting outreach_status, so "<> 'pending'" means
  // outreach has actually been sent to at least one supplier.
  const outreach = (await db
    .prepare(
      `SELECT 1 AS x FROM suppliers s
       JOIN sourcing_events se ON se.id = s.event_id
       WHERE se.org_id = ? AND s.outreach_status <> 'pending' LIMIT 1`
    )
    .get(orgId)) as { x: number } | undefined;
  if (outreach) detected.push("launch_outreach");

  return detected;
}

/** Persist a progress map and grant bonus events for newly-completed tasks. */
async function persistProgress(
  db: Db,
  orgId: number,
  merged: Record<string, string>,
  newlyCompletedCount: number
): Promise<void> {
  if (newlyCompletedCount === 0) return;
  const bonus = newlyCompletedCount * CHECKLIST_TASK_BONUS_EVENTS;
  await db
    .prepare(
      `UPDATE organizations
          SET checklist_progress = ?, bonus_events = bonus_events + ?, updated_at = now()
        WHERE id = ?`
    )
    .run(JSON.stringify(merged), bonus, orgId);
}

/**
 * Get the current checklist state for an org, auto-detecting and persisting
 * (with a bonus-event grant) any newly-completed auto tasks along the way.
 * Safe to call on every dashboard/settings load — it's a no-op write when
 * nothing new was detected.
 */
export async function getChecklistState(db: Db, org: Organization): Promise<ChecklistState> {
  const progress = parseChecklistProgress(org.checklist_progress);
  const detected = await detectAutoTasks(db, org.id);
  const { merged, newlyCompleted } = mergeAutoDetected(progress, detected);
  if (newlyCompleted.length > 0) {
    await persistProgress(db, org.id, merged, newlyCompleted.length);
  }
  const latestEventId = await getLatestEventId(db, org.id);
  return buildChecklistState(merged, latestEventId);
}

/**
 * Explicitly mark a client-reported (non-auto) task complete — e.g.
 * "share_referral" when the user copies their referral link. Idempotent:
 * completing an already-completed task is a no-op and grants nothing extra.
 * Silently ignores auto-only or unknown keys rather than throwing, since the
 * route layer is expected to validate with isExplicitlyCompletable() first.
 */
export async function completeChecklistTask(
  db: Db,
  org: Organization,
  key: ChecklistTaskKey
): Promise<ChecklistState> {
  const progress = parseChecklistProgress(org.checklist_progress);
  const latestEventId = await getLatestEventId(db, org.id);
  if (!isExplicitlyCompletable(key)) {
    return buildChecklistState(progress, latestEventId);
  }
  const { merged, newlyCompleted } = mergeAutoDetected(progress, [key]);
  if (newlyCompleted.length > 0) {
    await persistProgress(db, org.id, merged, newlyCompleted.length);
  }
  return buildChecklistState(merged, latestEventId);
}
