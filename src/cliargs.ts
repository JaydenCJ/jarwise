/**
 * Tiny declarative flag parser. Each command declares its flags; anything
 * else is a usage error with a did-you-mean-free, precise message. Usage
 * errors exit 2, so CI can tell "your cookie is broken" (exit 1) from
 * "your invocation is broken" (exit 2).
 */

export class UsageError extends Error {}

export interface FlagSpec {
  /** Flag name including dashes, e.g. "--url". */
  name: string;
  /** Does the flag consume a value? */
  takesValue: boolean;
  /** May the flag repeat? (Only meaningful with takesValue.) */
  repeatable?: boolean;
}

export interface ParsedArgs {
  positionals: string[];
  values: Map<string, string[]>;
  flags: Set<string>;
}

/** Parse argv (after the command word) against a flag spec list. */
export function parseArgs(argv: string[], specs: FlagSpec[]): ParsedArgs {
  const byName = new Map<string, FlagSpec>();
  for (const spec of specs) {
    byName.set(spec.name, spec);
  }
  const positionals: string[] = [];
  const values = new Map<string, string[]>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    // Support --flag=value as well as --flag value.
    let name = arg;
    let inlineValue: string | null = null;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq >= 0) {
      name = arg.slice(0, eq);
      inlineValue = arg.slice(eq + 1);
    }
    const spec = byName.get(name);
    if (!spec) throw new UsageError(`unknown flag ${name} (see --help)`);
    if (!spec.takesValue) {
      if (inlineValue !== null) throw new UsageError(`${spec.name} takes no value`);
      flags.add(spec.name);
      continue;
    }
    let value: string;
    if (inlineValue !== null) {
      value = inlineValue;
    } else {
      const next = argv[i + 1];
      if (next === undefined) throw new UsageError(`${spec.name} needs a value`);
      value = next;
      i++;
    }
    const existing = values.get(spec.name) ?? [];
    if (existing.length > 0 && spec.repeatable !== true) {
      throw new UsageError(`${spec.name} may only be given once`);
    }
    existing.push(value);
    values.set(spec.name, existing);
  }
  return { positionals, values, flags };
}

/** The single value of a flag, or null. */
export function single(args: ParsedArgs, name: string): string | null {
  const list = args.values.get(name);
  if (list === undefined) return null;
  const last = list[list.length - 1];
  return last ?? null;
}

/** All values of a repeatable flag. */
export function many(args: ParsedArgs, name: string): string[] {
  return args.values.get(name) ?? [];
}

/** Parse --now: an ISO 8601 timestamp to epoch ms; null when absent. */
export function parseNow(args: ParsedArgs): number | null {
  const raw = single(args, "--now");
  if (raw === null) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw new UsageError(`--now "${raw}" is not an ISO 8601 timestamp (e.g. 2026-07-13T12:00:00Z)`);
  return ms;
}

/** Validate --format. */
export function parseFormat(args: ParsedArgs): "text" | "json" {
  const raw = single(args, "--format") ?? "text";
  if (raw !== "text" && raw !== "json") throw new UsageError(`--format must be "text" or "json", got "${raw}"`);
  return raw;
}
