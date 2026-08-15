"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Check, X, EyeOff, Hand, SlidersHorizontal, ChevronDown } from "lucide-react";
import { useT } from "@/components/LanguageProvider";
import { useModalA11y } from "@/hooks/useModalA11y";
import { BUSINESS_TYPES, EMPLOYEE_BANDS, CAPABILITY_TAGS } from "@/lib/taxonomy";

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

// Below this confidence, the classifier's guess is more likely wrong than
// right — silently auto-selecting it just makes a bad pick harder to notice
// than an empty field would. Below the threshold, surface the same "pick one
// below" prompt used for outright classify failures instead of auto-selecting.
const LOW_CONFIDENCE_THRESHOLD = 55;

const SPEND_RANGES = [
  "< $500K / year",
  "$500K – $1M / year",
  "$1M – $5M / year",
  "$5M – $20M / year",
  "$20M – $50M / year",
  "> $50M / year",
  "Confidential",
];



// Sourcing geographies the scout agents should prioritise (quick picks).
const GEOGRAPHIES = [
  "United States", "Canada", "Mexico",
  "Germany", "United Kingdom", "Italy", "Poland", "Czech Republic",
  "Turkey", "India", "China", "Vietnam",
  "Japan", "South Korea", "Taiwan", "Brazil",
];

