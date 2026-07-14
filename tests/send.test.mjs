// The retrieval algorithm (RFC 6265bis §5.8.3): which cookies ride on a
// request. This is where SameSite, Secure and scoping actually bite.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decideSend } from "../dist/index.js";
import { jarWith, NOW, sentNames, su } from "./helpers.mjs";

const APP = "https://app.example.test/";

test("host-only cookies stay on their exact host — subdomains excluded", () => {
  const jar = jarWith([APP, "sid=abc"]);
  assert.deepEqual(sentNames(jar, "https://app.example.test/page"), ["sid"]);
  assert.deepEqual(sentNames(jar, "https://api.example.test/page"), []);
  assert.deepEqual(sentNames(jar, "https://example.test/page"), []);
});

test("Domain cookies flow to the parent and every sibling under it", () => {
  const jar = jarWith([APP, "sid=abc; Domain=example.test"]);
  assert.deepEqual(sentNames(jar, "https://example.test/"), ["sid"]);
  assert.deepEqual(sentNames(jar, "https://api.example.test/"), ["sid"]);
  assert.deepEqual(sentNames(jar, "https://deep.api.example.test/"), ["sid"]);
  assert.deepEqual(sentNames(jar, "https://other.test/"), []);
});

test("path scoping: /account cookies skip / and /accounting", () => {
  const jar = jarWith(["https://app.example.test/account/settings", "pref=1"]);
  // default-path of /account/settings is /account
  assert.deepEqual(sentNames(jar, "https://app.example.test/account"), ["pref"]);
  assert.deepEqual(sentNames(jar, "https://app.example.test/account/billing"), ["pref"]);
  assert.deepEqual(sentNames(jar, "https://app.example.test/"), []);
  assert.deepEqual(sentNames(jar, "https://app.example.test/accounting"), []);
});

test("Secure cookies never ride plain http — except trustworthy loopback", () => {
  const jar = jarWith([APP, "sid=abc; Secure"]);
  assert.deepEqual(sentNames(jar, "http://app.example.test/"), []);
  assert.deepEqual(sentNames(jar, "https://app.example.test/"), ["sid"]);
  const dev = jarWith(["http://localhost:3000/", "dev=1; Secure"]);
  assert.deepEqual(sentNames(dev, "http://localhost:3000/api"), ["dev"]);
});

test("SameSite=Strict: same-site only; cross-site link clicks arrive bare", () => {
  const jar = jarWith([APP, "sid=abc; Secure; SameSite=Strict"]);
  assert.deepEqual(sentNames(jar, APP, { from: su("https://api.example.test/") }), ["sid"]);
  assert.deepEqual(sentNames(jar, APP, { from: su("https://news.example/"), kind: "navigation" }), []);
  // Address-bar requests are same-site by definition (and the default).
  assert.deepEqual(sentNames(jar, APP, { from: "address-bar" }), ["sid"]);
  assert.deepEqual(sentNames(jar, APP), ["sid"]);
});

test("SameSite=Lax: cross-site GET navigations yes, POST navigations no", () => {
  const jar = jarWith([APP, "sid=abc; Secure; SameSite=Lax"]);
  const from = su("https://news.example/");
  assert.deepEqual(sentNames(jar, APP, { from, kind: "navigation", method: "GET" }), ["sid"]);
  assert.deepEqual(sentNames(jar, APP, { from, kind: "navigation", method: "POST" }), []);
});

test("SameSite=Lax blocks all cross-site subresources (fetch/img/iframe)", () => {
  const jar = jarWith([APP, "sid=abc; Secure; SameSite=Lax"]);
  const from = su("https://news.example/");
  assert.deepEqual(sentNames(jar, APP, { from, kind: "subresource", method: "GET" }), []);
});

test("SameSite=None rides every cross-site request", () => {
  const jar = jarWith([APP, "sid=abc; Secure; SameSite=None"]);
  const from = su("https://news.example/");
  assert.deepEqual(sentNames(jar, APP, { from, kind: "subresource", method: "POST" }), ["sid"]);
});

test("no SameSite attribute is enforced as Lax (defaulted)", () => {
  const jar = jarWith([APP, "sid=abc"]);
  const from = su("https://news.example/");
  assert.deepEqual(sentNames(jar, APP, { from, kind: "subresource" }), []);
  const result = decideSend({ jar, url: su(APP), from, kind: "subresource", now: NOW });
  const samesite = result.decisions[0].checks.find((c) => c.id === "send.samesite");
  assert.match(samesite.detail, /defaulted/);
});

test("schemeful same-site: http://site is cross-site to its https twin", () => {
  const jar = jarWith([APP, "sid=abc; Secure; SameSite=Strict"]);
  assert.deepEqual(sentNames(jar, APP, { from: su("http://app.example.test/") }), []);
});

test("expired cookies are invisible to retrieval", () => {
  const jar = jarWith([APP, "gone=1; Max-Age=60"], [APP, "kept=1; Max-Age=7200"]);
  const later = NOW + 3600_000;
  const result = decideSend({ jar, url: su(APP), now: later });
  assert.deepEqual(result.sent.map((c) => c.name), ["kept"]);
});

test("Cookie header ordering: longer paths first, then older cookies", () => {
  const jar = jarWith(
    [`${APP}deep/nested/page`, "b=2; Path=/deep/nested"],
    [APP, "a=1; Path=/"],
    [APP, "c=3; Path=/deep"],
  );
  const result = decideSend({ jar, url: su(`${APP}deep/nested/page`), now: NOW });
  assert.equal(result.header, "b=2; c=3; a=1");
  // A nameless cookie serializes as its bare value.
  const nameless = jarWith([APP, "justvalue"]);
  assert.equal(decideSend({ jar: nameless, url: su(APP), now: NOW }).header, "justvalue");
});



test("partitioned cookies only appear under their own top-level site", () => {
  // SameSite=None so the partition check (not SameSite) is the decider.
  const jar = jarWith(["https://widget.example.test/", "pref=1; Secure; Partitioned; SameSite=None"]);
  // Embedded under the same top-level site as the partition key:
  assert.deepEqual(
    sentNames(jar, "https://widget.example.test/frame", { from: su("https://example.test/"), kind: "subresource" }),
    ["pref"],
  );
  // Embedded under a different top-level site: invisible.
  assert.deepEqual(
    sentNames(jar, "https://widget.example.test/frame", { from: su("https://news.example/"), kind: "subresource" }),
    [],
  );
});

