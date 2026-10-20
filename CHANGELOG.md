# Changelog

## 2026-10-20

### Fixed

- Production admin Google sign-in failed with a generic `error=google` because Neon lacked `admins.google_sub` after the Desk→Admin cutover. Schema applied; `kakaiphil@gmail.com` seeded; `ADMIN_GOOGLE_EMAILS` set on Vercel.
- Login pages no longer collapse `network` / `server_error` into the generic Google failure message.

## 2026-10-07

### Added

- Admin Ledger lists every block (with hashes and verify walk), not only the intact/broken status line.

### Changed

- Admin dashboard Home is module tiles (icon + label) instead of overview stat cards.
- Admin Money tabs: Treasury → **Balances**, Payments → **In/Out**. Invest is its own bottom-nav module at `/admin/invest` (old `?lane=invest` redirects).
- Admin Money **In/Out** is now **Deposits** and **Draws** (`?lane=deposits`, `?lane=draws`; old `?lane=payments` opens Deposits).

## 2026-10-06

### Added

- Pot shows a centered **Deposit** button under the bowl; it opens Transact on Deposit with the amount field focused.

### Changed

- Member money flow renamed: **Move** → **Transact** (`/transact`, `/move` redirects), **Add** → **Deposit**, **Out** → **Draw** (UI, receipts, and PDF labels).

### Removed

- Member portal no longer shows the Invest buy (`+`) control or the ledger book on Pot and Transact. Buying holdings and the full ledger stay on Admin.
- Demo group seed (four `@hackstreet.local` members, sample deposits, transfers, and NSE marks). Seed now only ensures the genesis block, loan product catalogue defaults, and Google admins. `SEED_PASSWORD` is no longer required.

### Fixed

- Google cert and token fetches retry three times (10s each, linear backoff) so transient VPN/IPv6 egress blips do not abort member or admin sign-in as `google_network`.

## 2026-10-05

### Added

- Admin can create and edit loan products (Products lane `+` / tap-to-edit sheet). Catalogue is DB-backed; seed only inserts missing codes.
- Admin can buy investments from Money → Invest (`+` sheet) and open holding detail. Symbols, quotes, and buy are admin-authenticated.

### Changed

- Ops moved from the retired Desk SPA to **Admin** at `/admin` with Google-only sign-in (`ADMIN_GOOGLE_EMAILS`). Bookmark paths under `/desk` redirect to `/admin`. Session cookie is `hs_admin`; session rows live in `admin_sessions`.
- Admin Money and Loans lane tabs are centered like member Profile tabs.

### Removed

- Desk password login (`DESK_EMAIL` / `DESK_PASSWORD`), the Desk Vite SPA, and unused password verification for admins.

### Fixed

- API timestamps and Daraja Nairobi time follow network UTC when the host clock is wrong (internal-app realTime pattern).
- API DNS prefers IPv4 so Google sign-in does not fail as `google_network` on hosts with broken IPv6.
- `./start.sh` no longer reports a Docker-published port (e.g. **5433**) as free when `ss -p` omits PIDs. It detects LISTEN state, stops containers that publish the port, then kills host listeners before starting Postgres.
- `./start.sh` no longer treats a healthy compose DB as ready when the host port is unpublished (`NetworkSettings.Ports={}`). It recreates the container and waits until `127.0.0.1:POSTGRES_PORT` accepts connections before migrate/seed.

## 2026-10-03

### Added

- Live Add STK routes to a Coop (or other) paybill account via `MPESA_ACCOUNT_NUMBER` (Daraja `AccountReference`, max 12 characters). `MPESA_SHORTCODE` remains the business / paybill number. README includes a zero-to-live Daraja + Coop checklist.
- Config tests cover live M-Pesa requirements, including a required account number.

### Changed

- STK no longer puts the internal payment id in `AccountReference`; correlation stays on `CheckoutRequestID` / `MerchantRequestID`. Send stays ledger-only. Out stays Daraja B2C (fund the float from the Coop account after go-live).

## 2026-10-01

### Changed

- Local and production books moved from MariaDB to **Postgres** (`pg`). Docker Compose runs Postgres 16 on port **5433**. Schema is applied with `npm run db:migrate`; seed with `npm run db:seed` (no longer on every API boot).
- Production target is **Vercel** (SPA + serverless Express), **Neon** (pooled `DATABASE_URL`), and **Upstash Redis** (Google sign-in rate limit). Closes run on Vercel Cron at 00:01 Africa/Nairobi.

