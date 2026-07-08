import Anthropic from "@anthropic-ai/sdk";
import { scrapeSupplierContact } from "./contact";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Optional token-usage reporter. Routes pass this to record real cost per call.
export type UsageCb = (u: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ScoutResult = {
  name: string;
  country: string;
  city: string;
  description: string;
  capabilities: string[];
  certifications: string[];
  employees: string;
  annual_revenue: string;
  founded: string;
  website: string;
  contact_email: string;
  data_sources: string[];
};

export type QualificationResult = {
  overall_score: number;
  rationale: string;
  breakdown: {
    capability_fit: number;
    quality_signals: number;
    geographic_risk: number;
    financial_stability: number;
    compliance_readiness: number;
  };
};

export type EnrichmentResult = {
  market_position: string;
  key_risks: string[];
  key_strengths: string[];
  recommended_action: string;
};

// ─── CLASSIFIER AGENT ─────────────────────────────────────────────────────────
// Reads a free-text sourcing description and picks the best commodity category
// (from a fixed taxonomy) plus a specific subcategory.
export type ClassificationResult = {
  category: string;      // must be one of the provided categories
  subcategory: string;   // a concise, specific sub-classification
  confidence: number;    // 0-100
};

export async function runClassifierAgent(
  description: string,
  categories: string[],
  onUsage?: UsageCb
): Promise<ClassificationResult> {
  const prompt = `You are SourceIQ's Category Classification Agent. A buyer described a sourcing need. Classify it.

Buyer's description:
"""${description}"""

Choose the single best-fitting commodity category from this fixed list (use the EXACT string):
${categories.map(c => `- ${c}`).join("\n")}

Then propose a concise, specific SUBCATEGORY (2-5 words) that pinpoints the commodity within that category — e.g. "5-axis aluminum machining", "injection-molded medical housings", "corrugated retail packaging", "PCB assembly (SMT)". If nothing fits well, use category "Other".

Return JSON only:
{
  "category": "exact category string from the list",
  "subcategory": "specific 2-5 word subcategory",
  "confidence": 85
}`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  onUsage?.((response as any).usage); // eslint-disable-line @typescript-eslint/no-explicit-any

  const text = response.content
    .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
    .join("");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { category: "Other", subcategory: "", confidence: 0 };
  const parsed = JSON.parse(match[0]) as ClassificationResult;
  // Guard against the model drifting off-taxonomy.
  if (!categories.includes(parsed.category)) parsed.category = "Other";
  return parsed;
}

// ─── ORCHESTRATOR ─────────────────────────────────────────────────────────────
export async function runOrchestrator(
  category: string,
  description: string,
  requirements: string,
  annualSpend: string,
  waveNumber: number,
  targetCountries: string = "",
  onUsage?: UsageCb
): Promise<{ strategy: string; agents: { id: string; type: string; label: string; focus: string }[] }> {
  const geoLine = targetCountries
    ? `- Target geographies (PRIORITISE these countries/regions): ${targetCountries}`
    : "- Target geographies: Global — no geographic restriction";

  const prompt = `You are the SourceIQ Orchestrator — a senior procurement AI that directs a team of supplier scout agents.

A buyer needs suppliers for:
- Category: ${category}
- Description: ${description}
- Requirements: ${requirements}
- Annual Spend: ${annualSpend || "Not specified"}
${geoLine}
- This is Wave ${waveNumber} of discovery

${waveNumber === 1 ? "Wave 1: Deploy broad-market scouts. Find the major, established players." : ""}
${waveNumber === 2 ? "Wave 2: Deploy specialty scouts. Find niche, boutique, and specialist suppliers that Wave 1 missed." : ""}
${waveNumber === 3 ? "Wave 3: Deploy geographic scouts. Find nearshore, emerging-market, and regional suppliers for risk diversification." : ""}
${waveNumber >= 4 ? "Wave 4+: Deploy trade-intelligence scouts. Find suppliers based on trade flow patterns, import/export activity, and industry cross-references." : ""}

Maximise coverage: deploy 5-7 scout agents this wave, each with a distinct, non-overlapping focus (segment, sub-capability, tier, or region) so together they cast the widest possible net. ${targetCountries ? "Assign scouts across the target geographies so each focus country is covered." : "Spread scouts across different global regions."}

Return JSON only:
{
  "strategy": "One sentence describing this wave's search strategy",
  "agents": [
    { "id": "scout-1", "type": "broad-scout", "label": "Market Scout Alpha", "focus": "specific focus for this agent" },
    { "id": "scout-2", "type": "niche-scout", "label": "Specialist Scout Beta", "focus": "specific focus" },
    { "id": "scout-3", "type": "geo-scout", "label": "Regional Scout Gamma", "focus": "specific focus" }
  ]
}
Include 5-7 agents in the array.`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  onUsage?.((response as any).usage); // eslint-disable-line @typescript-eslint/no-explicit-any

  const text = response.content
    .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((b: any) => (b as { type: "text"; text: string }).text) // eslint-disable-line @typescript-eslint/no-explicit-any
    .join("");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON from orchestrator");
  return JSON.parse(match[0]);
}

// ─── SCOUT AGENT ──────────────────────────────────────────────────────────────
export async function runScoutAgent(
  agentType: string,
  agentFocus: string,
  category: string,
  description: string,
  requirements: string,
  annualSpend: string,
  wave: number,
  existingNames: string[],
  targetCountries: string = "",
  onUsage?: UsageCb
): Promise<ScoutResult[]> {
  const avoidList = existingNames.length > 0
    ? `\n\nDo NOT include these already-found suppliers (find DIFFERENT ones): ${existingNames.slice(0, 150).join(", ")}`
    : "";

  const geoLine = targetCountries
    ? `\nGEOGRAPHIC FOCUS: Only return suppliers headquartered or with primary operations in: ${targetCountries}. Do not return suppliers from other countries.
LOCAL-LANGUAGE SEARCH: For each target country, also search using local-language industry terms, trade directories and registries in that country's language (e.g. Germany → German terms & directories like "Wer liefert was", Italy → Italian, Japan → Japanese, China → Simplified Chinese). Surface domestic suppliers that only appear in local-language sources, not just those with English-facing websites.`
    : "\nGEOGRAPHIC FOCUS: Global — suppliers from any country are acceptable. Where relevant, also search local-language sources to surface strong domestic suppliers that only appear in non-English directories.";

  const scoutPersona: Record<string, string> = {
    "broad-scout": "You are a broad-market procurement scout. You identify established, well-known, tier-1 and tier-2 suppliers from major industrial directories (ThomasNet, Kompass, Thomasnet). Focus on companies with proven track records.",
    "niche-scout": "You are a specialist procurement scout. You identify boutique, specialized, and niche suppliers that larger scouts miss — contract manufacturers, job shops, specialty houses. Focus on capability depth over size.",
    "geo-scout": "You are a geographic diversification scout. You identify suppliers in specific regions for risk diversification — nearshore Mexico/Eastern Europe, emerging Asian markets, Latin America. Focus on geographic spread.",
    "trade-scout": "You are a trade intelligence scout. You identify suppliers based on trade flow patterns, import/export activity from Panjiva and trade databases. Focus on suppliers with active cross-border trade.",
  };

  const persona = scoutPersona[agentType] || scoutPersona["broad-scout"];

  const prompt = `${persona}

Your mission: Find as many REAL, verifiable suppliers as you can for this sourcing requirement — do NOT artificially cap the list. Aim for at least 20-30 and include every credible supplier that fits your focus. Breadth is the goal; a longer list is better than a short one, as long as each is a genuine, real company.

CRITICAL — GROUNDING IN REAL DATA:
- You have a \`web_search\` tool. USE IT extensively. Do NOT invent or guess suppliers from memory.
- Search industrial directories, trade registries, association member lists, and company websites. Run MULTIPLE searches with different query angles (segment, sub-capability, region, local-language terms).
- Every supplier you return MUST come from a real search result you actually saw. Put the real source URLs you used for that supplier in "data_sources".
- Prefer suppliers whose own website or a reputable directory confirms the capability. If you could not verify a company via search, do NOT include it.
- Leave fields you could not verify as an empty string "" rather than fabricating a value (e.g. don't guess revenue/founding year — only fill them if a source stated it).

Category: ${category}
Description: ${description}
Requirements: ${requirements}
Annual Spend: ${annualSpend || "Not specified"}
Wave: ${wave} | Focus: ${agentFocus}
${geoLine}
${avoidList}

After searching, return a JSON array of supplier objects:
[{
  "name": "Company Name",
  "country": "Country",
  "city": "City",
  "description": "2-3 sentence description of what they do and their specialization",
  "capabilities": ["capability 1", "capability 2", "capability 3", "capability 4"],
  "certifications": ["ISO 9001:2015", "IATF 16949"],
  "employees": "200-500",
  "annual_revenue": "$20M-$50M",
  "founded": "1992",
  "website": "www.example.com",
  "contact_email": "info@example.com",
  "data_sources": ["https://real-source-url-you-saw.com/page", "https://directory.com/listing"]
}]

For "contact_email": only include a real address you actually saw on the company's site or a directory listing (e.g. a sales/info/contact mailbox). If you did not find one, use "" — never guess or construct an address.

Your FINAL message must contain ONLY the JSON array (after you have finished searching).`;

  // Server-side web search grounds the scout in real, cited sources.
  // Web search auto-executes on Anthropic's side; long runs may return
  // stop_reason "pause_turn", which we resume by re-sending the accumulated turn.
  //
  // PROMPT CACHING: a scout run can pause/resume several times, and each resume
  // re-sends the ENTIRE accumulated turn — including large web-search result
  // blocks that dwarf the 4096-token Opus 4.7 minimum. We put a cache breakpoint
  // on the last content block we send each turn so the growing prefix is cached
  // and re-read at 0.1x instead of reprocessed at full input price on every
  // resume. Cache reads show up in response.usage.cache_read_input_tokens, which
  // normalizeUsage already prices correctly. (Ephemeral prefixes match by exact
  // bytes, so this only ever helps within a single scout's resume chain.)
  const markCache = (content: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    // Attach a cache breakpoint to the final block of a content array.
    if (Array.isArray(content) && content.length) {
      const last = content[content.length - 1];
      if (last && typeof last === "object") last.cache_control = { type: "ephemeral" };
    }
    return content;
  };

  const messages: any[] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { role: "user", content: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }] },
  ];
  let fullText = "";
  let guard = 0;

  while (guard++ < 8) {
    const response: any = await client.messages.create({ // eslint-disable-line @typescript-eslint/no-explicit-any
      model: "claude-opus-4-7",
      max_tokens: 16000,
      thinking: { type: "adaptive" } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
      messages,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    onUsage?.(response.usage); // per-turn usage (web search inflates input on resumes)

    fullText = (response.content || [])
      .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
      .join("");

    if (response.stop_reason === "pause_turn") {
      // Resume: append the assistant's partial turn and continue. Move the cache
      // breakpoint to the freshly appended turn so the whole prior prefix (user
      // prompt + earlier assistant/tool turns) is served from cache next call.
      messages.push({ role: "assistant", content: markCache(response.content) });
      continue;
    }
    break;
  }

  const match = fullText.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON from scout agent");
  return JSON.parse(match[0]) as ScoutResult[];
}

// ─── QUALIFIER AGENT ──────────────────────────────────────────────────────────
export async function runQualifierAgent(
  supplier: ScoutResult,
  category: string,
  requirements: string,
  annualSpend: string,
  onUsage?: UsageCb
): Promise<QualificationResult> {
  const prompt = `You are SourceIQ's Qualification Agent. Score this supplier rigorously.

Supplier: ${supplier.name} (${supplier.country})
Description: ${supplier.description}
Capabilities: ${supplier.capabilities.join(", ")}
Certifications: ${supplier.certifications.join(", ")}
Employees: ${supplier.employees}
Revenue: ${supplier.annual_revenue}
Evidence sources (from web scouting): ${(supplier.data_sources || []).join(", ") || "none"}

Buyer Requirements:
- Category: ${category}
- Requirements: ${requirements}
- Annual Spend: ${annualSpend || "Not specified"}

Score 0-100 across 5 dimensions. Be strict — 80+ means genuinely excellent fit.
Weigh the evidence: reward suppliers backed by credible, capability-confirming sources; treat unverified or thin sourcing as a quality/confidence risk.

Return JSON only:
{
  "overall_score": 78,
  "rationale": "2-3 sentence assessment with specific strengths and gaps",
  "breakdown": {
    "capability_fit": 82,
    "quality_signals": 75,
    "geographic_risk": 70,
    "financial_stability": 80,
    "compliance_readiness": 85
  }
}`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  onUsage?.((response as any).usage); // eslint-disable-line @typescript-eslint/no-explicit-any

  const text = response.content
    .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
    .join("");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { overall_score: 60, rationale: "Limited data for qualification.", breakdown: { capability_fit: 60, quality_signals: 60, geographic_risk: 60, financial_stability: 60, compliance_readiness: 60 } };
  return JSON.parse(match[0]) as QualificationResult;
}

// ─── GROUNDED QUALIFIER AGENT ─────────────────────────────────────────────────
// A stricter, evidence-backed qualifier. Unlike runQualifierAgent (which scores
// blind on the scout's self-report), this one gets web_search and must VERIFY the
// supplier's core capability before awarding a high score. Reserved for the
// thin-evidence / borderline band where a false positive is most costly.
// Resolves the pause_turn loop like the scout/contact agents.
export async function runQualifierAgentGrounded(
  supplier: ScoutResult,
  category: string,
  requirements: string,
  annualSpend: string,
  onUsage?: UsageCb
): Promise<QualificationResult> {
  const prompt = `You are SourceIQ's Qualification Agent, verification tier. Score this supplier RIGOROUSLY, and verify claims with web_search before trusting them.

Supplier: ${supplier.name} (${supplier.country})
Website: ${supplier.website || "unknown"}
Description: ${supplier.description}
Capabilities: ${supplier.capabilities.join(", ")}
Certifications: ${supplier.certifications.join(", ")}
Employees: ${supplier.employees}
Revenue: ${supplier.annual_revenue}
Evidence sources (from web scouting): ${(supplier.data_sources || []).join(", ") || "none"}

Buyer Requirements:
- Category: ${category}
- Requirements: ${requirements}
- Annual Spend: ${annualSpend || "Not specified"}

Use web_search (up to 3 searches) to confirm the supplier genuinely offers the core capability required for "${category}" and that they are a real, active business. Prioritize the company's own site and independent sources.

Scoring rules:
- Score 0-100 across 5 dimensions. Be strict — 80+ means genuinely excellent, VERIFIED fit.
- If you CANNOT verify the core capability from credible sources, cap overall_score at 74 and note the gap in the rationale.
- Reward independently confirmed capabilities, certifications, and scale; penalize thin or contradicted evidence.

Return JSON only (after any searches):
{
  "overall_score": 78,
  "rationale": "2-3 sentence assessment citing what you verified and any gaps",
  "breakdown": {
    "capability_fit": 82,
    "quality_signals": 75,
    "geographic_risk": 70,
    "financial_stability": 80,
    "compliance_readiness": 85
  }
}`;

  const messages: any[] = [{ role: "user", content: prompt }]; // eslint-disable-line @typescript-eslint/no-explicit-any
  let response: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Resume the pause_turn loop until the model finishes its turn.
  for (let i = 0; i < 6; i++) {
    response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 3000,
      thinking: { type: "adaptive" },
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    onUsage?.(response.usage);

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    break;
  }

  const text = response.content
    .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
    .join("");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { overall_score: 60, rationale: "Limited data for qualification.", breakdown: { capability_fit: 60, quality_signals: 60, geographic_risk: 60, financial_stability: 60, compliance_readiness: 60 } };
  return JSON.parse(match[0]) as QualificationResult;
}

// ─── ENRICHER AGENT ───────────────────────────────────────────────────────────
export async function runEnricherAgent(
  supplier: ScoutResult,
  score: QualificationResult,
  category: string,
  onUsage?: UsageCb
): Promise<EnrichmentResult> {
  const prompt = `You are SourceIQ's Enrichment Agent. Provide strategic context for this supplier.

Supplier: ${supplier.name} (${supplier.country}, ${supplier.city})
Score: ${score.overall_score}/100
Category: ${category}
Key capabilities: ${supplier.capabilities.slice(0, 3).join(", ")}
Evidence sources (from web scouting): ${(supplier.data_sources || []).join(", ") || "none"}

Base your assessment on the evidence sources where possible; flag thin/unverified sourcing as a risk.

Return JSON only:
{
  "market_position": "One sentence on their market positioning (e.g. 'Mid-tier job shop with strong automotive heritage')",
  "key_risks": ["risk 1", "risk 2"],
  "key_strengths": ["strength 1", "strength 2"],
  "recommended_action": "pursue" | "monitor" | "pass"
}`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  onUsage?.((response as any).usage); // eslint-disable-line @typescript-eslint/no-explicit-any

  const text = response.content
    .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
    .join("");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { market_position: "Unknown", key_risks: [], key_strengths: [], recommended_action: "monitor" };
  return JSON.parse(match[0]) as EnrichmentResult;
}

// ─── CONTACT DISCOVERY AGENT ──────────────────────────────────────────────────
// Finds a way to reach a supplier — a verified email if possible, otherwise the
// next-best channel (contact page, phone, LinkedIn). Uses web_search and resolves
// the pause_turn resume loop like the scout. Never guesses/constructs an email.
export type ContactResult = {
  contact_email: string; // verified email, or ""
  contact_url: string;   // contact/"contact us" page URL, or ""
  phone: string;         // phone number, or ""
  linkedin: string;      // company LinkedIn URL, or ""
  source: string;        // where the primary channel came from, or ""
};

const EMPTY_CONTACT: ContactResult = { contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" };

export async function runContactFinderAgent(
  supplierName: string,
  country: string,
  website: string,
  onUsage?: UsageCb
): Promise<ContactResult> {
  const prompt = `You are SourceIQ's Contact Discovery Agent. Find the best way to CONTACT this supplier.

Supplier: ${supplierName}
Country: ${country}
Known website: ${website || "(unknown — find it via search)"}

Your job is to ALWAYS return at least ONE usable way to get in touch. Prefer them in this order:
1. A real contact EMAIL (prefer a sales/info/RFQ/contact mailbox over a personal one).
2. The URL of the company's "Contact Us" page (/contact, /kontakt, /contatti, /contacto…) — many use a form instead of a public email.
3. A phone number.
4. The company's LinkedIn page.

RULES (critical):
- You have a \`web_search\` tool. USE IT. Open the company's own site first; fall back to reputable directories.
- Return ONLY details you actually saw. For the email specifically: NEVER guess, construct, or infer it from the domain — leave it "" if you didn't see a real one.
- It is fine (and expected) to return "" for the email as long as you provide a contact_url, phone, or linkedin instead.

Your FINAL message must be ONLY this JSON:
{ "contact_email": "verified email or ''", "contact_url": "contact page URL or ''", "phone": "phone or ''", "linkedin": "company LinkedIn URL or ''", "source": "URL the info came from or ''" }`;

  const markCache = (content: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (Array.isArray(content) && content.length) {
      const last = content[content.length - 1];
      if (last && typeof last === "object") last.cache_control = { type: "ephemeral" };
    }
    return content;
  };

  const messages: any[] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { role: "user", content: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }] },
  ];
  let fullText = "";
  let guard = 0;

  while (guard++ < 6) {
    const response: any = await client.messages.create({ // eslint-disable-line @typescript-eslint/no-explicit-any
      model: "claude-opus-4-7",
      max_tokens: 4000,
      thinking: { type: "adaptive" } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    onUsage?.(response.usage);

    fullText = (response.content || [])
      .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
      .join("");

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: markCache(response.content) });
      continue;
    }
    break;
  }

  const match = fullText.match(/\{[\s\S]*\}/);
  if (!match) return { ...EMPTY_CONTACT };
  try {
    const r = JSON.parse(match[0]) as Partial<ContactResult>;
    return {
      contact_email: (r.contact_email || "").trim(),
      contact_url: (r.contact_url || "").trim(),
      phone: (r.phone || "").trim(),
      linkedin: (r.linkedin || "").trim(),
      source: (r.source || "").trim(),
    };
  } catch {
    return { ...EMPTY_CONTACT };
  }
}

