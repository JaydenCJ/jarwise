/**
 * Renderers: every command produces either a human report (text) or a
 * stable machine shape (json). All functions are pure string builders;
 * only the CLI writes to stdout.
 */
import type { ExplainResult } from "./explain.js";
import type {
  Check,
  CookieSendDecision,
  Note,
  SendResult,
  SiteUrl,
  StoredCookie,
  StoreResult,
  TraceResult,
} from "./types.js";

const PASS = "ok ";
const FAIL = "X! ";

function renderCheck(c: Check): string {
  return `  ${c.pass ? PASS : FAIL} ${c.id.padEnd(28)} ${c.detail}  [${c.ref}]`;
}

function renderNote(n: Note): string {
  return `  ${n.level.padEnd(5)} ${n.id.padEnd(28)} ${n.message}  [${n.ref}]`;
}

function cookieCoords(c: StoredCookie): string {
  const scope = c.hostOnly ? `host ${c.domain}` : `domain .${c.domain}`;
  return `${c.name === "" ? "(nameless)" : c.name} (${scope}, path ${c.path})`;
}

/** `jarwise explain` text report. */
export function renderExplainText(header: string, result: ExplainResult): string {
  const lines: string[] = [`Set-Cookie: ${header}`, ""];
  if (result.reason !== null) {
    lines.push(`  rejected at parse: ${result.reason}`, "");
  }
  for (const row of result.rows) {
    lines.push(`  ${row.label.padEnd(12)} ${row.value}`);
  }
  if (result.notes.length > 0) {
    lines.push("", "notes:");
    for (const n of result.notes) lines.push(renderNote(n));
  }
  lines.push("");
  lines.push(result.verdict === "ok"
    ? "jarwise: OK — a compliant jar would accept this cookie"
    : "jarwise: REJECTED — no compliant jar will keep this cookie as written");
  return lines.join("\n");
}

/** `jarwise store` text report. */
export function renderStoreText(url: SiteUrl, header: string, result: StoreResult): string {
  const lines: string[] = [`store ${url.raw}`, `  Set-Cookie: ${header}`, ""];
  for (const c of result.checks) lines.push(renderCheck(c));
  lines.push("");
  if (result.verdict === "stored" && result.cookie) {
    const c = result.cookie;
    if (result.deletion) {
      lines.push(`jarwise: STORED (deletion) — ${cookieCoords(c)} is removed from the jar`);
    } else {
      lines.push(`jarwise: STORED — ${cookieCoords(c)}, SameSite=${c.sameSite}${c.defaulted ? " (defaulted)" : ""}, ${c.persistent ? "persistent" : "session"}`);
    }
  } else {
    const failed = result.checks.find((c) => !c.pass);
    lines.push(`jarwise: REJECTED — ${failed ? failed.detail : "see the trace above"}`);
  }
  return lines.join("\n");
}

function renderDecision(d: CookieSendDecision): string[] {
  const lines = [`  ${cookieCoords(d.cookie)}`];
  for (const c of d.checks) lines.push(`  ${renderCheck(c)}`);
  lines.push(`    → ${d.sent ? "attached" : "omitted"}`);
  return lines;
}

/** `jarwise send` text report. */
export function renderSendText(url: SiteUrl, fromLabel: string, result: SendResult): string {
  const context = `${result.sameSiteRequest ? "same-site" : "cross-site"}, ${result.kind === "navigation" ? "top-level navigation" : "subresource"}`;
  const lines: string[] = [
    `send ${result.method} ${url.raw}`,
    `  from ${fromLabel} (${context})`,
    "",
  ];
  if (result.decisions.length === 0) {
    lines.push("  (the jar is empty)");
  }
  for (const d of result.decisions) lines.push(...renderDecision(d), "");
  lines.push(result.header === null ? "Cookie: (nothing sent)" : `Cookie: ${result.header}`);
  const total = result.decisions.length;
  if (total === 0) {
    lines.push("jarwise: OK — the jar is empty, nothing to attach");
  } else {
    const verdict = result.sent.length === total ? "OK" : result.sent.length > 0 ? "PARTIAL" : "BLOCKED";
    lines.push(`jarwise: ${verdict} — ${result.sent.length} of ${total} ${total === 1 ? "cookie" : "cookies"} attached`);
  }
  return lines.join("\n");
}

