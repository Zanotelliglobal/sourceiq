import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import {
  Search, Brain, Scale, ShieldCheck, Globe2, Zap, Lock,
  ArrowRight, Check, Clock, Users, Sparkles,
} from "lucide-react";

// Public marketing landing. Signed-in users are sent straight to the dashboard;
// signed-out visitors get the credibility → book-demo funnel (MASTER.md: Landing).
export default function Home() {
  const { userId } = auth();
  if (userId) redirect("/dashboard");

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
            Multi-agent supplier intelligence
          </div>
          <h1 className="animate-rise delay-1 text-4xl sm:text-5xl lg:text-[4rem] font-extrabold tracking-tight text-slate-900 max-w-4xl mx-auto leading-[1.03]">
            Find qualified suppliers in{" "}
            <span className="bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-500 bg-clip-text text-transparent">minutes</span>, not months
          </h1>
          <p className="animate-rise delay-2 text-lg text-slate-500 max-w-2xl mx-auto mt-6 leading-relaxed">
            SourceIQ deploys a team of AI agents across global supplier networks to discover,
            score, and shortlist vendors against your exact requirements — so your procurement
            team can focus on decisions, not desk research.
          </p>
          <div className="animate-rise delay-3 flex flex-col sm:flex-row items-center justify-center gap-3 mt-9">
            <Link href="/sign-up" className="btn-cta text-base px-6 py-3 shadow-lg shadow-amber-600/25">
              Start free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/sign-in" className="btn-secondary text-base px-6 py-3 bg-white/70 backdrop-blur">
              Sign in
            </Link>
          </div>
          <p className="animate-rise delay-3 text-xs text-slate-400 mt-4">No credit card required · 14-day trial</p>

          {/* Product preview */}
          <div className="animate-rise delay-4 mt-16 max-w-4xl mx-auto relative">
            {/* soft glow behind the card */}
            <div className="absolute -inset-4 bg-gradient-to-tr from-blue-500/20 via-indigo-500/10 to-amber-500/10 blur-2xl rounded-[2rem]" aria-hidden />
            <div className="relative rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur shadow-2xl ring-1 ring-slate-900/5 overflow-hidden">
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-slate-100 bg-slate-50">
                <span className="w-2.5 h-2.5 rounded-full bg-red-300" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
                <span className="ml-3 text-xs text-slate-400 font-mono">sourceiq.app/events/precision-machining</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
                {[
                  { k: "Suppliers found", v: "52" },
                  { k: "Avg. AI score", v: "78" },
                  { k: "Responded", v: "19" },
                  { k: "Shortlisted", v: "7" },
                ].map(s => (
                  <div key={s.k} className="p-4 text-left">
                    <div className="text-2xl font-bold text-slate-900 tabular-nums">{s.v}</div>
                    <div className="text-[11px] text-slate-400 font-medium">{s.k}</div>
                  </div>
                ))}
              </div>
              <div className="p-4 space-y-2">
                {[
                  { n: "Rheinmetall Precision GmbH", c: "Germany", s: 91, stage: "badge-stage-shortlisted", label: "Shortlisted" },
                  { n: "Tokyo Micro Components", c: "Japan", s: 84, stage: "badge-stage-responded", label: "Responded" },
                  { n: "Baltic CNC Solutions", c: "Poland", s: 76, stage: "badge-stage-contacted", label: "Contacted" },
                ].map(r => (
                  <div key={r.n} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                    <div className="w-10 h-10 rounded-xl border-2 border-blue-200 text-blue-600 flex items-center justify-center font-bold text-sm tabular-nums flex-shrink-0">{r.s}</div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{r.n}</div>
                      <div className="text-xs text-slate-400">{r.c}</div>
                    </div>
                    <span className={r.stage}>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Proof ────────────────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-slate-50/60">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-14">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {[
              { v: "40–60", k: "suppliers discovered per event", Icon: Users },
              { v: "5 min", k: "from brief to qualified long list", Icon: Clock },
              { v: "180+", k: "countries covered by scout agents", Icon: Globe2 },
            ].map(s => (
              <div key={s.k} className="flex flex-col items-center gap-2">
                <s.Icon className="w-6 h-6 text-blue-600" />
                <div className="text-3xl font-extrabold text-slate-900 tabular-nums">{s.v}</div>
                <div className="text-sm text-slate-500 max-w-[16rem]">{s.k}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 mt-12 text-xs font-semibold text-slate-400">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> GDPR compliant</span>
            <span className="inline-flex items-center gap-1.5"><Lock className="w-4 h-4" /> Anonymous outreach</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> SOC 2 aligned</span>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-24">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">How SourceIQ works</h2>
          <p className="text-slate-500 mt-3">A multi-agent pipeline that runs your sourcing event end to end.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { Icon: Brain, title: "1 · Describe your need", body: "Write a short brief — category, requirements, target geographies. The orchestrator plans the discovery strategy." },
            { Icon: Search, title: "2 · AI agents scout", body: "Three scout agents search directories, trade databases and registries in parallel to build your long list." },
            { Icon: Scale, title: "3 · Score & shortlist", body: "A qualifier scores every supplier on 5 axes; an enricher flags risks and strengths. You approve the shortlist." },
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
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Simple, usage-based pricing</h2>
            <p className="text-slate-500 mt-3">Start free. Scale as your sourcing pipeline grows.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              { name: "Trial", price: "Free", sub: "14 days", cta: "Start free", highlight: false,
                features: ["3 sourcing events", "Up to 60 suppliers / event", "AI scoring & enrichment", "Anonymous outreach"] },
              { name: "Growth", price: "$499", sub: "per month", cta: "Start free trial", highlight: true,
                features: ["Unlimited sourcing events", "Priority scout agents", "Follow-up automation", "CSV export & reporting", "Email support"] },
              { name: "Enterprise", price: "Custom", sub: "annual", cta: "Contact sales", highlight: false,
                features: ["SSO & role-based access", "Dedicated infrastructure", "Custom integrations", "SLA & onboarding"] },
            ].map(p => (
              <div key={p.name} className={`card p-7 flex flex-col ${p.highlight ? "ring-2 ring-blue-600 shadow-lg relative" : ""}`}>
                {p.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-widest text-white bg-blue-600 px-3 py-1 rounded-full">
                    Most popular
                  </span>
                )}
                <div className="text-sm font-bold text-slate-700">{p.name}</div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-4xl font-extrabold text-slate-900">{p.price}</span>
                  <span className="text-sm text-slate-400">{p.sub}</span>
                </div>
                <ul className="mt-6 space-y-2.5 flex-1">
                  {p.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                      <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />{f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className={`mt-7 justify-center ${p.highlight ? "btn-cta" : "btn-secondary"}`}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
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
              Deploy your first AI sourcing event today
            </h2>
            <p className="text-slate-300 mt-4 max-w-xl mx-auto">
              Join procurement teams using SourceIQ to build qualified supplier shortlists in minutes.
            </p>
            <Link href="/sign-up" className="btn-cta text-base px-6 py-3 mt-8">
              Start free trial <ArrowRight className="w-4 h-4" />
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
            SourceIQ
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
              <Link href="/legal/privacy" className="hover:text-slate-900 transition-colors">Privacy Policy</Link>
              <Link href="/legal/terms" className="hover:text-slate-900 transition-colors">Terms of Service</Link>
            </div>
            <p className="text-xs text-slate-400">© {new Date().getFullYear()} SourceIQ. AI-powered supplier intelligence.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