// Combined, reliability-first resolver: scrape the supplier's own website
// deterministically first (cheap, no LLM), then fall back to the web-search agent
// only for whatever channels the scrape didn't turn up. Guarantees we return the
// richest set of channels available. `hasWebSearch` gates the (paid) agent call.
export async function resolveSupplierContact(
  supplierName: string,
  country: string,
  website: string,
  onUsage?: UsageCb,
): Promise<ContactResult> {
  let result: ContactResult = { ...EMPTY_CONTACT };

  // 1 ── Deterministic scrape of the supplier's own site.
  if (website) {
    try {
      const scraped = await scrapeSupplierContact(website);
      result = {
        contact_email: scraped.contact_email,
        contact_url: scraped.contact_url,
        phone: scraped.phone,
        linkedin: scraped.linkedin,
        source: scraped.source,
      };
    } catch { /* scrape best-effort */ }
  }

  // 2 ── If we still lack an email (the highest-value channel), ask the agent.
  //      It can also discover a website we didn't have, plus phone/LinkedIn.
  if (!result.contact_email) {
    try {
      const found = await runContactFinderAgent(supplierName, country, website, onUsage);
      result = {
        contact_email: result.contact_email || found.contact_email,
        contact_url: result.contact_url || found.contact_url,
        phone: result.phone || found.phone,
        linkedin: result.linkedin || found.linkedin,
        source: result.source || found.source,
      };
    } catch { /* agent best-effort */ }
  }

  return result;
}

