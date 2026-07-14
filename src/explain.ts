/**
 * `jarwise explain`: annotate a Set-Cookie header attribute by attribute,
 * without needing a URL. Parse-level notes are merged with static analysis
 * (prefix contracts, SameSite defaults, lifetime) into one report a person
 * can read top to bottom.
 */
import { formatHttpDate } from "./date.js";
import { parseSetCookie, utf8Length } from "./parse.js";
import { effectiveSameSite } from "./store.js";
import type { Note, SetCookie } from "./types.js";

export interface AttributeRow {
  label: string;
  value: string;
}

export interface ExplainResult {
  verdict: "ok" | "rejected";
  /** Rejection reason when the header does not even parse. */
  reason: string | null;
  cookie: SetCookie | null;
  rows: AttributeRow[];
  notes: Note[];
}

function note(level: Note["level"], id: string, ref: string, message: string): Note {
  return { level, id, ref, message };
}

/** Explain one Set-Cookie header. `now` anchors lifetime statements. */
export function explainSetCookie(header: string, now: number): ExplainResult {
  const parsed = parseSetCookie(header);
  if (!parsed.ok) {
    return { verdict: "rejected", reason: parsed.reason, cookie: null, rows: [], notes: parsed.notes };
  }
  const cookie = parsed.cookie;
  const notes: Note[] = [...cookie.notes];
  const rows: AttributeRow[] = [];
  const same = effectiveSameSite(cookie.sameSite);
  const lowerName = cookie.name.toLowerCase();

  rows.push({ label: "name", value: cookie.name === "" ? "(empty — nameless cookie)" : cookie.name });
  rows.push({ label: "value", value: `${cookie.value === "" ? "(empty)" : cookie.value} (${utf8Length(cookie.value)} bytes)` });

  rows.push({
    label: "Domain",
    value: cookie.domainAttr === null
      ? "(absent) — host-only: exact host match, subdomains excluded"
      : `${cookie.domainAttr} — sent to ${cookie.domainAttr} and every subdomain (only storable by hosts under it)`,
  });
  rows.push({
    label: "Path",
    value: cookie.pathAttr === null
      ? "(absent) — the default-path of the setting URL will apply"
      : `${cookie.pathAttr} — sent when the request path path-matches it`,
  });
  rows.push({
    label: "Secure",
    value: cookie.secure
      ? "yes — only settable from and sendable over https (loopback origins excepted)"
      : "no — travels over plain http, readable by any on-path attacker",
  });
  rows.push({
    label: "HttpOnly",
    value: cookie.httpOnly
      ? "yes — invisible to document.cookie; XSS cannot exfiltrate it directly"
      : "no — scripts on the page can read it via document.cookie",
  });
  rows.push({
    label: "SameSite",
    value: cookie.sameSite === "Default"
      ? "(absent) — modern browsers default to Lax"
      : cookie.sameSite === "Strict"
        ? "Strict — same-site requests only; even link-click navigations from other sites omit it"
        : cookie.sameSite === "Lax"
          ? "Lax — same-site requests, plus top-level navigations with safe methods (GET)"
          : "None — sent cross-site everywhere; requires Secure",
  });
  if (cookie.partitioned) {
    rows.push({ label: "Partitioned", value: "yes — CHIPS: one jar per top-level site; requires Secure" });
  }

  // Lifetime.
  let lifetime: string;
  if (cookie.maxAge !== null) {
    lifetime = cookie.maxAge <= 0
      ? `Max-Age=${cookie.maxAge} — expires immediately: this header deletes the cookie`
      : `persistent — Max-Age=${cookie.maxAge}s (until ${formatHttpDate(now + cookie.maxAge * 1000)})`;
    if (cookie.expires !== null) {
      notes.push(note("info", "explain.max-age-wins", "RFC 6265bis §5.7", "both Max-Age and Expires are present — Max-Age wins"));
    }
  } else if (cookie.expires !== null) {
    lifetime = cookie.expires <= now
      ? `Expires=${formatHttpDate(cookie.expires)} — already in the past: this header deletes the cookie`
      : `persistent — until ${formatHttpDate(cookie.expires)}`;
  } else {
    lifetime = "session — no Expires/Max-Age; evicted when the browser session ends";
  }
  rows.push({ label: "lifetime", value: lifetime });

  // Static contract analysis (no URL needed).
  if (lowerName.startsWith("__host-")) {
    const problems: string[] = [];
    if (!cookie.secure) problems.push("Secure is missing");
    if (cookie.domainAttr !== null) problems.push("Domain is present");
    if (cookie.pathAttr !== "/") problems.push('Path is not exactly "/"');
    if (problems.length > 0) {
      notes.push(note("error", "explain.prefix-host", "RFC 6265bis §4.1.3", `__Host- contract violated (${problems.join(", ")}) — no browser will ever store this cookie`));
    } else {
      notes.push(note("info", "explain.prefix-host", "RFC 6265bis §4.1.3", "__Host- prefix: locked to one host over https — the strongest binding a cookie can have"));
    }
  } else if (lowerName.startsWith("__secure-")) {
    if (!cookie.secure) {
      notes.push(note("error", "explain.prefix-secure", "RFC 6265bis §4.1.3", "__Secure- requires the Secure attribute — no browser will ever store this cookie"));
    } else {
      notes.push(note("info", "explain.prefix-secure", "RFC 6265bis §4.1.3", "__Secure- prefix: may only be set over https, so plaintext attackers cannot plant it"));
    }
  }
  if (same.value === "None" && !cookie.secure) {
    notes.push(note("error", "explain.samesite-none-secure", "RFC 6265bis §5.7", "SameSite=None without Secure — modern browsers reject the cookie outright"));
  }
  if (cookie.sameSite === "Default") {
    notes.push(note("info", "explain.samesite-default", "RFC 6265bis §5.7", "no SameSite attribute — enforced as Lax; Chrome additionally allows cross-site POSTs for ~2 minutes after creation (\"Lax+POST\", not simulated in 0.1.0)"));
  }
  if (cookie.partitioned && !cookie.secure) {
    notes.push(note("error", "explain.partitioned-secure", "CHIPS draft §3", "Partitioned requires Secure — the cookie will be rejected"));
  }
  if (!cookie.secure && !lowerName.startsWith("__")) {
    notes.push(note("info", "explain.no-secure", "RFC 6265bis §8.3", "without Secure, any plaintext http response for a matching host can overwrite this cookie"));
  }

  const verdict = notes.some((n) => n.level === "error") ? "rejected" : "ok";
  return { verdict, reason: null, cookie, rows, notes };
}
