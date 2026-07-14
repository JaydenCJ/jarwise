/**
 * The RFC 6265bis §5.8.3 retrieval algorithm: which jar cookies get
 * attached to a request, with a full per-cookie rule trace. This is where
 * SameSite actually bites — the rules here are the ones that "eat" a
 * login cookie years after a SameSite default change.
 */
import { sameSiteUrls, siteOf } from "./psl.js";
import { domainMatch, pathMatch, secureContext } from "./siteurl.js";
import type {
  Check,
  CookieSendDecision,
  SendInput,
  SendResult,
  StoredCookie,
} from "./types.js";

/** Methods RFC 9110 calls "safe" — the only ones Lax lets cross site. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

function check(id: string, ref: string, pass: boolean, detail: string): Check {
  return { id, ref, pass, detail };
}

function decideCookie(
  cookie: StoredCookie,
  input: Required<Pick<SendInput, "url" | "kind" | "method" | "now">> & { sameSiteRequest: boolean; topLevelSite: string },
): CookieSendDecision {
  const { url, kind, method, sameSiteRequest, topLevelSite } = input;
  const checks: Check[] = [];
  const done = (): CookieSendDecision => ({ cookie, sent: checks.every((c) => c.pass), checks });

  // Domain scoping: host-only cookies demand an exact host match.
  if (cookie.hostOnly) {
    const pass = url.host === cookie.domain;
    checks.push(check("send.host-only", "RFC 6265bis §5.8.3", pass,
      pass
        ? `host-only cookie for ${cookie.domain} — the request host matches exactly`
        : `host-only cookie for ${cookie.domain} — ${url.host} is a different host (no Domain attribute means no subdomain sharing)`));
    if (!pass) return done();
  } else {
    const pass = domainMatch(url.host, cookie.domain);
    checks.push(check("send.domain-match", "RFC 6265bis §5.1.3", pass,
      pass
        ? `${url.host} domain-matches ${cookie.domain}`
        : `${url.host} does not domain-match ${cookie.domain}`));
    if (!pass) return done();
  }

  // Path scoping.
  {
    const pass = pathMatch(url.path, cookie.path);
    checks.push(check("send.path-match", "RFC 6265bis §5.1.4", pass,
      pass
        ? `request path ${url.path} path-matches cookie path ${cookie.path}`
        : `request path ${url.path} does not path-match cookie path ${cookie.path}`));
    if (!pass) return done();
  }

  // Secure channel.
  {
    const pass = !cookie.secure || secureContext(url);
    checks.push(check("send.secure", "RFC 6265bis §5.8.3", pass,
      cookie.secure
        ? pass
          ? url.secure
            ? "Secure cookie on an https request"
            : "Secure cookie on a trustworthy loopback origin"
          : `Secure cookie withheld from ${url.scheme}://${url.host} — plaintext hops never see it`
        : "cookie is not Secure — any channel may carry it"));
    if (!pass) return done();
  }

  // HttpOnly never blocks an HTTP request; the trace says so explicitly.
  if (cookie.httpOnly) {
    checks.push(check("send.httponly", "RFC 6265bis §5.8.3", true,
      "HttpOnly hides the cookie from document.cookie, not from HTTP requests — attached normally"));
  }

  // SameSite enforcement.
  {
    const label = `${cookie.sameSite}${cookie.defaulted ? " (defaulted — no SameSite attribute)" : ""}`;
    let pass: boolean;
    let detail: string;
    if (cookie.sameSite === "None") {
      pass = true;
      detail = "SameSite=None — sent on every cross-site request (it had to be Secure to exist)";
    } else if (sameSiteRequest) {
      pass = true;
      detail = `SameSite=${label} — the request is same-site, nothing to enforce`;
    } else if (cookie.sameSite === "Strict") {
      pass = false;
      detail = kind === "navigation"
        ? "SameSite=Strict withholds the cookie even on a top-level navigation from another site — the first request after clicking a cross-site link arrives logged out"
        : "SameSite=Strict blocks every cross-site request";
    } else if (kind === "navigation" && SAFE_METHODS.has(method)) {
      pass = true;
      detail = `SameSite=${label} — cross-site, but a top-level ${method} navigation is exactly what Lax allows`;
    } else {
      pass = false;
      detail = kind === "navigation"
        ? `SameSite=${label} blocks cross-site ${method} navigations — Lax only allows safe methods (GET/HEAD/OPTIONS/TRACE)`
        : `SameSite=${label} blocks cross-site subresource requests (fetch/XHR/img/iframe)`;
    }
    checks.push(check("send.samesite", "RFC 6265bis §5.8.3", pass, detail));
    if (!pass) return done();
  }

  // Partitioned cookies only exist under their own top-level site.
  if (cookie.partitionKey !== null) {
    const pass = cookie.partitionKey === topLevelSite;
    checks.push(check("send.partitioned", "CHIPS draft §3", pass,
      pass
        ? `partition key ${cookie.partitionKey} matches the current top-level site`
        : `partitioned under ${cookie.partitionKey} — invisible while the top-level site is ${topLevelSite}`));
    if (!pass) return done();
  }

  return done();
}

/** Decide which cookies from the jar accompany the request. */
export function decideSend(input: SendInput): SendResult {
  const { jar, url, now } = input;
  const from = input.from ?? "address-bar";
  const kind = input.kind ?? "navigation";
  const method = (input.method ?? "GET").toUpperCase();

  // Browser-initiated (address-bar) requests are same-site by definition.
  const sameSiteRequest = input.forceSameSite ?? (from === "address-bar" ? true : sameSiteUrls(from, url));
  // The top-level site: the target for navigations, the embedder otherwise.
  const topLevelSite = kind === "navigation" || from === "address-bar" ? siteOf(url) : siteOf(from);

  const decisions: CookieSendDecision[] = jar
    .list(now)
    .map((cookie) => decideCookie(cookie, { url, kind, method, now, sameSiteRequest, topLevelSite }));

  // RFC 6265bis §5.8.3: longer paths first, then earlier creation time.
  const sent = decisions
    .filter((d) => d.sent)
    .map((d) => d.cookie)
    .sort((a, b) => b.path.length - a.path.length || a.creationSeq - b.creationSeq);

  const header = sent.length === 0
    ? null
    : sent.map((c) => (c.name === "" ? c.value : `${c.name}=${c.value}`)).join("; ");

  return { sameSiteRequest, kind, method, decisions, sent, header };
}
