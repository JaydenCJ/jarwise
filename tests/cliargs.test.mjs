// Flag parsing: the CLI's contract that usage errors are precise and
// distinguishable (exit 2) from cookie verdicts (exit 1).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseArgs, UsageError } from "../dist/cliargs.js";

const SPECS = [
  { name: "--url", takesValue: true },
  { name: "--set", takesValue: true, repeatable: true },
  { name: "--subresource", takesValue: false },
];

test("positionals, valued flags and boolean flags separate cleanly", () => {
  const args = parseArgs(["header-string", "--url", "https://a.test/", "--subresource"], SPECS);
  assert.deepEqual(args.positionals, ["header-string"]);
  assert.deepEqual(args.values.get("--url"), ["https://a.test/"]);
  assert.ok(args.flags.has("--subresource"));
});

test("--flag=value works and '-' stays a positional (stdin marker)", () => {
  const args = parseArgs(["-", "--url=https://a.test/"], SPECS);
  assert.deepEqual(args.positionals, ["-"]);
  assert.deepEqual(args.values.get("--url"), ["https://a.test/"]);
});

test("repeatable flags accumulate; non-repeatable ones refuse a second use", () => {
  const args = parseArgs(["--set", "a", "--set", "b"], SPECS);
  assert.deepEqual(args.values.get("--set"), ["a", "b"]);
  assert.throws(() => parseArgs(["--url", "a", "--url", "b"], SPECS), UsageError);
});

test("unknown flags, missing values and valued booleans all throw UsageError", () => {
  assert.throws(() => parseArgs(["--frobnicate"], SPECS), UsageError);
  assert.throws(() => parseArgs(["--url"], SPECS), UsageError);
  assert.throws(() => parseArgs(["--subresource=yes"], SPECS), UsageError);
});
