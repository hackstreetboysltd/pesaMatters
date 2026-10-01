# Changelog

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
- That menu is the app dropdown. Rows are centered, and it has no placeholder. Send on Move uses it for the crew list.
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

- Sign-in is Continue with Google. Email and password login and self-serve password registration are gone. A verified Google account joins the crew or resumes the member with that email.

### Added

- `./start.sh` frees the Vite, API, and (when needed) Postgres ports, starts the local stack, waits until healthy, and opens the app in the browser.
- Hackstreet PesaMatters: a React and Express crew pot on Postgres, with a hash-linked ledger for deposits, withdrawals, member transfers, and investment marks.
- Phone-first pot screen, move, investments with a price path, a full ledger, and a profile with per-device System / Light / Dark.
- Sandbox Kingdom Securities labeling. Broker credentials are not collected or stored.