### Added

- You shows notifications ten at a time, with the same previous / next control as the ledger.
- The loan form shows a read-only repayment amount under the amount. It is the amount plus that loan type's interest for the term.
- Add, Out, and Send on Move open a stepper. Add uses Daraja STK, Out uses Daraja B2C, and Send confirms an in-pot transfer. Each confirmed move has a receipt you can download or open from Activity on You. `MPESA_MODE=mock` settles locally until live credentials are set.

- Home shows **My Goal** above the pot. Enter a target once; it then displays as `KES …` in the ledger font. Tap the figure to edit again. Money amount fields (goal and Move) share live thousand commas and amount-in-words. A green check to the right of the goal field saves it and stays aligned with the bottom line when the amount wraps. The orange fill is claim ÷ goal (full bowl = goal met). The Move pot uses the same fill. Pot and Move snap the level on load — no breathing or fill spring.
- Invest lists holdings only. A plus in the top right opens the buy page.
- The buy share menu lists NSE names Kingdom Securities can trade, ten at a time, with search and previous / next. Tickers stay off the menu; the company name is enough.
- That menu is the app dropdown. Rows are centered, and it has no placeholder. Send on Move uses it for the group list.
- A buy stores the date, the shares, the shillings spent, and the last published Nairobi close. At 00:01 Africa/Nairobi the day move updates from the free NSE pages, green for a gain and red for a loss.

### Fixed

- The Move pot uses the same fill as the home pot. An empty claim sits at the bottom of the bowl.
- Google sign-in finishes in the browser, the same way Sherehe does. The API callback only hands the code back to `/login`. The verifier stays in this tab, so a stripped cookie on the way to Google cannot fail the sign-in.
- Token expiry follows Google's `Date` header. A laptop clock that is hours off no longer rejects a fresh sign-in.

### Changed

- Loan details sits a little lower under the capacity figure. The product control is labeled Loan type. Amount, repayment, loan type, and M-Pesa values share one mono size, and a click anywhere in an amount pill focuses that whole field.
- Loan details opens on a centered capacity mark (`Up to` + the KES ceiling) instead of a plain title. Purpose is no longer collected on the form. Amount fields center their figures. M-Pesa number fields use the same pill radius as other inputs.
- The login pot stamp reads Pesa over Matters, in Syne rather than the ledger mono.
- A confirmed move's receipt number is the first 12 digits of its ledger block hash, grouped for reading. Mock and in-pot sends no longer invent a `MOCK…` or `POT…` code. The on-screen slip and the PDF use the same slip, ember bar, and mono number.
- The home screen’s top-right control is the orange ledger button. It opens the ledger. The slips sheet is gone from that screen.
- The ledger control on Pot and Move is an open book. It still opens the ledger.
- Unauthenticated visitors are gated to `/login` immediately. The home screen no longer paints a "Sign in to continue." alert over Explore tiles.
- Session flow matches the internal app pattern: Vite cookie gate on HTML navigations, client `SessionProvider`, and any protected API 401 hard-redirects to login with a safe `returnTo`.
- Google sign-in preserves `returnTo` through the OAuth round-trip.

## 2026-09-30

### Changed

- Back navigation is a circular arrow button on every nested screen.
- Module cards, panels, forms, and related module content sit centered.

### Fixed

- Google sign-in no longer loses the attempt on the way back from Google. The sign-in page stores the attempt before the browser leaves.

### Changed

- Sign-in is Continue with Google. Email and password login and self-serve password registration are gone. A verified Google account joins the group or resumes the member with that email.

### Added

- `./start.sh` frees the Vite, API, and (when needed) Postgres ports, starts the local stack, waits until healthy, and opens the app in the browser.
- Hackstreet PesaMatters: a React and Express group pot on Postgres, with a hash-linked ledger for deposits, withdrawals, member transfers, and investment marks.
- Phone-first pot screen, move, investments with a price path, a full ledger, and a profile with per-device System / Light / Dark.
- Sandbox Kingdom Securities labeling. Broker credentials are not collected or stored.
