import { getDb } from "@/lib/db";
import RfiForm from "@/components/RfiForm";
import { Sparkles } from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── PUBLIC SUPPLIER RFI RESPONSE PAGE ────────────────────────────────────────
// Suppliers who received an RFI land here from the link in the email. No app
// session — authorized purely by the unguessable per-supplier reply token in
// the ?t= query param (same trust boundary as unsubscribe/inbound). Buyer
// identity is only shown when the sourcing event is NOT anonymous.

type Row = {
  id: number; name: string; country: string; contact_email: string | null;
  outreach_status: string; response_detail: string | null; opted_out: boolean | null;
  category: string; requirements: string; annual_spend: string | null;
  outreach_anonymous: boolean;
  buyer_name: string | null; buyer_role: string | null; buyer_company: string | null;
};

async function load(token: string | undefined): Promise<Row | undefined> {
  if (!token) return undefined;
  const db = getDb();
  return await db.prepare(`
    SELECT s.id, s.name, s.country, s.contact_email, s.outreach_status,
           s.response_detail, s.opted_out,
           se.category, se.requirements, se.annual_spend, se.outreach_anonymous,
           se.buyer_name, se.buyer_role, se.buyer_company
    FROM suppliers s JOIN sourcing_events se ON se.id = s.event_id
    WHERE s.reply_token = ?
  `).get(token) as Row | undefined;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-slate-900 tracking-tight">SourceIQ</span>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
          {children}
        </div>
        <p className="text-[11px] text-slate-500 text-center mt-6">
          Sent by SourceIQ on behalf of a buyer conducting a supplier sourcing search.
        </p>
      </div>
    </div>
  );
}

export default async function SupplierRfiPage({
  searchParams,
}: {
  searchParams: { t?: string };
}) {
  const row = await load(searchParams.t);

  if (!row) {
    return (
      <Shell>
        <h1 className="text-lg font-bold text-slate-900">Link not recognized</h1>
        <p className="text-sm text-slate-500 mt-2">
          This response link is invalid or has expired. If you received an RFI email, please reply to it directly.
        </p>
      </Shell>
    );
  }

  if (row.opted_out) {
    return (
      <Shell>
        <h1 className="text-lg font-bold text-slate-900">You&apos;ve opted out</h1>
        <p className="text-sm text-slate-500 mt-2">
          This contact has opted out of sourcing messages. No response is expected.
        </p>
      </Shell>
    );
  }

  const alreadyResponded = row.outreach_status === "responded" || !!row.response_detail;
  const disclosed = row.outreach_anonymous === false;

  return (
    <Shell>
      <div className="mb-6">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-blue-700 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full">
          Request for Information
        </span>
        <h1 className="text-xl font-bold text-slate-900 mt-3">
          {disclosed && row.buyer_company
            ? `${row.buyer_company} is sourcing ${row.category}`
            : `A buyer is sourcing ${row.category}`}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Hello {row.name} — you were identified as a potential supplier for this requirement.
        </p>
      </div>

      <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 mb-6 space-y-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Requirement</div>
          <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">{row.requirements}</p>
        </div>
        {row.annual_spend && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Indicative annual spend</div>
            <p className="text-sm text-slate-700 mt-0.5">{row.annual_spend}</p>
          </div>
        )}
        {disclosed && (row.buyer_name || row.buyer_role) && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Buyer contact</div>
            <p className="text-sm text-slate-700 mt-0.5">
              {[row.buyer_name, row.buyer_role].filter(Boolean).join(" · ")}
            </p>
          </div>
        )}
      </div>

      {alreadyResponded ? (
        <div className="text-center py-4">
          <h2 className="text-base font-bold text-slate-900">We&apos;ve already received your response.</h2>
          <p className="text-sm text-slate-500 mt-2">
            Thank you — there&apos;s nothing more to do. The buyer&apos;s team will be in touch if there&apos;s a fit.
          </p>
        </div>
      ) : (
        <RfiForm
          token={searchParams.t as string}
          ctx={{
            supplier_name: row.name,
            country: row.country,
            contact_email: row.contact_email,
            category: row.category,
            requirements: row.requirements,
            annual_spend: row.annual_spend,
            buyer: disclosed
              ? { name: row.buyer_name, role: row.buyer_role, company: row.buyer_company }
              : null,
          }}
        />
      )}
    </Shell>
  );
}
