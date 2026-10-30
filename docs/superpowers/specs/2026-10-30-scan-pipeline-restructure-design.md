# Scan Pipeline Restructure Design

## Intent

Turn the Phase 0 and Phase 1 spikes into one clean production-shaped pipeline while preserving the proven authentication and Oracle question-scanning behavior. The pipeline reads one job URL file, hands the same authenticated Playwright page from login scanning to application scanning, and replaces one job URL entry in a consolidated QA JSON only after a complete stop-before-Submit scan.

The refactor is organizational. It must not broaden automation scope, click Submit, weaken masking, change CAPTCHA behavior, or discard the existing working logic before live validation.

## Goals

- Expose two clear public stages:
  - `scan-login.js`: email, optional consent, OTP/magic-link/email-only access, ten-second post-verification wait, and application-form confirmation.
  - `scan-application.js`: manual gate, page traversal, registry scanning, option capture, repeaters, synthetic navigation values, and stop-before-Submit.
- Pass the same live Playwright page and browser context between both stages.
- Read all jobs from `data/job-urls.json`.
- Maintain one `data/qa.json` containing the latest successful QA record for every normalized job URL.
- Preserve an older successful QA record when a newer attempt fails or remains incomplete.
- Reduce the active codebase to a small set of clearly owned modules.
- Move superseded spikes, legacy detectors, historical screenshots, logs, and old results into a recoverable dated archive instead of deleting them.
- Keep current tests and active fixtures outside the archive.

## Non-goals

- Submitting an application.
- Persisting dashboard answers.
- Connecting QA data to PostgreSQL.
- Resolving real-user answers.
- Optimizing every Phase 0 or Phase 1 edge case during the restructure.
- Deleting archived evidence during this change.

## Safety constraints

- Submit is observed but never activated.
- CAPTCHA pauses the affected job as `needs_human` and saves masked evidence.
- OTPs, secrets, email contents, and unmasked email addresses never enter logs, screenshots, QA JSON, or commits.
- Every job receives one fresh browser context; the two stages share that context only for that job.
- Default concurrency remains one. Launch gap, jitter, and concurrency remain environment-controlled.
- A QA update is allowed only for a validated `submit_visible` result.
- QA writes use a temporary file and atomic rename.
- Failed or partial attempts write run evidence only and never replace the last successful QA entry.

## Chosen architecture

Use one process and one live browser session per job. `src/run.js` coordinates the two public stages. `scan-login.js` returns the authenticated `page` only when it proves the application is ready. `scan-application.js` receives that page directly and returns a completed registry scan only after Submit becomes visible.

Separate processes and saved cookie handoffs were rejected because Oracle may depend on session state that is not safely or completely represented by storage state.

## Active folder structure

```text
oracle_cloud/
├── data/
│   ├── job-urls.json
│   └── qa.json
├── src/
│   ├── run.js
│   ├── config.js
│   ├── scan-login.js
│   ├── scan-application.js
│   ├── qa.js
│   ├── evidence.js
│   ├── integrations/
│   │   └── zoho/
│   │       └── mailbox.js
│   └── sites/
│       └── oracle/
│           ├── selectors.js
│           ├── scanner.js
│           └── runtime.js
├── scripts/
│   └── scan.js
├── viewer/
│   ├── server.js
│   └── index.html
├── test/
│   ├── fixtures/
│   ├── scan-login.test.js
│   ├── scan-application.test.js
│   ├── scanner.test.js
│   ├── qa.test.js
│   ├── pipeline.test.js
│   └── viewer.test.js
├── artifacts/
│   ├── runs/
│   └── current-qa-evidence/
└── archive/
    └── legacy-2026-10-30/
```

## Module responsibilities

### `src/run.js`

- Read and validate `data/job-urls.json`.
- Normalize job IDs and URLs.
- Contain the launch-gate helper and worker scheduling.
- Launch Playwright and create one fresh context per job.
- Run `scanLogin`, then conditionally run `scanApplication` with the same page.
- Commit QA only after a validated complete scan.
- Close contexts and write the run summary.

