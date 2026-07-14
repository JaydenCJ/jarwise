// The cookie-date algorithm (RFC 6265bis §5.1.1): deliberately forgiving
// about format, deliberately strict about ranges. These cases mirror the
// spec's own examples plus the classic serializer variants in the wild.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatHttpDate, parseCookieDate } from "../dist/index.js";

const IMF = Date.parse("1994-11-06T08:49:37Z");

test("IMF-fixdate parses: Sun, 06 Nov 1994 08:49:37 GMT", () => {
  assert.equal(parseCookieDate("Sun, 06 Nov 1994 08:49:37 GMT"), IMF);
});

test("the obsolete RFC 850 and asctime forms parse to the same instant", () => {
  assert.equal(parseCookieDate("Sunday, 06-Nov-94 08:49:37 GMT"), IMF);
  assert.equal(parseCookieDate("Sun Nov  6 08:49:37 1994"), IMF);
});

test("token order is irrelevant and trailing junk after digits is fine", () => {
  // year first, then time, then day-of-month with garbage, then month
  assert.equal(parseCookieDate("1994 08:49:37 6xyz Nov"), IMF);
});

test("two-digit years: 70-99 map to 19xx, 00-69 map to 20xx", () => {
  assert.equal(parseCookieDate("06 Nov 94 08:49:37"), IMF);
  assert.equal(parseCookieDate("01 Jan 69 00:00:00"), Date.parse("2069-01-01T00:00:00Z"));
  assert.equal(parseCookieDate("01 Jan 70 00:00:00"), Date.parse("1970-01-01T00:00:00Z"));
});

test("missing components and out-of-range fields fail the parse", () => {
  assert.equal(parseCookieDate("06 Nov 1994"), null); // no time
  assert.equal(parseCookieDate("Nov 1994 08:49:37"), null); // no day-of-month anywhere
  assert.equal(parseCookieDate("32 Nov 1994 08:49:37"), null); // day 32
  assert.equal(parseCookieDate("06 Nov 1994 24:00:00"), null); // hour 24
  assert.equal(parseCookieDate("06 Nov 1994 08:60:00"), null); // minute 60
  assert.equal(parseCookieDate("06 Nov 1600 08:49:37"), null); // year < 1601
});

test("month names match on the first three letters, case-insensitively", () => {
  assert.equal(parseCookieDate("06 NOVEMBER 1994 08:49:37"), IMF);
  assert.equal(parseCookieDate("06 novembro 1994 08:49:37"), IMF); // pt-BR serializer bug: "nov" still matches
});

test("formatHttpDate round-trips, including leap days and year boundaries", () => {
  const formatted = formatHttpDate(IMF);
  assert.equal(formatted, "Sun, 06 Nov 1994 08:49:37 GMT");
  assert.equal(parseCookieDate(formatted), IMF);
  assert.equal(formatHttpDate(Date.parse("2024-02-29T23:59:59Z")), "Thu, 29 Feb 2024 23:59:59 GMT");
  assert.equal(formatHttpDate(Date.parse("2026-01-01T00:00:00Z")), "Thu, 01 Jan 2026 00:00:00 GMT");
});
