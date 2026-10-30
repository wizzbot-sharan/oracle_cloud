# Project: Job application automation (Oracle Cloud careers)

## Goal
Apply to jobs on Oracle Cloud (HCM Candidate Experience) career sites on behalf of many users, using data already in our database. Anything the bot can't answer goes to a dashboard for me to fill. Nothing is submitted until I approve it.

## Scale
~200 users now, up to ~1000 later. Who the users are doesn't matter to the code; each has a `user_id`.

## Stack
Node.js + Playwright | React.js dashboard | Azure PostgreSQL | Railway | .env / Railway Variables

## Data (all in the database)
- Per-user info: mostly answers stored as columns, plus a resume link.
- Per-user job list.
- A questions table that grows: any new question the bot meets gets added.
- Everything keyed by `user_id`. Schema draft in docs/DB_SCHEMA.md.

## Two-phase workflow
1. SCAN: open job URL, log in with a dummy email (OTP if asked), walk the whole application, extract every question.
2. RESOLVE: for each question, try to fill from user info, then resume, then saved answers, then matching algorithms (docs/MATCHING.md).
3. DASHBOARD: unresolved questions are shown. I answer them. Answers are saved per user and reusable.
4. SUBMIT: reopen the URL, log in with the user's real credentials, fill everything, stop at the review step, show it in the dashboard.
5. APPROVE: only after I click Approve does the bot press submit.
6. Repeat per user.

## Application status lifecycle
queued > scanning > scanned > awaiting_answers > ready > filled_awaiting_approval > approved > submitting > submitted
Side states: needs_human (CAPTCHA/OTP/block), failed.

## Success per application
Submitted + confirmation page seen + screenshot saved + status shown in the dashboard.

## OTP handling
Mailbox is Gmail or Zoho. Try fetching the OTP automatically (IMAP / connector); if that fails, the bot asks me or the user to type it in the dashboard. Mailbox access needs the user's consent.

## Run mode
Headed browser for now so I can solve a CAPTCHA by hand. The bot pauses until I do. See open question on Railway in STATE.md.

## Concurrency
Concurrency is configurable and must be sized to the production infrastructure, workload, and observed portal limits. The system is intended to serve multiple users, while pacing, per-company controls, and circuit breakers prevent unsafe request bursts.

## Risks to test early
- Playwright bot detection on Oracle Cloud pages.
- CAPTCHA (image challenge on the email page).
- Whether automation gets accounts or IPs blocked.

## Out of scope for now
Other ATS platforms (Workday, Greenhouse...) and auto-submit.
