"use client";

import { useState } from "react";
import { Check, Loader2, Send } from "lucide-react";

type Ctx = {
  supplier_name: string;
  country: string;
  contact_email: string | null;
  category: string;
  requirements: string;
  annual_spend: string | null;
  buyer: { name: string | null; role: string | null; company: string | null } | null;
};

// Supplier-facing RFI response form. Standalone (no app auth / no i18n provider):
// it's rendered on the public /supplier/rfi page, authorized by the token in the
// URL. Submits to the public /api/supplier-response endpoint.
export default function RfiForm({ token, ctx }: { token: string; ctx: Ctx }) {
  const [interested, setInterested] = useState<"yes" | "maybe" | "no" | "">("");
  const [capacity, setCapacity] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(ctx.contact_email || "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!interested && !message.trim()) {
      setError("Please tell us whether you're interested, or leave a message.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/supplier-response?t=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interested, capacity, lead_time: leadTime, message, contact_email: email }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.reason === "opted_out" ? "This contact has opted out." : "Something went wrong. Please try again.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="text-center py-8">
        <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
          <Check className="w-7 h-7 text-emerald-600" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Thank you — your response has been received.</h2>
        <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
          The buyer&apos;s procurement team will review it and reach out if there&apos;s a fit. You can close this page.
        </p>
      </div>
    );
  }

  const opt = (val: "yes" | "maybe" | "no", label: string, tone: string) => (
    <button
      type="button"
      onClick={() => setInterested(val)}
      aria-pressed={interested === val}
      className={`flex-1 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors ${
        interested === val ? tone : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2" id="interested-label">Are you interested in this opportunity?</label>
        <div className="flex gap-2" role="group" aria-labelledby="interested-label">
          {opt("yes", "Yes, interested", "border-emerald-300 bg-emerald-50 text-emerald-700")}
          {opt("maybe", "Tell me more", "border-blue-300 bg-blue-50 text-blue-700")}
          {opt("no", "Not a fit", "border-slate-300 bg-slate-100 text-slate-700")}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="capacity" className="block text-sm font-semibold text-slate-700 mb-1">Available capacity <span className="font-normal text-slate-500">(optional)</span></label>
          <input
            id="capacity"
            value={capacity} onChange={e => setCapacity(e.target.value)}
            placeholder="e.g. 50k units/year"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="lead_time" className="block text-sm font-semibold text-slate-700 mb-1">Indicative lead time <span className="font-normal text-slate-500">(optional)</span></label>
          <input
            id="lead_time"
            value={leadTime} onChange={e => setLeadTime(e.target.value)}
            placeholder="e.g. 8–10 weeks"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-semibold text-slate-700 mb-1">Message</label>
        <textarea
          id="message"
          value={message} onChange={e => setMessage(e.target.value)}
          rows={5}
          placeholder="Share anything relevant — certifications, relevant references, questions, or your best point of contact."
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>

      <div>
        <label htmlFor="contact_email" className="block text-sm font-semibold text-slate-700 mb-1">Your contact email</label>
        <input
          id="contact_email"
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="name@company.com"
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-3 text-sm transition-colors disabled:opacity-60"
      >
        {submitting
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
          : <><Send className="w-4 h-4" /> Send response</>}
      </button>
      <p className="text-[11px] text-slate-500 text-center">
        Your response is shared only with the buyer conducting this sourcing request.
      </p>
    </form>
  );
}
