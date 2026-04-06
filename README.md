# bestparts
Just the best parts of movies!

## Requirements

- npm and nvm
- Node.js `24.14.1`
- A running PostgreSQL database (install postgres or use Docker)
- A TMDB read access token if you want movie title autocomplete

## PostgreSQL setup

You need PostgreSQL before running Prisma migrations or the integration test workflow. Keep the application database and test database separate. The current test helpers expect `DATABASE_URL_TEST` to point at a dedicated database or dedicated schema that is not the same value as `DATABASE_URL`.

Recommended local names:

- App database: `bestparts`
- Test database: `bestparts_test`

### Option 1: Local PostgreSQL

If PostgreSQL is already installed on your machine, create a local database and point the app at it.

1. Start PostgreSQL. You probably installed if via homebrew.
2. Create the app and test databases:

```bash
createdb bestparts
createdb bestparts_test
```
   
3. Set both database URLs in `.env` using your local PostgreSQL credentials. If you used the default setup there won't be a password. Your username should match your login username.

```env
DATABASE_URL="postgresql://<username>@localhost:5432/bestparts?schema=public"
DATABASE_URL_TEST="postgresql://<username>@localhost:5432/bestparts_test?schema=public"
```

### Option 2: Docker

If you do not want to install PostgreSQL directly, run it in Docker:

```bash
docker run --name bestparts-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=bestparts \
  -p 5432:5432 \
  -d postgres:16
```

Create the separate test database after the container is running:

```bash
docker exec bestparts-postgres createdb -U postgres bestparts_test
```

Then use this in `.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bestparts?schema=public"
DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:5432/bestparts_test?schema=public"
```

If you stop the container later, restart it with:

```bash
docker start bestparts-postgres
```

## Run locally

1. Install the required Node.js version.

```bash
nvm use
```

   If you do not use `nvm`, install Node `24.14.1` manually.

2. Install dependencies.

```bash
npm install
```

3. Create your local environment file.

```bash
cp .env.example .env
```

4. Update `DATABASE_URL` in `.env` to point at your PostgreSQL instance. Example:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bestparts?schema=public"
DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:5432/bestparts_test?schema=public"

SESSION_SECRET="replace-with-a-long-random-secret"
WEBAUTHN_RP_NAME="bestparts"
WEBAUTHN_RP_ID="localhost"
WEBAUTHN_ORIGIN="http://localhost:3000"
AUTH_TRUST_PROXY_HEADERS="false"

TMDB_TOKEN="your_tmdb_read_access_token"
```

`TMDB_TOKEN` is optional for basic use, but movie title suggestions will not work without it.

`SESSION_SECRET`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, and `WEBAUTHN_ORIGIN` are required for the passkey auth flows and should be set to real local values before signing in or registering passkeys.

`AUTH_TRUST_PROXY_HEADERS` is optional. Leave it `false` unless your deployment sits behind a trusted proxy or load balancer that overwrites `X-Forwarded-For` or `X-Real-IP` before traffic reaches the app. This setting affects both public vote IP throttling and auth throttling.

5. Create the database schema locally.

```bash
npm run db:migrate
```

6. Start the development server.

```bash
npm run dev
```

7. Open [http://localhost:3000](http://localhost:3000).

## Test database workflow

The repo now includes separate unit, integration, and browser test entrypoints:

- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`

Before running integration tests against PostgreSQL, make sure `DATABASE_URL_TEST` is set to a dedicated database or dedicated schema.

To reset the test database to the current Prisma schema:

```bash
npm run db:test:reset
```

`db:test:reset` uses tests/setup/test-db.ts and refuses to run if `DATABASE_URL_TEST` is missing or exactly matches `DATABASE_URL`.

## Any doofus can upvote

Guest voting is intentionally public. We believe in the wisdom of crowds. Let's all hope the robot that wrote this code is good at security. I am not looking forward to seeing this spammed.

- The homepage now sorts by vote count by default. Use `/?sort=date` to switch back to newest-first ordering.
- `POST /api/videos/<id>/upvote` does not require a session.
- The route uses a signed long-lived anonymous voter cookie. Tampered or malformed cookies are rotated safely instead of failing the request.
- Only a hash of the anonymous voter identifier is stored in PostgreSQL.
- Votes are additive only. There is no downvote or undo flow.
- The same browser can upvote the same video again after 24 hours.
- A vote cooldown returns `409` with `retryAfterMs` and `nextEligibleUpvoteAt`.
- Cross-site unsafe vote requests are rejected before the app creates a voter cookie or touches vote state.