The former runner, job-source proposal, and launch-gate proposal are consolidated here because job loading and launch pacing are private pipeline concerns.

### `src/config.js`

- Parse and validate environment variables.
- Define input/output paths, delays, limits, evidence level, concurrency, and Zoho endpoint.
- Keep configuration logic separate from browser actions.

### `src/scan-login.js`

- Own the complete Phase 0 workflow.
- Handle cookies, visible email entry, optional consent, Next, OTP, magic link, email-only access, CAPTCHA, and form readiness.
- Wait ten seconds after OTP verification before final form confirmation.
- Return controlled statuses and the same page on `application_ready`.
- Never write QA.

### `src/scan-application.js`

- Own application-level Phase 1 orchestration.
- Enter the manual application flow when required.
- Wait for Oracle readiness, scan each page, fill synthetic navigation values, recover validation, and click Next.
- Stop when Submit is visible and never activate it.
- Return complete or partial scan results.

### `src/sites/oracle/scanner.js`

- Contain all question/control detection and interaction logic.
- Resolve sections, labels, containers, canonical IDs, field types, finite options, lazy popup scrolling, direct conditional branches, repeaters, composites, synthetic filling, and deduplication.
- Remain separate from `scan-application.js` because the scanner works at control level while the application stage works at page-flow level.

### `src/sites/oracle/selectors.js`

- Remain the single Oracle selector catalog.
- Contain no workflow or data persistence.

### `src/sites/oracle/runtime.js`

- Provide JET BusyContext readiness, settle helpers, and shared visibility helpers.

### `src/integrations/zoho/mailbox.js`

- Remain in its own integration folder.
- Snapshot mailbox IDs, correlate tenant/company messages, poll verification mail, parse OTPs or magic links, and return masked diagnostics.

### `src/qa.js`

- Read or initialize `data/qa.json`.
- Normalize complete Phase 1 results.
- Validate required metadata, completion status, question records, and canonical-ID uniqueness.
- Replace one normalized job URL entry.
- Write through a temporary file and atomic rename.
- Leave the current QA file untouched on any validation or scan failure.

### `src/evidence.js`

- Mask secrets and email addresses.
- Write JSONL events, summaries, partial artifacts, screenshots, and manifests.
- Produce summary or verbose terminal output.
- Enforce standard or verbose screenshot policy.

### Viewer

- `viewer/server.js` reads `data/qa.json` and current successful evidence only.
- `viewer/index.html` reconstructs local interactive controls in browser memory.
- It exposes no answer-write or Submit endpoint.

## Runtime flow

1. `npm run scan` starts `scripts/scan.js`.
2. `scripts/scan.js` loads `.env` and calls `src/run.js`.
3. `src/config.js` validates runtime settings.
4. `src/run.js` reads and validates `data/job-urls.json`.
5. `src/evidence.js` creates `artifacts/runs/<run_id>/`.
6. The launch gate allows the next job to start after the configured gap and jitter.
7. The pipeline creates a fresh browser context and calls `scan-login.js`.
8. Login scanning opens the URL, completes the applicable verification path, waits, and proves the application form is ready.
9. If login scanning fails or needs a human, the pipeline records evidence, leaves QA unchanged, and closes or pauses only that job.
10. If login scanning succeeds, the pipeline passes the same page to `scan-application.js`.
11. Application scanning enters the manual form if needed, scans each page through `oracle/scanner.js`, traverses Next, and stops before Submit.
12. If application scanning is incomplete, the pipeline records partial evidence and leaves QA unchanged.
13. If Submit is visible, `qa.js` normalizes and validates the result.
14. `qa.js` atomically replaces that job URL entry in `data/qa.json`.
15. Evidence referenced by the new current QA record is promoted to `artifacts/current-qa-evidence/<job_key>/`.
16. The context closes and the pipeline continues with the next job.
17. The pipeline writes a final run summary.

