// Redirect-chain simulation: method rewriting, cross-site taint for
// subresources, Secure downgrades mid-chain, and expectations.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runTrace, validateScenario, ScenarioError } from "../dist/index.js";
import { NOW } from "./helpers.mjs";

const APP = "https://app.example.test";

function trace(scenario) {
  return runTrace(validateScenario(scenario), NOW);
}

test("a cookie set on hop 1 rides every later same-site hop", () => {
  const result = trace({
    chain: [
      { url: `${APP}/login`, status: 302, setCookies: ["sid=abc; Path=/"] },
      { url: `${APP}/dashboard` },
    ],
    expect: ["sid"],
  });
  assert.equal(result.hops[0].send.header, null);
  assert.equal(result.hops[1].send.header, "sid=abc");
  assert.deepEqual(result.expectations, [{ name: "sid", sent: true }]);
});

test("303 rewrites POST to GET, so a Lax cookie reappears after login", () => {
  const result = trace({
    initiator: "https://idp.example/",
    method: "POST",
    chain: [
      { url: `${APP}/sso/callback`, status: 303 },
      { url: `${APP}/home` },
    ],
    seed: [{ url: `${APP}/login`, setCookie: "session=1; Secure; Path=/" }],
  });
  // Hop 1: cross-site POST navigation — defaulted-Lax cookie omitted.
  assert.equal(result.hops[0].method, "POST");
  assert.equal(result.hops[0].send.header, null);
  // Hop 2: the 303 turned it into a GET — Lax allows it again.
  assert.equal(result.hops[1].method, "GET");
  assert.equal(result.hops[1].send.header, "session=1");
});

test("307 preserves POST, so the Lax cookie stays missing", () => {
  const result = trace({
    initiator: "https://idp.example/",
    method: "POST",
    chain: [
      { url: `${APP}/sso/callback`, status: 307 },
      { url: `${APP}/home` },
    ],
    seed: [{ url: `${APP}/login`, setCookie: "session=1; Secure; Path=/" }],
  });
  assert.equal(result.hops[1].method, "POST");
  assert.equal(result.hops[1].send.header, null);
});

test("navigation hops keep comparing against the original initiator", () => {
  // app -> tracker -> app: hops 1 and 3 are same-site with the initiator.
  const result = trace({
    initiator: `${APP}/`,
    chain: [
      { url: `${APP}/out`, status: 302 },
      { url: "https://tracker.example/bounce", status: 302 },
      { url: `${APP}/landing` },
    ],
    seed: [{ url: `${APP}/`, setCookie: "sid=abc; Secure; SameSite=Strict; Path=/" }],
  });
  assert.equal(result.hops[0].sameSiteRequest, true);
  assert.equal(result.hops[1].sameSiteRequest, false);
  assert.equal(result.hops[2].sameSiteRequest, true);
  assert.equal(result.hops[2].send.header, "sid=abc");
});

test("one cross-site bounce taints the rest of a subresource chain", () => {
  const result = trace({
    kind: "subresource",
    initiator: `${APP}/`,
    chain: [
      { url: `${APP}/api/go`, status: 302 },
      { url: "https://cdn.other.test/hop", status: 302 },
      { url: `${APP}/api/return` }, // back on the original site, but tainted
    ],
    seed: [{ url: `${APP}/`, setCookie: "sid=abc; Secure; SameSite=Lax; Path=/" }],
  });
  assert.equal(result.hops[0].sameSiteRequest, true);
  assert.equal(result.hops[1].sameSiteRequest, false);
  assert.equal(result.hops[2].sameSiteRequest, false);
  assert.equal(result.hops[2].send.header, null);
});

test("Secure cookies vanish on an http hop and return on https", () => {
  const result = trace({
    chain: [
      { url: `${APP}/start`, status: 302, setCookies: ["sid=abc; Secure; Path=/", "theme=dark; Path=/"] },
      { url: "http://app.example.test/legacy", status: 302 },
      { url: `${APP}/end` },
    ],
  });
  assert.equal(result.hops[1].send.header, "theme=dark");
  assert.equal(result.hops[2].send.header, "sid=abc; theme=dark");
});

test("cookies set by a cross-site subresource hop obey the set restriction", () => {
  const result = trace({
    kind: "subresource",
    initiator: `${APP}/`,
    chain: [
      { url: "https://ads.other.test/pixel", setCookies: ["track=1; SameSite=Lax", "wide=1; SameSite=None; Secure"] },
    ],
  });
  const [lax, none] = result.hops[0].stores;
  assert.equal(lax.result.verdict, "rejected");
  assert.equal(none.result.verdict, "stored");
  assert.deepEqual(result.finalJar.map((c) => c.name), ["wide"]);
});

test("failed expectations are reported, and unparsable scenarios throw", () => {
  const result = trace({
    chain: [{ url: `${APP}/only` }],
    expect: ["ghost"],
  });
  assert.deepEqual(result.expectations, [{ name: "ghost", sent: false }]);
  assert.throws(() => validateScenario({ chain: [] }), ScenarioError);
  assert.throws(() => validateScenario({ chain: [{ url: 42 }] }), ScenarioError);
  assert.throws(() => validateScenario({ chain: [{ url: `${APP}/` }], kind: "prefetch" }), ScenarioError);
  assert.throws(() => runTrace(validateScenario({ chain: [{ url: "not-a-url" }] }), NOW), ScenarioError);
});