// ─── OUTREACH AGENT ───────────────────────────────────────────────────────────
export type OutreachEmail = {
  language: string;        // e.g. "German", "Italian", "English"
  subject: string;         // in the supplier's local language
  body: string;            // in the supplier's local language
  subject_en: string;      // English translation
  body_en: string;         // English translation
};

export type BuyerIdentity = {
  name?: string | null;
  role?: string | null;
  company?: string | null;
};

export async function runOutreachAgent(
  supplierName: string,
  country: string,
  category: string,
  requirements: string,
  annualSpend: string,
  onUsage?: UsageCb,
  buyer?: BuyerIdentity | null
): Promise<OutreachEmail> {
  const disclosed = !!(buyer && (buyer.name || buyer.company));
  const identityRules = disclosed
    ? `IDENTITY (disclosed outreach):
- This email is sent on behalf of a named buyer. Introduce them clearly.
- Buyer name: ${buyer?.name || "(not provided)"}
- Buyer role: ${buyer?.role || "(not provided)"}
- Buyer company: ${buyer?.company || "(not provided)"}
- Write as this buyer (first person), and sign off with their name, role, and company.
- Do NOT mention SourceIQ or any intermediary.`
    : `IDENTITY (anonymous outreach):
- Do NOT reveal the buyer's identity (SourceIQ acts as intermediary).`;

  const prompt = `You are SourceIQ's Outreach Agent. Write a compelling outreach email to a supplier.

Supplier: ${supplierName}
Supplier country: ${country}
Category: ${category}
Requirements: ${requirements}
Annual Spend: ${annualSpend || "Confidential at this stage"}

${identityRules}

LANGUAGE RULE (critical):
- Write the email in the primary BUSINESS language of the supplier's country (e.g. Germany→German, Italy→Italian, Mexico→Spanish, France→French, Japan→Japanese, Brazil→Portuguese, China→Simplified Chinese, Turkey→Turkish, Poland→Polish, Vietnam→Vietnamese). For English-speaking countries, write in English.
- Also provide a faithful English translation.

Other rules:
- Be professional and concise (under 180 words)
- Reference the spend opportunity to signal seriousness
- End with a clear CTA to express interest

Return JSON only:
{
  "language": "the language you wrote the email in (English name of the language)",
  "subject": "subject line in the local language",
  "body": "full email body in the local language",
  "subject_en": "English translation of the subject",
  "body_en": "English translation of the body"
}`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  onUsage?.((response as any).usage); // eslint-disable-line @typescript-eslint/no-explicit-any

  const text = response.content
    .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
    .join("");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON from outreach agent");
  return JSON.parse(match[0]) as OutreachEmail;
}

