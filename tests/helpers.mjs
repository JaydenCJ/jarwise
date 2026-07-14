// Shared factories for the test suite. Everything is deterministic and
// in-memory; only cli.test.mjs spawns a process, against its own temp dir.
import { Jar, decideSend, decideStore, parseSetCookie, parseUrl } from "../dist/index.js";

/** A fixed "now": 2026-07-13T12:00:00Z. Every test anchors to this clock. */
export const NOW = Date.parse("2026-07-13T12:00:00Z");

/** Parse a URL or throw (tests only use valid URLs unless testing errors). */
export function su(raw) {
  const parsed = parseUrl(raw);
  if (!parsed.ok) throw new Error(`test URL invalid: ${parsed.error}`);
  return parsed.url;
}

/** Parse a Set-Cookie header or throw. */
export function sc(header) {
  const parsed = parseSetCookie(header);
  if (!parsed.ok) throw new Error(`test cookie invalid: ${parsed.reason}`);
  return parsed.cookie;
}

/** Run the storage model for a header received at a URL. */
export function storeAt(url, header, options = {}) {
  return decideStore({ cookie: sc(header), url: su(url), now: NOW, ...options });
}

/** A jar seeded with [url, header] pairs (all must store successfully). */
export function jarWith(...seeds) {
  const jar = new Jar();
  for (const [url, header] of seeds) {
    const result = storeAt(url, header, { jar });
    if (result.verdict !== "stored") {
      throw new Error(`seed rejected: ${header} @ ${url}`);
    }
    jar.apply(result);
  }
  return jar;
}

/** Which cookie names get attached to a request. */
export function sentNames(jar, url, options = {}) {
  const result = decideSend({ jar, url: su(url), now: NOW, ...options });
  return result.sent.map((c) => c.name);
}

/** The ids of failed checks in a decision trace. */
export function failedIds(result) {
  const checks = result.checks ?? result;
  return checks.filter((c) => !c.pass).map((c) => c.id);
}
