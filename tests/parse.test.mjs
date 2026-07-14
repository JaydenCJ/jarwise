// Set-Cookie parsing: the RFC 6265bis §5.6 algorithm, including the
// forgiving/rejecting edges that surprise people (nameless cookies,
// control characters, size limits, attribute salvage).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseSetCookie, MAX_NAME_VALUE_BYTES } from "../dist/index.js";

test("a plain name=value pair parses; outer whitespace trims, inner stays", () => {
  const result = parseSetCookie("sid=abc123");
  assert.equal(result.ok, true);
  assert.equal(result.cookie.name, "sid");
  assert.equal(result.cookie.value, "abc123");
  assert.equal(result.cookie.secure, false);
  assert.equal(result.cookie.sameSite, "Default");
  const spaced = parseSetCookie("  sid =  a b c  ; Secure");
  assert.equal(spaced.cookie.name, "sid");
  assert.equal(spaced.cookie.value, "a b c");
  assert.equal(spaced.cookie.secure, true);
});

test("no '=' means a nameless cookie; empty name AND value is rejected", () => {
  const result = parseSetCookie("justavalue");
  assert.equal(result.ok, true);
  assert.equal(result.cookie.name, "");
  assert.equal(result.cookie.value, "justavalue");
  assert.ok(result.cookie.notes.some((n) => n.id === "parse.no-equals"));
  const empty = parseSetCookie("=; Secure");
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /empty/);
});

test("control characters anywhere abort the whole header", () => {
  const result = parseSetCookie("sid=abc\x01; Path=/");
  assert.equal(result.ok, false);
  assert.match(result.reason, /control character/);
});

test("size limits: >4096B name+value drops the cookie; >1024B drops the attribute", () => {
  const big = parseSetCookie(`big=${"x".repeat(MAX_NAME_VALUE_BYTES)}`);
  assert.equal(big.ok, false);
  assert.match(big.reason, /4096/);
  const attr = parseSetCookie(`sid=abc; Path=/${"p".repeat(1100)}`);
  assert.equal(attr.ok, true); // the cookie itself survives
  assert.equal(attr.cookie.pathAttr, null);
  assert.ok(attr.cookie.notes.some((n) => n.id === "parse.attr-oversize"));
});

test("attribute names are case-insensitive; Domain lowercases, dot strips", () => {
  const result = parseSetCookie("sid=abc; SECURE; httponly; sameSITE=lax; DOMAIN=.Example.Test; path=/x");
  const c = result.cookie;
  assert.equal(c.secure, true);
  assert.equal(c.httpOnly, true);
  assert.equal(c.sameSite, "Lax");
  assert.equal(c.domainAttr, "example.test"); // lowercased, leading dot stripped
  assert.equal(c.pathAttr, "/x");
  assert.ok(c.notes.some((n) => n.id === "parse.domain-dot"));
});

test("a Path that does not start with '/' falls back to the default-path", () => {
  const result = parseSetCookie("sid=abc; Path=relative/thing");
  assert.equal(result.cookie.pathAttr, null);
  assert.ok(result.cookie.notes.some((n) => n.id === "parse.path-default"));
});

test("bad attribute values salvage: Max-Age junk and unknown SameSite are ignored", () => {
  assert.equal(parseSetCookie("a=b; Max-Age=3600").cookie.maxAge, 3600);
  assert.equal(parseSetCookie("a=b; Max-Age=-1").cookie.maxAge, -1);
  const junk = parseSetCookie("a=b; Max-Age=1h");
  assert.equal(junk.cookie.maxAge, null);
  assert.ok(junk.cookie.notes.some((n) => n.id === "parse.max-age-invalid"));
  const sorta = parseSetCookie("a=b; SameSite=Sorta");
  assert.equal(sorta.cookie.sameSite, "Default"); // as if SameSite were absent
  assert.equal(sorta.cookie.sameSiteRaw, "Sorta");
  assert.ok(sorta.cookie.notes.some((n) => n.id === "parse.samesite-unknown"));
});

test("duplicates: later wins; unknown attributes are ignored but noted", () => {
  const dup = parseSetCookie("a=b; Path=/one; Path=/two");
  assert.equal(dup.cookie.pathAttr, "/two");
  assert.ok(dup.cookie.notes.some((n) => n.id === "parse.duplicate-attr"));
  const unknown = parseSetCookie("a=b; Version=1; Comment=old-rfc2109");
  assert.equal(unknown.ok, true);
  assert.equal(unknown.cookie.notes.filter((n) => n.id === "parse.unknown-attr").length, 2);
});

test("quoted values keep their quotes; non-token names warn, not reject", () => {
  const quoted = parseSetCookie('a="quoted"');
  assert.equal(quoted.cookie.value, '"quoted"'); // round-trips to the server verbatim
  assert.ok(quoted.cookie.notes.some((n) => n.id === "parse.quoted-value"));
  const weird = parseSetCookie("weird name=1");
  assert.equal(weird.ok, true);
  assert.ok(weird.cookie.notes.some((n) => n.id === "parse.name-token"));
});
