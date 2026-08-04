"use client";

import { useEffect, useState } from "react";
import { OrganizationSwitcher } from "@clerk/nextjs";
import { Users, Loader2 } from "lucide-react";
import { useT } from "@/components/LanguageProvider";

type Member = { id: string; name: string | null; email: string | null; role: string };
type Seats = { used: number; limit: number; unlimited: boolean; remaining: number | null };
type TeamData = { role: string; is_personal: boolean; seats: Seats; members: Member[] };

// Team & seats section for /settings. Membership/invites are handled by Clerk's
// native <OrganizationSwitcher> "Manage organization" flow, which enforces the
// seat cap the server keeps in sync with the plan. This surface adds the seat
// counter and a read-only roster so the state is visible without leaving.
export default function TeamSettings() {
  const t = useT();
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const seatLabel = data
    ? data.seats.unlimited
      ? t("Unlimited seats")
      : `${data.seats.used} / ${data.seats.limit} ${t("seats")}`
    : "";
  const overLimit = data && !data.seats.unlimited && data.seats.used >= data.seats.limit;
  const canManage = data?.role === "owner" || data?.role === "admin";

  return (
    <div className="card px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center flex-shrink-0">
            <Users className="w-4.5 h-4.5 text-violet-600" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900">{t("Team")}</div>
            <div className="text-xs text-slate-400 truncate">
              {loading ? (
                <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> {t("Loading…")}</span>
              ) : data?.is_personal ? (
                t("Invite teammates to share this workspace")
              ) : (
                seatLabel
              )}
            </div>
          </div>
        </div>
        {/* Clerk owns invites/roles; the switcher's "Manage organization" opens the members panel. */}
        <OrganizationSwitcher
          hidePersonal={false}
          afterCreateOrganizationUrl="/settings"
          afterLeaveOrganizationUrl="/settings"
          afterSelectOrganizationUrl="/settings"
        />
      </div>

      {!loading && data && !data.is_personal && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {overLimit && (
            <div className="mb-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {t("You've reached your plan's seat limit. Upgrade to invite more teammates.")}
            </div>
          )}
          <ul className="space-y-2">
            {data.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-slate-700 truncate">{m.name || m.email || t("Teammate")}</div>
                  {m.name && m.email && <div className="text-xs text-slate-400 truncate">{m.email}</div>}
                </div>
                <span className="badge-slate capitalize flex-shrink-0">{t(m.role)}</span>
              </li>
            ))}
          </ul>
          {!canManage && (
            <p className="mt-3 text-xs text-slate-400">{t("Only owners and admins can manage members.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
