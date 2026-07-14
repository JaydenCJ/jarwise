# jarwise examples

Three redirect-chain scenarios and a CI gate script. Run them from the
repository root after `npm install && npm run build`.

## login-redirect.json — the happy path

A POST login on `app.example.test` sets a `__Host-` session cookie and
answers `303 See Other`. The 303 rewrites the follow-up to GET, the cookie
is host-locked and Secure, and it rides the redirect to the dashboard.

```bash
node dist/cli.js trace examples/login-redirect.json
# → jarwise: OK — the chain behaves as expected (exit 0)
```

## cross-site-sso.json — the classic SameSite login loop

You are already logged in at `app.example.test` (the `seed` block). An
identity provider on another site POSTs back to your callback URL. The
session cookie has no SameSite attribute, so browsers enforce Lax — and
Lax does not ride a cross-site POST. The callback arrives logged out;
after the 303 turns the chain into a GET, the cookie reappears.

```bash
node dist/cli.js trace examples/cross-site-sso.json
# hop 1: omitted session … SameSite=Lax (defaulted) blocks cross-site POST navigations
# hop 2: Cookie: session=e91bd0
```

## http-downgrade.json — Secure cookies vanish on plaintext hops

Checkout on https sets a Secure `cart` cookie, then a legacy redirect
bounces through plain http. The Secure cookie is withheld from that hop.
This scenario **intentionally exits 1**: the `expect` list says `cart`
must reach the final hop, and it does not.

```bash
node dist/cli.js trace examples/http-downgrade.json
# → jarwise: FAIL — cart did not survive the chain (exit 1)
```

## ci-gate.sh — assert your login flow in CI

Runs the login-redirect scenario and fails the pipeline if the session
cookie ever stops surviving the flow — for instance after someone "just
tightens" SameSite or moves the callback to another subdomain.

```bash
bash examples/ci-gate.sh
```
