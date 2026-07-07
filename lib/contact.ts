// ─── DETERMINISTIC CONTACT SCRAPER ────────────────────────────────────────────
// Fetches a supplier's own website (homepage + common "contact" paths) and pulls
// real contact channels straight out of the HTML — mailto:/tel: links, visible
// email addresses, a contact-page URL, and social handles. This grounds contact
// discovery in what's actually published, rather than asking an LLM to recall or
// guess an address. Returns only what it genuinely found; empty strings otherwise.

export type ContactChannels = {
  contact_email: string; // best real email found (prefers info/sales/rfq mailboxes)
  contact_url: string;   // a contact / "contact us" page URL
  phone: string;         // a phone number (from tel: links)
  linkedin: string;      // company LinkedIn URL
  source: string;        // the page URL the primary channel came from
};

const EMPTY: ContactChannels = { contact_email: "", contact_url: "", phone: "", linkedin: "", source: "" };

// Common contact-page slugs across the languages SourceIQ sources in.
const CONTACT_PATHS = [
  "/contact", "/contact-us", "/contactus", "/contacts",
  "/kontakt", "/contatti", "/contacto", "/contact.html", "/contact.php",
  "/about/contact", "/company/contact", "/en/contact",
];

// Addresses that are almost never a real inbound mailbox — skip them.
const JUNK_EMAIL = /(example\.|sentry\.|wixpress\.|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|@\d)/i;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function normalizeSite(website: string): string | null {
  if (!website) return null;
  let w = website.trim();
  if (!/^https?:\/\//i.test(w)) w = "https://" + w.replace(/^\/+/, "");
  try { return new URL(w).origin; } catch { return null; }
}

// Score an email so we prefer generic business mailboxes over noreply/personal.
function emailScore(email: string): number {
  const local = email.split("@")[0].toLowerCase();
  if (/^(info|sales|contact|enquir|inquir|rfq|hello|office|export|commercial|kontakt)/.test(local)) return 3;
  if (/^(no.?reply|donotreply|newsletter|privacy|webmaster|abuse|postmaster)/.test(local)) return 0;
  return 1;
}

async function fetchHtml(url: string, timeoutMs = 7000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SourceIQ-ContactBot/1.0; +https://sourceiq.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    // Cap body size so a giant page can't blow up memory.
    const text = await res.text();
    return text.slice(0, 500_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Pull channels out of a single HTML document.
function extractFromHtml(html: string, pageUrl: string): Partial<ContactChannels> {
  const out: Partial<ContactChannels> = {};

  // mailto: links are the most trustworthy signal.
  const mailtos: string[] = [];
  const mailtoRe = /mailto:([^"'?>\s]+)/gi;
  let mm: RegExpExecArray | null;
  while ((mm = mailtoRe.exec(html)) !== null) {
    try { mailtos.push(decodeURIComponent(mm[1]).trim()); } catch { mailtos.push(mm[1].trim()); }
  }
  // Also scan visible text for bare addresses (many sites print them without mailto:).
  const bare = html.match(EMAIL_RE) || [];
  const seen: Record<string, true> = {};
  const emails = mailtos.concat(bare)
    .filter(e => {
      if (!e.includes("@") || JUNK_EMAIL.test(e)) return false;
      if (seen[e]) return false;
      seen[e] = true;
      return true;
    })
    .sort((a, b) => emailScore(b) - emailScore(a));
  if (emails.length) { out.contact_email = emails[0]; out.source = pageUrl; }

  // tel: links → phone.
  const tel = html.match(/tel:([+\d][\d\s().-]{5,})/i);
  if (tel) out.phone = tel[1].replace(/\s+/g, " ").trim();

  // Company LinkedIn.
  const li = html.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9_%-]+/i);
  if (li) out.linkedin = li[0];

  return out;
}

// Try to find a contact-page link within the homepage HTML.
function findContactLink(html: string, origin: string): string | null {
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").toLowerCase();
    if (/contact|kontakt|contatti|contacto|contattaci|get in touch/.test(text + " " + href.toLowerCase())) {
      try { return new URL(href, origin).href; } catch { /* skip */ }
    }
  }
  return null;
}

function merge(base: ContactChannels, add: Partial<ContactChannels>): ContactChannels {
  return {
    contact_email: base.contact_email || add.contact_email || "",
    contact_url: base.contact_url || add.contact_url || "",
    phone: base.phone || add.phone || "",
    linkedin: base.linkedin || add.linkedin || "",
    source: base.source || add.source || "",
  };
}

// Scrape a supplier's own site for contact channels. Fetches the homepage, follows
// a discovered contact link (or tries common slugs), and stops early once it has
// a solid email. Fully deterministic — no model call.
export async function scrapeSupplierContact(website: string): Promise<ContactChannels> {
  const origin = normalizeSite(website);
  if (!origin) return EMPTY;

  let result: ContactChannels = { ...EMPTY };

  const home = await fetchHtml(origin);
  if (home) {
    result = merge(result, extractFromHtml(home, origin));
    const link = findContactLink(home, origin);
    if (link) result.contact_url = result.contact_url || link;
  }

  // If we don't have a good (generic) email yet, visit contact pages.
  const haveGoodEmail = result.contact_email && emailScore(result.contact_email) >= 2;
  if (!haveGoodEmail) {
    const candidates = [result.contact_url, ...CONTACT_PATHS.map(p => origin + p)]
      .filter((v, i, a): v is string => !!v && a.indexOf(v) === i)
      .slice(0, 4); // bound the number of extra requests
    for (const url of candidates) {
      const html = await fetchHtml(url);
      if (!html) continue;
      result.contact_url = result.contact_url || url;
      result = merge(result, extractFromHtml(html, url));
      if (result.contact_email && emailScore(result.contact_email) >= 2) break;
    }
  }

  return result;
}
