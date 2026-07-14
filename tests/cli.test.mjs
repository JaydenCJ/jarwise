// CLI integration: the compiled binary, spawned for real, with temp files
// in a per-run directory. Exit codes are the contract under test.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { VERSION } from "../dist/index.js";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");
const WORKDIR = mkdtempSync(join(tmpdir(), "jarwise-test-"));
const NOW = ["--now", "2026-07-13T12:00:00Z"];
after(() => rmSync(WORKDIR, { recursive: true, force: true }));

/** Run the CLI; never throws — returns { code, stdout, stderr }. */
function run(args, stdin = "") {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8", input: stdin });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("--version prints the package version; --help documents the surface", () => {
  assert.equal(run(["--version"]).stdout.trim(), VERSION);
  const help = run(["--help"]).stdout;
  for (const needle of ["explain", "store", "send", "trace", "--format", "--now", "Exit codes"]) {
    assert.ok(help.includes(needle), needle);
  }
});

test("usage errors exit 2: unknown command, bad flag, missing --url", () => {
  assert.equal(run(["frobnicate"]).code, 2);
  assert.equal(run(["explain", "a=b", "--frobnicate"]).code, 2);
  assert.equal(run(["store", "a=b"]).code, 2); // --url is required
  assert.equal(run(["send", "--url", "not a url"]).code, 2);
  assert.equal(run([]).code, 2);
});

test("explain: exit 0 for a storable cookie, 1 for a doomed one", () => {
  const ok = run(["explain", "sid=abc; Secure; HttpOnly", ...NOW]);
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /jarwise: OK/);
  const doomed = run(["explain", "sid=abc; SameSite=None", ...NOW]);
  assert.equal(doomed.code, 1);
  assert.match(doomed.stdout, /REJECTED/);
});

test("store: the trace names the rule that rejected the cookie", () => {
  const result = run(["store", "sid=abc; Domain=other.test", "--url", "https://app.example.test/", ...NOW]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /store\.domain-match/);
  assert.match(result.stdout, /REJECTED/);
  const script = run(["store", "sid=abc; HttpOnly", "--url", "https://app.example.test/", "--api", "script", ...NOW]);
  assert.equal(script.code, 1);
  assert.match(script.stdout, /store\.httponly-api/);
});

test("send: cross-site subresource blocks a Lax cookie, exit 1 with trace", () => {
  const result = run([
    "send",
    "--set", "https://app.example.test/ => sid=abc; Secure; SameSite=Lax",
    "--url", "https://app.example.test/api",
    "--from", "https://news.example/",
    "--subresource",
    ...NOW,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /send\.samesite/);
  assert.match(result.stdout, /BLOCKED/);
});

test("send --expect gates only on the named cookie", () => {
  const args = [
    "send",
    "--set", "https://app.example.test/ => sid=abc; Secure; SameSite=None",
    "--set", "https://app.example.test/ => lax=1; Secure; SameSite=Lax",
    "--url", "https://app.example.test/api",
    "--from", "https://news.example/",
    "--subresource",
    ...NOW,
  ];
  assert.equal(run([...args, "--expect", "sid"]).code, 0);
  assert.equal(run([...args, "--expect", "lax"]).code, 1);
});

test("send --format json emits a stable machine shape", () => {
  const result = run([
    "send",
    "--set", "https://app.example.test/ => sid=abc",
    "--url", "https://app.example.test/",
    "--format", "json",
    ...NOW,
  ]);
  assert.equal(result.code, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.command, "send");
  assert.equal(body.cookieHeader, "sid=abc");
  assert.equal(body.decisions[0].sent, true);
  assert.ok(Array.isArray(body.decisions[0].checks));
});

test("trace reads a scenario file, honors expectations, exits accordingly", () => {
  const scenario = join(WORKDIR, "chain.json");
  writeFileSync(scenario, JSON.stringify({
    chain: [
      { url: "https://shop.example.test/checkout", status: 302, setCookies: ["cart=1; Secure; Path=/"] },
      { url: "http://shop.example.test/receipt" },
    ],
    expect: ["cart"],
  }));
  const result = run(["trace", scenario, ...NOW]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /omitted cart/);
  assert.match(result.stdout, /FAIL — cart/);
});

test("trace reads stdin with '-', and malformed JSON exits 2", () => {
  const good = run(["trace", "-", ...NOW], JSON.stringify({
    chain: [{ url: "https://app.example.test/", setCookies: ["sid=1"] }],
  }));
  assert.equal(good.code, 0);
  assert.match(good.stdout, /→ stored/);
  assert.equal(run(["trace", "-", ...NOW], "{nope").code, 2);
  assert.equal(run(["trace", join(WORKDIR, "missing.json"), ...NOW]).code, 2);
});

test("determinism: two identical runs are byte-identical", () => {
  const args = ["trace", "-", ...NOW];
  const scenario = JSON.stringify({
    chain: [
      { url: "https://app.example.test/a", status: 302, setCookies: ["x=1; Max-Age=60"] },
      { url: "https://app.example.test/b" },
    ],
  });
  assert.equal(run(args, scenario).stdout, run(args, scenario).stdout);
});