/** `jarwise trace` text report. */
export function renderTraceText(result: TraceResult): string {
  const initiatorLabel = result.initiator === "address-bar" ? "address-bar" : result.initiator.raw;
  const lines: string[] = [
    `trace: ${result.kind}, initiated from ${initiatorLabel}`,
    "",
  ];
  for (const hop of result.hops) {
    lines.push(`hop ${hop.index + 1}: ${hop.method} ${hop.url.raw} (${hop.sameSiteRequest ? "same-site" : "cross-site"})`);
    lines.push(`  Cookie: ${hop.send.header ?? "(nothing sent)"}`);
    for (const d of hop.send.decisions.filter((x) => !x.sent)) {
      const failed = d.checks.find((c) => !c.pass);
      lines.push(`    omitted ${cookieCoords(d.cookie)} — ${failed ? `${failed.detail} [${failed.ref}]` : "not eligible"}`);
    }
    for (const s of hop.stores) {
      const verdict = s.result.verdict === "stored"
        ? "deletion" in s.result && s.result.deletion ? "deleted" : "stored"
        : "rejected";
      lines.push(`  Set-Cookie: ${s.header}`);
      if (verdict === "rejected") {
        const failed = s.result.checks.find((c) => !c.pass);
        lines.push(`    → rejected — ${failed ? `${failed.detail} [${failed.ref}]` : "see checks"}`);
      } else {
        lines.push(`    → ${verdict}`);
      }
    }
    lines.push("");
  }
  lines.push(`final jar: ${result.finalJar.length === 0 ? "(empty)" : result.finalJar.map(cookieCoords).join(", ")}`);
  for (const e of result.expectations) {
    lines.push(`expect ${e.name}: ${e.sent ? "sent on the final hop" : "NOT sent on the final hop"}`);
  }
  const failedExpectations = result.expectations.filter((e) => !e.sent);
  lines.push(failedExpectations.length === 0
    ? "jarwise: OK — the chain behaves as expected"
    : `jarwise: FAIL — ${failedExpectations.map((e) => e.name).join(", ")} did not survive the chain`);
  return lines.join("\n");
}

// --- JSON shapes (stable API for CI) ---

function jsonCookie(c: StoredCookie): Record<string, unknown> {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    hostOnly: c.hostOnly,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    defaulted: c.defaulted,
    partitionKey: c.partitionKey,
    persistent: c.persistent,
    expiryTime: c.expiryTime,
  };
}

export function jsonExplain(header: string, result: ExplainResult): Record<string, unknown> {
  return {
    command: "explain",
    header,
    verdict: result.verdict,
    reason: result.reason,
    attributes: result.rows,
    notes: result.notes,
  };
}

export function jsonStore(url: SiteUrl, header: string, result: StoreResult): Record<string, unknown> {
  return {
    command: "store",
    url: url.raw,
    header,
    verdict: result.verdict,
    deletion: result.deletion,
    cookie: result.cookie ? jsonCookie(result.cookie) : null,
    checks: result.checks,
  };
}

export function jsonSend(url: SiteUrl, fromLabel: string, result: SendResult): Record<string, unknown> {
  return {
    command: "send",
    url: url.raw,
    from: fromLabel,
    kind: result.kind,
    method: result.method,
    sameSiteRequest: result.sameSiteRequest,
    cookieHeader: result.header,
    decisions: result.decisions.map((d) => ({
      cookie: jsonCookie(d.cookie),
      sent: d.sent,
      checks: d.checks,
    })),
  };
}

export function jsonTrace(result: TraceResult): Record<string, unknown> {
  return {
    command: "trace",
    kind: result.kind,
    initiator: result.initiator === "address-bar" ? "address-bar" : result.initiator.raw,
    hops: result.hops.map((hop) => ({
      index: hop.index,
      url: hop.url.raw,
      method: hop.method,
      sameSiteRequest: hop.sameSiteRequest,
      cookieHeader: hop.send.header,
      omitted: hop.send.decisions.filter((d) => !d.sent).map((d) => ({
        cookie: jsonCookie(d.cookie),
        checks: d.checks,
      })),
      setCookies: hop.stores.map((s) => ({
        header: s.header,
        verdict: s.result.verdict,
        deletion: "deletion" in s.result ? s.result.deletion : false,
        checks: s.result.checks,
      })),
    })),
    finalJar: result.finalJar.map(jsonCookie),
    expectations: result.expectations,
  };
}
