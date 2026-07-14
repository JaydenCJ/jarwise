#!/usr/bin/env bash
# Smoke test for jarwise: exercises the real CLI end to end against the
# bundled example scenarios and freshly written temp files. No network,
# idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

NOW="--now 2026-07-13T12:00:00Z"

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in explain store send trace --format --now --expect "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Usage errors exit 2 (distinct from cookie verdicts' 1).
set +e
$CLI frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown command should exit 2"; }
$CLI store 'a=b' >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "store without --url should exit 2"; }
$CLI send --url 'not a url' >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "bad --url should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 4. explain annotates and grades: a doomed cookie exits 1 with the reason.
$CLI explain 'sid=abc; Secure; HttpOnly; SameSite=Strict' $NOW | grep -q 'jarwise: OK' || fail "explain OK case"
set +e
DOOMED="$($CLI explain 'sid=abc; SameSite=None' $NOW)"; DOOMED_CODE=$?
set -e
[ "$DOOMED_CODE" -eq 1 ] || fail "SameSite=None without Secure should exit 1"
echo "$DOOMED" | grep -q 'explain.samesite-none-secure' || fail "explain missing the None-without-Secure note"
echo "[smoke] explain ok"

# 5. store: acceptance and each rejection name their rule.
$CLI store '__Host-sid=abc; Secure; Path=/' --url https://app.example.test/login $NOW | grep -q 'jarwise: STORED' \
  || fail "__Host- cookie should store"
set +e
OUT="$($CLI store 'sid=abc; Secure' --url http://app.example.test/ $NOW)"; CODE=$?
set -e
[ "$CODE" -eq 1 ] || fail "Secure over http should exit 1"
echo "$OUT" | grep -q 'store.secure-scheme' || fail "store trace missing store.secure-scheme"
set +e
DOMAIN_OUT="$($CLI store 'sid=abc; Domain=other.test' --url https://app.example.test/ $NOW)"
set -e
echo "$DOMAIN_OUT" | grep -q 'store.domain-match' || fail "store trace missing store.domain-match"
echo "[smoke] store ok"

# 6. store --api script models document.cookie limits.
set +e
$CLI store 'sid=abc; HttpOnly' --url https://app.example.test/ --api script $NOW >/dev/null; [ $? -eq 1 ] \
  || { set -e; fail "document.cookie HttpOnly write should exit 1"; }
set -e
echo "[smoke] --api script ok"

# 7. send explains a SameSite kill, exit 1.
set +e
SEND_OUT="$($CLI send \
  --set 'https://app.example.test/ => sid=abc; Secure; SameSite=Lax' \
  --url https://app.example.test/api --from https://news.example/ --subresource $NOW)"; SEND_CODE=$?
set -e
[ "$SEND_CODE" -eq 1 ] || fail "cross-site Lax subresource should exit 1"
echo "$SEND_OUT" | grep -q 'send.samesite' || fail "send trace missing send.samesite"
echo "$SEND_OUT" | grep -q 'BLOCKED' || fail "send should report BLOCKED"
echo "[smoke] send ok (SameSite kill traced)"

# 8. send --expect gates precisely.
$CLI send --set 'https://app.example.test/ => sid=1; Secure; SameSite=None' \
  --url https://app.example.test/x --from https://news.example/ --subresource --expect sid $NOW >/dev/null \
  || fail "--expect sid should exit 0 for a None cookie"
echo "[smoke] --expect ok"

# 9. The bundled login-redirect example: POST + 303 + __Host- survives.
$CLI trace examples/login-redirect.json $NOW | grep -q 'jarwise: OK' || fail "login-redirect.json should pass"
# The SSO example shows the classic Lax-on-POST gap, then recovery after 303.
SSO_OUT="$($CLI trace examples/cross-site-sso.json $NOW)" || fail "cross-site-sso.json should exit 0"
echo "$SSO_OUT" | grep -q 'omitted session' || fail "SSO trace should show the omitted Lax cookie"
echo "[smoke] bundled traces ok"

# 10. The http-downgrade example intentionally fails: Secure cookie eaten.
set +e
DOWN_OUT="$($CLI trace examples/http-downgrade.json $NOW)"; DOWN_CODE=$?
set -e
[ "$DOWN_CODE" -eq 1 ] || fail "http-downgrade.json should exit 1"
echo "$DOWN_OUT" | grep -q 'cart did not survive' || fail "downgrade trace missing the verdict"
echo "[smoke] downgrade trace ok (exit 1)"

# 11. trace via stdin + JSON output is valid JSON with stable fields.
printf '{"chain":[{"url":"https://app.example.test/","setCookies":["sid=1"]}]}' > "$WORKDIR/chain.json"
JSON_OUT="$($CLI trace "$WORKDIR/chain.json" --format json $NOW)" || fail "trace json failed"
echo "$JSON_OUT" | grep -q '"command": "trace"' || fail "trace json missing command field"
echo "$JSON_OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s))" \
  || fail "--format json is not valid JSON"
$CLI trace - $NOW < "$WORKDIR/chain.json" | grep -q '→ stored' || fail "trace via stdin failed"
echo "[smoke] JSON + stdin ok"

# 12. Determinism: two runs over the same input are byte-identical.
$CLI trace examples/login-redirect.json $NOW > "$WORKDIR/run1.txt"
$CLI trace examples/login-redirect.json $NOW > "$WORKDIR/run2.txt"
cmp -s "$WORKDIR/run1.txt" "$WORKDIR/run2.txt" || fail "repeat runs differ"
echo "[smoke] determinism ok"

echo "SMOKE OK"
