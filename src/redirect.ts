/**
 * Redirect-chain simulation: the "why did my login loop?" engine. A
 * scenario is an initiator plus an ordered chain of hops; each hop first
 * receives the cookies the jar is willing to send, then applies its
 * Set-Cookie headers under that hop's same-site context. Two behaviors
 * matter and are modeled explicitly:
 *
 *  - Method rewriting: 301/302/303 turn a POST into a GET for the next
 *    hop (so a Lax cookie missing on the POST reappears after the 303).
 *  - Redirect taint: a subresource request is only same-site if the
 *    initiator AND every URL in the chain so far share one site — one
 *    cross-site bounce taints the rest of the chain.
 *
 * Top-level navigations keep comparing against the original initiator,
 * which is exactly how browsers treat address-bar and link navigations.
 */
import { Jar } from "./jar.js";
import { sameSiteUrls } from "./psl.js";
import { parseSetCookie } from "./parse.js";
import { decideSend } from "./send.js";
import { decideStore } from "./store.js";
import { parseUrl } from "./siteurl.js";
import type {
  HopReport,
  Initiator,
  RequestKind,
  Scenario,
  SiteUrl,
  TraceResult,
} from "./types.js";

/** Thrown for malformed scenarios; the CLI maps it to exit code 2. */
export class ScenarioError extends Error {}

function parseHopUrl(raw: string, index: number): SiteUrl {
  const parsed = parseUrl(raw);
  if (!parsed.ok) throw new ScenarioError(`chain[${index}].url: ${parsed.error}`);
  return parsed.url;
}

/** Validate a decoded JSON value into a Scenario. */
export function validateScenario(value: unknown): Scenario {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScenarioError("scenario must be a JSON object");
  }
  const obj = value as Record<string, unknown>;
  const chain = obj["chain"];
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new ScenarioError('scenario needs a non-empty "chain" array');
  }
  const kind = obj["kind"] ?? "navigation";
  if (kind !== "navigation" && kind !== "subresource") {
    throw new ScenarioError(`"kind" must be "navigation" or "subresource", got ${JSON.stringify(kind)}`);
  }
  const scenario: Scenario = { chain: [], kind: kind as RequestKind };
  if (obj["initiator"] !== undefined) {
    if (typeof obj["initiator"] !== "string") throw new ScenarioError('"initiator" must be a URL string or "address-bar"');
    scenario.initiator = obj["initiator"];
  }
  if (obj["method"] !== undefined) {
    if (typeof obj["method"] !== "string") throw new ScenarioError('"method" must be a string');
    scenario.method = obj["method"];
  }
  if (obj["seed"] !== undefined) {
    const seed = obj["seed"];
    if (!Array.isArray(seed)) throw new ScenarioError('"seed" must be an array');
    scenario.seed = seed.map((entry, i) => {
      if (typeof entry !== "object" || entry === null) throw new ScenarioError(`seed[${i}] must be an object`);
      const e = entry as Record<string, unknown>;
      if (typeof e["url"] !== "string" || typeof e["setCookie"] !== "string") {
        throw new ScenarioError(`seed[${i}] needs string "url" and "setCookie" fields`);
      }
      return { url: e["url"], setCookie: e["setCookie"] };
    });
  }
  if (obj["expect"] !== undefined) {
    if (!Array.isArray(obj["expect"]) || !obj["expect"].every((e) => typeof e === "string")) {
      throw new ScenarioError('"expect" must be an array of cookie names');
    }
    scenario.expect = obj["expect"] as string[];
  }
  chain.forEach((hop, i) => {
    if (typeof hop !== "object" || hop === null) throw new ScenarioError(`chain[${i}] must be an object`);
    const h = hop as Record<string, unknown>;
    if (typeof h["url"] !== "string") throw new ScenarioError(`chain[${i}].url must be a string`);
    const out: Scenario["chain"][number] = { url: h["url"] };
    if (h["status"] !== undefined) {
      if (typeof h["status"] !== "number") throw new ScenarioError(`chain[${i}].status must be a number`);
      out.status = h["status"];
    }
    const setCookies = h["setCookies"];
    if (setCookies !== undefined) {
      if (!Array.isArray(setCookies) || !setCookies.every((s) => typeof s === "string")) {
        throw new ScenarioError(`chain[${i}].setCookies must be an array of Set-Cookie strings`);
      }
      out.setCookies = setCookies as string[];
    }
    scenario.chain.push(out);
  });
  return scenario;
}

