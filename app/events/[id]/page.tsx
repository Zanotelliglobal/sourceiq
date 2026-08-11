"use client";

import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  X, Check, Minus, Bell, Star, Undo2, Sparkles, Lock, Hand,
  Mail, Globe, Phone, ArrowLeft, Factory, ArrowDown, SlidersHorizontal,
  Layers, ThumbsUp, ThumbsDown, Info,
} from "lucide-react";
import { useT } from "@/components/LanguageProvider";
import FunnelExplainer from "@/components/FunnelExplainer";
import EventSwitcher from "@/components/EventSwitcher";
import { applySupplierUpdated } from "@/lib/supplier-updates";
import { filterSuppliers, isFiltersEmpty, type SupplierFilters } from "@/lib/supplier-filters";
import { BUSINESS_TYPES, EMPLOYEE_BANDS, CAPABILITY_TAGS } from "@/lib/taxonomy";
import { useModalA11y } from "@/hooks/useModalA11y";

// ─── Types ────────────────────────────────────────────────────────────────────
type Supplier = {
  id: number; event_id: number; name: string; country: string; city: string | null;
  description: string; capabilities: string; certifications: string | null;
  employees: string | null; annual_revenue: string | null; founded: string | null;
  business_type: string | null; employee_count: string | null; founded_year: number | null;
  review_score: number | null; capability_tags: string | null;
  partnered_customers: string | null; partnered_customer_count: number | null;
  key_export_markets: string | null; verification_badges: string | null;
  feedback_signal: number | null;
  website: string | null; contact_email: string | null;
  contact_url: string | null; contact_phone: string | null; contact_linkedin: string | null;
  data_sources: string | null; scout_agent: string | null;
  wave: number; ai_score: number | null; score_rationale: string | null;
  score_breakdown: string | null; enrichment: string | null;
  funnel_stage: string; outreach_status: string; response_detail: string | null;
  notes: string | null; created_at: string;
};

type SupplierResponse = {
  responded: boolean; sentiment: "positive" | "negative"; language: string;
  reply: string; reply_en: string;
  capacity_confirmed: string; lead_time: string; highlights: string[];
};

// One message in a supplier's revisitable outreach thread (GET /api/outreach-log).
type OutreachLogEntry = {
  id: number; direction: string; subject: string | null; body: string; sent_at: string;
};

type AgentRun = {
  id: number; agent_id: string; agent_type: string; agent_label: string;
  wave: number; status: string; message: string | null; suppliers_found: number;
};

type Event = {
  id: number; title: string; category: string; subcategory: string | null; description: string;
  requirements: string; annual_spend: string | null;
  target_countries: string | null;
  outreach_anonymous?: boolean;
  buyer_name?: string | null; buyer_role?: string | null; buyer_company?: string | null;
  status: string; wave_count: number; created_at: string;
};

const SPEND_RANGES = ["< $500K / year", "$500K – $1M / year", "$1M – $5M / year", "$5M – $20M / year", "$20M – $50M / year", "> $50M / year", "Confidential"];
const GEOGRAPHIES = ["United States", "Canada", "Mexico", "Germany", "United Kingdom", "Italy", "Poland", "Czech Republic", "Turkey", "India", "China", "Vietnam", "Japan", "South Korea", "Taiwan", "Brazil"];

// Full country list for the "add another country" dropdown (mirrors the new-event form).
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

// ─── Constants ────────────────────────────────────────────────────────────────
// Funnel: Long List (start) → Contacted → Responded (positive gate) → Short List (end).
// Declined is a side state for suppliers that did not reply or replied negatively.
const STAGES = [
  { key: "all",          label: "All Suppliers" },
  { key: "long_list",    label: "Long List" },
  { key: "contacted",    label: "Contacted" },
  { key: "responded",    label: "Responded" },
  { key: "shortlisted",  label: "Short List" },
  { key: "declined",     label: "Declined" },
];

// The ordered progression pipeline shown as the funnel bar.
// Semantic funnel colors — canonical per design-system/MASTER.md:
// long=slate · contacted=blue · responded=green · shortlisted=amber(gold) · declined=red.
const FUNNEL = [
  { key: "long_list",   label: "Long List",  hint: "Discovered",        dot: "bg-slate-400" },
  { key: "contacted",   label: "Contacted",  hint: "RFI sent by agent", dot: "bg-blue-500" },
  { key: "responded",   label: "Responded",  hint: "Positive reply",    dot: "bg-emerald-500" },
  { key: "shortlisted", label: "Short List", hint: "Buyer approved",    dot: "bg-amber-500" },
];

const STAGE_STYLE: Record<string, { dot: string; text: string; bg: string }> = {
  long_list:    { dot: "bg-slate-400",              text: "text-slate-500",   bg: "bg-slate-50" },
  contacted:    { dot: "bg-blue-500 animate-pulse", text: "text-blue-700",    bg: "bg-blue-50" },
  responded:    { dot: "bg-emerald-500",            text: "text-emerald-700", bg: "bg-emerald-50" },
  shortlisted:  { dot: "bg-amber-500",              text: "text-amber-700",   bg: "bg-amber-50" },
  declined:     { dot: "bg-red-400",                text: "text-red-500",     bg: "bg-red-50" },
};

const SCORE_STYLE = (s: number) =>
  s >= 80 ? "bg-emerald-500" :
  s >= 70 ? "bg-blue-500" :
  s >= 60 ? "bg-amber-500" : "bg-red-400";

const SCORE_TEXT = (s: number) =>
  s >= 80 ? "text-emerald-700 bg-emerald-50" :
  s >= 70 ? "text-blue-700 bg-blue-50" :
  s >= 60 ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50";

function tryParse<T>(s: string | null, fallback: T): T {
  try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; }
}

// ─── SSE stream reader ──────────────────────────────────────────────────────────
// Reads a text/event-stream response and dispatches each complete `data:` line.
// Network chunks do NOT align to line boundaries — a single read() can deliver a
// partial line, with the remainder arriving in a later chunk. We buffer across
// reads and only parse lines terminated by a newline, so events are never lost or
// split mid-JSON (the previous per-chunk split() dropped/crashed on partial lines,
// which made the live UI appear frozen until a manual refresh).
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (msg: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Abort the reader when the caller cancels, so the loop unblocks promptly.
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  if (signal) {
    if (signal.aborted) { void reader.cancel().catch(() => {}); return; }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  const flushLine = (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith("data: ")) return;
    const payload = trimmed.slice(6);
    if (!payload || payload === "[DONE]") return;
    try { onEvent(JSON.parse(payload)); }
    catch { /* ignore malformed/partial payloads */ }
  };

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      flushLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  // Flush any trailing complete line left in the buffer at stream end.
  buffer += decoder.decode();
  if (buffer.length) flushLine(buffer);
  } catch (err) {
    // Reader cancellation surfaces as an AbortError — swallow it, rethrow others.
    if (!(err instanceof DOMException && err.name === "AbortError")) throw err;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

// ─── Score bar ────────────────────────────────────────────────────────────────
function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-40 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${SCORE_STYLE(value)}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-700 w-6 text-right">{value}</span>
    </div>
  );
}

// useModalA11y lives in hooks/useModalA11y.ts (extracted for #40 so the
// dashboard/billing modals can share it too) — imported above.

