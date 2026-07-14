#!/usr/bin/env node
/**
 * The jarwise CLI. Four commands over the same pure engine:
 *
 *   explain  — annotate a Set-Cookie header (no URL needed)
 *   store    — would a browser store it? full RFC rule trace
 *   send     — which jar cookies accompany a request, and why
 *   trace    — simulate a redirect chain end to end
 *
 * Exit codes: 0 = accepted/attached/expectations met, 1 = a browser rule
 * ate the cookie, 2 = usage or input error.
 */
import { readFileSync } from "node:fs";
import { many, parseArgs, parseFormat, parseNow, single, UsageError, type FlagSpec, type ParsedArgs } from "./cliargs.js";
import { explainSetCookie } from "./explain.js";
import { Jar } from "./jar.js";
import { parseSetCookie } from "./parse.js";
import { sameSiteUrls } from "./psl.js";
import { runTrace, ScenarioError, validateScenario } from "./redirect.js";
import {
  jsonExplain, jsonSend, jsonStore, jsonTrace,
  renderExplainText, renderSendText, renderStoreText, renderTraceText,
} from "./report.js";
import { decideSend } from "./send.js";
import { parseUrl } from "./siteurl.js";
import { decideStore } from "./store.js";
import type { Initiator, RequestKind, SiteUrl } from "./types.js";
import { VERSION } from "./version.js";

const HELP = `jarwise ${VERSION} — explains which browser rule eats your cookie

Usage:
  jarwise explain '<set-cookie>'                annotate a Set-Cookie header
  jarwise store '<set-cookie>' --url <url>      would a browser store it?
  jarwise send --url <url> [--set '<url> => <set-cookie>']...
                                                which cookies ride along, and why
  jarwise trace <scenario.json | ->             simulate a redirect chain

Common flags:
  --format text|json        report format (default text)
  --now <ISO 8601>          the simulated clock (default: the real time)
  --help, --version

store flags:
  --url <url>               the URL the Set-Cookie response came from (required)
  --from <url|address-bar>  initiator of the request (default address-bar)
  --subresource             the response belongs to a subresource request
  --api http|script         HTTP response or document.cookie (default http)

send flags:
  --url <url>               the request URL (required)
  --set '<url> => <header>' seed the jar: a Set-Cookie received at <url> (repeatable)
  --from <url|address-bar>  initiator (default address-bar)
  --subresource             a fetch/XHR/img request instead of a navigation
  --method <verb>           request method (default GET)
  --expect <name>           require this cookie to be attached (repeatable)

trace flags:
  --expect <name>           require this cookie on the final hop (repeatable)

Exit codes:
  0  stored / attached / all expectations met
  1  a browser rule rejected or withheld a cookie
  2  usage or input error
`;

class CookieError extends Error {}

function requireUrl(raw: string | null, flag: string): SiteUrl {
  if (raw === null) throw new UsageError(`${flag} is required`);
  const parsed = parseUrl(raw);
  if (!parsed.ok) throw new UsageError(`${flag}: ${parsed.error}`);
  return parsed.url;
}

function parseInitiator(args: ParsedArgs): Initiator {
  const raw = single(args, "--from");
  if (raw === null || raw === "address-bar") return "address-bar";
  const parsed = parseUrl(raw);
  if (!parsed.ok) throw new UsageError(`--from: ${parsed.error}`);
  return parsed.url;
}

function readInput(pathOrDash: string): string {
  // "-" reads stdin; everything else is a file path.
  return readFileSync(pathOrDash === "-" ? 0 : pathOrDash, "utf8");
}

const COMMON_FLAGS: FlagSpec[] = [
  { name: "--format", takesValue: true },
  { name: "--now", takesValue: true },
];

function cmdExplain(argv: string[]): number {
  const args = parseArgs(argv, COMMON_FLAGS);
  const header = args.positionals[0];
  if (header === undefined || args.positionals.length !== 1) {
    throw new UsageError("explain takes exactly one Set-Cookie string");
  }
  const now = parseNow(args) ?? Date.now();
  const result = explainSetCookie(header, now);
  const out = parseFormat(args) === "json"
    ? JSON.stringify(jsonExplain(header, result), null, 2)
    : renderExplainText(header, result);
  process.stdout.write(out + "\n");
  return result.verdict === "ok" ? 0 : 1;
}

function cmdStore(argv: string[]): number {
  const args = parseArgs(argv, [
    ...COMMON_FLAGS,
    { name: "--url", takesValue: true },
    { name: "--from", takesValue: true },
    { name: "--api", takesValue: true },
    { name: "--subresource", takesValue: false },
  ]);
  const header = args.positionals[0];
  if (header === undefined || args.positionals.length !== 1) {
    throw new UsageError("store takes exactly one Set-Cookie string");
  }
  const url = requireUrl(single(args, "--url"), "--url");
  const from = parseInitiator(args);
  const api = single(args, "--api") ?? "http";
  if (api !== "http" && api !== "script") throw new UsageError(`--api must be "http" or "script", got "${api}"`);
  const now = parseNow(args) ?? Date.now();

  const parsed = parseSetCookie(header);
  if (!parsed.ok) throw new CookieError(`the header does not parse: ${parsed.reason}`);
  const crossSite = from !== "address-bar" && !sameSiteUrls(from, url);
  const result = decideStore({
    cookie: parsed.cookie,
    url,
    now,
    api,
    context: { crossSite, topLevelNavigation: !args.flags.has("--subresource") },
  });
  const out = parseFormat(args) === "json"
    ? JSON.stringify(jsonStore(url, header, result), null, 2)
    : renderStoreText(url, header, result);
  process.stdout.write(out + "\n");
  return result.verdict === "stored" ? 0 : 1;
}

