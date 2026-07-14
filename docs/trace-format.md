# Scenario format (`jarwise trace`)

A scenario is one JSON object describing a single request chain — a
navigation or a subresource fetch — hop by hop. `jarwise trace` replays
it against a fresh in-memory jar and reports, per hop, which cookies were
sent (and which rule ate the rest) and what each `Set-Cookie` did.

```json
{
  "initiator": "https://app.example.test/",
  "kind": "navigation",
  "method": "POST",
  "seed": [
    { "url": "https://app.example.test/login", "setCookie": "session=1; Secure; Path=/" }
  ],
  "chain": [
    { "url": "https://app.example.test/login", "status": 303,
      "setCookies": ["__Host-sid=abc; Secure; HttpOnly; Path=/"] },
    { "url": "https://app.example.test/home" }
  ],
  "expect": ["__Host-sid"]
}
```

## Fields

| Key | Default | Effect |
|---|---|---|
| `initiator` | `"address-bar"` | Where the chain starts: a URL, or the address bar (always same-site). |
| `kind` | `"navigation"` | `navigation` (top-level) or `subresource` (fetch/XHR/img/iframe). |
| `method` | `"GET"` | Method of the first hop; later hops follow redirect rewriting. |
| `seed` | `[]` | Cookies that already exist: each `{url, setCookie}` is stored same-site before the chain runs. |
| `chain` | required | Ordered hops. Each hop: `url` (required), `status` (default `302` for non-final hops), `setCookies` (array of Set-Cookie header values). |
| `expect` | `[]` | Cookie names that must be attached to the final hop's request; any miss makes the exit code 1. |

## Semantics worth knowing

- **Method rewriting** — a `303` always turns the next hop into GET;
  `301`/`302` do so only for POST; `307`/`308` preserve the method.
  This is why a Lax cookie missing on a POST callback "comes back" one
  hop later.
- **Same-site for navigations** — every hop is compared against the
  original initiator, the way browsers treat top-level navigations.
  Address-bar chains are same-site throughout.
- **Redirect taint for subresources** — a subresource hop is same-site
  only while the initiator *and every URL in the chain so far* share one
  schemeful site. One cross-site bounce taints the remainder of the
  chain, even if it returns to the original site.
- **Setting under cross-site contexts** — hops that are cross-site can
  only set `SameSite=None; Secure` cookies unless the chain is a
  top-level navigation (matching the storage-model restriction).
- **Clock** — pass `--now <ISO 8601>` to pin expiry arithmetic;
  otherwise the real time is used.
