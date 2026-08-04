# Evaluate — procurement-app oracle (FROZEN for the run)

Score the product strategy on 4 dimensions, 0–10, from THREE personas.

## Panel
- **Priya — Procurement Director, mid-market manufacturer ($200M rev).** Runs
  8–12 sourcing events/yr. Cares about cycle time, savings she can show the CFO,
  and not adding another tool nobody logs into.
- **Marcus — Seed-stage SaaS VC.** Pattern-matches on wedge, WTP, retention,
  and "why won't Coupa/ChatGPT eat this." Ruthless skeptic.
- **Sam — Solo-founder operator.** Cares about what's actually shippable this
  quarter, self-serve activation, and gross margin at AI-inference cost.

## Dimensions
- **D1 — Pain Kill**: Does it kill a top-3, budgeted, recurring procurement
  pain? A 10 = the buyer would rip out a current tool/process for this today.
- **D2 — Time-to-Value**: Can a buyer reach a genuine "wow" result in <10 min
  with zero setup/data import? A 10 = value on first session, no onboarding.
- **D3 — Money**: Is there clear willingness-to-pay and a model that compounds
  (expansion/usage/retention)? A 10 = obvious budget line + built-in expansion.
- **D4 — Wedge/Moat**: Convincing reason to pick this over Ariba/Coupa/Keelvar
  AND over raw ChatGPT? A 10 = a wedge incumbents structurally can't copy fast
  and ChatGPT can't replicate (data, workflow lock-in, network, or compliance).

## Scoring
- Each persona scores all 4 dimensions.
- Persona score = geometric mean of their 4 dimension scores.
- FINAL SCORE = arithmetic mean of the 3 persona scores.

## Constraints (violation caps FINAL at 5.0)
- Must be buildable on the current stack, self-serve, no 6-month sales cycle.
- ICP must be narrow (a nameable buyer), not "all procurement."

## Output format
```
D1 Pain Kill:   Priya X | Marcus X | Sam X
D2 Time-to-Value: Priya X | Marcus X | Sam X
D3 Money:       Priya X | Marcus X | Sam X
D4 Wedge/Moat:  Priya X | Marcus X | Sam X
Persona scores: Priya X.XX | Marcus X.XX | Sam X.XX
FINAL SCORE: X.XX
DECISION: KEEP / DISCARD (KEEP only if > previous best)
WEAKEST ELEMENT: [one]
SUGGESTED DIRECTION: [one sentence, bolder]
```
