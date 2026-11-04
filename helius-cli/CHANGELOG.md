# Changelog

## Unreleased

### Breaking
- **`helius tx parse` and `helius tx history` use the Parsed Events API on mainnet** instead of the legacy Enhanced Transactions API, which Helius has put in maintenance mode. Requests cost 10 credits instead of 100, and output includes decoded program and instruction names and decoded program errors. Devnet, where Parsed Events is unavailable, still uses Enhanced Transactions with the old output.
- **New `--json` shape on mainnet.** `tx parse` returns one `{ signature, parserStatus, parsed }` item per signature (or `parserError` for one that couldn't be found or parsed), and `tx history` returns `{ data, paginationToken }`. Inside `parsed`, `timestamp` is now `blockTime`, `type` is the lowercase `summary.type` (`swap`, `transfer`, ...), and token amounts are raw integers with `decimals`. See the [migration guide](https://www.helius.dev/docs/parsed-events/guides/migrate-from-enhanced-transactions) for the full field mapping.
- **`tx history --type` is removed.** Parsed Events has no transaction type filter. Passing `--type` exits with an error that points to `helius tx scan`, which filters server-side by program, instruction, or token mint.
- **History defaults on mainnet:** `confirmed` commitment instead of `finalized`, and successful transactions only. Pass `--commitment finalized` or `--status any` for the old behavior.

### New
- `tx history` takes `--after`, `--sort-order`, `--status`, `--token-accounts`, `--commitment`, block time and slot bounds, and `--pagination-token`, and prints the next page's token. On devnet, `--status`, `--token-accounts`, and `--pagination-token` exit with an error, since Enhanced Transactions doesn't support them.
- `tx parse` takes any number of signatures, sending at most 100 per request.

## 2.2.0 — Parsed Events scan

### New
- **`helius tx scan <address>`** searches an address's history server-side for transactions that call specific programs or instructions, or touch specific token mints, and returns only the matches. It uses the Parsed Events scan endpoint, mainnet only.
  - Match with `--programs`, `--instructions`, `--discriminators`, and `--mints`, each comma-separated, plus `--program-scope` and `--mint-scope`. For a different instruction list per program, pass the full match as JSON with `--match`.
  - `--return-shape` picks parsed transactions (the default), signatures, or a count. Also takes `--limit`, `--max-scanned`, `--sort-order`, `--status`, `--token-accounts`, time and slot bounds, `--pagination-token`, and `--json`.
  - The match, flags, and network are validated before any request is sent.
  - A page can return no matches and still print a pagination token: pass it back with `--pagination-token` to scan further.
  - Costs 10 credits plus 1 per history page scanned (a page holds up to 1,000 transactions), so at most 20 per request at the default budget. (#222)

### Changed
- Dependency updates: **helius-sdk 3.4.0** and `@solana-program/token` 0.18. (#212, #222)

## 2.1.1 — Signup contact info

### Changed
- **New signups need contact info.** `helius signup` asks for `--email`, `--first-name` and `--last-name` when the wallet has no account yet. A wallet that already has an account can still re-run `helius signup` without them to recover its key.
- **`helius plans` lists the Agent tier as `agent` ($10 one-time).** The `--json` output key changed from `basic` to `agent`, matching `--plan agent`; the old `basic` plan was retired.
- `helius keygen` now prints the contact flags in its "Then run" hint.

## 2.1.0 — Historical token balance & safer transactions

### New
- **`helius wallet balance-at <address>`** — query a wallet's exact balance of a token (or native SOL) at a past point in time. Requires `--mint` and exactly one of `--time` (Unix seconds), `--datetime` (UTC unless a timezone is given), or `--slot`. Validates inputs locally and supports `--json`. Wallet API, 100 credits, Developer plan or higher. (#138)
- **Confirmation prompt before submitting transactions.** Transaction-sending commands now show a summary and prompt before broadcasting. (#134)
- **Confirmation prompts for destructive commands.** Commands that move funds or close accounts now confirm before proceeding. Pass `-y`/`--yes` to skip the prompt in scripts and agent runs. (#133)

### Fixed
- **`helius reclaim` now exits non-zero when batches fail to land.** Failed batches are recorded in telemetry and marked `recoverable` in the JSON error envelope, so automation can detect partial failures instead of seeing a false success. (#126)

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