## QA data behavior

`data/qa.json` contains one current successful record per normalized job URL:

```json
{
  "schema_version": "qa-v1",
  "updated_at": "2026-10-30T00:00:00.000Z",
  "jobs": {
    "https://tenant.oraclecloud.com/hcmUI/CandidateExperience/en/job/123": {
      "job_id": "job-123",
      "url": "https://tenant.oraclecloud.com/hcmUI/CandidateExperience/en/job/123",
      "company": "Example",
      "title": "Example Role",
      "scanned_at": "2026-10-30T00:00:00.000Z",
      "detector_version": "registry-v1",
      "pages": [],
      "questions": []
    }
  }
}
```

A failed rescan does not create a second QA version and does not replace the current entry. Its diagnostic evidence remains only in the run folder.

## Evidence policy

`standard` is the approved default:

- one application-ready checkpoint after the required post-verification wait;
- CAPTCHA or authentication failure;
- one shared full-page screenshot per stable scanned application page;
- Submit-visible checkpoint;
- targeted evidence only when an application error or incomplete condition occurs, including unclassified controls, incomplete options, repeater failures, validation blocks, navigation loops, page limits, and unexpected scanner failures.

Normal fields reference their page's shared screenshot. Standard mode does not take routine per-field screenshots or routine page-after-fill screenshots. Validation captures the first failure and the final unresolved state rather than every identical retry.

`verbose` adds one screenshot per field, page-after-fill screenshots, and additional intermediate interaction evidence.

Current successful screenshots referenced by QA are promoted to `artifacts/current-qa-evidence/`. Historical run evidence can therefore be removed later without breaking the viewer.

## Archive strategy

No legacy file is deleted during the restructure. Superseded material moves to:

```text
archive/legacy-2026-10-30/
├── code/
├── screenshots/
├── results/
├── logs/
└── notes/
```

Move after equivalent active replacements exist and tests pass:

- standalone auth, batch-worker, and redirect spikes;
- legacy `fieldDetector.js` and `dynamicControls.js`;
- old question-scan entrypoints and viewer files after compatibility commands point to the new locations;
- historical batch screenshots, redirect images, debug logs, and superseded scan results;
- old learning traces and obsolete implementation notes that are not active specifications.

Keep active:

- current registry fixtures;
- authentication, scanner, pipeline, QA, viewer, and safety tests;
- dummy profile and harmless upload fixtures;
- current `data/qa.json`;
- current QA evidence;
- the latest validation run until reviewed;
- current design specifications and implementation plans.

The archive remains inside the workspace and recoverable. A later explicit cleanup request may delete it after the new pipeline passes live validation.

## Migration strategy

1. Add the new structure and tests without moving legacy files.
2. Move logic into the new modules in small test-backed steps.
3. Keep temporary compatibility wrappers for existing npm commands.
4. Run the complete fixture suite and syntax checks.
5. Run one headed end-to-end job with concurrency one.
6. Verify login handoff, complete QA replacement, viewer rendering, and stop-before-Submit.
7. Move superseded files and historical evidence into the dated archive.
8. Run tests again from the cleaned active tree.

This ordering ensures the archive operation never removes the only working copy of a behavior.

## Acceptance criteria

- `scan-login.js` is the only public login-stage entry.
- `scan-application.js` is the only public application-stage entry.
- The same live page is passed between stages.
- `data/job-urls.json` is the only active job input.
- `data/qa.json` contains one latest successful record per job URL.
- Failed and partial scans leave older successful QA entries unchanged.
- The viewer reads the consolidated QA file.
- Standard and verbose evidence modes work without leaking secrets.
- Submit remains untouched in fixtures and live validation.
- Legacy files are archived, not deleted.
- All active tests and syntax checks pass after the move.

