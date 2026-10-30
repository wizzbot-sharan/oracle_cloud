# Scan Pipeline Restructure Repair Design

## Intent

Bring the implemented `scan-login` → `scan-application` pipeline to the acceptance level of `2026-10-30-scan-pipeline-restructure-design.md`. Preserve the successful Oracle scanner and no-submit behavior while repairing evidence isolation, QA replacement safety, secret handling, run-state handling, migration cleanup, and verification.

## Goals

- Keep one fresh browser context per job and pass the exact authenticated page to application scanning.
- Preserve the last successful QA record and its screenshots if any later scan, validation, evidence promotion, or process step fails.
- Store only the successful job's evidence in a new immutable, job-scoped evidence directory.
- Prevent OTPs, magic-link URLs, tokens, email contents, and unmasked email addresses from reaching logs, artifacts, or screenshots.
- Make completed QA records structurally valid, non-empty, canonical-ID unique, and backed by current evidence before they replace an older record.
- Return `otp`, `magic_link`, or `email_only` authentication methods accurately.
- Persist `needs_human` evidence before waiting on CAPTCHA and enforce the configured repeated-error/block circuit breaker.
- Retire all remaining obsolete imports, compatibility wrappers, commands, tests, and terminology after equivalent active tests use the new modules.
- Finish with passing active tests, syntax checks, a single headed validation, a viewer check, and a simulated failed rescan preserving the prior successful QA byte-for-byte.

## Non-goals

- No application submission, dashboard answer persistence, PostgreSQL integration, answer matching, or expansion of Oracle scanning behavior.
- No deletion of archived material.
- No OCR or additional live-job experiments beyond one explicit validation job.

## Chosen approach: immutable current evidence

Each successful scan writes normal run evidence under `artifacts/runs/<run_id>/`. After its QA record is validated, only that job's manifest-selected screenshots are copied into a staged directory under:

```text
artifacts/current-qa-evidence/<safe-job-key>/<run-id>/
```

The new QA record references that immutable directory. The write sequence is:

1. Validate the completed scan and construct the new QA record in memory.
2. Stage and validate the exact job-scoped screenshot subset without changing current QA or current evidence.
3. Atomically write/rename `data/qa.json` to reference the staged immutable evidence directory.
4. Finalize the evidence directory name only after the QA replacement succeeds, or retain it as an unreferenced recoverable staging artifact on an interruption.

Existing QA records always keep pointing to their prior evidence directory until a new valid record is committed. A job's current evidence never includes another job's screenshots. Stale unreferenced evidence can be cleaned later only by an explicit maintenance action.

## QA record and validation

`validateQaRecord(record)` becomes public and is used before any evidence promotion or file replacement. It requires:

- `status === "submit_visible"` at normalization time;
- non-empty pages and questions;
- `job_id`, normalized URL key, company, title, scan time, detector version, and `scan_user_id` metadata;
- one unique non-empty canonical ID per question;
- page/section/type/coverage and a stable screenshot reference for every ordinary captured question;
- evidence directory, run ID, and a non-empty list of manifest-selected screenshot references.

QA remains global job-form metadata, keyed by normalized job URL. `scan_user_id` identifies the isolated dummy scan that produced it; it does not make the question schema user-specific.

## Login, failure, and run state

`scanLogin` tracks its actual path and returns one of `otp`, `magic_link`, or `email_only` on `application_ready`.

When CAPTCHA is seen, the writer first records a `needs_human` partial result and masked screenshot, invokes the human callback, and waits only for that job. The result transitions only after the challenge clears or the run is interrupted.

`run` owns a configurable consecutive terminal-failure/block counter per `user_id`, defaulting to two. It does not retry the failed application: after the first terminal scan/authentication failure it records partial evidence and starts the next application. If that next application also has a terminal failure, it stops launching the user's remaining jobs, writes a circuit-breaker partial result, and leaves prior QA untouched. A successful `submit_visible` scan resets the counter. `job_expired` is recorded but does not increment it; `needs_human` pauses only its current job until manual CAPTCHA resolution and does not increment it. Browser closure and summary writing run through top-level `finally` blocks.

## Secret-safe evidence

Mailbox diagnostics may identify only safe message metadata and a generic success type. Magic-link URLs are never printed. Screenshot masking expands beyond email input controls to known visible account/email controls; no raw verification page content is stored in JSONL.

## Clean active tree

All active imports, commands, tests, viewer copy, and current documentation use `scan-login` and `scan-application`. Tests import active modules directly. Superseded compatibility wrappers and detector implementations move to `archive/legacy-2026-10-30/` only after those references are eliminated. The archive README records each moved path and replacement.

## Verification

- Unit tests cover evidence transaction ordering, per-job manifest filtering, QA validation, write/rename failures, masking, authentication-method paths, CAPTCHA persistence, circuit breaking, and cleanup.
- Viewer tests cover immutable evidence resolution and rejection of cross-job artifact paths.
- The cleaned `npm test` and syntax checks pass without imports from legacy spike paths.
- One headed job at concurrency one confirms application-ready handoff, page screenshot reuse, Submit untouched, QA/evidence commit, and viewer rendering.
- A simulated incomplete or failed rescan proves the successful QA file and referenced evidence directory remain byte-for-byte unchanged.
