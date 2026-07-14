/**
 * A deliberately small URL splitter for the parts cookies care about:
 * scheme, host, port and path. Query strings and fragments never influence
 * a cookie decision, so they are stripped. Only http/https are accepted —
 * that keeps every downstream rule honest about what it models.
 */
import type { SiteUrl, UrlResult } from "./types.js";

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.?$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_RE = /^\[[0-9a-f:]+\]$/;

/** true when `host` is a syntactically valid dotted-quad IPv4 literal. */
export function isIpv4(host: string): boolean {
  const m = IPV4_RE.exec(host);
  if (!m) return false;
  return m.slice(1).every((part) => Number(part) <= 255);
}

/** Loopback origins that user agents treat as trustworthy over plain http. */
function isTrustworthyHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]") return true;
  const m = IPV4_RE.exec(host);
  return m !== null && Number(m[1]) === 127 && isIpv4(host);
}

/** Parse an absolute http/https URL into the cookie-relevant parts. */
export function parseUrl(raw: string): UrlResult {
  const trimmed = raw.trim();
  const schemeMatch = SCHEME_RE.exec(trimmed);
  if (!schemeMatch || schemeMatch[1] === undefined) {
    return { ok: false, error: `not an absolute URL: "${raw}" (expected http:// or https://)` };
  }
  const scheme = schemeMatch[1].toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return { ok: false, error: `unsupported scheme "${scheme}:" — jarwise models http and https only` };
  }
  let rest = trimmed.slice(schemeMatch[0].length);
  // Strip query and fragment: they never take part in a cookie decision.
  const cut = rest.search(/[?#]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  const slash = rest.indexOf("/");
  const authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const path = slash >= 0 ? rest.slice(slash) : "/";
  if (authority.includes("@")) {
    return { ok: false, error: `userinfo in URL is not supported: "${raw}"` };
  }
  let hostPart = authority;
  let port = scheme === "https" ? 443 : 80;
  // Bracketed IPv6 keeps its brackets as the canonical host form.
  const portMatch = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(authority);
  if (!portMatch || portMatch[1] === undefined) {
    return { ok: false, error: `cannot parse authority "${authority}"` };
  }
  hostPart = portMatch[1];
  if (portMatch[2] !== undefined) {
    port = Number(portMatch[2]);
    if (port < 1 || port > 65535) return { ok: false, error: `port out of range: ${portMatch[2]}` };
  }
  const host = hostPart.toLowerCase();
  if (host.length === 0) return { ok: false, error: `empty host in "${raw}"` };
  const ip = isIpv4(host) || IPV6_RE.test(host);
  if (!ip && IPV4_RE.test(host)) {
    return { ok: false, error: `invalid IPv4 literal "${host}" (an octet exceeds 255)` };
  }
  if (!ip && !HOST_RE.test(host)) {
    return { ok: false, error: `invalid host "${host}" (ASCII hostnames only; punycode non-ASCII names first)` };
  }
  const secure = scheme === "https";
  return {
    ok: true,
    url: {
      raw: trimmed,
      scheme,
      host: host.endsWith(".") && !ip ? host.slice(0, -1) : host,
      port,
      path: path === "" ? "/" : path,
      secure,
      trustworthy: isTrustworthyHost(host),
      ip,
    },
  };
}

/** true when the origin may receive/emit Secure cookies (https or loopback). */
export function secureContext(url: SiteUrl): boolean {
  return url.secure || url.trustworthy;
}

/**
 * RFC 6265bis §5.1.3 domain matching: `host` matches `domain` when they are
 * identical, or when `host` ends with `.domain` and `host` is not an IP.
 */
export function domainMatch(host: string, domain: string): boolean {
  if (host === domain) return true;
  if (isIpv4(host) || IPV6_RE.test(host)) return false;
  return host.endsWith(domain) && host.charAt(host.length - domain.length - 1) === ".";
}

/**
 * RFC 6265bis §5.1.4 default-path: everything up to (excluding) the last "/"
 * of the request path, or "/" when that leaves nothing.
 */
export function defaultPath(uriPath: string): string {
  if (uriPath.length === 0 || !uriPath.startsWith("/")) return "/";
  const lastSlash = uriPath.lastIndexOf("/");
  if (lastSlash === 0) return "/";
  return uriPath.slice(0, lastSlash);
}

/**
 * RFC 6265bis §5.1.4 path matching: identical, or cookie-path is a prefix
 * that either ends in "/" or is followed by "/" in the request path.
 */
export function pathMatch(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith("/")) return true;
  return requestPath.charAt(cookiePath.length) === "/";
}