// ─── FOLLOW-UP / NUDGE AGENT ──────────────────────────────────────────────────
// Writes a brief, polite follow-up for a supplier that was contacted but hasn't
// replied. References the prior RFI without re-pitching from scratch.
export async function runFollowUpAgent(
  supplierName: string,
  country: string,
  category: string,
  priorSubject: string,
  onUsage?: UsageCb
): Promise<OutreachEmail> {
  const prompt = `You are SourceIQ's Outreach Agent writing a SHORT follow-up nudge to a supplier who received an anonymous RFI but has not yet replied.

Supplier: ${supplierName} (${country})
Category: ${category}
Subject of the original RFI: "${priorSubject}"

Rules:
- This is a gentle reminder, NOT a new pitch. Reference the earlier message.
- Very concise (under 90 words). Warm, low-pressure, one clear CTA to reply.
- Do NOT reveal the buyer's identity.
- Write in the primary business language of the supplier's country; also give an English translation.
- Reuse the original subject prefixed with "Re: ".

Return JSON only:
{
  "language": "the language you wrote in (English name)",
  "subject": "Re: <original subject> (localized)",
  "body": "follow-up body in the local language",
  "subject_en": "English translation of the subject",
  "body_en": "English translation of the body"
}`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 900,
    messages: [{ role: "user", content: prompt }],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  onUsage?.((response as any).usage); // eslint-disable-line @typescript-eslint/no-explicit-any

  const text = response.content
    .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
    .join("");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON from follow-up agent");
  return JSON.parse(match[0]) as OutreachEmail;
}

