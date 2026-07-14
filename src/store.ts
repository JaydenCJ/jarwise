/**
 * The RFC 6265bis §5.7 storage model as an explainable decision: every
 * step becomes a Check with a pass/fail, the exact rule that fired, and a
 * pointer into the RFC. The verdict is what a compliant modern jar
 * (Chrome/Firefox/Safari current behavior) would do.
 */
import { formatHttpDate } from "./date.js";
import { isPublicSuffix, siteOf } from "./psl.js";
import { defaultPath, domainMatch, pathMatch, secureContext } from "./siteurl.js";
import type {
  Check,
  EffectiveSameSite,
  StoreContext,
  StoredCookie,
  StoreInput,
  StoreResult,
} from "./types.js";

let creationCounter = 0;

/** Reset the monotonic creation sequence (tests only). */
export function resetCreationSeq(): void {
  creationCounter = 0;
}

function check(id: string, ref: string, pass: boolean, detail: string): Check {
  return { id, ref, pass, detail };
}

/** SameSite as enforced: absent/unrecognized becomes Lax (with a flag). */
export function effectiveSameSite(sameSite: string): { value: EffectiveSameSite; defaulted: boolean } {
  if (sameSite === "Strict" || sameSite === "Lax" || sameSite === "None") {
    return { value: sameSite, defaulted: false };
  }
  return { value: "Lax", defaulted: true };
}

