"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Brain, Search, Scale, Lightbulb, ChevronRight, Sparkles, Check, X, EyeOff, Hand } from "lucide-react";

const CATEGORIES = [
  "Precision Machining & CNC",
  "Metal Fabrication & Stamping",
  "Plastics & Injection Molding",
  "Packaging & Container Solutions",
  "MRO & Industrial Supplies",
  "Electronic Components & PCB",
  "Castings & Forgings",
  "Chemical & Raw Materials",
  "Logistics & 3PL",
  "Contract Manufacturing",
  "Rubber & Sealing Components",
  "Surface Treatment & Coatings",
  "Other",
];

const SPEND_RANGES = [
  "< $500K / year",
  "$500K – $1M / year",
  "$1M – $5M / year",
  "$5M – $20M / year",
  "$20M – $50M / year",
  "> $50M / year",
  "Confidential",
];

const TIMELINES = [
  "Critical path — decision required < 4 weeks",
  "Accelerated — 1 to 3 months",
  "Standard cycle — 3 to 6 months",
  "Strategic / long-term — 6+ months",
];

const SUPPLY_RISKS = [
  "Single-sourced — no approved alternates",
  "Dual-sourced — limited backup capacity",
  "Multi-sourced — seeking additional options",
  "New category — no incumbent",
];

// Sourcing geographies the scout agents should prioritise (quick picks).
const GEOGRAPHIES = [
  "United States", "Canada", "Mexico",
  "Germany", "United Kingdom", "Italy", "Poland", "Czech Republic",
  "Turkey", "India", "China", "Vietnam",
  "Japan", "South Korea", "Taiwan", "Brazil",
];

// Full country list for the "add more" dropdown.
const ALL_COUNTRIES = [
  "Argentina", "Australia", "Austria", "Bangladesh", "Belgium", "Brazil", "Bulgaria",
  "Cambodia", "Canada", "Chile", "China", "Colombia", "Croatia", "Czech Republic",
  "Denmark", "Egypt", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary",
  "India", "Indonesia", "Ireland", "Israel", "Italy", "Japan", "Malaysia", "Mexico",
  "Morocco", "Netherlands", "New Zealand", "Norway", "Pakistan", "Philippines", "Poland",
  "Portugal", "Romania", "Saudi Arabia", "Serbia", "Singapore", "Slovakia", "Slovenia",
  "South Africa", "South Korea", "Spain", "Sweden", "Switzerland", "Taiwan", "Thailand",
  "Tunisia", "Turkey", "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
  "Vietnam",
];

