# tezzeract-auth

`auth.tezzeract.com` — the central login and SSO provider for Tezzeract
products: **Tezzeract** (`app.tezzeract.com`), **Talk** (`talk.tezzeract.com`)
and **Contelli** (`contelli.co`).

One Node process serves the API, the OIDC endpoints and the built frontend from
a single origin. That is what makes the session cookie first-party, and it is
why there is no CORS configuration anywhere in this repository.

```
tezzeract-auth/
  ui/        @tezzeract/ui — shared design system (pre-existing)
  web/       Vite + React login screens
  server/    Express + oidc-provider identity service
```

---

## Contents

- [Running locally](#running-locally)
- [Environment variables](#environment-variables)
- [The API contract](#the-api-contract)
- [Access token claims](#access-token-claims)
- [Verifying a token in another service](#verifying-a-token-in-another-service)
- [Memberships are a hint](#memberships-are-a-hint)
- [Adding a new client](#adding-a-new-client)
- [Rotating keys](#rotating-keys)
- [Security posture](#security-posture)
- [Testing](#testing)
- [Deployment](#deployment)
- [Design decisions](#design-decisions)

---

## Running locally

Requires **Node 20+** and **pnpm 9** (`corepack enable pnpm`).

```bash
pnpm install
```

### Frontend only, with mocks — no database, no Supabase

The fastest way to work on the screens. The mock API lives in
`web/src/api/mocks.ts` and is reached through a dynamic import guarded by
`VITE_USE_MOCKS`, so it is **absent from a production bundle** rather than
present but unreachable.

```bash
cd web && VITE_USE_MOCKS=true pnpm dev
```

Open <http://localhost:5180/login>. Accounts the mock knows:

| Email                  | Password                | Outcome                        |
| ---------------------- | ----------------------- | ------------------------------ |
| `ok@tezzeract.com`     | `correct horse battery` | signs in                       |
| `mfa@tezzeract.com`    | `correct horse battery` | asks for a code — use `123456` |
| `locked@tezzeract.com` | anything                | rate limited                   |
| anything else          | anything                | `Incorrect email or password.` |

Add `?client_id=talk` or `?client_id=contelli` to any screen to see per-client
theming, or `?client_id=boom` to exercise the fallback-to-defaults path.

### The full stack

1. **Postgres.** Any reachable instance; migrations run automatically on boot.

   ```bash
   createdb tezzeract_auth
   ```

2. **Supabase.** A project with Email auth enabled. From _Project Settings →
   API_, take the URL and the **service role** key.

3. **Secrets.**

   ```bash
   cp .env.example .env
   openssl rand -base64 48                                  # COOKIE_SECRET
   openssl rand -base64 48                                  # CSRF_SECRET
   pnpm --filter @tezzeract/auth-server keygen              # OIDC_SIGNING_KEYS
   ```

4. **Run both halves.**

   ```bash
   pnpm dev
   ```

   The server listens on `:3000`; Vite serves the screens on `:5180` and
   proxies `/api` and the OIDC endpoints to the server, so the browser sees the
   same single origin it will see in production.

Set `ALLOW_LOCALHOST_CLIENTS=true` so the client registry accepts
`http://localhost` callbacks. The env schema **refuses** that flag when
`NODE_ENV=production` — it is rejected at startup, not ignored.

### Everything, as CI runs it

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

---

## Environment variables

`server/src/config/env.ts` validates all of these at startup and fails with a
report naming **every** problem at once. It never echoes a value, because a
malformed secret is still a secret. Full template in
[`.env.example`](.env.example).

| Variable                    | Required | Notes                                                              |
| --------------------------- | -------- | ------------------------------------------------------------------ |
| `NODE_ENV`                  |          | `development` \| `test` \| `production`                            |
| `PORT`                      |          | Default `3000`                                                     |
| `LOG_LEVEL`                 |          | Default `info`                                                     |
| `AUTH_ISSUER`               | ✅       | Bare origin, no path. The `iss` claim. Must be https in production |
| `DATABASE_URL`              | ✅       | Provider storage, sessions, limiter counters, memberships          |
| `SUPABASE_URL`              | ✅       |                                                                    |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅       | **Server-side only.** Never reaches a bundle, a log or a browser   |
| `COOKIE_SECRET`             | ✅       | ≥32 chars                                                          |
| `CSRF_SECRET`               | ✅       | ≥32 chars, different from `COOKIE_SECRET`                          |
| `OIDC_SIGNING_KEYS`         | ✅       | base64 of a JSON array of private JWKs, max 2                      |
| `ACCESS_TOKEN_TTL`          |          | Seconds, 300–900. Default `900`                                    |
| `ALLOW_LOCALHOST_CLIENTS`   |          | Dev only; refused in production                                    |
| `TRUST_PROXY_HOPS`          |          | Proxy hops to trust for `req.ip`. **Get this right** — see below   |
| `DATABASE_URL_TEST`         |          | Enables the limiter's integration tests                            |

`TRUST_PROXY_HOPS` matters more than it looks. Too high and a client can spoof
its address with `X-Forwarded-For` and walk past per-IP rate limiting; too low
and every user is counted as the proxy, so one person's failed logins throttle
everyone. Set it to the number of proxies actually in front of the service — `1`
behind a single load balancer.

Anything prefixed `VITE_` is compiled into the browser bundle. **Never put a
secret in one.**

---

## The API contract

Defined as Zod schemas in `server/src/contracts/`, which is the single source of
truth, and mirrored for the browser in `web/src/api/types.ts`. **If the two ever
disagree, the contract file is right and the mirror is the bug.**

Every request schema is `.strict()`: unknown fields are a validation error, not
silently dropped.

| Method | Path                            | Request                   | Success                                   |
| ------ | ------------------------------- | ------------------------- | ----------------------------------------- |
| `POST` | `/api/login`                    | `{email, password}`       | `{redirect_to}` or `{mfa_required: true}` |
| `POST` | `/api/signup`                   | `{name, email, password}` | `{verify_email: true}`                    |
| `POST` | `/api/forgot-password`          | `{email}`                 | `204` **always**                          |
| `POST` | `/api/reset-password`           | `{token, password}`       | `204`                                     |
| `POST` | `/api/mfa/verify`               | `{code}`                  | `{redirect_to}`                           |
| `POST` | `/api/resend-verification`      | `{email}`                 | `204`                                     |
| `POST` | `/api/logout`                   | —                         | `204`                                     |
| `GET`  | `/api/client-config?client_id=` | —                         | `{name, logoUrl, accentColor}`            |
| `GET`  | `/healthz`                      | —                         | `{status, version, checks}`               |

OIDC endpoints, from `oidc-provider`:
`/.well-known/openid-configuration`, `/authorize`, `/token`, `/jwks`,
`/userinfo`, `/end_session`, `/revocation`.

Errors are always `{ error: { code, message } }`. The code set is closed
(`server/src/contracts/errors.ts`) and **deliberately cannot distinguish** "no
such account" from "wrong password" — both are `invalid_credentials`,
`Incorrect email or password.`

### Two things clients must get right

**`prompt=consent` is required to receive a refresh token.** OIDC says an
authorization server MUST ignore `offline_access` unless `prompt` contains
`consent`, and `oidc-provider` enforces it. Request:

```
scope=openid email profile offline_access
prompt=consent
```

**Redirect URIs are matched by exact string equality.** No wildcards, no prefix
matching, no normalisation. `…/callback` and `…/callback/` are different URIs
and only the registered one works.

### CSRF

Every state-changing endpoint requires double-submit CSRF. `GET
/api/client-config` issues the `tz_csrf` cookie as a side effect, which is why
the frontend calls it on mount before any form can be submitted.

The cookie value is `token|hash`; the server compares **only the `token` half**
against the `x-csrf-token` header. Echoing the whole cookie value fails
validation. The frontend handles this in `web/src/api/auth.ts`; the delimiter is
exported from `server/src/http/middleware/csrf.ts` as a deliberate part of the
contract.

---

## Access token claims

Access tokens are JWTs signed with an asymmetric key (ES256 by default) and
published at `/jwks`. Schema:
[`server/src/contracts/claims.ts`](server/src/contracts/claims.ts), exported so
other products import it rather than re-describing it.

```jsonc
{
  "iss": "https://auth.tezzeract.com",
  "sub": "user-uuid", // userId
  "aud": "app", // client_id
  "exp": 1760000900,
  "iat": 1760000000,
  "email": "ada@tezzeract.com",
  "name": "Ada Lovelace",
  "standing": "active", // active | suspended | delinquent
  "memberships": [{ "orgId": "…", "role": "admin" }],
}
```

Roles: `owner` | `admin` | `member` | `viewer`.

The schema is `passthrough`, not `strict`: the provider adds registered claims
(`jti`, `sid`, `scope`, `client_id`) and rejecting a structurally valid token
over them would be wrong.

---

## Verifying a token in another service

**Using only the JWKS URL. No call to this service per request.**

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AccessTokenClaimsSchema } from "@tezzeract/auth-server/contracts/claims";

const JWKS = createRemoteJWKSet(new URL("https://auth.tezzeract.com/jwks"));

export async function verifyAccessToken(token: string, clientId: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: "https://auth.tezzeract.com",
    audience: clientId,
  });
  return AccessTokenClaimsSchema.parse(payload);
}
```

`createRemoteJWKSet` caches the key set and refetches on an unknown `kid`, which
is what makes [key rotation](#rotating-keys) invisible to consumers.

---

## Memberships are a hint

**Read this before using `memberships` or `standing` for an authorization
decision.**

Both claims are read from Postgres **once, at token issue time**, and embedded
in the JWT. That is precisely what allows stateless verification from `/jwks`
with no call back here — and it is the trade-off:

> A membership or standing change takes effect in a token only when the next
> token is issued. Until then, **a revoked membership continues to appear valid
> for up to the access token lifetime — at most 15 minutes.**

So:

- **Treat these claims as a cache, not as authority.** Re-check against your own
  `OrgContext` before acting.
- **Any consequential action — permission changes, billing, deletion, data
  export — must re-check.** Do not rely on the claim alone.
- `standing` gates product access without carrying a reason, so the token never
  leaks billing or moderation detail to a client.

`ACCESS_TOKEN_TTL` is capped at 900 seconds by the env schema specifically to
bound this window. An unreadable standing **fails closed** to `suspended`, and a
membership row whose role this service does not recognise is **dropped**, never
coerced into a weaker or stronger one.

---

## Adding a new client

The registry lives in version control — `server/src/config/clients.seed.ts` —
rather than in a database table, so changing who may receive a token is a
reviewed commit with an audit trail instead of an `UPDATE`.

1. Add the record:

   ```ts
   {
     client_id: "newproduct",            // lowercase, [a-z0-9_-]
     name: "New Product",
     logoUrl: "/brand/newproduct.svg",
     accentColor: "#009BE9",             // exactly 6-digit hex
     redirect_uris: ["https://newproduct.tezzeract.com/auth/callback"],
     post_logout_redirect_uris: [
       "https://auth.tezzeract.com/signed-out",
       "https://newproduct.tezzeract.com/",
     ],
   }
   ```

2. Add the logo to `web/public/brand/`.

3. Add localhost callbacks to `LOCALHOST_REDIRECT_URIS` in the same file if the
   product is developed locally.

4. Restart. The registry is validated on first use, so a malformed entry is a
   startup failure, not a surprise mid-authorization.

Notes:

- **Every** callback must be listed in full. Matching is exact.
- `accentColor` must be a 6-digit hex literal. That pattern is a security
  boundary, not a style rule: the value is interpolated into a CSS custom
  property, and the regex is what stops a client record smuggling
  `red; } html { … }` into the page stylesheet. It is re-validated in the
  browser at the point of use as well.
- Clients are **public** — Authorization Code + PKCE, `token_endpoint_auth_method:
none`. There is no client secret to distribute, leak or rotate.

---

## Rotating keys

Two keys may be active at once. The **first signs**; all are published at
`/jwks`, so tokens issued before the rotation keep verifying until they expire.

```bash
pnpm --filter @tezzeract/auth-server keygen ES256
```

1. **Prepend** the new key to the existing array — new key first, old key
   second — and deploy:

   ```
   OIDC_SIGNING_KEYS=base64([newKey, oldKey])
   ```

   New tokens are signed with the new key. Tokens already in flight still
   verify against the old one, which is still published.

2. **Wait out the longest-lived token signed by the old key.** With
   `ACCESS_TOKEN_TTL=900` that is 15 minutes; give it an hour.

3. **Drop the old key** and deploy again:

   ```
   OIDC_SIGNING_KEYS=base64([newKey])
   ```

Consumers using `createRemoteJWKSet` pick this up automatically: an unknown
`kid` triggers a refetch. No coordination with other products is needed.

The env schema caps the array at two so a rotation has one defined steady
state. Every key needs a `kid`, or `/jwks` is not addressable. Key generation is
a **script, not a runtime capability** — a deployed process has no code path
that can mint itself a signing key.

---

## Security posture

### Tokens and flows

- Authorization Code + PKCE (S256), **mandatory for every client**, no
  per-client escape hatch.
- **No** implicit flow, hybrid flow, password grant, client credentials, device
  flow or dynamic registration. Not discouraged — not enabled.
- **No** introspection endpoint: verification goes through `/jwks`, so one does
  not exist to be abused.
- Access tokens 10–15 min, asymmetric (ES256/RS256), two-key rotation.
- Refresh tokens rotate on **every** exchange. Presenting a consumed token
  revokes the **entire grant**, so a stolen token cannot be used alongside the
  legitimate one — both die and the session is re-established.
- Refresh tokens are **stored hashed**. `oidc-provider` uses the opaque token
  value as its own adapter key; the Postgres adapter SHA-256s ids and uids
  before they touch the database, so a dump, a slow-query log or a replica leak
  yields nothing presentable as a token.

### Sessions

- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, signed, scoped to the auth
  origin. **No parent-domain cookies.**
- Server-side store. There is deliberately **no second session store**: the
  provider's own `Session` is the session, so there is one source of truth for
  "is this person signed in".
- Logout destroys the session **and revokes the refresh tokens issued through
  it**. Access tokens already issued cannot be recalled — they are
  self-contained JWTs — which is exactly why their lifetime is capped at 15
  minutes.
- RP-initiated logout from a product redirects to `/end_session`, then
  `post_logout_redirect_uri` (typically `https://auth.tezzeract.com/signed-out`).
  Products pass their `client_id` as the OIDC `state` parameter so `/signed-out`
  can theme and return the user to the product home after a short countdown.
  Set `AUTH_POST_LOGOUT_LANDING_URI` or `AUTH_POST_LOGOUT_REDIRECT_URI` to that
  signed-out URL in each app; it defaults to `{AUTH_ISSUER}/signed-out`.

### Non-disclosure

- Login returns `Incorrect email or password.` for a wrong password, an unknown
  account **and** an unverified email.
- `/api/forgot-password` returns `204` whether or not the address exists, and
  signup always returns `{verify_email: true}`. Supabase emails the existing
  account owner rather than the person who submitted the form.
- Those endpoints run under a **constant-time floor**
  (`server/src/http/timing.ts`), because sending an email is measurably slower
  than declining to and that difference alone is enough to enumerate accounts
  over a few hundred requests.
- Supabase errors are mapped lossily on purpose. Provider failures log an
  operation name and status code only — never the message, which contains the
  address and the reason.

### Rate limiting and lockout

Two independent mechanisms, because they stop different attacks:

- A fixed-window counter, per IP **and** separately per account, incremented by
  a single atomic `UPSERT` so concurrent requests cannot both read a stale count
  and each decide they are under the limit.
- A consecutive-failure counter with exponential backoff that **outlives the
  window**, so slow patient guessing — a few attempts an hour, under any volume
  cap — still trips a lockout. 5 failures → 60s, doubling to a 1h ceiling,
  decaying after 24h of quiet.

Per-account limits are tighter than per-IP: many users share an office IP,
nobody legitimately tries one account thirty times a minute. Limiter keys are
hashed, so the tables throttle without doubling as a list of user emails.

### Headers, input and logs

- Strict CSP: `default-src 'self'`, `frame-ancestors 'none'`, **no nonce and no
  `unsafe-inline` anywhere**. This origin serves a login form; script injection
  here is credential theft. RP-initiated logout auto-submits via
  `/logout-confirm.js` (same-origin only) and keeps a real submit button as a
  noscript fallback.
- HSTS (1 year, subdomains, preload) in production, `no-referrer`, `nosniff`,
  `X-Frame-Options: DENY`, COOP/CORP same-origin, no `X-Powered-By`.
- `noindex` as both a header and a meta tag.
- Every input validated with Zod, unknown fields rejected.
- **No** `dangerouslySetInnerHTML` — ESLint errors on it. Query-string values are
  never rendered: `/error` uses `reason` as a lookup key into a fixed table, and
  an unrecognised value falls through to generic copy.
- **Nothing** in `localStorage` or `sessionStorage`. No token, password or
  profile. The session is an HttpOnly cookie that script cannot read.
- Redaction is enforced **at the logger**, not at call sites, because call-site
  discipline does not survive a refactor. Passwords, tokens, cookies,
  authorization headers and emails are stripped whatever a caller passes, and
  URLs are reduced to their parameter _names_ because query strings carry reset
  tokens. `server/test/log-redaction.test.ts` drives the real logger
  configuration and asserts on the emitted bytes.

### Dependency audit

`pnpm audit --prod` → **no known vulnerabilities**.

The first audit of this repo flagged four open-redirect and XSS advisories
against `react-router-dom`, a production dependency and precisely this
service's threat model; it was upgraded to 7.18.4. Remaining advisories are all
in the dev toolchain (`vitest`, `vite`, `postcss`, `tinypool`), which the Docker
build prunes out of the runtime image. Re-check with:

```bash
pnpm audit --prod        # what ships
pnpm audit               # including the toolchain
```

---

## Testing

```bash
pnpm test                                    # everything
pnpm --filter @tezzeract/auth-server test
pnpm --filter @tezzeract/auth-web test
```

**95 tests.** The server suite runs without Postgres or Supabase: the provider
uses its in-memory adapter while keeping the shipping configuration, and the
credential store and Postgres-backed modules are stubbed.

| Suite                           | Covers                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e.test.ts`                   | Full happy path: `/authorize` → login → code → `/token` → verify against `/jwks`. PKCE mandatory and S256-only, exact redirect matching, refresh rotation and reuse detection, code replay, CSRF, headers, flows that must not exist |
| `clients.test.ts`               | Ten near-miss redirect URIs: trailing slash, scheme downgrade, userinfo tricks, prefix hosts, another client's URI                                                                                                                   |
| `log-redaction.test.ts`         | Secrets stripped from the real logger, including off an Error                                                                                                                                                                        |
| `config.test.ts`                | Fail-fast env, no secret echoed in the report, window and backoff maths                                                                                                                                                              |
| `contracts.test.ts`             | Normalisation, strictness, the CSS-injection guard                                                                                                                                                                                   |
| `serving.test.ts`               | OIDC endpoints, `/api` and the SPA coexisting on one origin                                                                                                                                                                          |
| `ratelimit.integration.test.ts` | **Needs Postgres** — concurrency, decay, hashed keys                                                                                                                                                                                 |
| web `params.test.ts`            | OIDC parameters preserved across screens; `redirect_uri` never carried                                                                                                                                                               |
| web `screens.test.tsx`          | Generic error copy, non-disclosure wording, `/error` refusing to render a query value, theming fallback                                                                                                                              |

The limiter integration tests skip unless a database is available:

```bash
createdb tezzeract_auth_test
DATABASE_URL_TEST=postgres://localhost:5432/tezzeract_auth_test pnpm test
```

---

## Deployment

```bash
docker build -t tezzeract-auth .
docker run -p 3000:3000 --env-file .env tezzeract-auth
```

Multi-stage: the builder installs with `--frozen-lockfile`, builds `web/dist`
and `server/dist`, and prunes to production dependencies; the runtime stage
copies that tree and runs as the **non-root `node` user** under `dumb-init`, so
`SIGTERM` reaches the process and graceful shutdown actually runs.

`VITE_USE_MOCKS` is deliberately unset at build time, so the mock API is
eliminated from the bundle.

Operational notes:

- Migrations run on boot. For a separate pre-deploy step:
  `pnpm --filter @tezzeract/auth-server migrate`.
- `/healthz` returns `503` when Postgres is unreachable; the container
  healthcheck uses it.
- Set `TRUST_PROXY_HOPS` to the real number of proxies. See
  [Environment variables](#environment-variables).
- Expired provider records and limiter counters are swept on a 15-minute timer,
  off the request path, so a login never pays for someone else's housekeeping.

---

## Design decisions

Things a future reader is likely to question.

**`node-oidc-provider` rather than hand-rolled OIDC.** It owns `/authorize`,
`/token`, `/jwks`, `/userinfo`, discovery, PKCE enforcement, the redirect
allowlist and refresh rotation with reuse detection. Reimplementing that is how
auth services grow subtle, expensive bugs. The npm package is `oidc-provider`;
`node-oidc-provider` is the repository name.

**Postgres is required, not optional.** The provider's default adapter is
in-memory and would drop every session, authorization code and refresh token on
restart. No Redis: Postgres covers provider storage, sessions and limiter
counters at this scale, and a second datastore is a second thing to secure,
back up and lose.

**`aud` is the `client_id`, and it took work.** In `oidc-provider` v8, JWT
access tokens are issued only for resource-indicated tokens, and `aud` comes
from the resource server. Returning `audience: client.clientId` from
`getResourceServerInfo` yields `aud = client_id` exactly as the contract
specifies, with no deviation. `extraTokenClaims` supplies the profile claims and
is spread _before_ the registered ones, so it cannot overwrite `iss`, `aud`,
`sub`, `exp` or `iat`.

**The interaction UID travels in a cookie, not the request body.** `POST
/api/login` has to know which authorization request it is completing. Setting
`cookies.short.path = '/'` means the provider's own signed interaction cookie
reaches `/api/*`, which keeps the request body exactly `{email, password}` as
specified and keeps the UID out of request bodies entirely.

**`interactionResult`, not `interactionFinished`.** The latter writes its own 302. These endpoints answer with JSON so the frontend never builds a redirect
URL — it only calls `window.location.assign` on the opaque string the server
returns, and never reads `redirect_uri` from the query string.

**Consent is granted implicitly.** These are all first-party Tezzeract clients;
asking someone to approve their own company's product is a dialog with one
sensible answer. Grants are created explicitly in
`server/src/services/sessions.ts` because finishing with a consent result that
carries no `grantId` means "reuse the existing grant", and on a first sign-in
there is none.

**The provider is mounted on a path prefix list, not at the root.**
`provider.callback()` is a Koa callback that answers 404 for anything it does not
route — at the root, ahead of the static handler, it swallows `/login` and every
other screen. Mounting with an Express path would rewrite `req.url` and break
the provider's own routing, so `server/src/http/app.ts` checks the prefix and
passes the request through untouched.

**Business logic is framework-agnostic.** `server/src/services/*` contains no
Express types; the provider instance is passed in. HTTP handlers validate, call a
service and serialise.

**Supabase sits behind one interface.** Every call lives in
`server/src/services/credentials.ts` behind `CredentialStore`, so the backing IdP
can be swapped for WorkOS, Ory or Clerk by writing one implementation and
changing a single binding. No other module imports `@supabase/supabase-js`, and
the service-role key never leaves that file.

### Changes to `@tezzeract/ui`

`ui/` had no `package.json`, no barrel, no Tailwind config and no token file,
and every component imported `@/shared/utils/cn` — an alias from the app they
were lifted out of. It is now a real workspace package consumed as TypeScript
source, with those imports rewritten, a `cn` helper, a barrel and a shared
Tailwind preset. Behavioural changes, all backwards-compatible:

- **`FormField`** now associates its label with the control via `htmlFor`/`id`,
  marks the error `role="alert"`, and wires `aria-invalid`/`aria-describedby`.
  It previously rendered a label attached to nothing.
- **`Input` / `Select`** had `focus:ring-0` — no visible focus indicator at all,
  which is not acceptable on a login form. They now show a `focus-visible` ring
  driven by `--tz-accent`.
- **`TezzeractButton`** takes its gradient from the `.gradient-primary`
  utilities instead of inline hex, so a client accent reaches the brand button,
  and gained a focus ring. With the variables unset the utilities fall back to
  the original Figma values, so **rendering is unchanged for other products**.
- **`Button`**'s `gradient` variant referenced `.gradient-primary`, which
  nothing defined. The preset now defines it.
- **`FormFieldProps`** are declared `?: T | undefined` so consumers compiling
  with `exactOptionalPropertyTypes` can pass a form library's error field.
- Added the `send.svg` that `TezzeractSendButton` imported but which was absent,
  and the `React` import `skeleton.tsx` needed to typecheck.

`@ui` has no `Alert`, `Spinner`, `PasswordInput` or OTP input, so those live in
`web/src/components/`, built on `@ui` primitives rather than invented, to avoid
mutating the shared library for Talk, App and Contelli.
