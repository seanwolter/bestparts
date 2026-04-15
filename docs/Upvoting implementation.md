# Any doofus can upvote

Guest voting is intentionally public. We believe in the wisdom of crowds. Let's all hope the robot that wrote this code is good at security. I am not looking forward to seeing this spammed.

- The homepage now sorts by vote count by default. Use `/?sort=date` to switch back to newest-first ordering.
- `POST /api/videos/<id>/upvote` does not require a session.
- The route uses a signed long-lived anonymous voter cookie. Tampered or malformed cookies are rotated safely instead of failing the request.
- Only a hash of the anonymous voter identifier is stored in PostgreSQL.
- Votes are additive only. There is no downvote or undo flow.
- The same browser can upvote the same video again after 24 hours.
- A vote cooldown returns `409` with `retryAfterMs` and `nextEligibleUpvoteAt`.
- Cross-site unsafe vote requests are rejected before the app creates a voter cookie or touches vote state.

## Vote throttling

The public upvote route has three throttle layers:

- per-video per-browser burst limit: `3` requests per `60` seconds
- per-IP endpoint limit: `30` requests per `60` seconds when a trusted client IP is available
- global endpoint limit: `300` requests per `60` seconds across all anonymous upvote traffic

Throttled vote responses return `429` with `retryAfterMs`, and set `Retry-After` when the wait is non-zero.
Rate-limits are hard-coded in `src/lib/votes/rate-limit.ts`.

`AUTH_TRUST_PROXY_HEADERS=true` also affects the public vote route. When enabled behind a trusted proxy, the app will use `X-Forwarded-For` or `X-Real-IP` for the IP-scoped vote limiter. If it stays `false`, the vote route still enforces the per-browser and global limiters, but it will skip the IP-scoped limiter.
