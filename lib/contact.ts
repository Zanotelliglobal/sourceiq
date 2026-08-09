// ─── DETERMINISTIC CONTACT SCRAPER ────────────────────────────────────────────
// Fetches a supplier's own website (homepage + common "contact" paths) and pulls
// real contact channels straight out of the HTML — mailto:/tel: links, visible
// email addresses, a contact-page URL, and social handles. This grounds contact
// discovery in what's actually published, rather than asking an LLM to recall or
// guess an address. Returns only what it genuinely found; empty strings otherwise.
//
// SECURITY (issue #76): `website` here is entirely attacker-influenced — it's
// whatever a scout LLM / web search turned up for a "supplier", not something
// a trusted user typed in. Fetching it server-side is a textbook SSRF vector
// (e.g. `http://169.254.169.254/latest/meta-data/` or `http://127.0.0.1:6379/`).
// `safeFetch` below resolves DNS and rejects private/loopback/link-local/
// metadata/reserved addresses before connecting, re-validates on every
// redirect hop (redirects are followed manually, never automatically), and
// rejects non-http(s) schemes. This narrows, but doesn't eliminate, the risk —
// a DNS-rebinding attack (the validated hostname resolves differently by the
// time `fetch()` itself connects) is a known residual gap that would need a
// connection-pinning HTTP client to close fully; blocking the vast majority of
// realistic SSRF payloads (literal internal IPs/hostnames, redirect chains to
// internal targets) is the goal here.

import dns from "node:dns";
import net from "node:net";

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

// ─── SSRF guard ────────────────────────────────────────────────────────────
// Built on Node's own `dns`/`net` modules only (no new dependency) so this
// works under a plain `npm ci` with no lockfile changes.
function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + (Number(octet) & 0xff), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

// RFC 1918/5735/6598 private, loopback, link-local (incl. the 169.254.169.254
// cloud-metadata address), CGNAT, multicast, and reserved ranges.
const BLOCKED_V4_RANGES: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_V4_RANGES.some(([base, bits]) => inCidr4(ip, base, bits));
}

function isBlockedIpv6(ip: string): boolean {
  const n = ip.toLowerCase();
  if (n === "::" || n === "::1") return true; // unspecified / loopback
  const v4embed = n.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (v4embed) return isBlockedIpv4(v4embed[1]);
  const firstHextet = parseInt(n.split(":")[0] || "0", 16) || 0;
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  return false;
}

function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // unrecognized format — fail closed
}

// Resolve + validate a URL is safe to connect to: http(s) only, and every
// address the hostname resolves to must be public. Rejects on any DNS
// failure (fail closed) rather than silently proceeding.
async function isSafeUrl(urlStr: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(urlStr); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const hostname = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (net.isIP(hostname)) return !isBlockedAddress(hostname);
  try {
    const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) return false;
    return records.every(r => !isBlockedAddress(r.address));
  } catch {
    return false;
  }
}

const MAX_REDIRECTS = 5;

// fetch() with SSRF validation on the initial URL AND on every redirect hop
// (redirects are never auto-followed — a same-origin-looking URL could 302 to
// an internal address, which `redirect: "follow"` would silently honor).
async function safeFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeUrl(current))) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, { ...init, signal: controller.signal, redirect: "manual" });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      try { current = new URL(location, current).href; } catch { return null; }
      continue;
    }
    return res;
  }
  return null; // too many redirects
}

// Registrable-ish domain: last two labels of a host (e.g. www.ritrama.com →
// ritrama.com). Good enough to tell "same company" from "third party"; it over-
// collapses a few multi-part TLDs (foo.co.uk) but that only makes matching
// slightly stricter, which is the safe direction here.
function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

// An email "belongs to" a page if its domain matches the page's base domain.
// This is what stops us from scraping an unrelated third-party address (a web
// agency, a partner, an embedded widget) that merely appears on the page.
function emailMatchesDomain(email: string, pageBase: string): boolean {
  if (!pageBase) return false;
  const dom = (email.split("@")[1] || "").toLowerCase();
  return !!dom && baseDomain(dom) === pageBase;
}

// Score an email so we prefer generic business mailboxes over noreply/personal.
function emailScore(email: string): number {
  const local = email.split("@")[0].toLowerCase();
  if (/^(info|sales|contact|enquir|inquir|rfq|hello|office|export|commercial|kontakt)/.test(local)) return 3;
  if (/^(no.?reply|donotreply|newsletter|privacy|webmaster|abuse|postmaster)/.test(local)) return 0;
  return 1;
}

async function fetchHtml(url: string, timeoutMs = 7000): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SourceIQ-ContactBot/1.0; +https://sourceiq.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    }, timeoutMs);
    if (!res || !res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    // Cap body size so a giant page can't blow up memory.
    const text = await res.text();
    return text.slice(0, 500_000);
  } catch {
    return null;
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
  const pageBase = baseDomain(hostOf(pageUrl));
  const seen: Record<string, true> = {};
  const emails = mailtos.concat(bare)
    .filter(e => {
      if (!e.includes("@") || JUNK_EMAIL.test(e)) return false;
      // Only accept addresses on the SAME domain as the page — this rejects
      // unrelated third-party emails (partners, web agencies, embedded widgets)
      // that merely appear in the HTML.
      if (!emailMatchesDomain(e, pageBase)) return false;
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

// Lightweight liveness probe backing the "website-live" verification badge
// (Epic 1 continuation, issue #39). Deliberately looser than fetchHtml — no
// content-type/HTML requirement, just "did the origin answer at all". HEAD
// first (cheaper), falling back to GET for servers that reject HEAD.
export async function checkWebsiteLive(website: string, timeoutMs = 5000): Promise<boolean> {
  const origin = normalizeSite(website);
  if (!origin) return false;
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; SourceIQ-ContactBot/1.0; +https://sourceiq.app)" };
  try {
    const head = await safeFetch(origin, { method: "HEAD", headers }, timeoutMs);
    if (!head) return false;
    if (head.status === 405 || head.status === 501) {
      const get = await safeFetch(origin, { method: "GET", headers }, timeoutMs);
      return !!get && get.ok;
    }
    return head.ok;
  } catch {
    return false;
  }
}

// Scrape a supplier's own site for contact channels. Fetches the homepage, follows
// a discovered contact link (or tries common slugs), and stops early once it has
// a solid email. Fully deterministic — no model call.
export async function scrapeSupplierContact(
  website: string,
  opts?: { timeoutMs?: number; maxPages?: number },
): Promise<ContactChannels> {
  const origin = normalizeSite(website);
  if (!origin) return EMPTY;

  const timeoutMs = opts?.timeoutMs ?? 7000;
  const maxPages = opts?.maxPages ?? 4;

  let result: ContactChannels = { ...EMPTY };

  const home = await fetchHtml(origin, timeoutMs);
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
      .slice(0, maxPages); // bound the number of extra requests
    for (const url of candidates) {
      const html = await fetchHtml(url, timeoutMs);
      if (!html) continue;
      result.contact_url = result.contact_url || url;
      result = merge(result, extractFromHtml(html, url));
      if (result.contact_email && emailScore(result.contact_email) >= 2) break;
    }
  }

  return result;
}