// Macro-regions: broad areas the buyer can target instead of (or alongside)
// individual countries. These are free-text hints passed to the scout agents.
const MACRO_REGIONS = [
  "Europe", "European Union", "Nordics", "Eastern Europe",
  "North America", "Latin America", "Asia", "Southeast Asia",
  "Middle East", "Africa", "Oceania",
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
  const t = useT();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: "", category: "", subcategory: "", description: "",
    requirements: "", annual_spend: "",
    incumbent: "",
    // Outreach identity: when anonymous, SourceIQ reaches out on the buyer's behalf
    // without naming them. When disclosed, the buyer's name/role/company appear in
    // the outreach email and drafts can be copied or opened in the default mail app.
    outreach_anonymous: "true",
    buyer_name: "", buyer_role: "", buyer_company: "",
  });
  const [countries, setCountries] = useState<string[]>([]);
  // Free-text region entry (e.g. "Northern Italy", "Bavaria") and the ship-to
  // destination market suppliers must be able to deliver/export to.
  const [regionInput, setRegionInput] = useState("");
  const [shipTo, setShipTo] = useState("");
  // Advanced search filters: optional, additional attribute constraints layered
  // on top of the base brief. Collapsed by default so casual users never see
  // them; when filled in, they're folded into the discovery prompt server-side
  // (see app/api/orchestrate/route.ts) without changing the scout's signature.
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [advFilters, setAdvFilters] = useState({
    business_type: "",
    min_employee_band: "",
    capabilities: [] as string[],
    certifications: "",
    excluded_countries: [] as string[],
  });
  const toggleCapability = (tag: string) => {
    setAdvFilters(prev => ({
      ...prev,
      capabilities: prev.capabilities.includes(tag)
        ? prev.capabilities.filter(c => c !== tag)
        : [...prev.capabilities, tag],
    }));
  };
  const toggleExcludedCountry = (country: string) => {
    setAdvFilters(prev => ({
      ...prev,
      excluded_countries: prev.excluded_countries.includes(country)
        ? prev.excluded_countries.filter(c => c !== country)
        : [...prev.excluded_countries, country],
    }));
  };
  const buildAdvancedFilters = (): Record<string, unknown> | null => {
    const out: Record<string, unknown> = {};
    if (advFilters.business_type) out.business_type = advFilters.business_type;
    if (advFilters.min_employee_band) out.min_employee_band = advFilters.min_employee_band;
    if (advFilters.capabilities.length) out.capabilities = advFilters.capabilities;
    if (advFilters.certifications.trim()) {
      out.certifications = advFilters.certifications.split(",").map(s => s.trim()).filter(Boolean);
    }
    if (advFilters.excluded_countries.length) out.excluded_countries = advFilters.excluded_countries;
    return Object.keys(out).length > 0 ? out : null;
  };
  // Quick Source: a single-line entry that infers everything and auto-launches
  // discovery. The detailed form lives behind the "Advanced brief" toggle.
  const [mode, setMode] = useState<"quick" | "advanced">("quick");
  const [quickInput, setQuickInput] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false); // category came from AI, not a manual click
  const [confidence, setConfidence] = useState<number | null>(null);
  const [classifyFailed, setClassifyFailed] = useState(false); // auto-detect errored → prompt manual pick
  const [lowConfidence, setLowConfidence] = useState(false); // classifier returned a guess, but below LOW_CONFIDENCE_THRESHOLD
  const [showUpgrade, setShowUpgrade] = useState(false); // trial ended / no active plan (402)
  // Which 402 reason triggered the gate — "subscription_required" (no active
  // plan/trial ended) vs "event_limit_reached" (on a real plan, but hit the
  // monthly event cap) need different copy, and neither implies "Pro" is the
  // right tier to recommend, so the gate no longer guesses a tier at all —
  // it just tailors the message and sends the user to /billing to pick.
  const [upgradeCode, setUpgradeCode] = useState<string | null>(null);
  const [upgradeMeta, setUpgradeMeta] = useState<{ limit?: number; used?: number }>({});
  // Which action is in flight: a full discovery wave or a fast, names-only
  // Quick Scan. Both forms below offer both as separate CTAs — previously
  // event creation always auto-launched full discovery (?autostart=1),
  // which meant Quick Scan was unreachable for a brand-new event (its
  // button on the event page is disabled the instant discovery starts).
  // Tracked per-form so each shows its own loading state independently.
  const [quickLaunchMode, setQuickLaunchMode] = useState<"1" | "quick">("1");
  const [advancedLaunchMode, setAdvancedLaunchMode] = useState<"1" | "quick">("1");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryTouchedRef = useRef(false); // user manually picked → stop auto-overriding

  // Escape/Tab-trap/focus-restore for this modal now lives in UpgradeGateModal
  // itself via useModalA11y (#90) — only mounted while showUpgrade is true, so
  // there's no always-on document listener when the gate isn't showing. No
  // "busy" state to gate on anymore — the modal only ever navigates to
  // /billing now, so closing is always safe.
  const closeUpgradeGate = useCallback(() => setShowUpgrade(false), []);

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
    setLowConfidence(false);
    try {
      const res = await fetch("/api/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, categories: CATEGORIES }),
      });
      if (!res.ok) { setClassifyFailed(true); return; }
      const r = await res.json() as { category: string; subcategory: string; confidence: number };
      if (categoryTouchedRef.current) return;         // user clicked while we waited
      if (!r.category) { setClassifyFailed(true); return; }
      const conf = typeof r.confidence === "number" ? r.confidence : null;
      setConfidence(conf);
      if (conf != null && conf < LOW_CONFIDENCE_THRESHOLD) {
        // Below the threshold — surface the guess's confidence but don't
        // silently pick a category the model itself isn't sure about.
        setLowConfidence(true);
        return;
      }
      setForm(f => ({ ...f, category: r.category, subcategory: r.subcategory || "" }));
      setAutoDetected(true);
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
    setLowConfidence(false);
    set("category", c);
  };

  // ── Quick Source parsing (client-side, best-effort) ──────────────────────
  // Pull any country names the buyer mentioned out of the free-text sentence.
  function parseCountries(sentence: string): string[] {
    const lc = sentence.toLowerCase();
    return ALL_COUNTRIES.filter(c => new RegExp(`\\b${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lc));
  }
  // Pull a named incumbent ("alternate to X", "replace X", "currently use X").
  function parseIncumbent(sentence: string): string {
    const m = sentence.match(/\b(?:alternate(?:s)?\s+to|alternative\s+to|replace|replacing|currently\s+(?:use|using|sourcing\s+from)|second\s+source\s+for|instead\s+of)\s+([A-Z][\w&.\- ]{1,40}?)(?=[,.;]|\s+(?:in|for|with|and|preferred|based)\b|$)/i);
    return m ? m[1].trim() : "";
  }

  // Shared by both the primary "Launch AI Discovery" submit and the secondary
  // "Quick Scan instead" action — only the resulting `autostart` value differs.
  async function submitQuickSource(mode: "1" | "quick") {
    const sentence = quickInput.trim();
    if (sentence.length < 12) {
      setQuickError(t("Add a little more detail so we can find the right suppliers."));
      return;
    }
    setQuickError(null);
    setLoading(true);
    setQuickLaunchMode(mode);
    try {
      // Infer the commodity category from the sentence (best-effort — never blocks).
      let category = "Other";
      let subcategory = "";
      let cleanTitle = "";
      try {
        const res = await fetch("/api/classify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: sentence, categories: CATEGORIES }),
        });
        if (res.ok) {
          const r = await res.json() as { category?: string; subcategory?: string; title?: string };
          if (r.category) category = r.category;
          if (r.subcategory) subcategory = r.subcategory;
          if (r.title) cleanTitle = r.title.trim();
        }
      } catch { /* fall back to "Other" — discovery still runs */ }

      const parsedCountries = parseCountries(sentence);
      const incumbent = parseIncumbent(sentence);
      const description = incumbent ? `${sentence}\n\nIncumbent: ${incumbent}` : sentence;

      const res = await fetch("/api/sourcing-events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Prefer the AI-generated clean title; fall back to the raw sentence.
          title: cleanTitle || sentence.slice(0, 80),
          category, subcategory,
          description,
          requirements: sentence,
          annual_spend: "",
          target_countries: parsedCountries,
          outreach_anonymous: "true",
        }),
      });
      if (res.status === 402) {
        const body = await res.json().catch(() => ({})) as { code?: string; limit?: number; used?: number };
        setUpgradeCode(body.code || null);
        setUpgradeMeta({ limit: body.limit, used: body.used });
        setShowUpgrade(true);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(t("Failed to create sourcing event"));
      const event = await res.json();
      // autostart=1 → full discovery wave; autostart=quick → fast, names-only
      // Quick Scan. Either way the event page kicks the action off itself, so
      // the user doesn't have to click a button again after creating.
      router.push(`/events/${event.id}?autostart=${mode}`);
    } catch (err) {
      setQuickError(String(err));
      setLoading(false);
    }
  }

  // Wrapper for the form's onSubmit — always launches full discovery.
  function handleQuickSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitQuickSource("1");
  }

  // Shared by both the primary "Launch AI Discovery" submit and the secondary
  // "Quick Scan instead" action on the advanced brief form — only the
  // resulting `autostart` value differs.
  async function submitAdvanced(mode: "1" | "quick") {
    setLoading(true);
    setAdvancedLaunchMode(mode);
    try {
      const description = form.incumbent
        ? `${form.description}\n\nIncumbent: ${form.incumbent}`
        : form.description;
      const res = await fetch("/api/sourcing-events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, description, subcategory: form.subcategory, target_countries: countries, ship_to: shipTo || null, advanced_filters: buildAdvancedFilters() }),
      });
      // Billing gate: trial ended, no active plan, or monthly event cap hit →
      // guide the user to upgrade instead of surfacing an opaque failure.
      if (res.status === 402) {
        const errBody = await res.json().catch(() => ({})) as { code?: string; limit?: number; used?: number };
        setUpgradeCode(errBody.code || null);
        setUpgradeMeta({ limit: errBody.limit, used: errBody.used });
        setShowUpgrade(true);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(t("Failed to create sourcing event"));
      const event = await res.json();
      // autostart=1 → full discovery wave; autostart=quick → fast, names-only
      // Quick Scan. Either way the event page kicks the action off itself, so
      // the user doesn't have to click a button again after creating.
      router.push(`/events/${event.id}?autostart=${mode}`);
    } catch (err) {
      alert(String(err));
      setLoading(false);
    }
  }

  // Wrapper for the advanced form's onSubmit — always launches full discovery.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitAdvanced("1");
  }

  // No inline checkout here anymore — the gate no longer guesses a tier (see
  // upgradeCode above), it just sends the user to /billing to pick the right
  // plan themselves.

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">

        {/* Breadcrumb */}
        <div className="mb-8">
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-600 transition-colors mb-8">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
            </svg>
            {t("Sourcing Dashboard")}
          </Link>

          <div className="mt-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20 flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("Initiate Sourcing Event")}</h1>
              <p className="text-sm text-slate-500 mt-1">
                {t("Define your sourcing requirement. A team of AI agents will execute market intelligence, supplier discovery, and pre-qualification across global supply chains.")}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Source — single-line entry, auto-launches discovery */}
        {mode === "quick" && (
          <form onSubmit={handleQuickSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="quick-source-input">{t("What are you trying to source?")}</label>
              <textarea
                id="quick-source-input"
                autoFocus
                rows={3}
                className="input text-base resize-none"
                placeholder={t("e.g. CNC-machined aluminum brackets, ~50k/year, alternate to a China supplier, EU preferred")}
                value={quickInput}
                onChange={e => { setQuickInput(e.target.value); if (quickError) setQuickError(null); }}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleQuickSubmit(e as unknown as React.FormEvent); }}
              />
              <p className="text-xs text-slate-500 mt-1.5">
                {t("One line is enough — we'll detect the category, region and incumbent, then start discovery automatically.")}
              </p>
              {quickError && <p className="text-xs text-red-500 mt-1.5">{quickError}</p>}
            </div>
            <button
              type="submit"
              disabled={loading || quickInput.trim().length < 12}
              className="btn-primary w-full justify-center py-4 text-base"
            >
              {loading && quickLaunchMode === "1" ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t("Starting discovery…")}
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  {t("Launch AI Discovery")}
                </>
              )}
            </button>
            <p className="text-xs text-slate-400 text-center -mt-0.5">
              {t("Full web research on real suppliers, ~60-90s")}
            </p>
            <button
              type="button"
              disabled={loading || quickInput.trim().length < 12}
              onClick={() => void submitQuickSource("quick")}
              title={t("Fast, unverified name suggestions — no web research. Use \"Deepen\" on a result to verify it for real.")}
              className="btn-secondary w-full justify-center py-2.5 text-sm"
            >
              {loading && quickLaunchMode === "quick" ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                  {t("Starting quick scan…")}
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  {t("Quick Scan instead — fast, unverified names")}
                </>
              )}
            </button>
            <p className="text-xs text-slate-400 text-center -mt-0.5">
              {t("Fast name suggestions, ~10s — deepen individual results to verify")}
            </p>
            <button
              type="button"
              onClick={() => setMode("advanced")}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-600 transition-colors"
            >
              {t("Need to specify certs, volumes or tolerances? Use the advanced brief →")}
            </button>
          </form>
        )}

        {/* Form */}
        {mode === "advanced" && (
        <>
        <button
          type="button"
          onClick={() => setMode("quick")}
          className="mb-5 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-600 transition-colors"
        >
          ← {t("Back to quick source")}
        </button>
        <form onSubmit={handleSubmit} className="space-y-7">

          {/* Event name */}
          <div>
            <label className="label" htmlFor="event-title">
              {t("Event Reference")}
              <span className="ml-1 text-red-600">*</span>
            </label>
            <input
              id="event-title"
              className="input text-base"
              placeholder={t("e.g. Precision CNC Machined Parts — Hydraulic Subassembly, FY2025-Q3")}
              value={form.title}
              onChange={e => set("title", e.target.value)}
              required
            />
            <p className="text-xs text-slate-500 mt-1.5">{t("Use your internal naming convention for traceability")}</p>
          </div>

          {/* Scope — comes first so the category can be inferred from it */}
          <div>
            <label className="label" htmlFor="event-description">
              {t("Sourcing Scope & Specification")}
              <span className="ml-1 text-red-600">*</span>
            </label>
            <textarea
              id="event-description"
              className="input resize-none"
              rows={5}
              placeholder={t("Describe the scope in precise commercial terms. Include:\n• Part or service description, materials, grades\n• Annual volumes or call-off quantities\n• Critical dimensions, tolerances, or performance specs\n• End-use application and sector context")}
              value={form.description}
              onChange={e => onDescriptionChange(e.target.value)}
              onBlur={onDescriptionBlur}
              required
            />
            <p className="text-xs text-slate-500 mt-1.5">
              {t("The commodity category is detected automatically as you describe the scope — you can override it below.")}
            </p>
          </div>

          {/* Category — auto-selected from the description, manually overridable */}
          <div>
            <div id="category-label" className="label flex items-center gap-2">
              <span>{t("Commodity Category")}<span className="ml-1 text-red-600">*</span></span>
              {classifying && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-500">
                  <span className="w-3 h-3 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
                  {t("Detecting…")}
                </span>
              )}
              {!classifying && autoDetected && form.category && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-3 h-3" /> {t("Auto-detected")}{confidence != null ? ` · ${confidence}%` : ""}
                </span>
              )}
              {!classifying && classifyFailed && !form.category && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full">
                  {t("Auto-detect unavailable — pick one below")}
                </span>
              )}
              {!classifying && lowConfidence && !form.category && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full">
                  {t("Not confident enough to guess — pick one below")}{confidence != null ? ` · ${confidence}%` : ""}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="category-label">
              {CATEGORIES.map(c => (
                <button
                  key={c} type="button"
                  onClick={() => pickCategory(c)}
                  aria-pressed={form.category === c}
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
              <label className="label text-xs" htmlFor="event-subcategory">
                {t("Subcategory")}
                <span className="font-normal text-slate-500"> {t("— refine the specific commodity")}</span>
              </label>
              <input
                id="event-subcategory"
                className="input"
                placeholder={t("e.g. 5-axis aluminum machining")}
                value={form.subcategory}
                onChange={e => set("subcategory", e.target.value)}
              />
            </div>
          </div>

          {/* Requirements */}
          <div>
            <label className="label" htmlFor="event-requirements">
              {t("Qualification Criteria & Constraints")}
              <span className="ml-1 text-red-600">*</span>
            </label>
            <textarea
              id="event-requirements"
              className="input resize-none"
              rows={5}
              placeholder={t("Define mandatory and desirable criteria. Include:\n• Required certifications (ISO 9001, IATF 16949, AS9100, NADCAP)\n• Geographic constraints or preferred regions\n• Minimum capacity or production rate thresholds\n• Lead time requirements and MOQ expectations\n• Country-of-origin restrictions (ITAR, Trade Compliance)")}
              value={form.requirements}
              onChange={e => set("requirements", e.target.value)}
              required
            />
            <p className="text-xs text-blue-600 font-medium mt-2">
              {t("AI qualification scoring is calibrated directly against these criteria. Greater specificity yields more accurate supplier rankings.")}
            </p>
          </div>

          {/* Incumbent */}
          <div>
            <label className="label" htmlFor="event-incumbent">{t("Incumbent Supplier(s)")} <span className="font-normal text-slate-500">{t("— optional")}</span></label>
            <input
              id="event-incumbent"
              className="input"
              placeholder={t("e.g. Acme Machining Co., Smith Fabricators (will be excluded from outreach)")}
              value={form.incumbent}
              onChange={e => set("incumbent", e.target.value)}
            />
          </div>

          {/* Target geographies */}
          <div role="group" aria-labelledby="geographies-label">
            <div id="geographies-label" className="label">
              {t("Target Sourcing Geographies")}
              <span className="font-normal text-slate-500"> {t("— optional")}</span>
            </div>
            <p className="text-xs text-slate-500 mb-2.5">
              {t("Select the countries or regions the scout agents should focus on. Leave empty for a global search.")}
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("Target Sourcing Geographies")}>
              {GEOGRAPHIES.map(c => {
                const active = countries.includes(c);
                return (
                  <button
                    key={c} type="button"
                    onClick={() => toggleCountry(c)}
                    aria-pressed={active}
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
            {/* Macro-regions: target a whole area instead of listing countries */}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mt-4 mb-2">{t("Macro-regions")}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("Macro-regions")}>
              {MACRO_REGIONS.map(c => {
                const active = countries.includes(c);
                return (
                  <button
                    key={c} type="button"
                    onClick={() => toggleCountry(c)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      active
                        ? "bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-600/20"
                        : "bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">{active && <Check className="w-3 h-3" />}{t(c)}</span>
                  </button>
                );
              })}
            </div>

            {/* Free-text region: micro-regions or areas (e.g. "Northern Italy") */}
            <div className="mt-3 flex gap-2">
              <input
                className="input flex-1"
                aria-label={t("Add a region or area")}
                value={regionInput}
                onChange={e => setRegionInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const v = regionInput.trim();
                    if (v && !countries.includes(v)) { setCountries(prev => [...prev, v]); setRegionInput(""); }
                  }
                }}
                placeholder={t("Add a region or area, e.g. Northern Italy, Bavaria…")}
              />
              <button
                type="button"
                className="btn-secondary px-3"
                onClick={() => {
                  const v = regionInput.trim();
                  if (v && !countries.includes(v)) { setCountries(prev => [...prev, v]); setRegionInput(""); }
                }}
              >
                {t("Add")}
              </button>
            </div>

            {/* Dropdown for any other country */}
            <div className="mt-3">
              <select
                className="input"
                aria-label={t("+ Add another country…")}
                value=""
                onChange={e => { if (e.target.value) toggleCountry(e.target.value); }}
              >
                <option value="">{t("+ Add another country…")}</option>
                {ALL_COUNTRIES.filter(c => !GEOGRAPHIES.includes(c) && !countries.includes(c)).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Selected regions/countries added via dropdown, macro chips, or free text */}
            {countries.filter(c => !GEOGRAPHIES.includes(c) && !MACRO_REGIONS.includes(c)).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {countries.filter(c => !GEOGRAPHIES.includes(c) && !MACRO_REGIONS.includes(c)).map(c => (
                  <span key={c} className="inline-flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg">
                    {c}
                    <button type="button" onClick={() => toggleCountry(c)} className="hover:text-blue-200"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}

            {countries.length > 0 && (
              <p className="text-xs text-blue-600 font-medium mt-2">
                {t("Agents will prioritise: {countries}", { countries: countries.join(", ") })}
              </p>
            )}
          </div>

          {/* Ship-to destination — serviceability qualification */}
          <div>
            <label className="label" htmlFor="event-ship-to">
              {t("Ship-to destination")}
              <span className="font-normal text-slate-500"> {t("— optional")}</span>
            </label>
            <p className="text-xs text-slate-500 mb-2.5">
              {t("Where must suppliers be able to deliver or export to? Agents will favour suppliers that can serve this market (e.g. a Chinese supplier that ships to Italy).")}
            </p>
            <input
              id="event-ship-to"
              className="input"
              value={shipTo}
              onChange={e => setShipTo(e.target.value)}
              placeholder={t("e.g. Italy, European Union, United States")}
            />
          </div>

          {/* Advanced search filters — optional attribute constraints layered on
              top of the base brief (distinct from the Quick/Advanced brief toggle
              above: this is about *what suppliers must look like*, not *how much
              detail you gave*). Collapsed by default. */}
          <div className="border border-slate-200 rounded-xl">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              aria-expanded={showAdvancedFilters}
              aria-controls="advanced-filters-panel"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-slate-700">
                <SlidersHorizontal className="w-4 h-4 text-slate-500" />
                {t("Advanced search filters")}
                <span className="font-normal text-slate-500 text-xs">{t("— optional")}</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showAdvancedFilters ? "rotate-180" : ""}`} />
            </button>
            {showAdvancedFilters && (
              <div id="advanced-filters-panel" className="px-4 pb-4 space-y-4 border-t border-slate-100">
                <p className="text-xs text-slate-500 pt-3">
                  {t("Narrow discovery to suppliers matching these attributes. Agents will weigh these alongside your brief above.")}
                </p>

                <div>
                  <label className="label text-xs" htmlFor="adv-business-type">{t("Business type")}</label>
                  <select
                    id="adv-business-type"
                    className="input"
                    value={advFilters.business_type}
                    onChange={e => setAdvFilters(prev => ({ ...prev, business_type: e.target.value }))}
                  >
                    <option value="">{t("Any")}</option>
                    {BUSINESS_TYPES.map(bt => <option key={bt} value={bt}>{bt}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label text-xs" htmlFor="adv-employee-band">{t("Minimum company size (employees)")}</label>
                  <select
                    id="adv-employee-band"
                    className="input"
                    value={advFilters.min_employee_band}
                    onChange={e => setAdvFilters(prev => ({ ...prev, min_employee_band: e.target.value }))}
                  >
                    <option value="">{t("Any")}</option>
                    {EMPLOYEE_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div>
                  <div className="label text-xs">{t("Required capabilities")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {CAPABILITY_TAGS.map(tag => {
                      const active = advFilters.capabilities.includes(tag);
                      return (
                        <button
                          key={tag} type="button"
                          onClick={() => toggleCapability(tag)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                            active
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="label text-xs" htmlFor="adv-certifications">{t("Required certifications")}</label>
                  <input
                    id="adv-certifications"
                    className="input"
                    value={advFilters.certifications}
                    onChange={e => setAdvFilters(prev => ({ ...prev, certifications: e.target.value }))}
                    placeholder={t("e.g. ISO 9001, IATF 16949, REACH")}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">{t("Comma-separated. Agents will prioritise suppliers that can demonstrate these.")}</p>
                </div>

                <div>
                  <div className="label text-xs">{t("Exclude countries")}</div>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-slate-50 rounded-lg border border-slate-200">
                    {ALL_COUNTRIES.map(country => {
                      const active = advFilters.excluded_countries.includes(country);
                      return (
                        <button
                          key={country} type="button"
                          onClick={() => toggleExcludedCountry(country)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                            active
                              ? "bg-red-500 text-white border-red-500"
                              : "bg-white text-slate-600 border-slate-200 hover:border-red-300"
                          }`}
                        >
                          {country}
                        </button>
                      );
                    })}
                  </div>
                  {advFilters.excluded_countries.length > 0 && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {t("Agents will avoid: {countries}", { countries: advFilters.excluded_countries.join(", ") })}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Outreach identity — anonymous vs. disclosed (per event) */}
          <div>
            <div id="outreach-identity-label" className="label">{t("Supplier Outreach Identity")}</div>
            <p className="text-xs text-slate-500 mb-2.5">
              {t("Choose how you appear to suppliers when SourceIQ reaches out on this event.")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-labelledby="outreach-identity-label">
              {[
                { v: "true",  Icon: EyeOff, title: t("Anonymous"), sub: t("SourceIQ contacts suppliers on your behalf — your organisation is never named.") },
                { v: "false", Icon: Hand, title: t("Disclosed"), sub: t("Your name, role & company appear in the outreach. Copy or send via your own mail client.") },
              ].map(opt => {
                const active = form.outreach_anonymous === opt.v;
                return (
                  <button
                    key={opt.v} type="button"
                    onClick={() => set("outreach_anonymous", opt.v)}
                    aria-pressed={active}
                    className={`text-left px-4 py-3 rounded-xl border transition-all ${
                      active
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/20"
                        : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <opt.Icon className="w-4 h-4" />{opt.title}
                    </div>
                    <div className={`text-[11px] mt-1 leading-snug ${active ? "text-blue-100" : "text-slate-500"}`}>
                      {opt.sub}
                    </div>
                  </button>
                );
              })}
            </div>

            {form.outreach_anonymous === "false" && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <label className="label text-xs" htmlFor="buyer-name">{t("Your Name")}<span className="ml-1 text-red-600">*</span></label>
                  <input id="buyer-name" className="input" placeholder={t("Jane Smith")} value={form.buyer_name} onChange={e => set("buyer_name", e.target.value)} />
                </div>
                <div>
                  <label className="label text-xs" htmlFor="buyer-role">{t("Role")}<span className="ml-1 text-red-600">*</span></label>
                  <input id="buyer-role" className="input" placeholder={t("Procurement Lead")} value={form.buyer_role} onChange={e => set("buyer_role", e.target.value)} />
                </div>
                <div>
                  <label className="label text-xs" htmlFor="buyer-company">{t("Company")}<span className="ml-1 text-red-600">*</span></label>
                  <input id="buyer-company" className="input" placeholder={t("Acme Corp")} value={form.buyer_company} onChange={e => set("buyer_company", e.target.value)} />
                </div>
                <p className="sm:col-span-3 text-[11px] text-slate-500">
                  {t("These details are included in disclosed outreach emails so suppliers know who they're dealing with.")}
                </p>
              </div>
            )}
          </div>

          {/* Spend */}
          <div>
            <label className="label" htmlFor="event-annual-spend">{t("Estimated Annual Spend (TCO)")}</label>
            <select id="event-annual-spend" className="input" value={form.annual_spend} onChange={e => set("annual_spend", e.target.value)}>
              <option value="">{t("Select range...")}</option>
              {SPEND_RANGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Submit */}
          <div className="pt-2 space-y-3">
            <button
              type="submit"
              disabled={loading || !complete}
              className="btn-primary w-full justify-center py-4 text-base"
            >
              {loading && advancedLaunchMode === "1" ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t("Initialising sourcing event...")}
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  {t("Launch AI Discovery")}
                </>
              )}
            </button>
            <p className="text-xs text-slate-400 text-center -mt-1.5">
              {t("Full web research on real suppliers, ~60-90s")}
            </p>
            <button
              type="button"
              disabled={loading || !complete}
              onClick={() => void submitAdvanced("quick")}
              title={t("Fast, unverified name suggestions — no web research. Use \"Deepen\" on a result to verify it for real.")}
              className="btn-secondary w-full justify-center py-2.5 text-sm"
            >
              {loading && advancedLaunchMode === "quick" ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                  {t("Starting quick scan…")}
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  {t("Quick Scan instead — fast, unverified names")}
                </>
              )}
            </button>
            <p className="text-xs text-slate-400 text-center -mt-1.5">
              {t("Fast name suggestions, ~10s — deepen individual results to verify")}
            </p>
            {!complete && (
              <p className="text-center text-xs text-slate-500">{t("Complete all required fields to proceed")}</p>
            )}
          </div>

        </form>
        </>
        )}
      </div>

      {/* Upgrade gate — shown when event creation is blocked by billing (402) */}
      {showUpgrade && (
        <UpgradeGateModal code={upgradeCode} meta={upgradeMeta} onClose={closeUpgradeGate} />
      )}
    </div>
  );
}

// Extracted (#90) so useModalA11y's Esc/Tab-trap/focus-restore only run while
// this dialog is actually mounted, matching the pattern used for every other
// modal in the app instead of a hand-rolled, always-on Escape listener.
//
// Deliberately does NOT start a Stripe checkout itself (previously hardcoded
// tier="pro" regardless of which plan the org actually needed — a Basic-tier
// org hitting its monthly event cap would be walked into a Pro subscription).
// The 402 `code` only tells us *why* creation was blocked, not which tier
// fixes it, so instead of guessing, this always routes to /billing where the
// real tier picker lives.
function UpgradeGateModal({ code, meta, onClose }: {
  code: string | null; meta: { limit?: number; used?: number }; onClose: () => void;
}) {
  const t = useT();
  const dialogRef = useModalA11y(onClose);
  const isEventLimit = code === "event_limit_reached";
  const heading = isEventLimit ? t("Monthly event limit reached.") : t("Your free trial has ended.");
  const body = isEventLimit
    ? (typeof meta.used === "number" && typeof meta.limit === "number"
      ? t("You've used {used} of {limit} sourcing events included on your current plan this month. Upgrade to create more.", { used: meta.used, limit: meta.limit })
      : t("You've reached the sourcing-event limit included on your current plan this month. Upgrade to create more."))
    : t("Subscribe to a plan to create unlimited sourcing events, run multi-wave discovery, and deploy live outreach.");
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 animate-slide-in outline-none"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-900">{heading}</h3>
            <button onClick={onClose} aria-label={t("Cancel")} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed mb-5">
            {body}
          </p>
          <div className="flex items-center justify-end gap-2">
            <Link href="/billing" className="btn-primary py-2">
              <Sparkles className="w-3.5 h-3.5" /> {t("View plans")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
