// `explain`: attribute annotation and the static contract analysis that
// needs no URL — prefix violations, SameSite defaults, lifetimes.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { explainSetCookie } from "../dist/index.js";
import { NOW } from "./helpers.mjs";

function noteIds(result) {
  return result.notes.map((n) => n.id);
}

test("a well-formed hardened cookie is OK with informative rows", () => {
  const result = explainSetCookie("__Host-sid=abc; Secure; HttpOnly; Path=/; SameSite=Strict", NOW);
  assert.equal(result.verdict, "ok");
  assert.ok(result.rows.some((r) => r.label === "SameSite" && r.value.includes("Strict")));
  assert.ok(noteIds(result).includes("explain.prefix-host"));
  assert.ok(result.notes.every((n) => n.level !== "error"));
});

test("SameSite=None without Secure is an error verdict", () => {
  const result = explainSetCookie("sid=abc; SameSite=None", NOW);
  assert.equal(result.verdict, "rejected");
  assert.ok(noteIds(result).includes("explain.samesite-none-secure"));
});

test("__Host- violations name each broken clause", () => {
  const result = explainSetCookie("__Host-sid=abc; Domain=example.test", NOW);
  assert.equal(result.verdict, "rejected");
  const note = result.notes.find((n) => n.id === "explain.prefix-host");
  assert.match(note.message, /Secure is missing/);
  assert.match(note.message, /Domain is present/);
  assert.match(note.message, /Path/);
});

test("absent SameSite explains the Lax default and the Lax+POST caveat", () => {
  const result = explainSetCookie("sid=abc; Secure", NOW);
  const note = result.notes.find((n) => n.id === "explain.samesite-default");
  assert.match(note.message, /Lax/);
  assert.match(note.message, /not simulated/);
});

test("lifetime rows: session, persistent, and deletion phrasing", () => {
  const session = explainSetCookie("a=1", NOW);
  assert.match(session.rows.find((r) => r.label === "lifetime").value, /session/);
  const persistent = explainSetCookie("a=1; Max-Age=3600", NOW);
  assert.match(persistent.rows.find((r) => r.label === "lifetime").value, /Max-Age=3600/);
  const deletion = explainSetCookie("a=1; Expires=Sun, 06 Nov 1994 08:49:37 GMT", NOW);
  assert.match(deletion.rows.find((r) => r.label === "lifetime").value, /deletes/);
});

test("a header that fails parsing yields a rejected verdict and reason", () => {
  const result = explainSetCookie("=", NOW);
  assert.equal(result.verdict, "rejected");
  assert.match(result.reason, /empty/);
  assert.equal(result.cookie, null);
});