// ─── SUPPLIER RESPONSE AGENT ──────────────────────────────────────────────────
// Simulates how a supplier replies to the anonymous RFI. The buyer only advances
// a supplier when it responds with positive, qualifying information.
export type SupplierResponse = {
  responded: boolean;
  sentiment: "positive" | "negative";
  language: string;
  reply: string;       // in the supplier's local language
  reply_en: string;    // English translation
  capacity_confirmed: string;
  lead_time: string;
  highlights: string[];
};

export async function runSupplierResponseAgent(
  supplierName: string,
  country: string,
  score: number,
  category: string,
  requirements: string,
  outreachBody: string,
  onUsage?: UsageCb
): Promise<SupplierResponse> {
  const prompt = `You are simulating how the procurement/sales team at "${supplierName}" (${country}) would realistically respond to an anonymous RFI from a serious industrial buyer.

Category: ${category}
Buyer requirements: ${requirements}
This supplier's internal fit score: ${score}/100
The RFI they received:
"""${outreachBody}"""

Decide realistically:
- Higher-fit suppliers (score 70+) usually respond, and usually positively (they have capacity and want the business).
- Mid-fit suppliers (55-69) respond about half the time; response may be positive or express constraints.
- Lower-fit suppliers (<55) often do not respond, or respond declining (no capacity / not a fit).
Introduce natural variation — not every strong supplier replies, and occasionally a weaker one is hungry for work.

If they respond POSITIVELY, they confirm capacity, give an indicative lead time, and highlight relevant strengths.
If they respond NEGATIVELY, they politely decline or flag a blocking constraint.
If they do NOT respond, set responded=false.

LANGUAGE RULE: The supplier writes their reply in the primary business language of their country (${country}) — e.g. Germany→German, Italy→Italian, Mexico→Spanish, Japan→Japanese, China→Simplified Chinese. English-speaking countries reply in English. Also provide a faithful English translation.

Return JSON only:
{
  "responded": true,
  "sentiment": "positive",
  "language": "the language of the reply (English name)",
  "reply": "The supplier's actual reply message in their local language (2-4 sentences, professional, first person).",
  "reply_en": "English translation of the reply",
  "capacity_confirmed": "e.g. 'Yes — 50k units/yr available' or 'N/A'",
  "lead_time": "e.g. '8-10 weeks' or 'N/A'",
  "highlights": ["relevant qualifying fact 1 (in English)", "fact 2"]
}
If responded=false, still return the object with sentiment "negative", empty reply and reply_en, and empty highlights.`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  onUsage?.((response as any).usage); // eslint-disable-line @typescript-eslint/no-explicit-any

  const text = response.content
    .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
    .join("");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { responded: false, sentiment: "negative", language: "English", reply: "", reply_en: "", capacity_confirmed: "N/A", lead_time: "N/A", highlights: [] };
  return JSON.parse(match[0]) as SupplierResponse;
}