/** Run a scenario against a fresh (or provided) jar. */
export function runTrace(scenario: Scenario, now: number, jar: Jar = new Jar()): TraceResult {
  const kind: RequestKind = scenario.kind ?? "navigation";
  let initiator: Initiator = "address-bar";
  if (scenario.initiator !== undefined && scenario.initiator !== "address-bar") {
    const parsed = parseUrl(scenario.initiator);
    if (!parsed.ok) throw new ScenarioError(`initiator: ${parsed.error}`);
    initiator = parsed.url;
  }

  // Seeds model cookies that already exist (a previous same-site login).
  for (const [i, seed] of (scenario.seed ?? []).entries()) {
    const parsedUrl = parseUrl(seed.url);
    if (!parsedUrl.ok) throw new ScenarioError(`seed[${i}].url: ${parsedUrl.error}`);
    const parsedCookie = parseSetCookie(seed.setCookie);
    if (!parsedCookie.ok) throw new ScenarioError(`seed[${i}].setCookie: ${parsedCookie.reason}`);
    jar.apply(decideStore({ cookie: parsedCookie.cookie, url: parsedUrl.url, now, jar }));
  }

  const urls = scenario.chain.map((hop, i) => parseHopUrl(hop.url, i));
  let method = (scenario.method ?? "GET").toUpperCase();
  const hops: HopReport[] = [];
  // For subresources: does {initiator, url_0..url_i} still share one site?
  let chainUntainted = true;

  for (let i = 0; i < scenario.chain.length; i++) {
    const hop = scenario.chain[i];
    const url = urls[i];
    if (hop === undefined || url === undefined) continue;

    let sameSiteRequest: boolean;
    if (kind === "navigation") {
      // Navigation hops keep comparing against the original initiator.
      sameSiteRequest = initiator === "address-bar" ? true : sameSiteUrls(initiator, url);
    } else {
      // Subresource: same-site only while the whole chain shares one site.
      const reference = initiator === "address-bar" ? urls[0] : initiator;
      chainUntainted = chainUntainted && reference !== undefined && sameSiteUrls(reference, url);
      sameSiteRequest = chainUntainted;
    }

    const send = decideSend({ jar, url, from: initiator, kind, method, now, forceSameSite: sameSiteRequest });

    const stores: HopReport["stores"] = [];
    for (const header of hop.setCookies ?? []) {
      const parsed = parseSetCookie(header);
      if (!parsed.ok) {
        stores.push({
          header,
          result: { verdict: "rejected", checks: [{ id: "parse", ref: "RFC 6265bis §5.6", pass: false, detail: parsed.reason }], deletion: false },
          parseError: parsed.reason,
        });
        continue;
      }
      const result = decideStore({
        cookie: parsed.cookie,
        url,
        now,
        jar,
        context: { crossSite: !sameSiteRequest, topLevelNavigation: kind === "navigation" },
      });
      jar.apply(result);
      stores.push({ header, result, parseError: null });
    }

    hops.push({ index: i, url, method, sameSiteRequest, send, stores });

    // Method rewriting for the next hop.
    const status = hop.status ?? (i < scenario.chain.length - 1 ? 302 : 200);
    if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
      method = "GET";
    }
  }

  const finalHop = hops[hops.length - 1];
  const expectations = (scenario.expect ?? []).map((name) => ({
    name,
    sent: finalHop !== undefined && finalHop.send.sent.some((c) => c.name === name),
  }));

  return { kind, initiator, hops, finalJar: jar.list(now), expectations };
}
