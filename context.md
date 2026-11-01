# Oracle Cloud Applier — Current Context

Last updated: 2026-10-30 (session wrap-up)

## Purpose

This project scans Oracle Cloud HCM applications for multiple users, records each question and option into a structured QA repository, and supports dashboard review and automated form filling. Submission is never automatic: only an approved application may submit.

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

- `src/config.js`: environment validation, pacing, limits, evidence level, paths, breaker settings, `captureComboboxOptions`, and `defaultCountry`.
- `src/run.js`: job loading, URL normalization, launch gate, worker outcomes, circuit breaker, and cleanup.
- `src/scan-login.js`: authentication-stage orchestration with OTP polling and magic-link support.
- `src/scan-application.js`: application-stage page traversal with JET readiness checks.
- `src/qa.js`: QA normalization, validation, and atomic replacement.
- `src/evidence.js`: masked events, screenshots, manifests, partial outputs, and immutable evidence preparation.
- `src/integrations/zoho/mailbox.js`: tenant-aware OTP and magic-link polling; allows `no-reply@oracle.com` and related workflow senders; URLs and OTPs never enter logs.
- `src/sites/oracle/selectors.js`: the single Oracle selector catalog, including `repeaterEditor`, `repeaterCancel`, and `timelineDisabledAnchor`.
- `src/sites/oracle/scanner.js`: registry detection, grouping, options, branches, fast combobox mode, progressive address gating, timeline repeaters, and synthetic filling.
- `src/sites/oracle/runtime.js`: Oracle JET readiness with dual-layer race timer capped at 2,000ms.

## Phase 1 Scanning Optimizations & Fixes

1. **Combobox Fast Mode**: `SCANNER_CAPTURE_COMBOBOX_OPTIONS=false` records `option_capture.status: 'complete'` with `source: 'combobox_fast_mode'`, preventing 30s hangs on exhaustive dropdown crawls.
2. **Progressive Address Gating**: Proactively selects `SCANNER_DEFAULT_COUNTRY` ("United States") when Country is present to uncover dynamic address subfields (`Address Line 1`, `City`, `State`, `ZIP`).
3. **JET Readiness Race Timer**: Wraps `busyContext.whenReady()` in `Promise.race()` with browser `setTimeout` and Node safety guard, preventing evaluate hangs when Oracle pages maintain background heartbeat activity.
4. **Timeline Repeater Mutual Exclusion**:
   - Oracle's `<beautiful-timeline>` with `<timeline-form-inline>` disables `#timeline-anchor` when an inline form opens (`.work-and-education-timeline__actions-container--disabled`).
   - `scanRegistryRepeater` detects timeline editors via `selectors.repeaterEditor`, scans nested fields, and explicitly triggers `selectors.repeaterCancel` (`.cancel-btn`) followed by `Escape` to discard drafts cleanly.
   - Waits for the action bar disabled class to detach before scanning subsequent repeaters.
   - Fixed `labelFor` so `<button>` elements with IDs preserve their visible inner text (e.g. "Add Experience").
5. **Zoho OTP Matching**: Broadened sender matching to accept `no-reply@oracle.com`, `noreply@oracle.com`, `workflow.mail`, and `oraclecloud.com` regardless of company metadata.

## Phase 2 Architecture Design (Answering & Live Filling)

1. **Two-Layer Data Separation**:
   - **Job Blueprint (`data/qa.json`)**: Contains portal geometry, page numbers, sections, navigation steps, screenshots, and exact field locators (`control_id`, `question_container_path`).
   - **User Answer Bank (`data/answers.json`)**: Stores normalized user answers keyed by `user_id` and canonical question meaning (`question_field_id`, `question`, `field_type`, `value`, `created_at`, `updated_at`).
2. **Question Similarity & Search**:
   - 3-tier matcher: text normalization -> synonym alias dictionary -> token Jaccard similarity. Reuses answers across companies for equivalent questions.
3. **Dynamic DOM Adapters**:
   - Maps core answer values to target DOM controls (e.g. `true` maps to radio pill "Yes", select option "Yes", or boolean checkbox).
   - Repeater loop maps user work history / education arrays to sequential "+Add" -> fill -> "Save" actions.
4. **Dashboard Actions**:
   - "Save Answers": Updates `data/answers.json` and `data/qa.json`.
   - "Apply": Spawns the live site filler in headed mode.
5. **Strict Submission Gate**:
   - The filler fills all pages, stops at the final review page where "Submit" becomes visible, captures a full-page verification screenshot, and holds the session open without clicking Submit.

## Safety and configuration

- Default concurrency is 1; production concurrency, launch gap, jitter, delays, and circuit-breaker threshold come from environment variables.
- The first terminal error continues to the next application; the second consecutive terminal error stops the user's remaining queue.
- CAPTCHA pauses the affected job and writes masked partial evidence before waiting for manual resolution.
- Every event carries `user_id`, `job_id`, `worker_id`, page, step, action, and result. Emails, OTPs, secrets, and magic-link URLs are masked or omitted.
- Hard Rule: `applications.status = 'approved'` is required for any submit action; the automation must never click Submit.

## Verification

- `npm test`: Runs full repository suite (78 tests, 100% pass rate).
- `npm run test:scanner`: Runs active scanner fixture suite (41 tests, 100% pass rate).
- Test fixtures include `oracle-timeline-repeater.html` verifying sequential timeline repeater discovery without hanging.

## Stack

Node.js + Playwright for automation, React.js planned for production dashboard, Azure PostgreSQL planned for persistence, and Railway for hosting. Secrets belong only in `.env` or Railway Variables.
