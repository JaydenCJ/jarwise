/**
 * jarwise public API. Everything the CLI does is available as pure
 * functions over plain values: parse a Set-Cookie header, run the storage
 * model, run the retrieval algorithm, or simulate a whole redirect chain.
 */
export { parseSetCookie, utf8Length, MAX_NAME_VALUE_BYTES, MAX_ATTRIBUTE_BYTES } from "./parse.js";
export { parseCookieDate, formatHttpDate } from "./date.js";
export { parseUrl, domainMatch, pathMatch, defaultPath, secureContext, isIpv4 } from "./siteurl.js";
export { publicSuffix, registrableDomain, isPublicSuffix, siteOf, sameSiteUrls } from "./psl.js";
export { decideStore, effectiveSameSite, resetCreationSeq } from "./store.js";
export { decideSend } from "./send.js";
export { Jar } from "./jar.js";
export { runTrace, validateScenario, ScenarioError } from "./redirect.js";
export { explainSetCookie } from "./explain.js";
export type { AttributeRow, ExplainResult } from "./explain.js";
export {
  renderExplainText, renderStoreText, renderSendText, renderTraceText,
  jsonExplain, jsonStore, jsonSend, jsonTrace,
} from "./report.js";
export { VERSION } from "./version.js";
export type {
  Check,
  CookieSendDecision,
  EffectiveSameSite,
  Hop,
  HopReport,
  Initiator,
  JarLike,
  Note,
  NoteLevel,
  ParseResult,
  RequestKind,
  SameSite,
  Scenario,
  Seed,
  SendInput,
  SendResult,
  SetApi,
  SetCookie,
  SiteUrl,
  StoreContext,
  StoredCookie,
  StoreInput,
  StoreResult,
  TraceResult,
  UrlResult,
} from "./types.js";
