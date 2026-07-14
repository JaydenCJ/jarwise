# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- `jarwise explain`: annotates a Set-Cookie header attribute by attribute
  — scope, lifetime, SameSite semantics — plus static contract analysis
  (`__Host-`/`__Secure-` prefixes, SameSite=None-needs-Secure, deletion
  headers) that flags cookies no browser will ever store.
- Full RFC 6265bis §5.6 Set-Cookie parser: nameless cookies, control
  characters, the 4096/1024-byte limits, duplicate and unknown
  attributes, quoted values — every quirk surfaced as a stable-id note.
- The RFC 6265 §5.1.1 cookie-date algorithm implemented verbatim
  (delimiter tokenization, 2-digit-year mapping, year-1601 floor), so
  Expires parses and fails exactly the way a browser's does.
- `jarwise store`: the §5.7 storage model as an explainable trace —
  prefix contracts, Secure-from-insecure (with trustworthy loopback),
  SameSite=None-requires-Secure, cross-site set restrictions, Domain
  scoping with a public-suffix supercookie guard, default-path,
  Secure/HttpOnly overwrite protection, Max-Age/Expires precedence and
  deletions, and CHIPS `Partitioned` validation.
- `jarwise send`: the §5.8.3 retrieval algorithm with a per-cookie rule
  trace — host-only vs Domain matching, path-match, Secure channels,
  schemeful SameSite (Strict/Lax/None plus defaulted-Lax labelling),
  partition keys, and the RFC Cookie-header ordering.
- `jarwise trace`: redirect-chain simulation with 301/302/303 vs 307/308
  method rewriting, cross-site taint for subresource chains, per-hop
  send/store reports, jar seeding, and `expect` assertions for CI.
- An embedded public-suffix snapshot (ccTLD registries, major hosting
  suffixes, wildcard/exception rules) driving registrable-domain and
  schemeful same-site decisions offline.
- CI-ready surface: `--format json` with a stable shape, `--now` for a
  pinned clock, `--expect` gates, and exit codes 0 (accepted/attached) /
  1 (a browser rule ate the cookie) / 2 (usage error).
- Public programmatic API (`parseSetCookie`, `decideStore`, `decideSend`,
  `runTrace`, `Jar`, `explainSetCookie`, PSL and URL helpers) with type
  declarations.
- Test suite: 90 node:test tests (unit + CLI integration in fresh temp
  dirs) and an end-to-end `scripts/smoke.sh` against the bundled
  login-redirect / cross-site-SSO / http-downgrade scenarios.

[0.1.0]: https://github.com/JaydenCJ/jarwise/releases/tag/v0.1.0