/** Run the storage model. Checks are evaluated and reported in RFC order. */
export function decideStore(input: StoreInput): StoreResult {
  const { cookie, url, now } = input;
  const api = input.api ?? "http";
  const context: StoreContext = {
    crossSite: input.context?.crossSite ?? false,
    topLevelNavigation: input.context?.topLevelNavigation ?? true,
  };
  const checks: Check[] = [];
  const secureUrl = secureContext(url);
  const same = effectiveSameSite(cookie.sameSite);

  const reject = (): StoreResult => ({ verdict: "rejected", checks, deletion: false });

  // 1. Non-HTTP APIs may not create HttpOnly cookies.
  if (api === "script") {
    const pass = !cookie.httpOnly;
    checks.push(check("store.httponly-api", "RFC 6265bis §5.7 step 9", pass,
      pass
        ? "set via document.cookie without HttpOnly — allowed"
        : "document.cookie cannot create an HttpOnly cookie — the write is silently discarded"));
    if (!pass) return reject();
  }

  // 2. Cookie-name prefixes carry mandatory attribute contracts.
  const lowerName = cookie.name.toLowerCase();
  if (lowerName.startsWith("__secure-")) {
    const pass = cookie.secure && secureUrl;
    checks.push(check("store.prefix-secure", "RFC 6265bis §4.1.3", pass,
      pass
        ? "__Secure- prefix honored: Secure is set and the origin is secure"
        : `__Secure- requires the Secure attribute and a secure origin — ${!cookie.secure ? "Secure is missing" : `${url.scheme}:// is not secure`}`));
    if (!pass) return reject();
  } else if (lowerName.startsWith("__host-")) {
    const problems: string[] = [];
    if (!cookie.secure) problems.push("Secure is missing");
    if (!secureUrl) problems.push(`${url.scheme}:// is not a secure origin`);
    if (cookie.domainAttr !== null) problems.push(`Domain=${cookie.domainAttr} is present (forbidden)`);
    if (cookie.pathAttr !== "/") problems.push(`Path must be exactly "/" (got ${cookie.pathAttr === null ? "no Path" : `"${cookie.pathAttr}"`})`);
    const pass = problems.length === 0;
    checks.push(check("store.prefix-host", "RFC 6265bis §4.1.3", pass,
      pass
        ? "__Host- prefix honored: Secure, secure origin, no Domain, Path=/"
        : `__Host- contract violated: ${problems.join("; ")}`));
    if (!pass) return reject();
  } else {
    checks.push(check("store.prefix", "RFC 6265bis §4.1.3", true,
      "no __Secure-/__Host- prefix — no extra attribute contract applies"));
  }

  // 3. Secure cookies may only be set from secure origins.
  {
    const pass = !cookie.secure || secureUrl;
    const trustNote = url.trustworthy && !url.secure ? " (loopback origins count as trustworthy)" : "";
    checks.push(check("store.secure-scheme", "RFC 6265bis §5.7 step 8", pass,
      pass
        ? cookie.secure
          ? `Secure cookie set from a secure origin${trustNote}`
          : "cookie is not Secure — no secure-origin requirement"
        : `a Secure cookie cannot be set from ${url.scheme}://${url.host} — an active network attacker could plant it`));
    if (!pass) return reject();
  }

  // 4. SameSite=None must be Secure.
  {
    const pass = !(same.value === "None" && !cookie.secure);
    checks.push(check("store.samesite-none-secure", "RFC 6265bis §5.7 step 12", pass,
      pass
        ? same.value === "None"
          ? "SameSite=None is paired with Secure, as required"
          : `SameSite is ${same.value}${same.defaulted ? " (defaulted — no SameSite attribute)" : ""} — no Secure pairing required`
        : "SameSite=None without Secure is rejected outright by modern browsers"));
    if (!pass) return reject();
  }

  // 5. SameSite cookies cannot be created by cross-site subresources.
  {
    const blocked = same.value !== "None" && context.crossSite && !context.topLevelNavigation;
    checks.push(check("store.samesite-cross-set", "RFC 6265bis §5.7 step 13", !blocked,
      blocked
        ? `a cross-site subresource response cannot create a SameSite=${same.value}${same.defaulted ? " (defaulted)" : ""} cookie`
        : context.crossSite
          ? same.value === "None"
            ? "SameSite=None cookies may be set from cross-site contexts"
            : "cross-site but a top-level navigation — SameSite cookies may still be set"
          : "the response is same-site with its initiator — no restriction"));
    if (blocked) return reject();
  }

  // 6. Domain attribute: public-suffix guard, then domain-match.
  let domain = url.host;
  let hostOnly = true;
  if (cookie.domainAttr !== null) {
    if (isPublicSuffix(cookie.domainAttr)) {
      const isExactHost = cookie.domainAttr === url.host;
      checks.push(check("store.public-suffix", "RFC 6265bis §5.7 step 6", isExactHost,
        isExactHost
          ? `Domain=${cookie.domainAttr} is a public suffix but equals the host — the attribute is ignored and the cookie becomes host-only`
          : `Domain=${cookie.domainAttr} is a public suffix — accepting it would share the cookie across every registration under it ("supercookie"), so the cookie is rejected`));
      if (!isExactHost) return reject();
      // Attribute is discarded; the cookie is stored host-only.
    } else {
      const pass = domainMatch(url.host, cookie.domainAttr);
      checks.push(check("store.domain-match", "RFC 6265bis §5.7 step 6", pass,
        pass
          ? `${url.host} domain-matches Domain=${cookie.domainAttr} — the cookie is sent to ${cookie.domainAttr} and every subdomain`
          : url.ip
            ? `Domain=${cookie.domainAttr} can never match the IP-literal host ${url.host} — IPs take host-only cookies exclusively`
            : `${url.host} does not domain-match Domain=${cookie.domainAttr} — a host can widen a cookie to its parent domain, never to a sibling or unrelated one`));
      if (!pass) return reject();
      domain = cookie.domainAttr;
      hostOnly = false;
    }
  } else {
    checks.push(check("store.domain-match", "RFC 6265bis §5.7 step 6", true,
      `no Domain attribute — host-only: sent to ${url.host} exactly, subdomains excluded`));
  }

  // 7. Path: attribute or the default-path of the setting URL.
  const path = cookie.pathAttr ?? defaultPath(url.path);
  checks.push(check("store.path", "RFC 6265bis §5.1.4", true,
    cookie.pathAttr !== null
      ? `Path=${path} as written`
      : `no usable Path attribute — default-path of ${url.path} is ${path}`));

  // 8. Partitioned (CHIPS) requires Secure; key is the requesting site.
  let partitionKey: string | null = null;
  if (cookie.partitioned) {
    const pass = cookie.secure;
    partitionKey = siteOf(url);
    checks.push(check("store.partitioned", "CHIPS draft §3", pass,
      pass
        ? `Partitioned cookie keyed to top-level site ${partitionKey} — invisible under any other top-level site`
        : "Partitioned requires the Secure attribute"));
    if (!pass) return reject();
  }

  // 9. Insecure origins cannot evict or shadow existing Secure cookies.
  if (!secureUrl && input.jar) {
    const shadowed = input.jar.list(now).find((existing) =>
      existing.secure &&
      existing.name === cookie.name &&
      (domainMatch(domain, existing.domain) || domainMatch(existing.domain, domain)) &&
      pathMatch(path, existing.path));
    const pass = shadowed === undefined;
    checks.push(check("store.secure-overwrite", "RFC 6265bis §5.7 step 11", pass,
      pass
        ? "no existing Secure cookie is shadowed by this insecure write"
        : `an insecure origin cannot overwrite the existing Secure cookie "${shadowed?.name}" (domain ${shadowed?.domain}, path ${shadowed?.path})`));
    if (!pass) return reject();
  }

  // 10. Non-HTTP APIs cannot replace an existing HttpOnly cookie either.
  if (api === "script" && input.jar) {
    const clash = input.jar.list(now).find((existing) =>
      existing.httpOnly && existing.name === cookie.name &&
      existing.domain === domain && existing.path === path);
    const pass = clash === undefined;
    checks.push(check("store.httponly-overwrite", "RFC 6265bis §5.7 step 10", pass,
      pass
        ? "no existing HttpOnly cookie is replaced by this document.cookie write"
        : "document.cookie cannot replace an existing HttpOnly cookie with the same name/domain/path"));
    if (!pass) return reject();
  }

  // 11. Lifetime: Max-Age beats Expires; both absent = session cookie.
  let persistent = false;
  let expiryTime: number | null = null;
  if (cookie.maxAge !== null) {
    persistent = true;
    expiryTime = cookie.maxAge <= 0 ? Number.MIN_SAFE_INTEGER : now + cookie.maxAge * 1000;
  } else if (cookie.expires !== null) {
    persistent = true;
    expiryTime = cookie.expires;
  }
  const deletion = persistent && expiryTime !== null && expiryTime <= now;
  checks.push(check("store.lifetime", "RFC 6265bis §5.7 step 4", true,
    !persistent
      ? "no Max-Age or Expires — a session cookie that dies with the browser session"
      : deletion
        ? "the expiry is already in the past — this write is a deletion of any matching cookie"
        : cookie.maxAge !== null
          ? `persistent via Max-Age=${cookie.maxAge}${cookie.expires !== null ? " (Max-Age wins over Expires)" : ""} — expires ${formatHttpDate(expiryTime ?? now)}`
          : `persistent via Expires — ${formatHttpDate(expiryTime ?? now)}`));

  const stored: StoredCookie = {
    name: cookie.name,
    value: cookie.value,
    domain,
    hostOnly,
    path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: same.value,
    defaulted: same.defaulted,
    partitionKey,
    persistent,
    expiryTime,
    creationSeq: creationCounter++,
  };
  return { verdict: "stored", checks, cookie: stored, deletion };
}
