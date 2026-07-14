# Rule catalog

Every store/send decision is a trace of named checks; every parse quirk is
a named note. Ids are stable API: they are never renumbered or repurposed,
only added. References point into RFC 6265bis (draft-ietf-httpbis-rfc6265bis,
the revision of RFC 6265 that current browsers implement) and the CHIPS
draft for `Partitioned`.

## Parse notes (`parse.*`)

| Id | Level | Fires when |
|---|---|---|
| `parse.ctl-char` | error | a control character (%x00-08, %x0A-1F, %x7F) appears anywhere — the whole header is dropped |
| `parse.empty` | error | both name and value are empty — the header is ignored |
| `parse.oversize` | error | name+value exceed 4096 bytes — dropped, not truncated |
| `parse.no-equals` | warn | no `=` in the pair — the string becomes a nameless cookie's value |
| `parse.name-token` | warn | the name contains non-token characters |
| `parse.attr-oversize` | warn | one attribute value exceeds 1024 bytes — that attribute is ignored |
| `parse.expires-invalid` | warn | the Expires date fails the cookie-date algorithm |
| `parse.max-age-invalid` | warn | Max-Age is not an optionally-signed integer |
| `parse.samesite-unknown` | warn | SameSite is not Strict/Lax/None — treated as absent |
| `parse.domain-empty` | warn | an empty Domain attribute — ignored, cookie stays host-only |
| `parse.domain-dot` | info | the leading dot on Domain was stripped |
| `parse.path-default` | info | Path does not start with `/` — default-path applies |
| `parse.flag-value` | info | Secure/HttpOnly were given a value — ignored |
| `parse.duplicate-attr` | info | a duplicate attribute — the later one wins |
| `parse.quoted-value` | info | the value is wrapped in double quotes — they are kept |
| `parse.unknown-attr` | info | an unrecognized attribute — ignored |

## Storage checks (`store.*`, RFC 6265bis §5.7)

| Id | Rejects when |
|---|---|
| `store.httponly-api` | `document.cookie` tries to create an HttpOnly cookie |
| `store.prefix-secure` | a `__Secure-` name lacks Secure or a secure origin |
| `store.prefix-host` | a `__Host-` name lacks Secure, a secure origin, `Path=/`, or carries Domain |
| `store.secure-scheme` | a Secure cookie is set from plain http (loopback origins are trustworthy) |
| `store.samesite-none-secure` | SameSite=None without Secure |
| `store.samesite-cross-set` | a cross-site subresource response sets a SameSite Strict/Lax (or defaulted) cookie |
| `store.public-suffix` | Domain names a public suffix other than the host itself |
| `store.domain-match` | the host does not domain-match the Domain attribute (IPs never match a parent) |
| `store.partitioned` | Partitioned without Secure |
| `store.secure-overwrite` | an insecure origin would shadow an existing Secure cookie with the same name and overlapping scope |
| `store.httponly-overwrite` | `document.cookie` would replace an existing HttpOnly cookie |
| `store.path` | never — reports the effective path (attribute or default-path) |
| `store.lifetime` | never — reports session/persistent/deletion status |

## Send checks (`send.*`, RFC 6265bis §5.8.3)

| Id | Omits when |
|---|---|
| `send.host-only` | a host-only cookie's domain is not exactly the request host |
| `send.domain-match` | the request host does not domain-match the cookie domain |
| `send.path-match` | the request path does not path-match the cookie path |
| `send.secure` | a Secure cookie would ride plain http (loopback excepted) |
| `send.httponly` | never for HTTP requests — the trace explains HttpOnly only hides from scripts |
| `send.samesite` | Strict on any cross-site request; Lax on cross-site subresources or unsafe-method navigations |
| `send.partitioned` | the partition key differs from the current top-level site |

## Fidelity notes

- SameSite absent or unrecognized is enforced as **Lax** and labelled
  `defaulted` — the modern-browser behavior. Chrome's two-minute
  "Lax-allowing-unsafe" (Lax+POST) grace window is *documented* in
  `explain` output but not simulated in 0.1.0.
- Same-site comparison is **schemeful** (scheme + registrable domain), so
  `http://` and `https://` twins are cross-site.
- The public-suffix data is a compact embedded snapshot (common ccTLD
  registries, major hosting suffixes, the `*.ck`/`!www.ck` pair to keep
  the matcher honest, and the reserved `example`/`test`/`invalid`
  suffixes). Unknown multi-label suffixes fall back to "last label",
  exactly like a browser with an empty PSL.
- Ports never participate in any cookie decision, matching the RFC.
