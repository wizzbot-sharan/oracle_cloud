# Oracle Cloud Applier — Current Context

Last updated: 2026-10-30 (session wrap-up)

## Purpose

This project scans Oracle Cloud HCM applications for multiple users, records each question and option, and later supports dashboard review. Submission is never automatic: only an approved application may submit.

## Documentation contract

- `context.md` is the authoritative current technical snapshot. It is overwritten on every `wrap up`.
- `STATE.md` is the short operational handoff: what is done, blocked, and next.
- `DECISIONS.md` is append-only and records durable choices with their reasons.
- `PROJECT.md` describes the product goal and clearly separates current implementation from planned production work.
- Historical plans and designs under `docs/superpowers/` explain past reasoning; they do not override this file.

## Active workflow

1. `npm run scan` reads `data/job-urls.json`.
2. `src/run.js` creates one fresh browser context per job and applies the configurable launch gate.
3. `src/scan-login.js` handles email, optional consent, OTP, magic-link, email-only access, CAPTCHA pauses, and the ten-second OTP verification settle. It returns the same page only as `application_ready`.
4. `src/scan-application.js` enters the manual form when required, scans every page with `src/sites/oracle/scanner.js`, fills synthetic navigation values, clicks Next only after scanning, and stops at visible Submit without clicking it.
5. `src/qa.js` validates and atomically replaces only the successful normalized job entry in `data/qa.json`.
6. `src/evidence.js` keeps run evidence below `artifacts/runs/` and immutable current evidence below `artifacts/current-qa-evidence/`.
7. `npm run viewer` reads only current QA and QA-referenced evidence; its controls are browser-memory-only.

## Active modules

- `src/config.js`: environment validation, pacing, limits, evidence level, paths, and breaker settings.
- `src/run.js`: job loading, URL normalization, launch gate, worker outcomes, circuit breaker, and cleanup.
- `src/scan-login.js`: authentication-stage orchestration.
- `src/scan-application.js`: application-stage page traversal.
- `src/qa.js`: QA normalization, validation, and atomic replacement.
- `src/evidence.js`: masked events, screenshots, manifests, partial outputs, and immutable evidence preparation.
- `src/integrations/zoho/mailbox.js`: tenant-aware OTP and magic-link polling; URLs and OTPs never enter logs.
- `src/sites/oracle/selectors.js`: the single Oracle selector catalog.
- `src/sites/oracle/scanner.js`: registry detection, grouping, options, branches, repeaters, and synthetic filling.
- `src/sites/oracle/runtime.js`: Oracle JET readiness and settle helpers.

## Safety and configuration

- Default concurrency is 1; production concurrency, launch gap, jitter, delays, and circuit-breaker threshold come from environment variables.
- The first terminal error continues to the next application; the second consecutive terminal error stops the user's remaining queue. `needs_human` pauses only its job, and `job_expired` does not count.
- CAPTCHA pauses the affected job and writes masked partial evidence before waiting for manual resolution.
- Every event carries `user_id`, `job_id`, `worker_id`, page, step, action, and result. Emails, OTPs, secrets, and magic-link URLs are masked or omitted.
- QA is global job-form metadata keyed by normalized URL and carries `scan_user_id` for audit; user answers are not stored by this scanner.

## Data and evidence

- Active jobs: `data/job-urls.json`.
- Latest successful QA: `data/qa.json`.
- Run evidence: `artifacts/runs/<run_id>/`.
- Immutable current evidence: `artifacts/current-qa-evidence/<job_hash>/<run_id>/`.
- Standard evidence: application-ready, one shared screenshot per stable page, Submit-visible, and targeted error/incomplete screenshots. Verbose mode adds field and page-after-fill screenshots.
- Historical spikes, screenshots, results, and obsolete tests are recoverable under `archive/legacy-2026-10-30/` and are not runtime dependencies.

## Verification

- `npm test` runs the cleaned active suite with one test worker.
- `npm run test:scanner` runs the active scanner fixture suite.
- A headed live validation must use concurrency 1, must not click Submit, and must be reviewed in the viewer before the scan is treated as accepted.

## Current status and next validation

- The active migration from legacy spikes is complete: no active code imports archived files.
- Fixture and static checks cover scanning, evidence, QA replacement, authentication, CAPTCHA checkpoints, circuit breaking, and viewer isolation.
- The prior Safeway scan reached visible Submit without clicking it and remains the current accepted QA evidence.
- A new complete headed validation is still required after bounding the large address-autocomplete crawl; the interrupted post-repair run made no QA or evidence changes.

## Session wrap-up

- Completed the scan-pipeline repair: immutable per-job evidence rejects collisions, QA validates manifest-backed screenshots before replacement, magic-link URLs are redacted, and viewer artifacts require the selected job plus its manifest.
- Verified focused evidence, QA, runner, viewer, scanner, registry, Zoho, and authentication fixtures; active JavaScript syntax checks also pass.
- Documentation is now maintained by contract: `context.md` is refreshed on every wrap-up, `STATE.md` records operational handoff, and `DECISIONS.md` keeps durable choices.

## Stack

Node.js + Playwright for automation, React.js planned for production dashboard, Azure PostgreSQL planned for persistence, and Railway for hosting. Secrets belong only in `.env` or Railway Variables.
