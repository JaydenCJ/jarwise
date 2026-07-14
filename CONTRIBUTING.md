# Contributing to jarwise

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and honest about what browsers
actually do.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/jarwise.git
cd jarwise
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (explain, store, send, trace,
exit codes, --expect, --api script, JSON output, stdin scenarios,
determinism) against the bundled example chains and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (parsing, matching, storage and retrieval all take values,
   not file handles — only the CLI touches the filesystem).
5. New checks or notes need a row in `docs/rules.md`, a stable id that is
   never reused, an RFC reference, and at least one test.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — the tool reads arguments, files and stdin,
  then prints. That is the whole I/O surface.
- Check/note ids (`store.*`, `send.*`, `parse.*`, `explain.*`) are stable
  API: never rename or repurpose an existing id; add new ones instead.
- Verdicts must track what **current browsers** do, with the RFC 6265bis
  storage/retrieval algorithms as the tiebreaker; where browsers and the
  older RFC 6265 disagree, follow the browsers and say so in the detail.
- Determinism is non-negotiable: every time-dependent decision takes an
  injected `now`; no randomness, no wall-clock reads outside `cli.ts`.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `jarwise --version` output, the exact command line, and
the smallest Set-Cookie header (or scenario JSON) that reproduces the
problem. If you believe a verdict is wrong, say what a real browser does
with that cookie — DevTools' Application tab and the Network panel's
blocked-cookie tooltips are the ground truth this tool must match.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
