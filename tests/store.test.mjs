// The storage model (RFC 6265bis §5.7): every way a browser refuses a
// Set-Cookie, each asserted through the check trace, not just the verdict.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { failedIds, jarWith, NOW, storeAt } from "./helpers.mjs";

test("a boring session cookie stores host-only with default path, all checks green", () => {
  const result = storeAt("https://app.example.test/account/settings", "sid=abc");
  assert.equal(result.verdict, "stored");
  assert.equal(result.cookie.domain, "app.example.test");
  assert.equal(result.cookie.hostOnly, true);
  assert.equal(result.cookie.path, "/account");
  assert.equal(result.cookie.persistent, false);
  assert.ok(result.checks.every((c) => c.pass));
  assert.ok(result.checks.every((c) => c.ref.includes("RFC") || c.ref.includes("CHIPS")));
});

test("Domain widens to the parent and clears host-only", () => {
  const result = storeAt("https://app.example.test/", "sid=abc; Domain=example.test");
  assert.equal(result.verdict, "stored");
  assert.equal(result.cookie.domain, "example.test");
  assert.equal(result.cookie.hostOnly, false);
});

test("Domain naming a sibling, an unrelated host, or a public suffix is rejected", () => {
  const sibling = storeAt("https://app.example.test/", "sid=abc; Domain=api.example.test");
  assert.equal(sibling.verdict, "rejected");
  assert.deepEqual(failedIds(sibling), ["store.domain-match"]);
  const unrelated = storeAt("https://app.example.test/", "sid=abc; Domain=other.test");
  assert.equal(unrelated.verdict, "rejected");
  // Supercookie guard: Domain=co.uk would span every .co.uk registration.
  const suffix = storeAt("https://shop.example.co.uk/", "sid=abc; Domain=co.uk");
  assert.equal(suffix.verdict, "rejected");
  assert.deepEqual(failedIds(suffix), ["store.public-suffix"]);
});

test("Domain equal to the host when the host IS a public suffix: host-only", () => {
  // github.io itself serves pages; Domain=github.io from github.io is tolerated but demoted.
  const result = storeAt("https://github.io/", "sid=abc; Domain=github.io");
  assert.equal(result.verdict, "stored");
  assert.equal(result.cookie.hostOnly, true);
});

test("an IP host takes host-only cookies only; Domain must not appear", () => {
  const bare = storeAt("http://192.168.1.10/", "sid=abc");
  assert.equal(bare.verdict, "stored");
  assert.equal(bare.cookie.domain, "192.168.1.10");
  const withDomain = storeAt("http://192.168.1.10/", "sid=abc; Domain=192.168.1.10");
  // Domain equal to the IP is accepted by the domain-match identity clause…
  assert.equal(withDomain.verdict, "stored");
  const parent = storeAt("http://192.168.1.10/", "sid=abc; Domain=1.10");
  // …but anything else can never match an IP literal.
  assert.equal(parent.verdict, "rejected");
});

test("a Secure cookie from plain http is rejected — loopback origins excepted", () => {
  const result = storeAt("http://app.example.test/", "sid=abc; Secure");
  assert.equal(result.verdict, "rejected");
  assert.deepEqual(failedIds(result), ["store.secure-scheme"]);
  // localhost/127.0.0.1 are trustworthy even over http:
  assert.equal(storeAt("http://127.0.0.1:3000/", "sid=abc; Secure").verdict, "stored");
});

test("SameSite=None without Secure is rejected outright", () => {
  const result = storeAt("https://app.example.test/", "sid=abc; SameSite=None");
  assert.equal(result.verdict, "rejected");
  assert.deepEqual(failedIds(result), ["store.samesite-none-secure"]);
});

test("__Host- demands Secure, no Domain, and Path=/ — each failure named", () => {
  const good = storeAt("https://app.example.test/", "__Host-sid=abc; Secure; Path=/");
  assert.equal(good.verdict, "stored");
  const noPath = storeAt("https://app.example.test/", "__Host-sid=abc; Secure");
  assert.equal(noPath.verdict, "rejected");
  assert.match(noPath.checks.find((c) => !c.pass).detail, /Path/);
  const withDomain = storeAt("https://app.example.test/", "__Host-sid=abc; Secure; Path=/; Domain=example.test");
  assert.equal(withDomain.verdict, "rejected");
  assert.match(withDomain.checks.find((c) => !c.pass).detail, /Domain/);
});

