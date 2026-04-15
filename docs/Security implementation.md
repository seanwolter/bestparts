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
