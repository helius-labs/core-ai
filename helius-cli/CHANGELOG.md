# Changelog

## 2.1.0 — Historical token balance

### New
- **`helius wallet balance-at <address>`** — query a wallet's exact balance of a token (or native SOL) at a past point in time. Requires `--mint` and exactly one of `--time` (Unix seconds), `--datetime` (UTC unless a timezone is given), or `--slot`. Validates inputs locally and supports `--json`. Wallet API, 100 credits, Developer plan or higher. (#138)

## 2.0.0 — Breaking change: OAuth/PKCE login

`helius login` now opens your browser to authenticate via dashboard.helius.dev, instead of signing a message with a local Solana keypair.

### Breaking
- **`helius login -k <keypair>` / `--keypair` flag removed.** The new flow uses OAuth 2.0 Authorization Code Grant + PKCE (RFC 7636 + RFC 8252) — same pattern as `aws sso login`, `gh auth login`, `vercel login`. Wallet-based account creation continues to work via `helius signup`; only the auth-token retrieval path changed.
- If you previously authenticated with `helius login -k`, your cached JWT in `~/.helius/config.json` keeps working until it expires. The next time you need to re-authenticate, run `helius login` (no flag).

### New
- `helius login` — browser-based authentication for users with existing dashboard.helius.dev accounts. Supports four auth methods: email/password, Google, GitHub, and **wallet** (Solana signature).
- `helius login --no-browser` — prints the URL for manual paste (useful in remote/headless environments).
- `helius login --json` — emits `{ status: "AWAITING_CALLBACK", verification_uri }` while waiting and `{ status: "SUCCESS", user, expires_at }` on completion.
- Already-logged-in short-circuit: a second `helius login` with a valid JWT prints `Already logged in as <email>.` (or `wallet <pubkey>` for wallet sessions) and exits 0.
- **`helius logout`** — clears the local session token. Default keeps the API key so RPC calls still work; `--all` wipes the entire config.
- **`helius whoami`** — shows the authenticated identity (email or wallet pubkey), session expiry, project, API key, and network. `--verify` pings the backend to confirm the token is still valid server-side. `--json` for scripting.
- "No projects found" guidance updated across `projects`, `status`, `apikeys` to point users at the dashboard for project creation (the CLI cannot create projects for OAuth-authenticated users — that gate is enforced backend-side and is a separate ticket).

### Not supported
- **WorkOS SSO users**: rejected at the backend with a clean error message. Enterprise SSO users typically have their CLI access provisioned via the org admin portal; this is consistent with the existing domain-lockdown check that already rejects SSO at `/oauth/token`.

### Security
- PKCE binds each auth code to the originating CLI invocation. Public OAuth client per RFC 8252 §6 — no client secret.
- Loopback redirect on `127.0.0.1` (literal IPv4, not `localhost`) per RFC 8252 §7.3, random ephemeral port via `:0`.
- 5-minute timeout on the loopback listener; CSRF defense via `state` round-trip.

## 1.3.0

Previous releases — see git history.
