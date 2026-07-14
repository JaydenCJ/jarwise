/**
 * A compact, embedded snapshot of the Public Suffix List — enough to make
 * registrable-domain and same-site decisions realistic for the hosts that
 * show up in day-to-day debugging. Unknown multi-label suffixes fall back
 * to "the last label is the public suffix", exactly like a browser with an
 * empty PSL would behave. The snapshot is data, not policy: swapping in a
 * fuller list is a one-array change (see the roadmap).
 */
import { isIpv4 } from "./siteurl.js";
import type { SiteUrl } from "./types.js";

/**
 * Rules use PSL syntax: plain suffixes, `*.` wildcards (match exactly one
 * extra label) and `!` exceptions (beat a wildcard). Snapshot 2026-07.
 */
const RULES: string[] = [
  // ccTLD second-level registries (the ones that break naive eTLD+1 logic)
  "ac.jp", "ad.jp", "co.jp", "ed.jp", "go.jp", "gr.jp", "lg.jp", "ne.jp", "or.jp",
  "ac.uk", "co.uk", "gov.uk", "ltd.uk", "me.uk", "net.uk", "org.uk", "plc.uk", "sch.uk",
  "asn.au", "com.au", "edu.au", "gov.au", "id.au", "net.au", "org.au",
  "ac.nz", "co.nz", "govt.nz", "net.nz", "org.nz",
  "co.in", "firm.in", "gen.in", "ind.in", "net.in", "org.in",
  "com.br", "gov.br", "net.br", "org.br",
  "ac.cn", "com.cn", "edu.cn", "gov.cn", "net.cn", "org.cn",
  "ac.kr", "co.kr", "go.kr", "ne.kr", "or.kr", "re.kr",
  "com.tw", "edu.tw", "gov.tw", "net.tw", "org.tw",
  "com.hk", "edu.hk", "gov.hk", "net.hk", "org.hk",
  "com.sg", "edu.sg", "gov.sg", "net.sg", "org.sg",
  "com.mx", "edu.mx", "gob.mx", "net.mx", "org.mx",
  "co.za", "gov.za", "net.za", "org.za", "web.za",
  "com.ar", "net.ar", "org.ar",
  "com.tr", "net.tr", "org.tr",
  "ac.il", "co.il", "gov.il", "net.il", "org.il",
  "com.pl", "net.pl", "org.pl",
  // wildcard + exception, to keep the matcher honest
  "*.ck", "!www.ck",
  // private-section hosting suffixes where sibling customers must be cross-site
  "github.io", "githubusercontent.com", "gitlab.io",
  "herokuapp.com", "netlify.app", "vercel.app",
  "pages.dev", "workers.dev", "web.app", "firebaseapp.com", "appspot.com",
  "blogspot.com", "azurewebsites.net", "cloudfront.net", "s3.amazonaws.com",
  "elasticbeanstalk.com", "fly.dev", "onrender.com", "surge.sh", "glitch.me",
  // reserved documentation/test suffixes used throughout the examples
  "example", "invalid", "test", "localhost",
];

interface Rule {
  labels: string[];
  exception: boolean;
}

const PARSED: Rule[] = RULES.map((raw) => {
  const exception = raw.startsWith("!");
  const body = exception ? raw.slice(1) : raw;
  return { labels: body.split("."), exception };
});

/** Does `rule` match `hostLabels` (right-aligned, `*` eats one label)? */
function ruleMatches(rule: Rule, hostLabels: string[]): boolean {
  if (rule.labels.length > hostLabels.length) return false;
  for (let i = 1; i <= rule.labels.length; i++) {
    const ruleLabel = rule.labels[rule.labels.length - i];
    const hostLabel = hostLabels[hostLabels.length - i];
    if (ruleLabel !== "*" && ruleLabel !== hostLabel) return false;
  }
  return true;
}

/**
 * The public suffix of `host` per PSL semantics: prevailing rule is the
 * matching exception (minus its first label) or the longest match; with no
 * match at all, the last label.
 */
export function publicSuffix(host: string): string {
  const labels = host.split(".");
  let best: Rule | null = null;
  for (const rule of PARSED) {
    if (!ruleMatches(rule, labels)) continue;
    if (rule.exception) {
      // An exception rule's suffix is the rule with its leftmost label removed.
      return rule.labels.slice(1).join(".");
    }
    if (best === null || rule.labels.length > best.labels.length) best = rule;
  }
  const size = best ? best.labels.length : 1;
  return labels.slice(labels.length - size).join(".");
}

/**
 * The registrable domain (eTLD+1) of `host`, or null when the host *is* a
 * public suffix or an IP literal (IPs have no registrable domain).
 */
export function registrableDomain(host: string): string | null {
  if (isIpv4(host) || host.startsWith("[")) return null;
  const suffix = publicSuffix(host);
  if (host === suffix) return null;
  const suffixLabels = suffix.split(".").length;
  const labels = host.split(".");
  if (labels.length < suffixLabels + 1) return null;
  return labels.slice(labels.length - suffixLabels - 1).join(".");
}

/** true when `host` is itself a public suffix (Domain=com is forbidden). */
export function isPublicSuffix(host: string): boolean {
  return !isIpv4(host) && !host.startsWith("[") && publicSuffix(host) === host;
}

/**
 * The "site" of a URL for SameSite purposes: scheme + registrable domain
 * (schemeful same-site, the modern-browser behavior). IP hosts and bare
 * suffixes use the host itself.
 */
export function siteOf(url: SiteUrl): string {
  return `${url.scheme}://${registrableDomain(url.host) ?? url.host}`;
}

/** Schemeful same-site comparison of two URLs. */
export function sameSiteUrls(a: SiteUrl, b: SiteUrl): boolean {
  return siteOf(a) === siteOf(b);
}