function cmdSend(argv: string[]): number {
  const args = parseArgs(argv, [
    ...COMMON_FLAGS,
    { name: "--url", takesValue: true },
    { name: "--from", takesValue: true },
    { name: "--set", takesValue: true, repeatable: true },
    { name: "--method", takesValue: true },
    { name: "--expect", takesValue: true, repeatable: true },
    { name: "--subresource", takesValue: false },
  ]);
  if (args.positionals.length !== 0) throw new UsageError(`unexpected argument "${args.positionals[0]}"`);
  const url = requireUrl(single(args, "--url"), "--url");
  const from = parseInitiator(args);
  const kind: RequestKind = args.flags.has("--subresource") ? "subresource" : "navigation";
  const now = parseNow(args) ?? Date.now();

  const jar = new Jar();
  const seedProblems: string[] = [];
  for (const seed of many(args, "--set")) {
    const sep = seed.indexOf("=>");
    if (sep < 0) throw new UsageError(`--set needs the form '<url> => <set-cookie>', got "${seed}"`);
    const seedUrl = requireUrl(seed.slice(0, sep).trim(), "--set url");
    const seedHeader = seed.slice(sep + 2).trim();
    const parsed = parseSetCookie(seedHeader);
    if (!parsed.ok) {
      seedProblems.push(`seed "${seedHeader}" does not parse: ${parsed.reason}`);
      continue;
    }
    const stored = decideStore({ cookie: parsed.cookie, url: seedUrl, now, jar });
    if (stored.verdict === "rejected") {
      const failed = stored.checks.find((c) => !c.pass);
      seedProblems.push(`seed "${seedHeader}" was never stored at ${seedUrl.raw}: ${failed?.detail ?? "rejected"}`);
    }
    jar.apply(stored);
  }

  const result = decideSend({ jar, url, from, kind, method: single(args, "--method") ?? "GET", now });
  const fromLabel = from === "address-bar" ? "address-bar" : from.raw;
  if (parseFormat(args) === "json") {
    const body = jsonSend(url, fromLabel, result) as Record<string, unknown>;
    body["seedProblems"] = seedProblems;
    process.stdout.write(JSON.stringify(body, null, 2) + "\n");
  } else {
    let text = renderSendText(url, fromLabel, result);
    if (seedProblems.length > 0) {
      text = seedProblems.map((p) => `note: ${p}`).join("\n") + "\n\n" + text;
    }
    process.stdout.write(text + "\n");
  }

  const expected = many(args, "--expect");
  if (expected.length > 0) {
    return expected.every((name) => result.sent.some((c) => c.name === name)) ? 0 : 1;
  }
  const allSent = result.decisions.every((d) => d.sent);
  return seedProblems.length === 0 && allSent ? 0 : 1;
}

function cmdTrace(argv: string[]): number {
  const args = parseArgs(argv, [
    ...COMMON_FLAGS,
    { name: "--expect", takesValue: true, repeatable: true },
  ]);
  const source = args.positionals[0];
  if (source === undefined || args.positionals.length !== 1) {
    throw new UsageError("trace takes exactly one scenario file (or - for stdin)");
  }
  let text: string;
  try {
    text = readInput(source);
  } catch {
    throw new UsageError(`cannot read scenario file "${source}"`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`scenario is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const scenario = validateScenario(decoded);
  for (const extra of many(args, "--expect")) {
    scenario.expect = [...(scenario.expect ?? []), extra];
  }
  const now = parseNow(args) ?? Date.now();
  const result = runTrace(scenario, now);
  const out = parseFormat(args) === "json"
    ? JSON.stringify(jsonTrace(result), null, 2)
    : renderTraceText(result);
  process.stdout.write(out + "\n");
  return result.expectations.every((e) => e.sent) ? 0 : 1;
}

/** Entry point; returns the process exit code. */
export function main(argv: string[]): number {
  try {
    const command = argv[0];
    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
      process.stdout.write(HELP);
      return command === undefined ? 2 : 0;
    }
    if (command === "--version" || command === "-V") {
      process.stdout.write(VERSION + "\n");
      return 0;
    }
    const rest = argv.slice(1);
    switch (command) {
      case "explain": return cmdExplain(rest);
      case "store": return cmdStore(rest);
      case "send": return cmdSend(rest);
      case "trace": return cmdTrace(rest);
      default:
        throw new UsageError(`unknown command "${command}" (see --help)`);
    }
  } catch (error) {
    if (error instanceof UsageError || error instanceof ScenarioError) {
      process.stderr.write(`jarwise: ${error.message}\n`);
      return 2;
    }
    if (error instanceof CookieError) {
      process.stderr.write(`jarwise: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = main(process.argv.slice(2));