// ─── Detail panel ─────────────────────────────────────────────────────────────
function DetailPanel({ supplier, onClose, onMove, onOutreach, onFollowUp, onFeedback }: {
  supplier: Supplier;
  onClose: () => void;
  onMove: (id: number, stage: string) => void;
  onOutreach: (s: Supplier) => void;
  onFollowUp: (s: Supplier) => void;
  onFeedback: (id: number, signal: number) => void;
}) {
  const t = useT();
  const caps    = tryParse<string[]>(supplier.capabilities, []);
  const certs   = tryParse<string[]>(supplier.certifications, []);
  const tags    = tryParse<string[]>(supplier.capability_tags, []);
  const customers = tryParse<string[]>(supplier.partnered_customers, []);
  const exportMarkets = tryParse<string[]>(supplier.key_export_markets, []);
  const badges  = tryParse<string[]>(supplier.verification_badges, []);
  const breakdown = tryParse<Record<string, number>>(supplier.score_breakdown, {});
  const enrichment = tryParse<{ market_position?: string; key_risks?: string[]; key_strengths?: string[]; recommended_action?: string } | null>(supplier.enrichment, null);
  const response = tryParse<SupplierResponse | null>(supplier.response_detail, null);
  const stage   = STAGE_STYLE[supplier.funnel_stage] || STAGE_STYLE.long_list;
  const [showReplyEn, setShowReplyEn] = useState(false);
  const replyForeign = response?.language && response.language.toLowerCase() !== "english";
  const dialogRef = useModalA11y(onClose);

  // Revisitable outreach thread: every RFI/follow-up sent and every reply
  // received for this supplier, oldest first. Self-fetched so the panel stays
  // a drop-in presentational component driven only by the `supplier` prop.
  const [thread, setThread] = useState<OutreachLogEntry[] | null>(null);
  const [threadError, setThreadError] = useState(false);
  useEffect(() => {
    let alive = true;
    setThread(null);
    setThreadError(false);
    (async () => {
      try {
        const res = await fetch(`/api/outreach-log?supplier_id=${supplier.id}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (alive) setThread(data.entries || []);
      } catch {
        if (alive) setThreadError(true);
      }
    })();
    return () => { alive = false; };
  }, [supplier.id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={supplier.name}
        className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl flex flex-col animate-slide-in outline-none"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="font-bold text-slate-900 text-lg leading-tight">{supplier.name}</h2>
              {badges.includes("website-live") && (
                <span title={t("Website reachability verified automatically")} className="inline-flex items-center gap-1 flex-shrink-0 text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded">
                  <Check className="w-2.5 h-2.5" /> {t("Verified")}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">{[supplier.city, supplier.country].filter(Boolean).join(", ")}</p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-6 flex-1">

          {/* Score + stage */}
          <div className="flex items-center gap-4">
            {supplier.ai_score !== null && (
              <div className={`w-20 h-20 rounded-2xl flex flex-col items-center justify-center border-2 font-bold ${SCORE_TEXT(supplier.ai_score)} border-current`}>
                <span className="text-3xl leading-none">{supplier.ai_score}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide mt-1 opacity-60">{t("Score")}</span>
              </div>
            )}
            <div className="flex-1">
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold mb-2 ${stage.bg} ${stage.text}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${stage.dot}`} />
                {(() => { const lbl = STAGES.find(s => s.key === supplier.funnel_stage)?.label; return lbl ? t(lbl) : supplier.funnel_stage; })()}
              </div>
              {enrichment?.recommended_action && (
                <div className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                  enrichment.recommended_action === "pursue" ? "text-emerald-600" :
                  enrichment.recommended_action === "pass" ? "text-red-500" : "text-amber-800"
                }`}>
                  {enrichment.recommended_action === "pursue" ? <><Check className="w-4 h-4" /> {t("Recommended: Pursue")}</> :
                   enrichment.recommended_action === "pass" ? <><X className="w-4 h-4" /> {t("Recommended: Pass")}</> : <><Minus className="w-4 h-4" /> {t("Recommended: Monitor")}</>}
                </div>
              )}
              {enrichment?.market_position && (
                <p className="text-xs text-slate-500 mt-1">{enrichment.market_position}</p>
              )}
            </div>
          </div>

          {/* Quick facts */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Business Type", v: supplier.business_type },
              { label: "Employees", v: supplier.employee_count ?? supplier.employees },
              { label: "Rating", v: supplier.review_score !== null ? `★ ${supplier.review_score.toFixed(1)} / 5` : null },
              { label: "Est. Revenue", v: supplier.annual_revenue },
              { label: "Partnered Customers", v: supplier.partnered_customer_count ? t("{n} known", { n: supplier.partnered_customer_count }) : null },
              { label: "Founded", v: supplier.founded_year ?? supplier.founded },
              { label: "Website", v: supplier.website },
              { label: "Contact", v: supplier.contact_email },
              { label: "Contact Page", v: supplier.contact_url },
              { label: "Phone", v: supplier.contact_phone },
              { label: "LinkedIn", v: supplier.contact_linkedin },
              { label: "Scout Agent", v: supplier.scout_agent },
              { label: "Wave", v: supplier.wave ? t("Wave {n}", { n: supplier.wave }) : null },
            ].filter(x => x.v).map(({ label, v }) => (
              <div key={label} className="bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t(label)}</div>
                <div className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{v}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{t("Company Overview")}</div>
            <p className="text-sm text-slate-700 leading-relaxed">{supplier.description}</p>
          </div>

          {/* Capabilities */}
          {caps.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{t("Core Capabilities")}</div>
              <div className="flex flex-wrap gap-1.5">
                {caps.map(c => (
                  <span key={c} className="text-xs bg-white border border-slate-200 text-slate-600 px-2.5 py-1 rounded-lg">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* Capability tags — controlled-vocabulary highlights */}
          {tags.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{t("Capability Tags")}</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => (
                  <span key={tag} className="text-xs bg-indigo-50 border border-indigo-100 text-indigo-700 px-2.5 py-1 rounded-lg font-medium">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Certifications */}
          {certs.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{t("Certifications")}</div>
              <div className="flex flex-wrap gap-1.5">
                {certs.map(c => (
                  <span key={c} className="text-xs bg-emerald-50 border border-emerald-100 text-emerald-700 px-2.5 py-1 rounded-lg font-medium">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* Partnered customers */}
          {customers.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{t("Partnered Customers")}</div>
              <div className="flex flex-wrap gap-1.5">
                {customers.map(c => (
                  <span key={c} className="text-xs bg-white border border-slate-200 text-slate-600 px-2.5 py-1 rounded-lg">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* Key export markets */}
          {exportMarkets.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{t("Key Export Markets")}</div>
              <div className="flex flex-wrap gap-1.5">
                {exportMarkets.map(m => (
                  <span key={m} className="text-xs bg-blue-50 border border-blue-100 text-blue-700 px-2.5 py-1 rounded-lg font-medium">{m}</span>
                ))}
              </div>
            </div>
          )}

          {/* AI Assessment */}
          {supplier.score_rationale && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{t("AI Assessment")}</div>
                {/* Thumbs up/down quality signal (#46 — Epic 5.3). Re-clicking an
                    active thumb clears it (signal 0); the two are mutually exclusive. */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onFeedback(supplier.id, supplier.feedback_signal === 1 ? 0 : 1)}
                    title={t("Good assessment")}
                    className={`p-1 rounded-md border transition-colors ${
                      supplier.feedback_signal === 1
                        ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                        : "border-transparent text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onFeedback(supplier.id, supplier.feedback_signal === -1 ? 0 : -1)}
                    title={t("Poor assessment")}
                    className={`p-1 rounded-md border transition-colors ${
                      supplier.feedback_signal === -1
                        ? "bg-red-50 border-red-200 text-red-600"
                        : "border-transparent text-slate-500 hover:text-red-600 hover:bg-red-50"
                    }`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4 border border-slate-100">{supplier.score_rationale}</p>
              <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-500">
                <Info className="w-3 h-3 flex-shrink-0" />
                {t("AI may make mistakes. Please verify important information.")}
              </div>
            </div>
          )}

          {/* Score breakdown */}
          {Object.keys(breakdown).length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">{t("Qualification Dimensions")}</div>
              <div className="space-y-2.5">
                {Object.entries(breakdown).map(([k, v]) => (
                  <ScoreBar key={k} label={k.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())} value={v} />
                ))}
              </div>
            </div>
          )}

          {/* Enrichment */}
          {enrichment && (enrichment.key_strengths?.length || enrichment.key_risks?.length) ? (
            <div className="grid grid-cols-2 gap-4">
              {enrichment.key_strengths && enrichment.key_strengths.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-2">{t("Strengths")}</div>
                  <ul className="space-y-1.5">
                    {enrichment.key_strengths.map((s, i) => (
                      <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                        <span className="text-emerald-500 font-bold flex-shrink-0">+</span>{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {enrichment.key_risks && enrichment.key_risks.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-2">{t("Risk Factors")}</div>
                  <ul className="space-y-1.5">
                    {enrichment.key_risks.map((r, i) => (
                      <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                        <Minus className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}

          {/* Supplier response to RFI */}
          {response && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                {t("RFI Response")}
                {response.responded ? (
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] ${response.sentiment === "positive" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                    {response.sentiment === "positive" ? t("POSITIVE") : t("DECLINED")}
                  </span>
                ) : (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-slate-100 text-slate-500">{t("NO RESPONSE")}</span>
                )}
              </div>
              {response.responded ? (
                <div className={`rounded-xl p-4 border ${response.sentiment === "positive" ? "bg-emerald-50/50 border-emerald-100" : "bg-red-50/50 border-red-100"}`}>
                  {replyForeign && (
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] text-slate-500 font-medium">{t("Reply in {language}", { language: response.language })}</span>
                      <button
                        onClick={() => setShowReplyEn(v => !v)}
                        className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 bg-white border border-slate-200 px-2 py-0.5 rounded transition-colors"
                      >
                        {showReplyEn ? t("Show {language}", { language: response.language }) : t("Translate to English")}
                      </button>
                    </div>
                  )}
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{showReplyEn && response.reply_en ? response.reply_en : response.reply}</p>
                  {response.sentiment === "positive" && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {response.capacity_confirmed && response.capacity_confirmed !== "N/A" && (
                        <span className="text-[10px] bg-white border border-emerald-200 text-emerald-700 px-2 py-1 rounded-lg font-medium">{t("Capacity: {value}", { value: response.capacity_confirmed })}</span>
                      )}
                      {response.lead_time && response.lead_time !== "N/A" && (
                        <span className="text-[10px] bg-white border border-emerald-200 text-emerald-700 px-2 py-1 rounded-lg font-medium">{t("Lead time: {value}", { value: response.lead_time })}</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500 italic bg-slate-50 rounded-xl p-4 border border-slate-100">{t("No reply received to the RFI within the follow-up window.")}</p>
              )}
            </div>
          )}

          {/* Outreach thread — the full, revisitable correspondence history for
              this supplier: every RFI/follow-up sent and every reply received,
              oldest first. Self-fetched from /api/outreach-log on open. */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
              <Mail className="w-3 h-3" /> {t("Outreach History")}
            </div>
            {threadError ? (
              <p className="text-sm text-red-600">{t("Could not load outreach history.")}</p>
            ) : thread === null ? (
              <p className="text-sm text-slate-500">{t("Loading…")}</p>
            ) : thread.length === 0 ? (
              <p className="text-sm text-slate-500 italic bg-slate-50 rounded-xl p-4 border border-slate-100">{t("No outreach sent yet.")}</p>
            ) : (
              <ol className="relative border-l border-slate-200 ml-2 space-y-3">
                {thread.map(msg => (
                  <li key={msg.id} className="ml-4">
                    <div className={`absolute -left-1.5 w-3 h-3 rounded-full border-2 border-white ${msg.direction === "inbound" ? "bg-emerald-400" : "bg-blue-400"}`} />
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${msg.direction === "inbound" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"}`}>
                        {msg.direction === "inbound" ? t("Received") : t("Sent")}
                      </span>
                      <span className="text-[11px] text-slate-500">{relativeTime(msg.sent_at)}</span>
                    </div>
                    {msg.subject && <div className="text-xs font-semibold text-slate-700">{msg.subject}</div>}
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {/* Action footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4">
          <div className="flex flex-wrap gap-2">
            {supplier.funnel_stage === "long_list" && (
              <button onClick={() => { onOutreach(supplier); onClose(); }} className="btn-cta flex-1 justify-center py-2.5">
                {t("Send RFI Now")}
              </button>
            )}
            {supplier.funnel_stage === "contacted" && (
              <button onClick={() => { onFollowUp(supplier); onClose(); }} className="btn-ghost flex-1 justify-center py-2.5">
                <Bell className="w-4 h-4" /> {t("Send Follow-up")}
              </button>
            )}
            {supplier.funnel_stage === "responded" && (
              <button onClick={() => { onMove(supplier.id, "shortlisted"); onClose(); }} className="btn-primary flex-1 justify-center py-2.5">
                <Star className="w-4 h-4" /> {t("Add to Short List")}
              </button>
            )}
            {supplier.funnel_stage === "shortlisted" && (
              <button onClick={() => { onMove(supplier.id, "responded"); onClose(); }} className="btn-ghost py-2.5">
                <Undo2 className="w-4 h-4" /> {t("Remove from Short List")}
              </button>
            )}
            {supplier.funnel_stage !== "declined" ? (
              <button onClick={() => { onMove(supplier.id, "declined"); onClose(); }} className="btn-ghost text-red-500 hover:bg-red-50 py-2.5">
                <X className="w-4 h-4" /> {t("Decline")}
              </button>
            ) : (
              <button onClick={() => { onMove(supplier.id, "long_list"); onClose(); }} className="btn-ghost py-2.5">
                {t("Restore to Long List")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Outreach modal ───────────────────────────────────────────────────────────
function OutreachModal({ supplier, anonymous = true, onClose, onSent }: {
  supplier: Supplier; anonymous?: boolean; onClose: () => void; onSent: (id: number) => void;
}) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<{ language?: string; subject: string; body: string; subject_en?: string; body_en?: string } | null>(null);
  const [showEn, setShowEn] = useState(false);
  const [copied, setCopied] = useState(false);
  // Website-contact channel (no email on file, but a contact page): the
  // server already logged the drafted RFI and parked the supplier in
  // outreach_status='awaiting_manual_send' — the confirm button below must
  // call /api/outreach/mark-sent to actually persist the buyer's "I sent it"
  // confirmation, rather than only updating local UI state.
  const [awaitingManual, setAwaitingManual] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetch("/api/qualify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_outreach", supplier_id: supplier.id }),
    }).then(r => r.json()).then(d => { setEmail(d.email); setAwaitingManual(!!d.awaiting_manual); setLoading(false); });
  }, [supplier.id]);

  const confirmSent = async () => {
    if (!awaitingManual) { onSent(supplier.id); onClose(); return; }
    setConfirming(true);
    try {
      const res = await fetch("/api/outreach/mark-sent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier_id: supplier.id }),
      });
      if (!res.ok) throw new Error();
    } catch { /* best-effort — local state still advances so the UI isn't stuck */ }
    setConfirming(false);
    onSent(supplier.id);
    onClose();
  };

  const isForeign = email?.language && email.language.toLowerCase() !== "english";

  // For disclosed outreach the buyer may prefer to send from their own mailbox.
  const activeSubject = email ? (showEn && email.subject_en ? email.subject_en : email.subject) : "";
  const activeBody = email ? (showEn && email.body_en ? email.body_en : email.body) : "";
  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${activeSubject}\n\n${activeBody}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };
  const mailtoHref =
    `mailto:${encodeURIComponent(supplier.contact_email || "")}` +
    `?subject=${encodeURIComponent(activeSubject)}&body=${encodeURIComponent(activeBody)}`;
  const dialogRef = useModalA11y(onClose);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={anonymous ? t("Anonymous RFI Outreach") : t("RFI Outreach")}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200 animate-slide-in outline-none"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-slate-900">{anonymous ? t("Anonymous RFI Outreach") : t("RFI Outreach")}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{supplier.name} · {anonymous ? t("Identity protected") : t("Sent under your name")}</p>
            </div>
            <button onClick={onClose} aria-label={t("Close")} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="w-4 h-4" /></button>
          </div>
          {loading ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500">{t("Drafting personalised RFI email...")}</p>
            </div>
          ) : email ? (
            <div className="space-y-4">
              {isForeign && (
                <div className="flex items-center justify-between gap-2 p-2.5 bg-blue-50 rounded-xl border border-blue-100">
                  <span className="inline-flex items-center gap-1.5 text-xs text-blue-700 font-medium">
                    <Sparkles className="w-3.5 h-3.5" /> {t("Written in {language} for this supplier", { language: email.language ?? "" })}
                  </span>
                  <button
                    onClick={() => setShowEn(v => !v)}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-white border border-blue-200 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    {showEn ? t("Show {language}", { language: email.language ?? "" }) : t("Translate to English")}
                  </button>
                </div>
              )}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">{t("Subject Line")}</div>
                <div className="text-sm font-semibold text-slate-800 bg-slate-50 px-4 py-3 rounded-xl border border-slate-200">{showEn && email.subject_en ? email.subject_en : email.subject}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">{t("Message")}</div>
                <div className="text-sm text-slate-700 bg-slate-50 px-4 py-4 rounded-xl border border-slate-200 whitespace-pre-wrap leading-relaxed">{showEn && email.body_en ? email.body_en : email.body}</div>
              </div>
              {anonymous ? (
                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100 text-xs text-amber-700">
                  <Lock className="w-4 h-4 flex-shrink-0" /> {t("Sent anonymously via SourceIQ — your organisation identity is not disclosed")}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700">
                  <Hand className="w-4 h-4 flex-shrink-0" /> {t("Disclosed outreach — copy the draft or open it in your own email client to send under your name.")}
                </div>
              )}

              {awaitingManual && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700">
                  <Globe className="w-4 h-4 flex-shrink-0" /> {t("This supplier has no email on file — open their contact page, paste the draft into their form, then confirm below.")}
                </div>
              )}

              {/* Copy / send-via-own-client — always available, primary path when disclosed */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={copyDraft} className="btn-secondary justify-center py-2.5 text-sm">
                  {copied ? <><Check className="w-4 h-4" /> {t("Copied")}</> : t("Copy draft")}
                </button>
                {supplier.contact_email ? (
                  <a
                    href={mailtoHref}
                    className="btn-secondary justify-center py-2.5 text-sm"
                    title={t("Open in your default email app")}
                  >
                    {t("Open in email app")}
                  </a>
                ) : supplier.contact_url ? (
                  <a
                    href={supplier.contact_url}
                    target="_blank" rel="noopener noreferrer"
                    className="btn-secondary justify-center py-2.5 text-sm"
                    title={t("Open contact page — {url}", { url: supplier.contact_url })}
                  >
                    {t("Open contact page")}
                  </a>
                ) : (
                  <span
                    className="btn-secondary justify-center py-2.5 text-sm opacity-50 pointer-events-none"
                    title={t("No contact channel on file")}
                  >
                    {t("No contact channel")}
                  </span>
                )}
              </div>

              <button onClick={confirmSent} disabled={confirming} className="btn-primary w-full justify-center py-3 disabled:opacity-60">
                {confirming ? t("Confirming...") : awaitingManual ? t("Confirm I sent it via their website") : t("Confirm & Log RFI Sent")}
              </button>
            </div>
          ) : <p className="text-red-500 text-sm">{t("Failed to generate email.")}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Supplier row (compact table row) ─────────────────────────────────────────
function SupplierRow({ supplier, rank, onClick, onMove }: {
  supplier: Supplier; rank: number;
  onClick: () => void;
  onMove: (id: number, stage: string) => Promise<void>;
}) {
  const t = useT();
  const caps  = tryParse<string[]>(supplier.capabilities, []);
  const certs = tryParse<string[]>(supplier.certifications, []);
  const tags  = tryParse<string[]>(supplier.capability_tags, []);
  const badges = tryParse<string[]>(supplier.verification_badges, []);
  const stage = STAGE_STYLE[supplier.funnel_stage] || STAGE_STYLE.long_list;
  const stageLabelRaw = STAGES.find(s => s.key === supplier.funnel_stage)?.label || "";
  const stageLabel = stageLabelRaw ? t(stageLabelRaw) : "";

  return (
    <tr
      onClick={onClick}
      onKeyDown={e => {
        // Keyboard equivalent of the row click (#86): Enter/Space open the
        // supplier detail panel, same as clicking anywhere on the row.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      aria-label={t("View details for {value}", { value: supplier.name })}
      className={`group border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors focus:outline-none focus-visible:bg-slate-50 ${supplier.funnel_stage === "disqualified" ? "opacity-40" : ""}`}
    >
      {/* Rank */}
      <td className="pl-4 pr-2 py-3 w-8 text-xs text-slate-500 font-mono">{rank}</td>

      {/* Score */}
      <td className="px-2 py-3 w-14">
        {supplier.ai_score !== null && (
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${SCORE_TEXT(supplier.ai_score)}`}>
            {supplier.ai_score}
          </div>
        )}
      </td>

      {/* Company */}
      <td className="px-3 py-3 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-900 text-sm leading-tight truncate">{supplier.name}</span>
          {(() => {
            // Tiered reachability badge: email → contact page → phone → LinkedIn → none.
            if (supplier.contact_email)
              return <span title={t("Contactable — {value}", { value: supplier.contact_email })} className="inline-flex items-center gap-1 flex-shrink-0 text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded"><Mail className="w-2.5 h-2.5" /> {t("Email")}</span>;
            if (supplier.contact_url)
              return <span title={t("Contact page — {value}", { value: supplier.contact_url })} className="inline-flex items-center gap-1 flex-shrink-0 text-[9px] font-bold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded"><Globe className="w-2.5 h-2.5" /> {t("Contact page")}</span>;
            if (supplier.contact_phone)
              return <span title={t("Phone — {value}", { value: supplier.contact_phone })} className="inline-flex items-center gap-1 flex-shrink-0 text-[9px] font-bold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded"><Phone className="w-2.5 h-2.5" /> {t("Phone")}</span>;
            if (supplier.contact_linkedin)
              return <span title={t("LinkedIn — {value}", { value: supplier.contact_linkedin })} className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">{t("in LinkedIn")}</span>;
            return <span title={t("No contact channel found yet")} className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">{t("No contact")}</span>;
          })()}
          {badges.includes("website-live") && (
            <span title={t("Website reachability verified automatically")} className="inline-flex items-center gap-1 flex-shrink-0 text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded">
              <Check className="w-2.5 h-2.5" /> {t("Verified")}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">
          {[supplier.city, supplier.country].filter(Boolean).join(", ")}
          {supplier.business_type && <span className="ml-2">· {supplier.business_type}</span>}
          {(supplier.employee_count ?? supplier.employees) && <span className="ml-2">· {supplier.employee_count ?? supplier.employees}</span>}
          {supplier.review_score !== null && <span className="ml-2 text-amber-500">· ★ {supplier.review_score.toFixed(1)}</span>}
        </div>
      </td>

      {/* Certs — hidden on small */}
      <td className="px-3 py-3 hidden lg:table-cell w-48">
        <div className="flex flex-wrap gap-1">
          {certs.slice(0, 2).map(c => (
            <span key={c} className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded font-medium">{c}</span>
          ))}
          {certs.length > 2 && <span className="text-[10px] text-slate-500">+{certs.length - 2}</span>}
        </div>
      </td>

      {/* Capability tags / capabilities — hidden on small */}
      <td className="px-3 py-3 hidden xl:table-cell max-w-xs">
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded font-medium">{tag}</span>
            ))}
            {tags.length > 3 && <span className="text-[10px] text-slate-500">+{tags.length - 3}</span>}
          </div>
        ) : (
          <div className="text-xs text-slate-500 truncate">{caps.slice(0, 3).join(" · ")}</div>
        )}
      </td>

      {/* Stage */}
      <td className="px-3 py-3 w-32 hidden md:table-cell">
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold ${stage.bg} ${stage.text}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${stage.dot} flex-shrink-0`} />
          {stageLabel}
        </span>
      </td>

      {/* Action */}
      <td className="px-3 py-3 w-28 text-right" onClick={e => e.stopPropagation()}>
        {/* Visible on hover AND on keyboard focus (#86) — a keyboard user
            tabbing to these buttons must be able to see them, not just
            reach them. */}
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {supplier.funnel_stage === "responded" && (
            <button
              onClick={async () => await onMove(supplier.id, "shortlisted")}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-1 rounded-lg transition-colors"
              title={t("Add to Short List")}
            >
              <Star className="w-2.5 h-2.5" /> {t("Shortlist")}
            </button>
          )}
          {supplier.funnel_stage !== "declined" ? (
            <button
              onClick={async () => await onMove(supplier.id, "declined")}
              className="inline-flex items-center text-[10px] font-semibold text-red-400 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors"
              title={t("Decline")}
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={async () => await onMove(supplier.id, "long_list")}
              className="text-[10px] font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition-colors"
              title={t("Restore")}
            >
              <Undo2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Brief editor modal ───────────────────────────────────────────────────────
// ── Governance audit trail ──────────────────────────────────────────────────
// Read-only history of governance-relevant actions on this event. Fetched once
// when opened (not on every poll) to avoid Clerk actor-resolution rate pressure.
type AuditEntry = { id: number; action: string; summary: string; actor: string; created_at: string };

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function AuditModal({ eventId, onClose }: { eventId: number; onClose: () => void }) {
  const t = useT();
  const dialogRef = useModalA11y(onClose);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/audit?event_id=${eventId}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (alive) setEntries(data.entries || []);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [eventId]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("Activity History")}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl border border-slate-200 animate-slide-in outline-none"
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="font-bold text-slate-900">{t("Activity History")}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{t("Who did what, and when — an append-only governance record")}</p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6">
{error ? (
            <p className="text-sm text-red-600 text-center py-6">{t("Could not load activity history.")}</p>
          ) : entries === null ? (
            <p className="text-sm text-slate-500 text-center py-6">{t("Loading…")}</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">{t("No activity recorded yet.")}</p>
          ) : (
            <ol className="relative border-l border-slate-200 ml-2 space-y-4">
              {entries.map(e => (
                <li key={e.id} className="ml-4">
                  <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-slate-300 border-2 border-white" />
                  <div className="text-sm text-slate-800">{e.summary}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    <span className="font-medium text-slate-500">{e.actor}</span> · {relativeTime(e.created_at)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefModal({ event, onClose, onSaved }: {
  event: Event; onClose: () => void; onSaved: (e: Event) => void;
}) {
  const t = useT();
  const [form, setForm] = useState({
    title: event.title,
    category: event.category,
    description: event.description,
    requirements: event.requirements,
    annual_spend: event.annual_spend || "",
  });
  const [countries, setCountries] = useState<string[]>(
    (event.target_countries || "").split(",").map(c => c.trim()).filter(Boolean)
  );
  const [saving, setSaving] = useState(false);
  const dialogRef = useModalA11y(onClose);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const toggle = (c: string) => setCountries(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/sourcing-events/${event.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, target_countries: countries.join(", ") }),
      });
      const updated = await res.json();
      onSaved(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={() => !saving && onClose()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("Scouting Brief")}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 animate-slide-in outline-none"
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="font-bold text-slate-900">{t("Scouting Brief")}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{t("Review and refine the mandate driving the agents")}</p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="label" htmlFor="brief-title">{t("Event Reference")}</label>
            <input id="brief-title" className="input" value={form.title} onChange={e => set("title", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="brief-category">{t("Commodity Category")}</label>
            <input id="brief-category" className="input" value={form.category} onChange={e => set("category", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="brief-description">{t("Sourcing Scope & Specification")}</label>
            <textarea id="brief-description" className="input resize-none" rows={4} value={form.description} onChange={e => set("description", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="brief-requirements">{t("Qualification Criteria & Constraints")}</label>
            <textarea id="brief-requirements" className="input resize-none" rows={4} value={form.requirements} onChange={e => set("requirements", e.target.value)} />
            <p className="text-xs text-blue-600 font-medium mt-1.5">{t("AI scoring recalibrates against these criteria on the next wave.")}</p>
          </div>
          <div role="group" aria-labelledby="brief-geographies-label">
            <div id="brief-geographies-label" className="label">{t("Target Sourcing Geographies")}</div>
            <div className="flex flex-wrap gap-2 mb-2">
              {GEOGRAPHIES.map(c => {
                const active = countries.includes(c);
                return (
                  <button key={c} type="button" onClick={() => toggle(c)}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"}`}>
                    {active && <Check className="w-3 h-3" />}{c}
                  </button>
                );
              })}
            </div>
            <select
              className="input"
              aria-label={t("+ Add another country…")}
              value=""
              onChange={e => { if (e.target.value) toggle(e.target.value); }}
            >
              <option value="">{t("+ Add another country…")}</option>
              {ALL_COUNTRIES.filter(c => !GEOGRAPHIES.includes(c) && !countries.includes(c)).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {countries.filter(c => !GEOGRAPHIES.includes(c)).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {countries.filter(c => !GEOGRAPHIES.includes(c)).map(c => (
                  <span key={c} className="inline-flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg">
                    {c}<button type="button" onClick={() => toggle(c)} className="hover:text-blue-200"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1.5">{t("Empty = global search. Scouts prioritise these countries and search local-language sources.")}</p>
          </div>
          <div>
            <label className="label" htmlFor="brief-annual-spend">{t("Estimated Annual Spend")}</label>
            <select id="brief-annual-spend" className="input" value={form.annual_spend} onChange={e => set("annual_spend", e.target.value)}>
              <option value="">{t("Select range…")}</option>
              {SPEND_RANGES.map(s => <option key={s} value={s}>{t(s)}</option>)}
            </select>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">{t("Changes apply to the next discovery wave and outreach.")}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost py-2.5">{t("Cancel")}</button>
            <button onClick={save} disabled={saving} className="btn-primary py-2.5 px-6">
              {saving ? t("Saving…") : t("Save Brief")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Confirmation gate before firing a bulk RFI campaign. Bulk outreach sends real
// emails to real suppliers and cannot be undone, so we surface the recipient
// count, the anonymous/disclosed mode, and a short recipient preview first.
function CampaignConfirmModal({ count, anonymous, preview, onCancel, onConfirm }: {
  count: number; anonymous: boolean; preview: Supplier[];
  onCancel: () => void; onConfirm: () => void;
}) {
  const t = useT();
  const dialogRef = useModalA11y(onCancel);

  const channel = (s: Supplier) =>
    s.contact_email ? s.contact_email
    : s.contact_url ? t("Contact page")
    : s.contact_phone ? s.contact_phone
    : t("No contact channel found yet");

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={onCancel}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("Send outreach to {n} suppliers?", { n: count })}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200 animate-slide-in outline-none"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900">{t("Send outreach to {n} suppliers?", { n: count })}</h3>
            <button onClick={onCancel} aria-label={t("Cancel")} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="w-4 h-4" /></button>
          </div>

          <div className={`flex items-start gap-2.5 p-3 rounded-xl border mb-4 ${anonymous ? "bg-blue-50 border-blue-100" : "bg-amber-50 border-amber-100"}`}>
            <Lock className={`w-4 h-4 flex-shrink-0 mt-0.5 ${anonymous ? "text-blue-600" : "text-amber-700"}`} />
            <p className="text-xs text-slate-600 leading-relaxed">
              {anonymous
                ? t("These RFIs are sent anonymously via SourceIQ — your organisation is never named. This emails real suppliers and cannot be undone.")
                : t("These RFIs disclose your name, role & company. This emails real suppliers and cannot be undone.")}
            </p>
          </div>

          <div className="mb-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{t("Recipients preview")}</p>
            <div className="space-y-1.5">
              {preview.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-3 text-xs px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="font-semibold text-slate-700 truncate">{s.name}</span>
                  <span className="text-slate-500 truncate max-w-[55%] text-right">{channel(s)}</span>
                </div>
              ))}
              {count > preview.length && (
                <p className="text-[11px] text-slate-500 pl-1">{t("+ {n} more", { n: count - preview.length })}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button onClick={onCancel} className="btn-secondary py-2">{t("Cancel")}</button>
            <button onClick={onConfirm} className="btn-primary py-2">
              <Mail className="w-3.5 h-3.5" /> {t("Send to {n} suppliers", { n: count })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Structured filter panel ───────────────────────────────────────────────────
// Filters the current event's already-discovered suppliers by the structured
// fields Epic 1 (#20) populates. Tabbed like SourceReady's panel, minus tabs we
// have no fields for yet: no "Highlight" (verification badges land in #39) and
// no separate "Product" tab (capability tags — the product-facing signals —
// live under "Product" here since there's no standalone Product object yet, #44).
const FILTER_TABS = ["General", "Product", "Profile", "Verification"] as const;
type FilterTab = (typeof FILTER_TABS)[number];

function FilterPanel({ filters, onApply, onClose }: {
  filters: SupplierFilters;
  onApply: (f: SupplierFilters) => void;
  onClose: () => void;
}) {
  const t = useT();
  const dialogRef = useModalA11y(onClose);
  const [draft, setDraft] = useState<SupplierFilters>(filters);
  const [tab, setTab] = useState<FilterTab>("General");
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const toggleIn = (key: "business_type" | "employee_count" | "certifications" | "capability_tags", value: string) => {
    setDraft(d => {
      const current = d[key] ?? [];
      const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      return { ...d, [key]: next };
    });
  };

  async function runAiFilter() {
    if (aiQuery.trim().length < 3) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/filter-suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: aiQuery.trim() }),
      });
      if (!res.ok) throw new Error();
      const mapped = (await res.json()) as SupplierFilters;
      setDraft(d => ({ ...d, ...mapped }));
    } catch {
      setAiError(t("Couldn't map that to filters — try being more specific."));
    } finally {
      setAiLoading(false);
    }
  }

  const clearAll = () => setDraft({});

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("Filter suppliers")}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 animate-slide-in outline-none"
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="font-bold text-slate-900">{t("Filter suppliers")}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{t("Narrow the current list by structured fields")}</p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 pt-4">
          <div className="mb-3">
            <label className="label" htmlFor="filter-ai-query">{t("AI filter — describe what you're looking for")}</label>
            <div className="flex gap-2">
              <input
                id="filter-ai-query"
                className="input"
                placeholder={t('e.g. "ISO-certified manufacturers in Vietnam with 200+ employees"')}
                value={aiQuery}
                onChange={e => setAiQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void runAiFilter(); } }}
              />
              <button
                onClick={() => void runAiFilter()}
                disabled={aiLoading || aiQuery.trim().length < 3}
                className="btn-secondary py-2 px-3 whitespace-nowrap disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" /> {aiLoading ? t("Mapping…") : t("Apply")}
              </button>
            </div>
            {aiError && <p className="text-xs text-red-600 mt-1.5">{aiError}</p>}
          </div>

          <div className="flex items-center gap-1 border-b border-slate-200">
            {FILTER_TABS.map(tb => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-all ${
                  tab === tb ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-600"
                }`}
              >
                {t(tb)}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 pt-4 space-y-4">
          {tab === "General" && (
            <>
              <div role="group" aria-labelledby="filter-business-type-label">
                <div id="filter-business-type-label" className="label">{t("Business type")}</div>
                <div className="flex flex-wrap gap-2">
                  {BUSINESS_TYPES.map(v => {
                    const active = (draft.business_type ?? []).includes(v);
                    return (
                      <button key={v} type="button" onClick={() => toggleIn("business_type", v)}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"}`}>
                        {active && <Check className="w-3 h-3" />}{v}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="filter-founded-after">{t("Founded after (year)")}</label>
                  <input id="filter-founded-after" type="number" className="input" placeholder={t("e.g. 1990")}
                    value={draft.founded_year_min ?? ""}
                    onChange={e => setDraft(d => ({ ...d, founded_year_min: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
                <div>
                  <label className="label" htmlFor="filter-founded-before">{t("Founded before (year)")}</label>
                  <input id="filter-founded-before" type="number" className="input" placeholder={t("e.g. 2015")}
                    value={draft.founded_year_max ?? ""}
                    onChange={e => setDraft(d => ({ ...d, founded_year_max: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
              </div>
            </>
          )}

          {tab === "Product" && (
            <div role="group" aria-labelledby="filter-capability-tags-label">
              <div id="filter-capability-tags-label" className="label">{t("Capability tags")}</div>
              <div className="flex flex-wrap gap-2">
                {CAPABILITY_TAGS.map(v => {
                  const active = (draft.capability_tags ?? []).includes(v);
                  return (
                    <button key={v} type="button" onClick={() => toggleIn("capability_tags", v)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"}`}>
                      {active && <Check className="w-3 h-3" />}{v}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "Profile" && (
            <>
              <div role="group" aria-labelledby="filter-employee-count-label">
                <div id="filter-employee-count-label" className="label">{t("Employee count")}</div>
                <div className="flex flex-wrap gap-2">
                  {EMPLOYEE_BANDS.map(v => {
                    const active = (draft.employee_count ?? []).includes(v);
                    return (
                      <button key={v} type="button" onClick={() => toggleIn("employee_count", v)}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"}`}>
                        {active && <Check className="w-3 h-3" />}{v}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="filter-review-score-min">{t("Minimum review score")}</label>
                <select id="filter-review-score-min" className="input" value={draft.review_score_min ?? ""}
                  onChange={e => setDraft(d => ({ ...d, review_score_min: e.target.value ? Number(e.target.value) : undefined }))}>
                  <option value="">{t("Any")}</option>
                  {[1, 2, 3, 3.5, 4, 4.5].map(n => <option key={n} value={n}>{n}+</option>)}
                </select>
              </div>
            </>
          )}

          {tab === "Verification" && (
            <div>
              <label className="label" htmlFor="filter-certifications">{t("Certifications")}</label>
              <input
                id="filter-certifications"
                className="input"
                placeholder={t("Type a certification and press Enter (e.g. ISO 9001:2015)")}
                onKeyDown={e => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const value = (e.target as HTMLInputElement).value.trim();
                  if (!value) return;
                  toggleIn("certifications", value);
                  (e.target as HTMLInputElement).value = "";
                }}
              />
              {(draft.certifications ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {(draft.certifications ?? []).map(c => (
                    <span key={c} className="inline-flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg">
                      {c}<button type="button" onClick={() => toggleIn("certifications", c)} className="hover:text-blue-200"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
          <button onClick={clearAll} className="btn-ghost py-2.5">{t("Clear all")}</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost py-2.5">{t("Cancel")}</button>
            <button onClick={() => { onApply(draft); onClose(); }} className="btn-primary py-2.5 px-6">{t("Apply filters")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function EventPage() {
  const t = useT();
  const { id } = useParams() as { id: string };
  const [event, setEvent]       = useState<Event | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [agents, setAgents]     = useState<AgentRun[]>([]);
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [campaigning, setCampaigning] = useState(false);
  const [confirmCampaign, setConfirmCampaign] = useState(false);
  const [liveAgents, setLiveAgents] = useState<{ agent_id: string; agent_label: string; status: string; message?: string }[]>([]);
  const [logs, setLogs]         = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState("all");
  // Structured filter panel state (Epic 3, #38). Persisted per-event in
  // localStorage so it survives reloads and isn't reset by SSE-driven
  // supplier list updates — those only ever append/patch `suppliers`.
  const [structuredFilters, setStructuredFilters] = useState<SupplierFilters>({});
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [outreachTarget, setOutreachTarget] = useState<Supplier | null>(null);
  const [editingBrief, setEditingBrief] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [sortBy, setSortBy]     = useState<"score" | "name" | "wave">("score");
  // Grouped results view (#46 — Epic 5.2): cluster the supplier table by
  // business_type instead of one flat list, mirroring the dashboard's
  // existing group-by-category pattern (app/dashboard/page.tsx).
  const [groupByType, setGroupByType] = useState(false);
  const [usage, setUsage]       = useState<{ cost_usd: number; total_tokens: number; web_searches: number } | null>(null);
  // Whether the org's plan permits exporting (CSV). Free tiers see an upgrade
  // prompt instead of the export button.
  const [canExport, setCanExport] = useState(true);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<HTMLDivElement>(null);
  const autostartedRef = useRef(false);

  // Resolve export capability from the org's plan once on mount.
  useEffect(() => {
    fetch("/api/usage")
      .then(r => r.json())
      .then(d => { if (d?.limits) setCanExport(Boolean(d.limits.export)); })
      .catch(() => {});
  }, []);

  // Hydrate structured filters from localStorage on mount, then persist any
  // change. Keyed per event so filters from one project don't leak into another.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`sourceiq:filters:${id}`);
      if (stored) setStructuredFilters(JSON.parse(stored));
    } catch { /* corrupt/old value — ignore, start from an empty filter set */ }
  }, [id]);
  useEffect(() => {
    try {
      window.localStorage.setItem(`sourceiq:filters:${id}`, JSON.stringify(structuredFilters));
    } catch { /* storage unavailable (e.g. private mode) — filters just won't persist */ }
  }, [id, structuredFilters]);

  // Close the export format menu on any outside click.
  useEffect(() => {
    if (!exportMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [exportMenuOpen]);

  // Toasts — transient user-facing notifications (errors, confirmations, undo).
  type Toast = { id: number; kind: "error" | "success" | "info"; msg: string; action?: { label: string; run: () => void } };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const dismissToast = useCallback((tid: number) => setToasts(prev => prev.filter(x => x.id !== tid)), []);
  const pushToast = useCallback((kind: Toast["kind"], msg: string, action?: Toast["action"]) => {
    const tid = ++toastSeq.current;
    setToasts(prev => [...prev, { id: tid, kind, msg, action }]);
    // Errors and undo prompts linger longer; plain info fades quickly.
    const ttl = action ? 8000 : kind === "error" ? 6000 : 3500;
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== tid)), ttl);
    return tid;
  }, []);

  // Abort controller for the in-flight discovery/outreach stream, so the user
  // can stop a running wave. Cleared once the run settles.
  const abortRef = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRun = useCallback(() => {
    if (!abortRef.current) return;
    setStopping(true);
    abortRef.current.abort();
    addLogRef.current?.("⏹  Stopping — no further suppliers will be contacted.");
  }, []);
  // addLog is defined below; keep a ref so stopRun (declared first) can call it.
  const addLogRef = useRef<((msg: string) => void) | null>(null);

  const loadData = useCallback(async () => {
    const res  = await fetch(`/api/sourcing-events/${id}`);
    const data = await res.json();
    setEvent(data.event);
    setSuppliers(data.suppliers || []);
    setAgents(data.agents || []);
    if (data.usage) setUsage(data.usage);
    setLoading(false);
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Server-side discovery is running (persisted status), regardless of whether
  // THIS tab holds the live SSE stream. After a refresh the fetch is aborted but
  // the agents keep working server-side and persisting suppliers to the DB.
  const serverWorking = event?.status === "scouting" || event?.status === "outreach";

  // Resilient live view: when a run is in progress server-side but this tab
  // isn't the one streaming it (fresh page load, refresh mid-run, or a run
  // launched from another device), poll the DB so newly-found suppliers appear
  // live and survive reloads — instead of the page going static until re-entry.
  useEffect(() => {
    if (running) return;        // local SSE stream already delivering live updates
    if (!serverWorking) return; // nothing running server-side
    const timer = setInterval(() => { void loadData(); }, 4000);
    return () => clearInterval(timer);
  }, [running, serverWorking, loadData]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const addLog = (msg: string) =>
    setLogs(prev => [...prev.slice(-149), `${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}  ${msg}`]);
  addLogRef.current = addLog;

  function handleStreamEvent(msg: Record<string, unknown>) {
    const type = msg.type as string;
    if (type === "wave_start")        addLog(msg.message as string);
    if (type === "strategy")          addLog(`Strategy: ${msg.strategy}`);
    if (type === "agents_registered") {
      const a = msg.agents as { id: string; label: string }[];
      setLiveAgents(a.map(x => ({ agent_id: x.id, agent_label: x.label, status: "queued" })));
      addLog(`${a.length} agents deployed`);
    }
    if (type === "agent_start") {
      setLiveAgents(prev => prev.map(a => a.agent_id === msg.agent_id ? { ...a, status: "running", message: "Scanning market directories..." } : a));
      addLog(`▶  ${msg.agent_label} — scouting`);
    }
    if (type === "agent_scouted") {
      setLiveAgents(prev => prev.map(a => a.agent_id === msg.agent_id ? { ...a, status: "qualifying", message: `Qualifying ${msg.count} leads...` } : a));
    }
    if (type === "qualifying")       addLog(`   Qualifying ${msg.supplier_name}...`);
    if (type === "supplier_found") {
      const s = msg.supplier as Supplier;
      setSuppliers(prev => prev.find(x => x.id === s.id) ? prev : [...prev, s]);
      addLog(`✓  ${s.name} (${s.country}) — ${s.ai_score}`);
    }
    if (type === "supplier_updated") {
      // A background contact scrape (deferred off the critical path — see
      // lib/process-supplier.ts) resolved after the card was already streamed.
      // Patch the matching card in place with whatever channels it found.
      setSuppliers(prev => applySupplierUpdated(prev, msg));
    }
    if (type === "agent_complete") {
      setLiveAgents(prev => prev.map(a => a.agent_id === msg.agent_id ? { ...a, status: "complete", message: `${msg.suppliers_found} leads delivered` } : a));
      addLog(`■  ${msg.agent_label} — ${msg.suppliers_found} suppliers complete`);
    }
    if (type === "usage") {
      setUsage({ cost_usd: msg.cost_usd as number, total_tokens: msg.total_tokens as number, web_searches: msg.web_searches as number });
    }
    if (type === "wave_complete") {
      addLog(`Wave ${msg.wave} complete — ${msg.new_suppliers} new · ${msg.total_suppliers} total`);
      const u = msg.usage as { cost_usd: number; total_tokens: number; web_searches: number } | undefined;
      if (u) { setUsage(u); addLog(`💰 Run cost so far: $${u.cost_usd.toFixed(2)} · ${(u.total_tokens/1000).toFixed(0)}k tokens · ${u.web_searches} web searches`); }
      setEvent(e => e ? { ...e, wave_count: msg.wave as number, status: "reviewing" } : e);
    }
    if (type === "error") { addLog(`ERR ${msg.message}`); pushToast("error", String(msg.message || t("Discovery failed"))); }
  }

  async function runWave() {
    setRunning(true);
    setStopping(false);
    setLogs([]);
    setLiveAgents([]);
    const controller = new AbortController();
    abortRef.current = controller;
    const nextWave = (event?.wave_count ?? 0) + 1;
    addLog(`Initialising Wave ${nextWave}...`);
    try {
      const res = await fetch("/api/orchestrate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: id, wave: nextWave }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        const detail = err.error ? ` — ${err.error}` : "";
        addLog(`ERR discovery failed (${res.status})${detail}`);
        pushToast("error", t("Discovery failed") + detail);
      } else {
        await readEventStream(res.body, handleStreamEvent, controller.signal);
        if (controller.signal.aborted) pushToast("info", t("Discovery stopped."));
      }
      await loadData();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        addLog("⏹  Discovery stopped by user.");
        pushToast("info", t("Discovery stopped."));
      } else {
        addLog(`ERR discovery failed: ${String(err)}`);
        pushToast("error", t("Discovery failed"));
      }
      await loadData().catch(() => {});
    } finally {
      abortRef.current = null;
      setStopping(false);
      setRunning(false);
      setLiveAgents(prev => prev.map(a => ({ ...a, status: "complete" })));
    }
  }

  // Auto-launch the first discovery wave when arriving straight from event
  // creation (?autostart=1), so users don't have to click "Launch Discovery"
  // themselves. Guarded to fire once, and only for a fresh event with no waves.
  useEffect(() => {
    if (autostartedRef.current) return;
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("autostart") !== "1") return;
    if (loading || !event) return;
    if (running || (event.wave_count ?? 0) > 0 || suppliers.length > 0) return;
    autostartedRef.current = true;
    void runWave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, event, running, suppliers.length]);

  async function moveStage(supplierId: number, stage: string, opts?: { silent?: boolean }) {
    const prevStage = suppliers.find(s => s.id === supplierId)?.funnel_stage;
    // Optimistic update; revert if the request fails.
    setSuppliers(prev => prev.map(s => s.id === supplierId ? { ...s, funnel_stage: stage } : s));
    if (selected?.id === supplierId) setSelected(s => s ? { ...s, funnel_stage: stage } : s);
    try {
      const res = await fetch("/api/qualify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move_stage", supplier_id: supplierId, stage }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!opts?.silent && prevStage && prevStage !== stage) {
        const label = STAGES.find(x => x.key === stage)?.label ?? stage;
        pushToast("success", t("Moved to {stage}", { stage: t(label) }), {
          label: t("Undo"),
          run: () => { void moveStage(supplierId, prevStage, { silent: true }); },
        });
      }
    } catch (err) {
      // Revert the optimistic change and tell the user.
      if (prevStage) {
        setSuppliers(prev => prev.map(s => s.id === supplierId ? { ...s, funnel_stage: prevStage } : s));
        if (selected?.id === supplierId) setSelected(s => s ? { ...s, funnel_stage: prevStage } : s);
      }
      addLog(`ERR could not move supplier: ${String(err)}`);
      pushToast("error", t("Could not update stage. Please try again."));
    }
  }

  // Thumbs up/down on a supplier's AI assessment (#46 — Epic 5.3). Same
  // optimistic-update-then-revert shape as moveStage above.
  async function setFeedback(supplierId: number, signal: number) {
    const prev = suppliers.find(s => s.id === supplierId)?.feedback_signal ?? null;
    setSuppliers(p => p.map(s => s.id === supplierId ? { ...s, feedback_signal: signal } : s));
    if (selected?.id === supplierId) setSelected(s => s ? { ...s, feedback_signal: signal } : s);
    try {
      const res = await fetch("/api/qualify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_feedback", supplier_id: supplierId, signal }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setSuppliers(p => p.map(s => s.id === supplierId ? { ...s, feedback_signal: prev } : s));
      if (selected?.id === supplierId) setSelected(s => s ? { ...s, feedback_signal: prev } : s);
      addLog(`ERR could not save feedback: ${String(err)}`);
      pushToast("error", t("Could not save feedback. Please try again."));
    }
  }

  function handleOutreachSent(supplierId: number) {
    setSuppliers(prev => prev.map(s => s.id === supplierId ? { ...s, outreach_status: "sent", funnel_stage: "contacted" } : s));
  }

  async function sendFollowUp(s: Supplier) {
    addLog(`🔔  Sending follow-up to ${s.name}...`);
    try {
      const res = await fetch("/api/qualify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_followup", supplier_id: s.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (d.warning) { addLog(`⚠  Follow-up drafted for ${s.name} — ${d.warning}`); pushToast("info", String(d.warning)); }
      else { addLog(`   Follow-up ${d.delivery?.mode === "live" ? "sent" : "drafted"} for ${s.name}`); pushToast("success", t("Follow-up sent to {name}", { name: s.name })); }
    } catch (err) {
      addLog(`ERR follow-up failed: ${String(err)}`);
      pushToast("error", t("Could not send follow-up to {name}.", { name: s.name }));
    }
  }

  async function shortlistResponders() {
    try {
      const res = await fetch("/api/qualify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "shortlist_responders", event_id: Number(id) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || `HTTP ${res.status}`);
      setSuppliers(prev => prev.map(s => s.funnel_stage === "responded" ? { ...s, funnel_stage: "shortlisted" } : s));
      addLog(`⭐  Shortlisted ${d.moved} responder${d.moved === 1 ? "" : "s"}.`);
      pushToast("success", t("Shortlisted {n} responders", { n: d.moved }));
    } catch (err) {
      addLog(`ERR shortlist failed: ${String(err)}`);
      pushToast("error", t("Could not shortlist responders. Please try again."));
    }
  }

  function handleCampaignEvent(msg: Record<string, unknown>) {
    const type = msg.type as string;
    const patch = (id: number, p: Partial<Supplier>) =>
      setSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...p } : s));

    if (type === "campaign_start") addLog(msg.message as string);
    if (type === "contact_found") {
      const email = msg.contact_email as string, url = msg.contact_url as string, phone = msg.phone as string;
      patch(msg.supplier_id as number, {
        contact_email: email || undefined, contact_url: url || undefined, contact_phone: phone || undefined,
      });
      const via = email ? `email ${email}` : url ? `contact page` : phone ? `phone ${phone}` : "a channel";
      addLog(`🔎  Found ${via} for ${msg.supplier_name}`);
    }
    if (type === "contacting")  addLog(`📨  Contacting ${msg.supplier_name}...`);
    if (type === "contacted") {
      patch(msg.supplier_id as number, { funnel_stage: "contacted", outreach_status: "sent" });
      addLog(`   RFI sent to ${msg.supplier_name}`);
    }
    if (type === "responded") {
      patch(msg.supplier_id as number, { funnel_stage: "responded", outreach_status: "responded", response_detail: JSON.stringify(msg.detail) });
      addLog(`✓  ${msg.supplier_name} responded — POSITIVE`);
    }
    if (type === "declined") {
      patch(msg.supplier_id as number, { funnel_stage: "declined", response_detail: JSON.stringify(msg.detail) });
      addLog(`✕  ${msg.supplier_name} — ${msg.responded ? "declined" : "no response"}`);
    }
    if (type === "awaiting_reply") {
      // Live mode: real email sent, waiting on a genuine inbound reply.
      patch(msg.supplier_id as number, { funnel_stage: "contacted", outreach_status: "sent" });
      addLog(`⏳  ${msg.supplier_name} — awaiting real reply`);
    }
    if (type === "skipped") {
      addLog(`⤼  ${msg.supplier_name} skipped — ${msg.reason || "no contact email"}`);
    }
    if (type === "awaiting_manual_contact") {
      // No email, but a contact page: the RFI is drafted and logged, but
      // someone has to paste it into that site's form by hand — see the
      // "Contact via website" action in the supplier row below.
      patch(msg.supplier_id as number, { outreach_status: "awaiting_manual_send" });
      addLog(`✍️  ${msg.supplier_name} — drafted, needs manual send via website`);
    }
    if (type === "usage") {
      setUsage({ cost_usd: msg.cost_usd as number, total_tokens: msg.total_tokens as number, web_searches: msg.web_searches as number });
    }
    if (type === "supplier_error") { addLog(`ERR ${msg.message}`); pushToast("error", String(msg.message)); }
    if (type === "campaign_complete") {
      addLog(
        msg.live
          ? `Campaign complete (LIVE) — ${msg.sent} emailed · ${msg.awaiting} awaiting reply · ${msg.skipped} skipped (no email)`
          : `Campaign complete — ${msg.sent} contacted · ${msg.positive} positive · ${msg.declined} declined`
      );
    }
    if (type === "error") { addLog(`ERR ${msg.message}`); pushToast("error", String(msg.message || t("Outreach failed"))); }
  }

  async function runCampaign() {
    setCampaigning(true);
    setStopping(false);
    setLiveAgents([]);
    const controller = new AbortController();
    abortRef.current = controller;
    addLog(t("Deploying outreach agent across the Long List..."));
    try {
      const res = await fetch("/api/outreach", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: id }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        const detail = err.error ? ` — ${err.error}` : "";
        addLog(`ERR outreach failed (${res.status})${detail}`);
        pushToast("error", t("Outreach failed") + detail);
      } else {
        await readEventStream(res.body, handleCampaignEvent, controller.signal);
        if (controller.signal.aborted) pushToast("info", t("Outreach stopped."));
      }
      await loadData();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        addLog("⏹  Outreach stopped by user.");
        pushToast("info", t("Outreach stopped."));
      } else {
        addLog(`ERR outreach failed: ${String(err)}`);
        pushToast("error", t("Outreach failed"));
      }
      await loadData().catch(() => {});
    } finally {
      abortRef.current = null;
      setStopping(false);
      setCampaigning(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">{t("Loading sourcing event...")}</p>
      </div>
    </div>
  );
  if (!event) return <div className="text-center py-24 text-slate-500">{t("Event not found.")}</div>;

  // Filter + sort
  const filtered = filterSuppliers(suppliers, structuredFilters)
    .filter(s => stageFilter === "all" || s.funnel_stage === stageFilter)
    .sort((a, b) =>
      sortBy === "score" ? (b.ai_score ?? 0) - (a.ai_score ?? 0) :
      sortBy === "name"  ? a.name.localeCompare(b.name) :
      a.wave - b.wave
    );

  // Grouped view: cluster `filtered` by business_type, alphabetically by
  // group label. Null when the toggle is off so the render stays a flat list.
  const groupedSuppliers = groupByType
    ? Array.from(
        filtered.reduce((map, s) => {
          const key = s.business_type || t("Uncategorised");
          (map.get(key) ?? map.set(key, []).get(key)!).push(s);
          return map;
        }, new Map<string, Supplier[]>())
      ).sort((a, b) => a[0].localeCompare(b[0]))
    : null;

  const stageCounts = Object.fromEntries(
    STAGES.map(s => [s.key, s.key === "all" ? suppliers.length : suppliers.filter(x => x.funnel_stage === s.key).length])
  );

  const activeFilterCount = [
    structuredFilters.business_type,
    structuredFilters.employee_count,
    structuredFilters.certifications,
    structuredFilters.capability_tags,
  ].filter(v => (v?.length ?? 0) > 0).length
    + (structuredFilters.founded_year_min != null || structuredFilters.founded_year_max != null ? 1 : 0)
    + (structuredFilters.review_score_min != null ? 1 : 0);

  // ── Supplier exports (CSV / Excel / PDF) ──────────────────────────────────
  // All three formats share one column definition so the columns/order stay in
  // sync, and all operate on `filtered` — i.e. the current stage-filtered view.
  const listVal = (raw: string | null) => tryParse<string[]>(raw, []).join("; ");
  const exportCols: { header: string; get: (s: Supplier) => unknown }[] = [
    { header: "Name",            get: s => s.name },
    { header: "Country",         get: s => s.country },
    { header: "City",            get: s => s.city },
    { header: "AI Score",        get: s => s.ai_score },
    { header: "Funnel Stage",    get: s => STAGES.find(x => x.key === s.funnel_stage)?.label || s.funnel_stage },
    { header: "Outreach Status", get: s => s.outreach_status },
    { header: "Contact Email",   get: s => s.contact_email },
    { header: "Contact Page",    get: s => s.contact_url },
    { header: "Phone",           get: s => s.contact_phone },
    { header: "LinkedIn",        get: s => s.contact_linkedin },
    { header: "Website",         get: s => s.website },
    { header: "Employees",       get: s => s.employees },
    { header: "Annual Revenue",  get: s => s.annual_revenue },
    { header: "Founded",         get: s => s.founded },
    { header: "Capabilities",    get: s => listVal(s.capabilities) },
    { header: "Certifications",  get: s => listVal(s.certifications) },
    { header: "Partnered Customers", get: s => listVal(s.partnered_customers) },
    { header: "Key Export Markets",  get: s => listVal(s.key_export_markets) },
    { header: "Verification Badges", get: s => listVal(s.verification_badges) },
    { header: "Wave",            get: s => s.wave },
    { header: "Description",     get: s => s.description },
  ];

  const exportSlug = (event?.title || "suppliers").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "suppliers";
  const exportFilename = (ext: string) => `${exportSlug}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Best-effort audit record of the export (format + count + active filter).
  const logExport = (format: "csv" | "xlsx" | "pdf") => {
    void fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: Number(id), format, count: filtered.length, stage: stageFilter }),
    }).catch(() => {});
  };

  const exportCsv = () => {
    const cell = (v: unknown) => {
      const str = v == null ? "" : String(v);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const rows = [
      exportCols.map(c => cell(c.header)).join(","),
      ...filtered.map(s => exportCols.map(c => cell(c.get(s))).join(",")),
    ];
    downloadBlob(new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8;" }), exportFilename("csv"));
    logExport("csv");
  };

  // Excel: same columns/order as CSV. SheetJS is loaded on demand so it never
  // ships in the initial bundle.
  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const aoa = [
      exportCols.map(c => c.header),
      ...filtered.map(s => exportCols.map(c => { const v = c.get(s); return v == null ? "" : v; })),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
    XLSX.writeFile(wb, exportFilename("xlsx"));
    logExport("xlsx");
  };

  // PDF: a readable, branded table with the key columns (company, country,
  // score, contact) respecting the active stage filter. jsPDF + autotable are
  // loaded on demand.
  const exportPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const stageLabelRaw = STAGES.find(s => s.key === stageFilter)?.label || "All";
    const stageLabel = stageFilter === "all" ? t("All stages") : t(stageLabelRaw);

    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text("SourceIQ", 40, 40);
    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105);
    doc.text(event?.title || t("Supplier list"), 40, 58);
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(`${t("Filter")}: ${stageLabel}  ·  ${filtered.length} ${t("suppliers")}  ·  ${new Date().toISOString().slice(0, 10)}`, 40, 72);

    const contactOf = (s: Supplier) => s.contact_email || s.contact_url || s.contact_phone || s.website || "—";
    autoTable(doc, {
      startY: 86,
      head: [[t("Company"), t("Country"), t("Score"), t("Stage"), t("Contact")]],
      body: filtered.map(s => [
        s.name,
        [s.city, s.country].filter(Boolean).join(", "),
        s.ai_score == null ? "—" : String(s.ai_score),
        t(STAGES.find(x => x.key === s.funnel_stage)?.label || s.funnel_stage),
        contactOf(s),
      ]),
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", textColor: [30, 41, 59] },
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 200 }, 2: { halign: "center", cellWidth: 40 }, 4: { cellWidth: 220 } },
      margin: { left: 40, right: 40 },
    });

    doc.save(exportFilename("pdf"));
    logExport("pdf");
  };

  const shortlisted = suppliers.filter(s => s.funnel_stage === "shortlisted").length;
  const longListCount = suppliers.filter(s => s.funnel_stage === "long_list").length;
  const avgScore    = suppliers.length ? Math.round(suppliers.reduce((a, s) => a + (s.ai_score ?? 0), 0) / suppliers.length) : 0;
  const busy = running || campaigning;

  const AGENT_DOT: Record<string, string> = {
    queued: "bg-slate-300", running: "bg-blue-500 animate-pulse",
    qualifying: "bg-violet-500 animate-pulse", complete: "bg-emerald-500", error: "bg-red-500",
  };

  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-56px)] lg:overflow-hidden">

      {/* ── Left sidebar: agent panel ── */}
      <div className="w-full lg:w-64 flex-shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white flex flex-col lg:overflow-hidden">
        <div className="px-4 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{t("Agent Control")}</span>
            {(running || serverWorking) && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
          </div>
          <button
            onClick={runWave}
            disabled={busy || serverWorking}
            className="btn-cta w-full justify-center mt-2 py-2"
          >
            {running || serverWorking ? (
              <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t("Running...")}</>
            ) : suppliers.length === 0 ? (
              <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> {t("Launch Discovery")}</>
            ) : (
              <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> {t("Wave {n}", { n: (event.wave_count ?? 0) + 1 })}</>
            )}
          </button>

          {/* Agentic outreach campaign */}
          {longListCount > 0 && (
            <button
              onClick={() => setConfirmCampaign(true)}
              disabled={busy}
              className="btn-secondary w-full justify-center mt-2 py-2"
            >
              {campaigning ? (
                <><div className="w-3.5 h-3.5 border-2 border-slate-400/40 border-t-slate-600 rounded-full animate-spin" /> {t("Contacting...")}</>
              ) : (
                <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> {t("Auto-Outreach ({n})", { n: longListCount })}</>
              )}
            </button>
          )}
          {busy && (
            <button
              onClick={stopRun}
              disabled={stopping}
              className="w-full justify-center mt-2 py-2 inline-flex items-center gap-1.5 rounded-lg text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" strokeWidth={2} /></svg>
              {stopping ? t("Stopping...") : t("Stop")}
            </button>
          )}
          {serverWorking && !running && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-[10px] font-medium text-blue-700 leading-snug">
              <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0 mt-0.5" />
              {t("Discovery is running in the background — results update live. Safe to leave or refresh this page.")}
            </div>
          )}
          <p className="text-[10px] text-slate-500 mt-2 leading-snug">
            {longListCount > 0
              ? t("Agent will send anonymous RFIs to {n} long-list suppliers and advance those that reply positively.", { n: longListCount })
              : t("Run discovery waves to build the long list, then deploy the outreach agent.")}
          </p>
        </div>

        {/* Live agents */}
        <div className="px-3 py-3 border-b border-slate-100 space-y-1.5">
          {liveAgents.length > 0 ? liveAgents.map(a => (
            <div key={a.agent_id} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
              a.status === "running" || a.status === "qualifying" ? "border-blue-200 bg-blue-50" :
              a.status === "complete" ? "border-emerald-100 bg-emerald-50" : "border-slate-100 bg-slate-50"
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${AGENT_DOT[a.status] || "bg-slate-300"}`} />
              <div className="min-w-0">
                <div className="font-semibold text-slate-700 truncate">{a.agent_label}</div>
                <div className="text-slate-500 truncate">{a.message || a.status}</div>
              </div>
            </div>
          )) : agents.slice(0, 6).map(a => (
            <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.status === "complete" ? "bg-emerald-500" : "bg-slate-300"}`} />
              <div className="min-w-0 flex-1">
                <span className="text-slate-600 font-medium">{a.agent_label}</span>
                <span className="text-slate-500 ml-1">W{a.wave} · {a.suppliers_found}</span>
              </div>
            </div>
          ))}
          {liveAgents.length === 0 && agents.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">{t("No agents deployed yet")}</p>
          )}
        </div>

        {/* Activity log */}
        <div className="flex flex-col overflow-hidden lg:flex-1">
          <div className="px-3 py-2 border-b border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{t("Activity Log")}</span>
          </div>
          <div ref={logsRef} role="log" aria-live="polite" aria-label={t("Activity Log")} className="overflow-y-auto p-3 space-y-0.5 max-h-56 lg:max-h-none lg:flex-1">
            {logs.length === 0 ? (
              <p className="text-[10px] text-slate-500 text-center pt-4">{t("Log appears here during discovery")}</p>
            ) : logs.map((l, i) => (
              <div key={i} className="text-[10px] font-mono text-slate-500 leading-relaxed whitespace-pre-wrap break-all">{l}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col lg:overflow-hidden">

        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-600 transition-colors"><ArrowLeft className="w-3 h-3" /> {t("Dashboard")}</Link>
                <EventSwitcher currentEventId={event.id} />
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <h1 className="font-bold text-slate-900 text-lg leading-tight">{event.title}</h1>
                <button
                  onClick={() => setEditingBrief(true)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-300 bg-blue-50 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  {t("Edit Brief")}
                </button>
                <button
                  onClick={() => setShowAudit(true)}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 bg-slate-50 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  {t("History")}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs text-slate-500">{event.category}</span>
                {event.subcategory && <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded">{event.subcategory}</span>}
                {event.annual_spend && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{event.annual_spend}</span>}
                {event.target_countries && <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded"><Globe className="w-3 h-3" /> {event.target_countries}</span>}
                {event.wave_count > 0 && <span className="text-xs bg-blue-50 text-blue-600 font-medium px-2 py-0.5 rounded">{t("{n} waves complete", { n: event.wave_count })}</span>}
              </div>
            </div>
            {/* KPIs */}
            <div className="flex flex-wrap items-center gap-4 sm:gap-6 sm:text-right">
              {[
                { label: t("Total Found"), value: suppliers.length },
                { label: t("Avg Score"),   value: avgScore || "—" },
                { label: t("Short Listed"),value: shortlisted },
                ...(usage && usage.cost_usd > 0
                  ? [{
                      label: t("AI Cost · {tok}k tok", { tok: (usage.total_tokens / 1000).toFixed(0) }),
                      value: `$${usage.cost_usd.toFixed(2)}`,
                    }]
                  : []),
              ].map(k => (
                <div key={k.label} title={usage ? t("{tokens} tokens · {searches} web searches", { tokens: usage.total_tokens.toLocaleString(), searches: usage.web_searches }) : undefined}>
                  <div className="text-2xl font-bold text-slate-900">{k.value}</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">{k.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* First-run funnel explainer — dismissible, persisted per user */}
          <FunnelExplainer />

          {/* Funnel progression bar */}
          {suppliers.length > 0 && (
            <div className="flex items-stretch gap-1 mt-4">
              {FUNNEL.map((f, i) => {
                const count = suppliers.filter(s => s.funnel_stage === f.key).length;
                const active = stageFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setStageFilter(f.key)}
                    className={`group relative flex-1 text-left rounded-lg border px-3 py-2 transition-all ${
                      active ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />
                      <span className="text-[11px] font-bold text-slate-700">{t(f.label)}</span>
                      <span className="ml-auto text-sm font-bold text-slate-900">{count}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{t(f.hint)}</div>
                    {i < FUNNEL.length - 1 && (
                      <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs z-10">›</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-1 overflow-x-auto">
            {STAGES.filter(s => stageCounts[s.key] > 0 || s.key === "all").map(s => (
              <button
                key={s.key}
                onClick={() => setStageFilter(s.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  stageFilter === s.key
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {t(s.label)}
                {stageCounts[s.key] > 0 && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] ${stageFilter === s.key ? "bg-white/20" : "bg-slate-100"}`}>
                    {stageCounts[s.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {running && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                {t("{n} found so far", { n: suppliers.length })}
              </span>
            )}
            {(stageCounts["responded"] ?? 0) > 0 && (
              <button
                onClick={shortlistResponders}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-all whitespace-nowrap"
              >
                <Star className="w-3 h-3" /> {t("Shortlist all responders ({n})", { n: stageCounts["responded"] })}
              </button>
            )}
            {suppliers.length > 0 && (
              <button
                onClick={() => setFilterPanelOpen(true)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all whitespace-nowrap ${
                  isFiltersEmpty(structuredFilters)
                    ? "text-slate-600 border-slate-200 hover:bg-slate-100"
                    : "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                }`}
              >
                <SlidersHorizontal className="w-3 h-3" /> {t("Filters")}
                {!isFiltersEmpty(structuredFilters) && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px]">{activeFilterCount}</span>
                )}
              </button>
            )}
            {suppliers.length > 0 && (
              <button
                onClick={() => setGroupByType(v => !v)}
                title={t("Group by business type")}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all whitespace-nowrap ${
                  groupByType
                    ? "bg-violet-50 text-violet-700 border-violet-200"
                    : "text-slate-600 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <Layers className="w-3 h-3" /> {t("Group")}
              </button>
            )}
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">{t("Sort:")}</span>
            {(["score", "name", "wave"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${sortBy === s ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
              >
                {s === "score" ? <span className="inline-flex items-center gap-0.5">{t("Score")} <ArrowDown className="w-3 h-3" /></span> : s === "name" ? t("Name") : t("Wave")}
              </button>
            ))}
            {suppliers.length > 0 && (
              canExport ? (
                <div className="relative ml-1" ref={exportMenuRef}>
                  <button
                    onClick={() => setExportMenuOpen(o => !o)}
                    title={t("Export the current list")}
                    aria-haspopup="menu"
                    aria-expanded={exportMenuOpen}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-600 border border-slate-200 hover:bg-slate-100 transition-all whitespace-nowrap"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    {t("Export")}
                    <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {exportMenuOpen && (
                    <div role="menu" className="absolute right-0 mt-1 w-36 rounded-lg border border-slate-200 bg-white shadow-lg z-20 py-1">
                      {([
                        { key: "csv" as const, label: t("Export CSV"), run: exportCsv },
                        { key: "xlsx" as const, label: t("Export Excel"), run: exportXlsx },
                        { key: "pdf" as const, label: t("Export PDF"), run: exportPdf },
                      ]).map(opt => (
                        <button
                          key={opt.key}
                          role="menuitem"
                          onClick={() => { setExportMenuOpen(false); void opt.run(); }}
                          className="w-full text-left px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  href="/billing"
                  title={t("Exporting is available on paid plans.")}
                  className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-all whitespace-nowrap"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                  </svg>
                  {t("Upgrade to export")}
                </Link>
              )
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          {suppliers.length === 0 && !running && !serverWorking ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-12">
              <Factory className="w-12 h-12 text-slate-500 mb-4" strokeWidth={1.5} />
              <h2 className="text-lg font-bold text-slate-700 mb-2">{t("Ready to initiate market intelligence")}</h2>
              <p className="text-sm text-slate-500 max-w-md mb-6">{t("Click")} <strong>{t("Launch Discovery")}</strong> {t("in the left panel to deploy AI agents across global supplier directories, trade databases, and industry registries.")}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-slate-500 text-sm">{t("No suppliers in this stage.")}</div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <th className="pl-4 pr-2 py-2.5 text-left w-8 text-[10px] font-bold uppercase tracking-wider text-slate-500">#</th>
                  <th className="px-2 py-2.5 text-left w-14 text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("Score")}</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("Supplier")}</th>
                  <th className="px-3 py-2.5 text-left w-48 text-[10px] font-bold uppercase tracking-wider text-slate-500 hidden lg:table-cell">{t("Certifications")}</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 hidden xl:table-cell">{t("Capabilities")}</th>
                  <th className="px-3 py-2.5 text-left w-32 text-[10px] font-bold uppercase tracking-wider text-slate-500 hidden md:table-cell">{t("Stage")}</th>
                  <th className="px-3 py-2.5 w-28" />
                </tr>
              </thead>
              <tbody>
                {(running || serverWorking) && suppliers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        {t("Agents discovering suppliers...")}
                      </div>
                    </td>
                  </tr>
                )}
                {groupedSuppliers ? (
                  groupedSuppliers.map(([type, rows]) => (
                    <Fragment key={type}>
                      <tr className="bg-slate-50/70">
                        <td colSpan={7} className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {type} <span className="text-slate-500 font-semibold">· {rows.length}</span>
                        </td>
                      </tr>
                      {rows.map(s => (
                        <SupplierRow
                          key={s.id}
                          supplier={s}
                          rank={filtered.indexOf(s) + 1}
                          onClick={() => setSelected(s)}
                          onMove={moveStage}
                        />
                      ))}
                    </Fragment>
                  ))
                ) : (
                  filtered.map((s, i) => (
                    <SupplierRow
                      key={s.id}
                      supplier={s}
                      rank={i + 1}
                      onClick={() => setSelected(s)}
                      onMove={moveStage}
                    />
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          supplier={selected}
          onClose={() => setSelected(null)}
          onMove={moveStage}
          onOutreach={setOutreachTarget}
          onFollowUp={sendFollowUp}
          onFeedback={setFeedback}
        />
      )}

      {/* Outreach modal */}
      {outreachTarget && (
        <OutreachModal
          supplier={outreachTarget}
          anonymous={event?.outreach_anonymous !== false}
          onClose={() => setOutreachTarget(null)}
          onSent={handleOutreachSent}
        />
      )}

      {/* Brief editor */}
      {editingBrief && (
        <BriefModal
          event={event}
          onClose={() => setEditingBrief(false)}
          onSaved={(e) => setEvent(e)}
        />
      )}

      {showAudit && (
        <AuditModal eventId={event.id} onClose={() => setShowAudit(false)} />
      )}

      {/* Structured filter panel (Epic 3, #38) */}
      {filterPanelOpen && (
        <FilterPanel
          filters={structuredFilters}
          onApply={setStructuredFilters}
          onClose={() => setFilterPanelOpen(false)}
        />
      )}

      {/* Bulk outreach confirmation */}
      {confirmCampaign && (
        <CampaignConfirmModal
          count={longListCount}
          anonymous={event?.outreach_anonymous !== false}
          preview={suppliers.filter(s => s.funnel_stage === "long_list").slice(0, 3)}
          onCancel={() => setConfirmCampaign(false)}
          onConfirm={() => { setConfirmCampaign(false); void runCampaign(); }}
        />
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2 w-full max-w-sm pointer-events-none" aria-live="assertive" aria-atomic="false">
        {toasts.map(toast => (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg animate-slide-in ${
              toast.kind === "error"   ? "bg-red-50 border-red-200 text-red-800" :
              toast.kind === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
                                         "bg-slate-800 border-slate-700 text-white"
            }`}
          >
            <span className="text-sm leading-snug flex-1">{toast.msg}</span>
            {toast.action && (
              <button
                onClick={() => { toast.action!.run(); dismissToast(toast.id); }}
                className="text-xs font-bold underline underline-offset-2 hover:opacity-80 flex-shrink-0"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => dismissToast(toast.id)}
              aria-label={t("Dismiss")}
              className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
