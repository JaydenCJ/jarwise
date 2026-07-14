// URL splitting plus the three matching primitives everything else is
// built on: domain-match, default-path, and path-match (RFC 6265bis §5.1).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultPath, domainMatch, parseUrl, pathMatch, secureContext } from "../dist/index.js";

test("parseUrl splits scheme/host/port/path and lowercases the host", () => {
  const r = parseUrl("HTTPS://App.Example.TEST:8443/Login?next=/x#frag");
  assert.equal(r.ok, true);
  assert.equal(r.url.scheme, "https");
  assert.equal(r.url.host, "app.example.test");
  assert.equal(r.url.port, 8443);
  assert.equal(r.url.path, "/Login"); // query and fragment stripped, case kept
  assert.equal(r.url.secure, true);
  // Defaults: port 80/443 by scheme, path "/" when absent.
  assert.equal(parseUrl("http://example.test").url.port, 80);
  assert.equal(parseUrl("http://example.test").url.path, "/");
  assert.equal(parseUrl("https://example.test").url.port, 443);
});

test("non-http schemes, userinfo and bad hosts are rejected with reasons", () => {
  assert.equal(parseUrl("ftp://example.test/").ok, false);
  assert.equal(parseUrl("example.test/no-scheme").ok, false);
  assert.equal(parseUrl("https://user:pw@example.test/").ok, false);
  assert.equal(parseUrl("https://exa mple.test/").ok, false);
  assert.equal(parseUrl("http://192.168.1.999/").ok, false); // IPv4 octet > 255
});

test("loopback origins are trustworthy even over http", () => {
  assert.equal(parseUrl("http://localhost:3000/").url.trustworthy, true);
  assert.equal(parseUrl("http://app.localhost/").url.trustworthy, true);
  assert.equal(parseUrl("http://127.0.0.1/").url.trustworthy, true);
  assert.equal(parseUrl("http://127.8.9.10/").url.trustworthy, true);
  assert.equal(parseUrl("http://128.0.0.1/").url.trustworthy, false);
  assert.equal(secureContext(parseUrl("http://localhost/").url), true);
  assert.equal(secureContext(parseUrl("http://example.test/").url), false);
});

test("IP literals are detected (IPv4 and bracketed IPv6)", () => {
  assert.equal(parseUrl("http://192.168.1.10/").url.ip, true);
  assert.equal(parseUrl("http://[::1]:8080/").url.ip, true);
  assert.equal(parseUrl("http://example.test/").url.ip, false);
});

test("domain-match: identical, or ends with .domain — never for IPs", () => {
  assert.equal(domainMatch("example.test", "example.test"), true);
  assert.equal(domainMatch("app.example.test", "example.test"), true);
  assert.equal(domainMatch("deep.app.example.test", "example.test"), true);
  assert.equal(domainMatch("example.test", "app.example.test"), false); // parent never matches child
  assert.equal(domainMatch("notexample.test", "example.test"), false); // suffix without a dot boundary
  assert.equal(domainMatch("10.0.0.1", "0.0.1"), false); // IPs never domain-match
});

test("default-path: directory of the request path, '/' when shallow", () => {
  assert.equal(defaultPath("/"), "/");
  assert.equal(defaultPath("/login"), "/");
  assert.equal(defaultPath("/account/settings"), "/account");
  assert.equal(defaultPath("/account/settings/"), "/account/settings");
  assert.equal(defaultPath(""), "/");
});

test("path-match: exact, trailing-slash prefix, or segment-boundary prefix", () => {
  assert.equal(pathMatch("/account", "/account"), true);
  assert.equal(pathMatch("/account/settings", "/account"), true);
  assert.equal(pathMatch("/account/settings", "/account/"), true);
  assert.equal(pathMatch("/accounting", "/account"), false); // not a segment boundary
  assert.equal(pathMatch("/", "/account"), false);
});
