/** Shared types for the whole simulator. Everything is a plain value. */

/** SameSite as written on the wire. `Default` = absent or unrecognized. */
export type SameSite = "Strict" | "Lax" | "None" | "Default";

/** SameSite as a compliant modern jar enforces it (`Default` becomes `Lax`). */
export type EffectiveSameSite = "Strict" | "Lax" | "None";

/** How the Set-Cookie reached the jar: an HTTP response or `document.cookie`. */
export type SetApi = "http" | "script";

/** What kind of request is being simulated. */
export type RequestKind = "navigation" | "subresource";

export type NoteLevel = "error" | "warn" | "info";

/** A parse- or lint-level observation with a stable id and an RFC pointer. */
export interface Note {
  level: NoteLevel;
  id: string;
  ref: string;
  message: string;
}

/** One evaluated rule inside a store/send decision trace. */
export interface Check {
  id: string;
  ref: string;
  pass: boolean;
  detail: string;
}

/** A Set-Cookie header after RFC 6265bis §5.6 parsing, before storage. */
export interface SetCookie {
  name: string;
  value: string;
  /** Domain attribute: lowercased, leading dot stripped; null when absent. */
  domainAttr: string | null;
  /** Path attribute; null when absent or not starting with "/". */
  pathAttr: string | null;
  /** Parsed Expires as epoch milliseconds; null when absent or unparsable. */
  expires: number | null;
  /** Max-Age in seconds; null when absent or invalid. */
  maxAge: number | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSite;
  /** Raw SameSite attribute value as written, when present. */
  sameSiteRaw: string | null;
  partitioned: boolean;
  notes: Note[];
}

export type ParseResult =
  | { ok: true; cookie: SetCookie }
  | { ok: false; reason: string; notes: Note[] };

/** A minimal, cookie-oriented view of a URL (query/fragment are irrelevant). */
export interface SiteUrl {
  raw: string;
  scheme: "http" | "https";
  host: string;
  port: number;
  path: string;
  /** Scheme is https. */
  secure: boolean;
  /** Loopback origins browsers treat as trustworthy even over http. */
  trustworthy: boolean;
  /** true when host is an IPv4 or bracketed IPv6 literal. */
  ip: boolean;
}

export type UrlResult = { ok: true; url: SiteUrl } | { ok: false; error: string };

/** Where a simulated request comes from. */
export type Initiator = SiteUrl | "address-bar";

/** A cookie as it lives in the jar after a successful store. */
export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: EffectiveSameSite;
  /** true when SameSite was absent/unrecognized and Lax was applied. */
  defaulted: boolean;
  /** CHIPS partition key (a site string) or null for unpartitioned cookies. */
  partitionKey: string | null;
  persistent: boolean;
  /** Absolute expiry, epoch ms; null for session cookies. */
  expiryTime: number | null;
  /** Monotonic insertion sequence; drives Cookie-header ordering. */
  creationSeq: number;
}

export interface StoreContext {
  /** Response belongs to a cross-site request. Default: same-site. */
  crossSite: boolean;
  /** Response belongs to a top-level navigation. Default: true. */
  topLevelNavigation: boolean;
}

export interface StoreInput {
  cookie: SetCookie;
  url: SiteUrl;
  api?: SetApi;
  context?: Partial<StoreContext>;
  /** Existing jar, for overwrite-protection rules. */
  jar?: JarLike;
  /** "Now" in epoch ms; injected so every run is deterministic. */
  now: number;
}

export interface StoreResult {
  verdict: "stored" | "rejected";
  checks: Check[];
  /** Present when verdict is "stored". */
  cookie?: StoredCookie;
  /** Stored, but the expiry is already in the past: this is a deletion. */
  deletion: boolean;
}

/** The jar surface store/send need; the concrete class lives in jar.ts. */
export interface JarLike {
  list(now: number): StoredCookie[];
}

export interface SendInput {
  jar: JarLike;
  url: SiteUrl;
  from?: Initiator;
  kind?: RequestKind;
  method?: string;
  now: number;
  /**
   * Override the computed same-site verdict. The redirect simulator uses
   * this to inject chain taint, which a single (from, url) pair cannot see.
   */
  forceSameSite?: boolean;
}

export interface CookieSendDecision {
  cookie: StoredCookie;
  sent: boolean;
  checks: Check[];
}

export interface SendResult {
  /** The request was same-site (schemeful) with its initiator. */
  sameSiteRequest: boolean;
  kind: RequestKind;
  method: string;
  decisions: CookieSendDecision[];
  /** Cookies attached, in RFC 6265bis §5.8.3 order. */
  sent: StoredCookie[];
  /** The Cookie header value, or null when nothing is attached. */
  header: string | null;
}

/** One hop of a redirect-chain scenario. */
export interface Hop {
  url: string;
  status?: number;
  setCookies?: string[];
}

/** Pre-populate the jar before the chain runs (a previous login, say). */
export interface Seed {
  url: string;
  setCookie: string;
}

export interface Scenario {
  initiator?: string;
  kind?: RequestKind;
  method?: string;
  seed?: Seed[];
  chain: Hop[];
  expect?: string[];
}

export interface HopReport {
  index: number;
  url: SiteUrl;
  method: string;
  sameSiteRequest: boolean;
  send: SendResult;
  stores: { header: string; result: StoreResult | { verdict: "rejected"; checks: Check[]; deletion: false }; parseError: string | null }[];
}

export interface TraceResult {
  kind: RequestKind;
  initiator: Initiator;
  hops: HopReport[];
  finalJar: StoredCookie[];
  /** Per expected cookie name: was it sent on the final hop? */
  expectations: { name: string; sent: boolean }[];
}