### Vote throttling

The public upvote route has three throttle layers:

- per-video per-browser burst limit: `3` requests per `60` seconds
- per-IP endpoint limit: `30` requests per `60` seconds when a trusted client IP is available
- global endpoint limit: `300` requests per `60` seconds across all anonymous upvote traffic

Throttled vote responses return `429` with `retryAfterMs`, and set `Retry-After` when the wait is non-zero.
Rate-limits are hard-coded in `src/lib/votes/rate-limit.ts`.

`AUTH_TRUST_PROXY_HEADERS=true` also affects the public vote route. When enabled behind a trusted proxy, the app will use `X-Forwarded-For` or `X-Real-IP` for the IP-scoped vote limiter. If it stays `false`, the vote route still enforces the per-browser and global limiters, but it will skip the IP-scoped limiter.

## Security Shit
### Auth throttle policy

The public auth routes intentionally do not trust `X-Forwarded-For` or `X-Real-IP` by default.

- Login throttling keys off the normalized submitted username.
- Setup throttling keys off the hashed setup token value.
- Rotating spoofed forwarding headers should not create fresh throttle buckets in the default configuration.

If you deploy behind a proxy that overwrites forwarding headers and you want auth throttling and public vote throttling to include the proxy-derived client IP, set `AUTH_TRUST_PROXY_HEADERS=true`.

Only enable that mode when the proxy is part of your deployment boundary and the app is not reachable in a way that lets clients supply those headers directly. If that guarantee does not hold, leave the setting off.

### Auth protection storage

Replay markers and auth throttle buckets now live in PostgreSQL instead of process-local memory.

- `ConsumedCeremonyNonce` stores hashed ceremony nonce identifiers until each ceremony expires.
- `AuthThrottleBucket` stores hashed throttle keys and reset windows for the public auth routes.
- Expired rows are pruned opportunistically during auth reads and writes, so normal traffic gradually cleans up old protection state without a separate required cron job.
- Because the protection state is shared, replay rejection and throttling remain effective across app restarts and across multiple app instances that use the same database.

### Login failure behavior

The login flow is intentionally non-distinguishing.

- `/api/auth/login/options` returns the same outward success behavior for real and fake usernames.
- `/api/auth/login/verify` returns the same generic `Authentication failed.` error for unknown usernames, wrong passkeys, malformed WebAuthn payloads, expired or missing ceremony state, and replayed ceremonies.
- Avoid changing the status codes, response shapes, or visible UI messaging in a way that reveals whether a username exists.

### Bootstrap first admin

The first admin bootstrap path uses a one-time CLI script, not direct seed data.

Run it like this:

```bash
npm run db:bootstrap-admin -- --username your-admin-handle
```

Optional flags:

- `--base-url http://localhost:3000` overrides the origin used when printing the setup URL
- `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_BASE_URL` can be used instead of CLI flags

Behavior:

- Creates the first `ADMIN` user in `PENDING_SETUP` if no users exist yet
- Reuses the same bootstrap username if it already exists and still has no registered passkeys
- Revokes any older unused bootstrap setup tokens for that pending user before issuing a fresh single-use setup URL
- Refuses to run if a different user already exists, so it does not silently mutate an initialized system

The printed setup URL is the out-of-band bootstrap path for first-time passkey enrollment. Keep it private.

### Admin user management

After the first admin has completed setup and can sign in, the app exposes `/admin/users` for day-to-day user management.

From there an authenticated admin can:

- create another username-only admin in `PENDING_SETUP`
- issue an initial enrollment link
- issue an add-passkey link for a user who already has a working passkey
- run a recovery flow that revokes existing passkeys, sessions, and outstanding setup links before issuing a replacement URL

## Useful commands

- `npm run dev` starts the Next.js dev server
- `npm run build` generates the Prisma client, applies deploy migrations, and builds the app
- `npm run start` starts the production build
- `npm run typecheck` runs TypeScript without emitting files
- `npm run test` runs the unit and integration suites
- `npm run test:unit` runs the Vitest unit project
- `npm run test:integration` runs the Vitest integration project
- `npm run test:e2e` runs the Playwright browser test suite
- `npm run db:migrate` creates and applies local Prisma migrations
- `npm run db:bootstrap-admin -- --username <username>` creates the first admin and prints a single-use setup URL
- `npm run db:test:reset` force-resets the dedicated test database to the current Prisma schema
- `npm run db:generate` regenerates the Prisma client
- `npm run db:studio` opens Prisma Studio