// ─── REPLY CLASSIFIER AGENT ───────────────────────────────────────────────────
// Classifies a REAL inbound reply from a supplier (from the inbound webhook).
// Unlike runSupplierResponseAgent (which SIMULATES a reply in demo mode), this
// reads an actual received message and decides whether it qualifies the supplier.
export type ReplyClassification = {
  sentiment: "positive" | "negative" | "neutral";
  interested: boolean;        // does the supplier want to engage?
  language: string;
  summary_en: string;         // short English summary of what they said
  capacity_confirmed: string; // extracted, or "N/A"
  lead_time: string;          // extracted, or "N/A"
  highlights: string[];       // qualifying facts (English)
  is_auto_reply: boolean;     // out-of-office / bounce / autoresponder
};

export async function runReplyClassifierAgent(
  supplierName: string,
  country: string,
  category: string,
  requirements: string,
  replyBody: string,
  onUsage?: UsageCb
): Promise<ReplyClassification> {
  const prompt = `You are SourceIQ's Reply Classifier. A supplier has replied to our anonymous RFI. Read their actual message and classify it factually — do NOT invent details that are not present.

Supplier: ${supplierName} (${country})
Category: ${category}
Buyer requirements: ${requirements}

The supplier's reply (verbatim, may be in a non-English language):
"""${replyBody}"""

Classify:
- sentiment: "positive" if they express interest/capacity, "negative" if they decline or flag a blocking constraint, "neutral" if unclear or just asking questions.
- interested: true only if they want to continue the conversation.
- is_auto_reply: true if this is an out-of-office autoresponder, a delivery/bounce notification, or an unattended-mailbox message (in which case sentiment is "neutral" and interested is false).
- Extract capacity_confirmed and lead_time ONLY if explicitly stated; otherwise "N/A".
- highlights: concrete qualifying facts the supplier actually stated (in English). Empty if none.

Return JSON only:
{
  "sentiment": "positive",
  "interested": true,
  "language": "the language of the reply (English name)",
  "summary_en": "1-2 sentence English summary of what they said",
  "capacity_confirmed": "N/A",
  "lead_time": "N/A",
  "highlights": [],
  "is_auto_reply": false
}`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  onUsage?.((response as any).usage); // eslint-disable-line @typescript-eslint/no-explicit-any

  const text = response.content
    .filter((b: any) => b.type === "text") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text) // eslint-disable-line @typescript-eslint/no-explicit-any
    .join("");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match)
    return { sentiment: "neutral", interested: false, language: "English", summary_en: "(could not parse reply)", capacity_confirmed: "N/A", lead_time: "N/A", highlights: [], is_auto_reply: false };
  return JSON.parse(match[0]) as ReplyClassification;
}
