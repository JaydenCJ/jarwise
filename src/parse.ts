/**
 * The RFC 6265bis §5.6 Set-Cookie parsing algorithm. Parsing never throws;
 * it either yields a SetCookie plus notes (things a browser silently did),
 * or a rejection with the reason a browser would drop the header outright.
 */
import { parseCookieDate } from "./date.js";
import type { Note, ParseResult, SameSite, SetCookie } from "./types.js";

/** Hard limit on name+value bytes; larger cookies are ignored entirely. */
export const MAX_NAME_VALUE_BYTES = 4096;
/** Hard limit on a single attribute value; larger attributes are ignored. */
export const MAX_ATTRIBUTE_BYTES = 1024;

const CTL_RE = /[\x00-\x08\x0a-\x1f\x7f]/;
// RFC 9110 token characters — cookie names outside this set still get
// stored by browsers, but are worth a warning.
const NON_TOKEN_RE = /[^!#$%&'*+\-.^_`|~0-9A-Za-z]/;

/** UTF-8 byte length without TextEncoder (keeps the lib surface tiny). */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function trimOws(s: string): string {
  return s.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
}

function note(level: Note["level"], id: string, ref: string, message: string): Note {
  return { level, id, ref, message };
}

/** Parse one Set-Cookie header value. */
export function parseSetCookie(header: string): ParseResult {
  const notes: Note[] = [];

  if (CTL_RE.test(header)) {
    return {
      ok: false,
      reason: "header contains a control character — browsers drop the whole Set-Cookie",
      notes: [note("error", "parse.ctl-char", "RFC 6265bis §5.6", "control characters (%x00-08, %x0A-1F, %x7F) anywhere in the header abort parsing")],
    };
  }

  const semicolon = header.indexOf(";");
  const nameValue = semicolon >= 0 ? header.slice(0, semicolon) : header;
  const attributeString = semicolon >= 0 ? header.slice(semicolon + 1) : "";

  let name: string;
  let value: string;
  const eq = nameValue.indexOf("=");
  if (eq < 0) {
    name = "";
    value = trimOws(nameValue);
    notes.push(note("warn", "parse.no-equals", "RFC 6265bis §5.6", `no "=" in "${nameValue.trim()}" — the whole string becomes the value of a nameless cookie`));
  } else {
    name = trimOws(nameValue.slice(0, eq));
    value = trimOws(nameValue.slice(eq + 1));
  }

  if (name === "" && value === "") {
    return {
      ok: false,
      reason: "both name and value are empty — browsers ignore the header",
      notes: [...notes, note("error", "parse.empty", "RFC 6265bis §5.6", "an empty name with an empty value is ignored entirely")],
    };
  }
  if (utf8Length(name) + utf8Length(value) > MAX_NAME_VALUE_BYTES) {
    return {
      ok: false,
      reason: `name+value exceed ${MAX_NAME_VALUE_BYTES} bytes — browsers ignore the header`,
      notes: [...notes, note("error", "parse.oversize", "RFC 6265bis §5.6", `name plus value is limited to ${MAX_NAME_VALUE_BYTES} bytes; this cookie is dropped, not truncated`)],
    };
  }
  if (name !== "" && NON_TOKEN_RE.test(name)) {
    notes.push(note("warn", "parse.name-token", "RFC 6265bis §4.1.1", `name "${name}" contains characters outside the token set — some servers and libraries will not round-trip it`));
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    notes.push(note("info", "parse.quoted-value", "RFC 6265bis §4.1.1", "the surrounding double quotes are part of the value and are stored and sent back verbatim"));
  }

  const cookie: SetCookie = {
    name,
    value,
    domainAttr: null,
    pathAttr: null,
    expires: null,
    maxAge: null,
    secure: false,
    httpOnly: false,
    sameSite: "Default",
    sameSiteRaw: null,
    partitioned: false,
    notes,
  };
  const seen = new Set<string>();

  for (const rawAv of attributeString.split(";")) {
    if (trimOws(rawAv) === "") continue;
    const avEq = rawAv.indexOf("=");
    const attrName = trimOws(avEq >= 0 ? rawAv.slice(0, avEq) : rawAv).toLowerCase();
    const attrValue = trimOws(avEq >= 0 ? rawAv.slice(avEq + 1) : "");
    if (utf8Length(attrValue) > MAX_ATTRIBUTE_BYTES) {
      notes.push(note("warn", "parse.attr-oversize", "RFC 6265bis §5.6", `${attrName} value exceeds ${MAX_ATTRIBUTE_BYTES} bytes — the attribute is ignored, the cookie itself survives`));
      continue;
    }
    if (seen.has(attrName)) {
      notes.push(note("info", "parse.duplicate-attr", "RFC 6265bis §5.6", `duplicate ${attrName} attribute — the later occurrence wins`));
    }
    seen.add(attrName);

    switch (attrName) {
      case "expires": {
        const parsed = parseCookieDate(attrValue);
        if (parsed === null) {
          notes.push(note("warn", "parse.expires-invalid", "RFC 6265bis §5.1.1", `Expires date "${attrValue}" does not parse under the cookie-date algorithm — the attribute is ignored (session cookie unless Max-Age says otherwise)`));
        } else {
          cookie.expires = parsed;
        }
        break;
      }
      case "max-age": {
        if (!/^-?\d+$/.test(attrValue)) {
          notes.push(note("warn", "parse.max-age-invalid", "RFC 6265bis §5.6.1", `Max-Age "${attrValue}" is not a valid integer — the attribute is ignored`));
        } else {
          cookie.maxAge = Number(attrValue);
        }
        break;
      }
      case "domain": {
        if (attrValue === "") {
          notes.push(note("warn", "parse.domain-empty", "RFC 6265bis §5.6.2", "empty Domain attribute — ignored; the cookie stays host-only"));
          break;
        }
        let domain = attrValue;
        if (domain.startsWith(".")) {
          domain = domain.slice(1);
          notes.push(note("info", "parse.domain-dot", "RFC 6265bis §5.6.2", `the leading dot in "${attrValue}" is stripped — ".site" and "site" mean the same thing since RFC 6265`));
        }
        cookie.domainAttr = domain.toLowerCase();
        break;
      }
      case "path": {
        if (attrValue === "" || !attrValue.startsWith("/")) {
          notes.push(note("info", "parse.path-default", "RFC 6265bis §5.6.4", `Path "${attrValue}" does not start with "/" — the default-path of the setting URL is used instead`));
          cookie.pathAttr = null;
        } else {
          cookie.pathAttr = attrValue;
        }
        break;
      }
      case "secure": {
        cookie.secure = true;
        if (attrValue !== "") notes.push(note("info", "parse.flag-value", "RFC 6265bis §5.6.5", `Secure takes no value — "=${attrValue}" is ignored`));
        break;
      }
      case "httponly": {
        cookie.httpOnly = true;
        if (attrValue !== "") notes.push(note("info", "parse.flag-value", "RFC 6265bis §5.6.6", `HttpOnly takes no value — "=${attrValue}" is ignored`));
        break;
      }
      case "samesite": {
        cookie.sameSiteRaw = attrValue;
        const lowered = attrValue.toLowerCase();
        const mapped: SameSite | null =
          lowered === "strict" ? "Strict" : lowered === "lax" ? "Lax" : lowered === "none" ? "None" : null;
        if (mapped === null) {
          cookie.sameSite = "Default";
          notes.push(note("warn", "parse.samesite-unknown", "RFC 6265bis §5.6.7", `SameSite "${attrValue}" is not Strict/Lax/None — browsers treat it as if SameSite were absent (Lax by default)`));
        } else {
          cookie.sameSite = mapped;
        }
        break;
      }
      case "partitioned": {
        cookie.partitioned = true;
        break;
      }
      default: {
        notes.push(note("info", "parse.unknown-attr", "RFC 6265bis §5.6", `unknown attribute "${attrName}" is ignored`));
      }
    }
  }

  return { ok: true, cookie };
}
