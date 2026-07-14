#!/usr/bin/env bash
# CI gate: fail the pipeline when the login flow's session cookie stops
# surviving its redirect chain. Pin --now so runs are reproducible.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

node dist/cli.js trace examples/login-redirect.json \
  --expect __Host-sid \
  --now 2026-07-13T12:00:00Z \
  --format json > /dev/null

echo "ci-gate: session cookie survives the login redirect"
