# bestparts
Just the best parts of movies! 

## Requirements

- npm and nvm
- Node.js `24.14.1`
- A running PostgreSQL database (install postgres or use Docker)
- A [TMDB](https://www.themoviedb.org) read access token if you want movie title autocomplete

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

## How to run this app

1. Install the required Node.js version. If you do not use `nvm`, install Node `24.14.1` manually.

```bash
nvm use
```

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

## Running Tests

The repo includes separate unit, integration, and browser test entrypoints:

- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`

Before running integration tests against PostgreSQL, make sure `DATABASE_URL_TEST` is set to a dedicated database or dedicated schema. To reset the test database to the current Prisma schema:

```bash
npm run db:test:reset
```

`db:test:reset` uses tests/setup/test-db.ts and refuses to run if `DATABASE_URL_TEST` is missing or exactly matches `DATABASE_URL`.
