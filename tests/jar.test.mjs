// Jar semantics: replacement coordinates, creation-order preservation,
// deletions, and lazy expiry against the injected clock.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Jar, decideSend } from "../dist/index.js";
import { jarWith, NOW, storeAt, su } from "./helpers.mjs";

const APP = "https://app.example.test/";

test("same name+domain+path replaces the value, keeping creation order", () => {
  const jar = jarWith([APP, "a=old; Path=/"], [APP, "b=2; Path=/"]);
  jar.apply(storeAt(APP, "a=new; Path=/", { jar }));
  const result = decideSend({ jar, url: su(APP), now: NOW });
  // "a" was created first, so it still serializes first despite the rewrite.
  assert.equal(result.header, "a=new; b=2");
  assert.equal(jar.size(NOW), 2);
});

test("different paths or host-only flags are different cookies, not replacements", () => {
  const paths = jarWith([APP, "a=root; Path=/"], [APP, "a=deep; Path=/x"]);
  assert.equal(paths.size(NOW), 2);
  const flags = jarWith(
    [APP, "sid=hostonly; Path=/"],
    [APP, "sid=wide; Domain=app.example.test; Path=/"],
  );
  assert.equal(flags.size(NOW), 2);
});

test("Max-Age=0 deletes the matching cookie — and only that one", () => {
  const jar = jarWith([APP, "sid=abc; Path=/"]);
  // A deletion aimed at different coordinates removes nothing.
  jar.apply(storeAt(APP, "sid=; Max-Age=0; Path=/other", { jar }));
  assert.equal(jar.size(NOW), 1);
  jar.apply(storeAt(APP, "sid=; Max-Age=0; Path=/", { jar }));
  assert.equal(jar.size(NOW), 0);
});

test("rejected results are no-ops on the jar", () => {
  const jar = jarWith([APP, "sid=abc; Path=/"]);
  jar.apply(storeAt("http://app.example.test/", "sid=evil; Secure; Path=/", { jar }));
  const result = decideSend({ jar, url: su(APP), now: NOW });
  assert.equal(result.header, "sid=abc");
});

test("expiry is lazy: list() hides cookies the clock has passed", () => {
  const jar = new Jar();
  jar.apply(storeAt(APP, "t=1; Max-Age=10"));
  assert.equal(jar.size(NOW), 1);
  assert.equal(jar.size(NOW + 11_000), 0);
  assert.equal(jar.listAll().length, 1); // still present for deletion reports
});
