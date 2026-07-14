// Public-suffix snapshot + registrable-domain + schemeful same-site.
// These decisions gate both Domain=... acceptance and every SameSite call.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isPublicSuffix, parseUrl, publicSuffix, registrableDomain, sameSiteUrls, siteOf } from "../dist/index.js";

const u = (raw) => parseUrl(raw).url;

test("multi-label registry suffixes are known: co.uk, co.jp, com.au", () => {
  assert.equal(publicSuffix("shop.example.co.uk"), "co.uk");
  assert.equal(publicSuffix("example.co.jp"), "co.jp");
  assert.equal(publicSuffix("example.com.au"), "com.au");
});

test("unknown TLDs fall back to 'last label is the suffix'", () => {
  assert.equal(publicSuffix("app.example.zz"), "zz");
  assert.equal(registrableDomain("app.example.zz"), "example.zz");
});

test("wildcard and exception rules: *.ck vs !www.ck", () => {
  assert.equal(publicSuffix("shop.acme.ck"), "acme.ck"); // *.ck: every label is a registry
  assert.equal(registrableDomain("shop.acme.ck"), "shop.acme.ck");
  assert.equal(publicSuffix("www.ck"), "ck"); // the exception carves www.ck back out
  assert.equal(registrableDomain("www.ck"), "www.ck");
});

test("private hosting suffixes isolate sibling customers: github.io", () => {
  assert.equal(registrableDomain("alice.github.io"), "alice.github.io");
  assert.equal(registrableDomain("bob.github.io"), "bob.github.io");
  assert.equal(sameSiteUrls(u("https://alice.github.io/"), u("https://bob.github.io/")), false);
});

test("a bare suffix has no registrable domain; IPs never do", () => {
  assert.equal(registrableDomain("co.uk"), null);
  assert.equal(registrableDomain("com"), null);
  assert.equal(registrableDomain("192.168.1.10"), null);
  assert.equal(isPublicSuffix("co.uk"), true);
  assert.equal(isPublicSuffix("example.co.uk"), false);
});

test("siteOf is scheme + registrable domain (schemeful same-site)", () => {
  assert.equal(siteOf(u("https://app.example.test/x")), "https://example.test");
  assert.equal(siteOf(u("https://192.168.1.10/x")), "https://192.168.1.10");
});

test("subdomains share a site; different domains and schemes do not", () => {
  assert.equal(sameSiteUrls(u("https://app.example.test/"), u("https://api.example.test/")), true);
  assert.equal(sameSiteUrls(u("https://example.test/"), u("https://other.test/")), false);
  // Schemeful: the http twin of an https site is cross-site.
  assert.equal(sameSiteUrls(u("http://example.test/"), u("https://example.test/")), false);
});