test("__Secure- demands Secure + a secure origin; prefixes match case-insensitively", () => {
  assert.equal(storeAt("https://a.example.test/", "__Secure-t=1; Secure").verdict, "stored");
  assert.equal(storeAt("https://a.example.test/", "__Secure-t=1").verdict, "rejected");
  assert.equal(storeAt("http://a.example.test/", "__Secure-t=1; Secure").verdict, "rejected");
  // __HOST- is still __Host-: rejected here because Path=/ is missing.
  assert.equal(storeAt("https://app.example.test/", "__HOST-sid=abc; Secure").verdict, "rejected");
});

test("cross-site subresource responses cannot create SameSite cookies", () => {
  const opts = { context: { crossSite: true, topLevelNavigation: false } };
  const lax = storeAt("https://app.example.test/", "sid=abc; SameSite=Lax", opts);
  assert.equal(lax.verdict, "rejected");
  assert.deepEqual(failedIds(lax), ["store.samesite-cross-set"]);
  // Defaulted SameSite is enforced as Lax here too.
  const defaulted = storeAt("https://app.example.test/", "sid=abc", opts);
  assert.equal(defaulted.verdict, "rejected");
  // SameSite=None; Secure is the escape hatch.
  const none = storeAt("https://app.example.test/", "sid=abc; SameSite=None; Secure", opts);
  assert.equal(none.verdict, "stored");
  // …and a cross-site TOP-LEVEL NAVIGATION may still set even Strict cookies.
  const nav = storeAt("https://app.example.test/", "sid=abc; SameSite=Strict",
    { context: { crossSite: true, topLevelNavigation: true } });
  assert.equal(nav.verdict, "stored");
});

test("document.cookie can neither create nor replace an HttpOnly cookie", () => {
  const create = storeAt("https://app.example.test/", "sid=abc; HttpOnly", { api: "script" });
  assert.equal(create.verdict, "rejected");
  assert.deepEqual(failedIds(create), ["store.httponly-api"]);
  const jar = jarWith(["https://app.example.test/", "sid=server; HttpOnly; Path=/"]);
  const replace = storeAt("https://app.example.test/", "sid=forged; Path=/", { api: "script", jar });
  assert.equal(replace.verdict, "rejected");
  assert.deepEqual(failedIds(replace), ["store.httponly-overwrite"]);
});

test("an insecure origin cannot shadow an existing Secure cookie", () => {
  const jar = jarWith(["https://app.example.test/", "sid=real; Secure; Path=/"]);
  const attack = storeAt("http://app.example.test/", "sid=planted; Path=/", { jar });
  assert.equal(attack.verdict, "rejected");
  assert.deepEqual(failedIds(attack), ["store.secure-overwrite"]);
  // A different name is unaffected.
  const other = storeAt("http://app.example.test/", "theme=dark; Path=/", { jar });
  assert.equal(other.verdict, "stored");
});

test("lifetime: Max-Age wins over Expires; past expiries are deletions", () => {
  const both = storeAt("https://a.example.test/", "t=1; Max-Age=60; Expires=Sun, 06 Nov 1994 08:49:37 GMT");
  assert.equal(both.cookie.persistent, true);
  assert.equal(both.cookie.expiryTime, NOW + 60_000);
  const session = storeAt("https://a.example.test/", "t=1");
  assert.equal(session.cookie.persistent, false);
  assert.equal(session.cookie.expiryTime, null);
  const maxAge = storeAt("https://a.example.test/", "t=1; Max-Age=0");
  assert.equal(maxAge.verdict, "stored");
  assert.equal(maxAge.deletion, true);
  const past = storeAt("https://a.example.test/", "t=1; Expires=Sun, 06 Nov 1994 08:49:37 GMT");
  assert.equal(past.deletion, true);
});

test("Partitioned requires Secure and records the partition key", () => {
  const good = storeAt("https://widget.example.test/", "pref=1; Secure; Partitioned");
  assert.equal(good.verdict, "stored");
  assert.equal(good.cookie.partitionKey, "https://example.test");
  const bad = storeAt("https://widget.example.test/", "pref=1; Partitioned");
  assert.equal(bad.verdict, "rejected");
  assert.deepEqual(failedIds(bad), ["store.partitioned"]);
});
