# SourceIQ — Product Strategy v11 (CONVERGED, oracle 9.07)

## One-liner
**ChatGPT gives you names. SourceIQ gets you answers** — it finds alternate
suppliers, emails them, chases them, grades the replies, and hands you an
award-ready comparison. And the data gets smarter every cycle.

## 1. ICP (narrow)
Mid-market manufacturers ($50M–$500M rev) **re-sourcing direct materials under
tariff / supply-shock pressure** — they need *alternate*, qualified suppliers
fast, in a specific region, and can't wait on a 6-month Ariba rollout or a
consultant. Nameable buyer: the Sourcing/Procurement Manager who just got told
"find us a second source outside <region> by end of quarter."

## 2. Killer workflow — "Alternate supplier in a week"
Type one line describing the part/category →
1. Ranked shortlist of vetted alternate suppliers (with risk flags)
2. Anonymous RFIs sent automatically
3. AI-graded replies (capacity, lead time, price band, sentiment)
4. Side-by-side comparison
5. **Award-ready packet for the CFO**
**Closed loop:** awarded terms are stored, auto re-benchmarked next cycle, and
one-click re-sourced when price/lead-time drifts — turning a one-off into a
recurring habit.

## 3. Simplicity promise
No data import. No supplier master. No implementation. You type one line; we do
discovery, outreach, follow-up, and reply grading. **You just pick.**

## 4. Monetization (land-and-expand)
- **Land:** self-serve **credit packs** — credits burned per *qualified*
  supplier / RFI cycle. Usage compounds with real work.
- **Expand:** team **seats** + a CFO **"savings realized" dashboard** that
  renews the budget line every year.
- **Second surface:** anonymized **market intel** (response rates, lead times,
  price bands by category/region) sold back to buyers.
- Savings-share offered only as an optional enterprise tier (not primary — it
  hurts self-serve WTP and cash cycle).

## 5. Wedge & moat
- **vs ChatGPT:** it can list names; it cannot email suppliers, chase them,
  grade replies, or produce an auditable, compliant comparison.
- **vs Coupa / Ariba / Keelvar:** they *manage existing* suppliers and spend;
  they don't *find + qualify new* ones, and they need long implementations.
- **Compounding data moat:** every RFI cycle enriches a proprietary benchmark
  (response rates, lead times, price bands per supplier/category/region). New
  entrants start from zero; incumbents don't collect discovery-stage data.

## 6. Proof / first wow (PLG)
Ungated: **from one line to 10 vetted alternate suppliers in 3 minutes**, emailed
before signup. Signup unlocks sending RFIs. SLA + risk reversal: **graded RFI
replies within 72 hours — or it's free.**

---
### What this changes about today's build (concrete next steps)
1. **Ungated instant report** (pre-signup): reuse discovery agent → 10 alternates
   + risk flags, emailed. This is the activation wedge.
2. **Reframe ICP + copy** around tariff/supply-shock alternate sourcing.
3. **Credit-based metering** on top of the existing Stripe billing (credits per
   qualified supplier / RFI cycle) instead of flat Pro.
4. **CFO savings dashboard** (award vs baseline) to defend renewal.
5. **Benchmark data layer**: persist response rates / lead times / price bands
   from the outreach + reply-classifier data already being captured.