export default function NewEventPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: "", category: "", subcategory: "", description: "",
    requirements: "", annual_spend: "", timeline: "",
    supply_risk: "", incumbent: "",
    // Outreach identity: when anonymous, SourceIQ reaches out on the buyer's behalf
    // without naming them. When disclosed, the buyer's name/role/company appear in
    // the outreach email and drafts can be copied or opened in the default mail app.
    outreach_anonymous: "true",
    buyer_name: "", buyer_role: "", buyer_company: "",
  });
  const [countries, setCountries] = useState<string[]>([]);
  const [classifying, setClassifying] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false); // category came from AI, not a manual click
  const [confidence, setConfidence] = useState<number | null>(null);
  const [classifyFailed, setClassifyFailed] = useState(false); // auto-detect errored → prompt manual pick
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryTouchedRef = useRef(false); // user manually picked → stop auto-overriding

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));
  const toggleCountry = (c: string) =>
    setCountries(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  const disclosedComplete = form.outreach_anonymous !== "false"
    || (form.buyer_name.trim() && form.buyer_role.trim() && form.buyer_company.trim());
  const complete = form.title && form.category && form.description && form.requirements && disclosedComplete;

  // Ask the classifier to pick a category + subcategory from the description.
  const classify = useCallback(async (description: string) => {
    if (categoryTouchedRef.current) return;          // respect manual override
    if (description.trim().length < 12) return;
    setClassifying(true);
    setClassifyFailed(false);
    try {
      const res = await fetch("/api/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, categories: CATEGORIES }),
      });
      if (!res.ok) { setClassifyFailed(true); return; }
      const r = await res.json() as { category: string; subcategory: string; confidence: number };
      if (categoryTouchedRef.current) return;         // user clicked while we waited
      if (!r.category) { setClassifyFailed(true); return; }
      setForm(f => ({ ...f, category: r.category, subcategory: r.subcategory || "" }));
      setAutoDetected(true);
      setConfidence(typeof r.confidence === "number" ? r.confidence : null);
    } catch {
      setClassifyFailed(true);      // surface failure so the user knows to pick manually
    }
    finally { setClassifying(false); }
  }, []);

  const onDescriptionChange = (value: string) => {
    set("description", value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => classify(value), 900);
  };

  // Blur = the buyer finished the description → classify immediately (skip the debounce),
  // so the category is suggested right after they leave the field rather than only mid-typing.
  const onDescriptionBlur = () => {
    if (categoryTouchedRef.current || autoDetected || classifying) return;
    if (form.description.trim().length < 12) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    classify(form.description);
  };

  const pickCategory = (c: string) => {
    categoryTouchedRef.current = true;
    setAutoDetected(false);
    setConfidence(null);
    set("category", c);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const description = form.incumbent
        ? `${form.description}\n\nSupply Risk: ${form.supply_risk || "Not specified"}\nIncumbent: ${form.incumbent}`
        : form.description;
      const res = await fetch("/api/sourcing-events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, description, subcategory: form.subcategory, target_countries: countries }),
      });
      if (!res.ok) throw new Error("Failed to create sourcing event");
      const event = await res.json();
      router.push(`/events/${event.id}`);
    } catch (err) {
      alert(String(err));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">

        {/* Breadcrumb */}
        <div className="mb-8">
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-8">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
            </svg>
            Sourcing Dashboard
          </Link>

          <div className="mt-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20 flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Initiate Sourcing Event</h1>
              <p className="text-sm text-slate-500 mt-1">
                Define your sourcing requirement. A team of AI agents will execute market intelligence, supplier discovery, and pre-qualification across global supply chains.
              </p>
            </div>
          </div>
        </div>

        {/* Agent pipeline preview */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50/40 p-5 sm:p-6 mb-8">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse-dot" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-blue-600">Agent Pipeline</span>
          </div>
          <div className="flex items-stretch gap-2 sm:gap-3">
            {[
              { Icon: Brain, label: "Orchestrator", sub: "Plans wave strategy" },
              { Icon: Search, label: "Scout ×3", sub: "Broad · Niche · Geo" },
              { Icon: Scale, label: "Qualifier", sub: "5-axis scoring" },
              { Icon: Lightbulb, label: "Enricher", sub: "Risk · Strengths" },
            ].map((a, i, arr) => (
              <div key={a.label} className="flex items-stretch flex-1 min-w-0">
                <div className="relative flex-1 flex flex-col items-center text-center bg-white rounded-xl px-2 py-4 border border-blue-100/80 shadow-sm shadow-blue-600/[0.03] min-w-0">
                  <span className="absolute top-2 left-2.5 text-[10px] font-bold text-slate-300 tabular-nums">{i + 1}</span>
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center mb-2">
                    <a.Icon className="w-[18px] h-[18px] text-blue-600" strokeWidth={2} />
                  </div>
                  <div className="text-[12px] font-bold text-slate-700 leading-tight truncate max-w-full">{a.label}</div>
                  <div className="text-[10px] text-slate-400 leading-tight mt-0.5 truncate max-w-full">{a.sub}</div>
                </div>
                {i < arr.length - 1 && (
                  <div className="flex items-center px-0.5 sm:px-1 flex-shrink-0" aria-hidden="true">
                    <ChevronRight className="w-4 h-4 text-blue-300" />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-4">Runs in 4 waves · discovers 40–60 suppliers · auto-scores against your requirements</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-7">

          {/* Event name */}
          <div>
            <label className="label">
              Event Reference
              <span className="ml-1 text-red-400">*</span>
            </label>
            <input
              className="input text-base"
              placeholder="e.g. Precision CNC Machined Parts — Hydraulic Subassembly, FY2025-Q3"
              value={form.title}
              onChange={e => set("title", e.target.value)}
              required
            />
            <p className="text-xs text-slate-400 mt-1.5">Use your internal naming convention for traceability</p>
          </div>

          {/* Scope — comes first so the category can be inferred from it */}
          <div>
            <label className="label">
              Sourcing Scope & Specification
              <span className="ml-1 text-red-400">*</span>
            </label>
            <textarea
              className="input resize-none"
              rows={5}
              placeholder={`Describe the scope in precise commercial terms. Include:\n• Part or service description, materials, grades\n• Annual volumes or call-off quantities\n• Critical dimensions, tolerances, or performance specs\n• End-use application and sector context`}
              value={form.description}
              onChange={e => onDescriptionChange(e.target.value)}
              onBlur={onDescriptionBlur}
              required
            />
            <p className="text-xs text-slate-400 mt-1.5">
              The commodity category is detected automatically as you describe the scope — you can override it below.
            </p>
          </div>

          {/* Category — auto-selected from the description, manually overridable */}
          <div>
            <label className="label flex items-center gap-2">
              <span>Commodity Category<span className="ml-1 text-red-400">*</span></span>
              {classifying && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-500">
                  <span className="w-3 h-3 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
                  Detecting…
                </span>
              )}
              {!classifying && autoDetected && form.category && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-3 h-3" /> Auto-detected{confidence != null ? ` · ${confidence}%` : ""}
                </span>
              )}
              {!classifying && classifyFailed && !form.category && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  Auto-detect unavailable — pick one below
                </span>
              )}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map(c => (
                <button
                  key={c} type="button"
                  onClick={() => pickCategory(c)}
                  className={`text-left px-3.5 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    form.category === c
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/20"
                      : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            {/* Subcategory — populated by the classifier, freely editable */}
            <div className="mt-3">
              <label className="label text-xs">
                Subcategory
                <span className="font-normal text-slate-400"> — refine the specific commodity</span>
              </label>
              <input
                className="input"
                placeholder="e.g. 5-axis aluminum machining"
                value={form.subcategory}
                onChange={e => set("subcategory", e.target.value)}
              />
            </div>
          </div>

          {/* Requirements */}
          <div>
            <label className="label">
              Qualification Criteria & Constraints
              <span className="ml-1 text-red-400">*</span>
            </label>
            <textarea
              className="input resize-none"
              rows={5}
              placeholder={`Define mandatory and desirable criteria. Include:\n• Required certifications (ISO 9001, IATF 16949, AS9100, NADCAP)\n• Geographic constraints or preferred regions\n• Minimum capacity or production rate thresholds\n• Lead time requirements and MOQ expectations\n• Country-of-origin restrictions (ITAR, Trade Compliance)`}
              value={form.requirements}
              onChange={e => set("requirements", e.target.value)}
              required
            />
            <p className="text-xs text-blue-600 font-medium mt-2">
              AI qualification scoring is calibrated directly against these criteria. Greater specificity yields more accurate supplier rankings.
            </p>
          </div>

          {/* Supply risk + incumbent */}
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="label">Supply Risk Profile</label>
              <div className="grid grid-cols-2 gap-2">
                {SUPPLY_RISKS.map(r => (
                  <button
                    key={r} type="button"
                    onClick={() => set("supply_risk", r)}
                    className={`text-left px-3 py-2.5 rounded-xl text-xs font-medium border transition-all ${
                      form.supply_risk === r
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:bg-amber-50"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Incumbent Supplier(s) <span className="font-normal text-slate-400">— optional</span></label>
              <input
                className="input"
                placeholder="e.g. Acme Machining Co., Smith Fabricators (will be excluded from outreach)"
                value={form.incumbent}
                onChange={e => set("incumbent", e.target.value)}
              />
            </div>
          </div>

          {/* Target geographies */}
          <div>
            <label className="label">
              Target Sourcing Geographies
              <span className="font-normal text-slate-400"> — optional</span>
            </label>
            <p className="text-xs text-slate-400 mb-2.5">
              Select the countries or regions the scout agents should focus on. Leave empty for a global search.
            </p>
            <div className="flex flex-wrap gap-2">
              {GEOGRAPHIES.map(c => {
                const active = countries.includes(c);
                return (
                  <button
                    key={c} type="button"
                    onClick={() => toggleCountry(c)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      active
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/20"
                        : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">{active && <Check className="w-3 h-3" />}{c}</span>
                  </button>
                );
              })}
            </div>
            {/* Dropdown for any other country */}
            <div className="mt-3">
              <select
                className="input"
                value=""
                onChange={e => { if (e.target.value) toggleCountry(e.target.value); }}
              >
                <option value="">+ Add another country…</option>
                {ALL_COUNTRIES.filter(c => !GEOGRAPHIES.includes(c) && !countries.includes(c)).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Selected countries added via dropdown (not already shown as quick picks) */}
            {countries.filter(c => !GEOGRAPHIES.includes(c)).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {countries.filter(c => !GEOGRAPHIES.includes(c)).map(c => (
                  <span key={c} className="inline-flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg">
                    {c}
                    <button type="button" onClick={() => toggleCountry(c)} className="hover:text-blue-200"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}

            {countries.length > 0 && (
              <p className="text-xs text-blue-600 font-medium mt-2">
                Agents will prioritise: {countries.join(", ")}
              </p>
            )}
          </div>

          {/* Outreach identity — anonymous vs. disclosed (per event) */}
          <div>
            <label className="label">Supplier Outreach Identity</label>
            <p className="text-xs text-slate-400 mb-2.5">
              Choose how you appear to suppliers when SourceIQ reaches out on this event.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { v: "true",  Icon: EyeOff, title: "Anonymous", sub: "SourceIQ contacts suppliers on your behalf — your organisation is never named." },
                { v: "false", Icon: Hand, title: "Disclosed", sub: "Your name, role & company appear in the outreach. Copy or send via your own mail client." },
              ].map(opt => {
                const active = form.outreach_anonymous === opt.v;
                return (
                  <button
                    key={opt.v} type="button"
                    onClick={() => set("outreach_anonymous", opt.v)}
                    className={`text-left px-4 py-3 rounded-xl border transition-all ${
                      active
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/20"
                        : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <opt.Icon className="w-4 h-4" />{opt.title}
                    </div>
                    <div className={`text-[11px] mt-1 leading-snug ${active ? "text-blue-100" : "text-slate-400"}`}>
                      {opt.sub}
                    </div>
                  </button>
                );
              })}
            </div>

            {form.outreach_anonymous === "false" && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <label className="label text-xs">Your Name<span className="ml-1 text-red-400">*</span></label>
                  <input className="input" placeholder="Jane Smith" value={form.buyer_name} onChange={e => set("buyer_name", e.target.value)} />
                </div>
                <div>
                  <label className="label text-xs">Role<span className="ml-1 text-red-400">*</span></label>
                  <input className="input" placeholder="Procurement Lead" value={form.buyer_role} onChange={e => set("buyer_role", e.target.value)} />
                </div>
                <div>
                  <label className="label text-xs">Company<span className="ml-1 text-red-400">*</span></label>
                  <input className="input" placeholder="Acme Corp" value={form.buyer_company} onChange={e => set("buyer_company", e.target.value)} />
                </div>
                <p className="sm:col-span-3 text-[11px] text-slate-400">
                  These details are included in disclosed outreach emails so suppliers know who they&apos;re dealing with.
                </p>
              </div>
            )}
          </div>

          {/* Spend + Timeline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Estimated Annual Spend (TCO)</label>
              <select className="input" value={form.annual_spend} onChange={e => set("annual_spend", e.target.value)}>
                <option value="">Select range...</option>
                {SPEND_RANGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Decision Timeline</label>
              <select className="input" value={form.timeline} onChange={e => set("timeline", e.target.value)}>
                <option value="">Select timeline...</option>
                {TIMELINES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Submit */}
          <div className="pt-2 space-y-3">
            <button
              type="submit"
              disabled={loading || !complete}
              className="btn-primary w-full justify-center py-4 text-base"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Initialising sourcing event...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  Launch AI Discovery
                </>
              )}
            </button>
            {!complete && (
              <p className="text-center text-xs text-slate-400">Complete all required fields to proceed</p>
            )}
          </div>

        </form>
      </div>
    </div>
  );
}
