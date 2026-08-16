"use client";

import Link from "next/link";
import {
  Search, Brain, Scale, ShieldCheck, Globe2, Zap, Lock,
  ArrowRight, Check, Clock, Users, Sparkles, RefreshCw, DollarSign,
} from "lucide-react";
import { useT } from "@/components/LanguageProvider";
import { TIERS, displayPrice, cadenceSuffix, UNLIMITED, type Cadence } from "@/lib/plans";
import { COMPANY } from "@/lib/legal";

// Public marketing landing content (client component so it can be translated).
// The server page (app/page.tsx) handles the signed-in → dashboard redirect.
export default function LandingContent() {
  const t = useT();

  return (
    <div className="bg-white">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Layered background: base wash → drifting aurora blobs → blueprint grid */}
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/70 via-white to-white" aria-hidden />
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div className="aurora aurora-1 w-[42rem] h-[42rem] -top-40 -left-40" />
          <div className="aurora aurora-2 w-[38rem] h-[38rem] -top-56 right-[-8rem]" />
          <div className="aurora aurora-3 w-[30rem] h-[30rem] top-24 left-1/2 -translate-x-1/2" />
        </div>
        <div className="absolute inset-0 bg-grid" aria-hidden />

        <div className="relative max-w-screen-xl mx-auto px-4 sm:px-6 pt-24 pb-28 text-center">
          <div className="animate-rise inline-flex items-center gap-2 text-xs font-semibold text-blue-700 bg-white/70 backdrop-blur border border-blue-100 px-3 py-1.5 rounded-full mb-6 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
            <Sparkles className="w-3.5 h-3.5" />
            {t("Multi-agent supplier intelligence")}
          </div>
          <h1 className="animate-rise delay-1 text-4xl sm:text-5xl lg:text-[4rem] font-extrabold tracking-tight text-slate-900 max-w-4xl mx-auto leading-[1.03]">
            {t("Find qualified suppliers in")}{" "}
            <span className="bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-500 bg-clip-text text-transparent">{t("minutes")}</span>{t(", not months")}
          </h1>
          <p className="animate-rise delay-2 text-lg text-slate-500 max-w-2xl mx-auto mt-6 leading-relaxed">
            {t("SourceGPT deploys a team of AI agents across global supplier networks to discover, score, and shortlist vendors against your exact requirements — so your procurement team can focus on decisions, not desk research.")}
          </p>
          <div className="animate-rise delay-3 flex flex-col sm:flex-row items-center justify-center gap-3 mt-9">
            <Link href="/sign-up" className="btn-cta text-base px-6 py-3 shadow-lg shadow-amber-600/25">
              {t("Start free trial")} <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/sign-in" className="btn-secondary text-base px-6 py-3 bg-white/70 backdrop-blur">
              {t("Sign in")}
            </Link>
          </div>
          <p className="animate-rise delay-3 text-xs text-slate-500 mt-4">{t("No credit card required · 14-day trial")}</p>

          {/* Product preview */}
          <div className="animate-rise delay-4 mt-16 max-w-4xl mx-auto relative">
            {/* soft glow behind the card */}
            <div className="absolute -inset-4 bg-gradient-to-tr from-blue-500/20 via-indigo-500/10 to-amber-500/10 blur-2xl rounded-[2rem]" aria-hidden />
            <div className="relative rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur shadow-2xl ring-1 ring-slate-900/5 overflow-hidden">
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-slate-100 bg-slate-50">
                <span className="w-2.5 h-2.5 rounded-full bg-red-300" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
                <span className="ml-3 text-xs text-slate-500 font-mono">sourcegpt.app/events/precision-machining</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- static placeholder asset, swapped for a real screenshot/video later with zero code change (MKT-05, D-08) */}
              <img
                src="/hero-placeholder.svg"
                alt={t("Product preview showing SourceGPT's supplier discovery interface")}
                className="w-full h-auto block"
              />
            </div>
            <p className="text-xs text-slate-500 mt-3">{t("Product preview")}</p>
          </div>
        </div>
      </section>

      {/* ── Proof ────────────────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-slate-50/60">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-14">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {[
              { v: "40–60", k: t("suppliers discovered per event"), Icon: Users },
              { v: t("5 min"), k: t("from brief to qualified long list"), Icon: Clock },
              { v: "180+", k: t("countries covered by scout agents"), Icon: Globe2 },
            ].map(s => (
              <div key={s.k} className="flex flex-col items-center gap-2">
                <s.Icon className="w-6 h-6 text-blue-600" />
                <div className="text-3xl font-extrabold text-slate-900 tabular-nums">{s.v}</div>
                <div className="text-sm text-slate-500 max-w-[16rem]">{s.k}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 mt-12 text-xs font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> {t("GDPR aligned")}</span>
            <span className="inline-flex items-center gap-1.5"><Lock className="w-4 h-4" /> {t("Anonymous outreach")}</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> {t("SOC 2 aligned")}</span>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-24">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{t("How SourceGPT works")}</h2>
          <p className="text-slate-500 mt-3">{t("A multi-agent pipeline that runs your sourcing event end to end.")}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { Icon: Brain, title: t("1 · Describe your need"), body: t("Write a short brief — category, requirements, target geographies. The orchestrator plans the discovery strategy.") },
            { Icon: Search, title: t("2 · AI agents scout"), body: t("Three scout agents search directories, trade databases and registries in parallel to build your long list.") },
            { Icon: Scale, title: t("3 · Score & shortlist"), body: t("A qualifier scores every supplier on 5 axes; an enricher flags risks and strengths. You approve the shortlist.") },
          ].map(step => (
            <div key={step.title} className="card p-7">
              <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-4">
                <step.Icon className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="font-bold text-slate-900">{step.title}</h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────── */}
      <section className="border-t border-slate-100 bg-slate-50/60">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-24">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{t("Simple, usage-based pricing")}</h2>
            <p className="text-slate-500 mt-3">{t("Start free. Scale as your sourcing pipeline grows.")}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {/* Cards + prices read live from lib/plans.ts TIERS — a monthlyUsd
                change there flows through automatically, no local price array
                to keep in sync (D-04). Landing page always shows the monthly
                cadence — there is no cadence toggle on this public surface
                (unlike app/billing/page.tsx, which does have one). */}
            {TIERS.filter(tier => tier.key !== "free").map(tier => {
              const cadence: Cadence = "monthly";
              const price = displayPrice(tier, cadence);
              const ctaClass = tier.featured === true ? "btn-cta" : "btn-secondary";
              const features: string[] = [
                tier.limits.eventsPerMonth === UNLIMITED
                  ? t("Unlimited sourcing events")
                  : t("{n} sourcing events / month", { n: tier.limits.eventsPerMonth }),
                tier.limits.suppliersPerEvent === UNLIMITED
                  ? t("Unlimited suppliers per event")
                  : t("Up to {n} suppliers / event", { n: tier.limits.suppliersPerEvent }),
                tier.limits.seats === UNLIMITED
                  ? t("Unlimited team seats")
                  : t("{n} team seats", { n: tier.limits.seats }),
                ...(tier.limits.outreach ? [t("Live supplier outreach")] : []),
                ...(tier.limits.export ? [t("CSV/Excel/PDF export")] : []),
              ];
              return (
                <div key={tier.key} className={`card p-7 flex flex-col ${tier.featured === true ? "ring-2 ring-blue-600 shadow-lg relative" : ""}`}>
                  {tier.featured === true && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-widest text-white bg-blue-600 px-3 py-1 rounded-full">
                      {t("Most popular")}
                    </span>
                  )}
                  <div className="text-sm font-bold text-slate-700">{t(tier.name)}</div>
                  <p className="text-xs text-slate-500 mt-1 min-h-[32px]">{t(tier.blurb)}</p>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    {tier.contactSales === true ? (
                      <span className="text-2xl font-extrabold text-slate-900">{t("Custom pricing")}</span>
                    ) : (
                      <>
                        <span className="text-4xl font-extrabold text-slate-900">${price.toLocaleString()}</span>
                        <span className="text-sm text-slate-500">{cadenceSuffix(cadence)}</span>
                      </>
                    )}
                  </div>
                  <ul className="mt-6 space-y-2.5 flex-1">
                    {features.map(f => (
                      <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                        <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />{f}
                      </li>
                    ))}
                  </ul>
                  {tier.contactSales === true ? (
                    <a href={`mailto:${COMPANY.contactEmail}`} className={`mt-7 justify-center ${ctaClass}`}>
                      {t("Contact sales")}
                    </a>
                  ) : tier.key === "basic" ? (
                    <Link href="/sign-up" className={`mt-7 justify-center ${ctaClass}`}>
                      {t("Start free trial")}
                    </Link>
                  ) : (
                    <Link href="/sign-up" className={`mt-7 justify-center ${ctaClass}`}>
                      {t("Choose {plan}", { plan: t(tier.name) })}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-24">
        <div className="rounded-3xl bg-slate-900 px-8 py-16 text-center relative overflow-hidden ring-1 ring-white/10">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600/30 via-indigo-600/10 to-transparent" aria-hidden />
          <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-amber-500/20 blur-3xl" aria-hidden />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-blue-500/20 blur-3xl" aria-hidden />
          <div className="absolute inset-0 bg-grid opacity-[0.15]" aria-hidden />
          <div className="relative">
            <Zap className="w-10 h-10 text-amber-500 mx-auto mb-5" />
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight max-w-2xl mx-auto">
              {t("Deploy your first AI sourcing event today")}
            </h2>
            <p className="text-slate-300 mt-4 max-w-xl mx-auto">
              {t("Join procurement teams using SourceGPT to build qualified supplier shortlists in minutes.")}
            </p>
            <Link href="/sign-up" className="btn-cta text-base px-6 py-3 mt-8">
              {t("Start free trial")} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-slate-100">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            SourceGPT
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
              <Link href="/legal/privacy" className="hover:text-slate-900 transition-colors">{t("Privacy Policy")}</Link>
              <Link href="/legal/terms" className="hover:text-slate-900 transition-colors">{t("Terms of Service")}</Link>
            </div>
            <p className="text-xs text-slate-500">© {new Date().getFullYear()} SourceGPT. {t("AI-powered supplier intelligence.")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
