# Scan Pipeline Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `test-driven-development`, then `executing-plans`, task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active spike-shaped workflow with a compact `scan-login` → `scan-application` pipeline that updates one consolidated QA JSON only after a complete stop-before-Submit scan.

**Architecture:** One process creates a fresh browser context per job and passes the same authenticated page from `scanLogin` to `scanApplication`. Active configuration, evidence, QA storage, Zoho integration, Oracle scanning, viewer, and pipeline responsibilities are consolidated into focused modules; legacy code and historical evidence move to a dated archive only after fixture and live validation.

**Tech Stack:** Node.js, Playwright, existing vanilla local viewer, Node test runner; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-scan-pipeline-restructure-design.md`

## Global Constraints

- Never click Submit; a successful application scan ends at `status: "submit_visible"`.
- CAPTCHA pauses only the affected job as `needs_human` and saves masked evidence.
- Never log or store OTPs, secrets, email contents, or unmasked email addresses.
- Use one fresh browser context per job and pass the same page from login scanning to application scanning.
- Default concurrency is `1`; concurrency, launch gap, jitter, and delays come only from environment variables.
- Replace a QA entry only after a validated complete scan; failed and partial attempts leave the older successful entry unchanged.
- Write `data/qa.json` through a temporary file and atomic rename.
- Standard evidence takes one post-verification/application-ready screenshot, one shared screenshot per stable application page, one Submit-visible screenshot, and error/incomplete screenshots only.
- Verbose evidence may additionally take per-field and page-after-fill screenshots.
- Do not delete legacy files during this implementation; move them to `archive/legacy-2026-10-30/` only after the new live path is accepted.
- Replace `Phase 0` with `scan-login` and `Phase 1` with `scan-application` throughout all active source, tests, commands, terminal output, viewer copy, current documentation, event step names, and QA metadata. Historical archived artifacts retain their original wording.
- Preserve existing user changes and do not commit, push, or merge unless explicitly requested.

## Review Focus

- Equivalent Oracle URLs with tracking parameters must resolve to the intended stable QA key without merging different requisitions; Task 1 adds normalization tests.
- Missing, empty, malformed, or schema-incompatible QA files must never destroy the last valid file; Task 2 adds read and atomic-write failure tests.
- OTP, magic-link, and email-only paths must all return the same `application_ready` contract without leaking verification data; Task 5 adds path-contract and masking tests.
- A Phase 1 timeout, navigation block, CAPTCHA, page limit, or validation failure after an older successful scan must leave QA unchanged; Task 7 adds pipeline preservation tests.
- Standard evidence must not silently lose field-to-page evidence when per-field screenshots are disabled; Task 3 and Task 8 verify shared page references in artifacts and the viewer.

---

## File Structure

### Active files created

- `data/job-urls.json` — sole active job input.
- `data/qa.json` — latest successful QA record per normalized job URL.
- `src/run.js` — job validation, URL normalization, launch gate, workers, orchestration, and summary.
- `src/config.js` — environment validation and resolved paths.
- `src/scan-login.js` — public Phase 0 implementation.
- `src/scan-application.js` — public Phase 1 page-flow implementation.
- `src/qa.js` — QA normalization, validation, reading, and atomic replacement.
- `src/evidence.js` — masking, events, screenshots, manifests, partial artifacts, summaries, and terminal projection.
- `src/integrations/zoho/mailbox.js` — Zoho verification integration.
- `src/sites/oracle/scanner.js` — registry-based control scanner.
- `src/sites/oracle/runtime.js` — JET readiness and shared Oracle settle helpers.
- `scripts/scan.js` — minimal executable entrypoint.
- `viewer/server.js` and `viewer/index.html` — QA viewer.

### Active files retained

- `src/sites/oracle/selectors.js` — single Oracle selector catalog.
- `test/fixtures/*` that exercise active login and scanner behavior.
- Dummy profile and harmless upload fixtures, moved to a stable active fixture location.

### Compatibility wrappers retained until live validation

- `spike/question_scan_spike.js`
- `spike/question_scan_viewer.js`
- `src/scanner/runner.js`
- `src/scanner/config.js`
- `src/scanner/artifacts.js`
- `src/scanner/terminalReporter.js`
- `src/sites/oracle/authenticate.js`
- `src/sites/oracle/navigator.js`
- `src/sites/oracle/registryScanner.js`
- `src/sites/oracle/jetReady.js`
- `spike/zohoMailbox.js`

Each wrapper temporarily re-exports or calls the new implementation so existing commands and tests remain usable during migration.

---

### Task 1: Consolidate configuration, job input, URL normalization, and launch gating

**Files:**
- Create: `src/config.js`
- Create: `src/run.js`
- Create: `data/job-urls.json`
- Create: `test/pipeline.test.js`
- Modify: `.env.example`
- Modify: `src/scanner/config.js`
- Modify: `src/scanner/runner.js`

**Interfaces:**
- Produces: `loadConfig(env) -> Readonly<ScanConfig>` from `src/config.js`.
- Produces: `normalizeJobUrl(url) -> string`, `loadJobs(file) -> Job[]`, `createLaunchGate(options)`, and `summarizeRun(results) -> RunSummary` from `src/run.js`.
- Preserves: old config and runner imports through compatibility re-exports.

- [ ] **Step 1: Write failing pipeline tests**

Add tests proving:

- `data/job-urls.json` loads the six current trial jobs.
- invalid or non-HTTPS URLs are rejected;
- URL fragments and known tracking parameters do not produce duplicate keys;
- different Oracle tenant/requisition paths never collapse to one key;
- default concurrency is `1`;
- launch gap plus deterministic jitter is enforced;
- `SCANNER_EVIDENCE_LEVEL` accepts only `standard` or `verbose`.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `node --test test/pipeline.test.js`

Expected: FAIL because the new modules and data path do not exist.

- [ ] **Step 3: Implement the new configuration and pipeline utility interfaces**

Move environment parsing into `src/config.js`. Move current job loading, validation, launch-gate, and summary helpers into `src/run.js`. Copy the active six-job input to `data/job-urls.json`; do not remove the spike input yet.

- [ ] **Step 4: Add compatibility re-exports**

Make the old config and runner paths delegate to the new helpers while the full orchestrator remains in its old location until Task 7.

- [ ] **Step 5: Verify Task 1**

Run: `node --test test/pipeline.test.js test/scanner/config-artifacts.test.js test/scanner/runner.test.js`

Expected: all tests PASS.

---

### Task 2: Build the consolidated QA store

**Files:**
- Create: `src/qa.js`
- Create: `data/qa.json`
- Create: `test/qa.test.js`

**Interfaces:**
- Produces: `normalizeQaRecord({ job, scan, scannedAt, evidence }) -> QaJobRecord`.
- Produces: `validateQaRecord(record) -> { valid: true }` or throws a validation error.
- Produces: `readQa(file) -> QaDocument`.
- Produces: `replaceSuccessfulQaEntry({ file, job, scan, scannedAt, evidence }) -> QaDocument`.
- QA document shape: `{ schema_version: "qa-v1", updated_at, jobs: Record<normalizedUrl, QaJobRecord> }`.

- [ ] **Step 1: Write failing QA tests**

Cover:

- initialization from a missing file;
- reading a valid existing QA document;
- rejecting malformed JSON without overwriting it;
- accepting only `scan.status === "submit_visible"`;
- rejecting duplicate canonical question IDs;
- replacing one URL while preserving unrelated entries;
- preserving the old entry when normalization or validation fails;
- preserving the original file when temporary write or rename fails;
- producing no history array or failed-attempt record.

- [ ] **Step 2: Run the QA tests and confirm failure**

Run: `node --test test/qa.test.js`

Expected: FAIL because `src/qa.js` does not exist.

- [ ] **Step 3: Implement normalization and validation**

Normalize `fields` to `questions`, retain pages, sections, types, options, conditional parents, repeater schemas, coverage, detector version, and stable evidence references. Require unique canonical IDs and a completed stop-before-Submit status.

- [ ] **Step 4: Implement atomic replacement**

Write a sibling temporary file, close it, then rename it over `data/qa.json`. Never modify the in-memory or on-disk previous entry before validation succeeds.

- [ ] **Step 5: Verify Task 2**

Run: `node --test test/qa.test.js`

Expected: all tests PASS.

---

### Task 3: Consolidate evidence and implement reduced screenshot policy

**Files:**
- Create: `src/evidence.js`
- Create: `test/evidence.test.js`
- Modify: `src/scanner/artifacts.js`
- Modify: `src/scanner/terminalReporter.js`

**Interfaces:**
- Produces: `createEvidenceWriter({ rootDir, runId, level, reporter }) -> EvidenceWriter`.
- `EvidenceWriter.capture(page, entry, { kind, fullPage })` accepts kinds: `application_ready`, `page`, `submit`, `error`, `incomplete`, `field`, and `page_after_fill`.
- Standard mode captures `application_ready`, `page`, `submit`, `error`, and `incomplete` only.
- Verbose mode additionally captures `field` and `page_after_fill`.
- Produces: `maskSensitive(value)` and `createTerminalReporter({ level, write })`.

- [ ] **Step 1: Write failing evidence-policy tests**

Verify:

- standard mode skips ordinary field and page-after-fill captures;
- verbose mode accepts them;
- standard mode accepts one shared page capture and returns a reusable screenshot reference;
- error and incomplete captures are always retained;
- validation retries capture only the first failure and final unresolved failure when given stable evidence keys;
- emails and OTPs are masked in terminal events, JSONL, manifests, and filenames.

- [ ] **Step 2: Run the evidence tests and confirm failure**

Run: `node --test test/evidence.test.js`

Expected: FAIL because `src/evidence.js` does not exist.

- [ ] **Step 3: Merge artifact and reporter behavior**

Move the current writer, masking, manifest, partial-output, summary, and reporter logic into `src/evidence.js`. Add evidence-level filtering before screenshot capture.

- [ ] **Step 4: Add compatibility re-exports**

Keep the old artifact and terminal reporter imports working until all callers move.

- [ ] **Step 5: Verify Task 3**

Run: `node --test test/evidence.test.js test/scanner/config-artifacts.test.js test/scanner/terminal-reporter.test.js`

Expected: all tests PASS.

---

### Task 4: Move Zoho verification into its integration folder

**Files:**
- Create: `src/integrations/zoho/mailbox.js`
- Modify: `spike/zohoMailbox.js`
- Move/Modify: `test/scanner/zoho-mailbox.test.js` → `test/zoho-mailbox.test.js`

**Interfaces:**
- Preserves: `snapshotInboxMessageIds(email)`, `pollForVerificationEmail(options)`, tenant extraction, message matching, OTP parsing, magic-link parsing, and safe diagnostics.

- [ ] **Step 1: Point a copied test at the new integration path and confirm failure**

Run: `node --test test/zoho-mailbox.test.js`

Expected: FAIL because the integration file does not exist.

- [ ] **Step 2: Move the mailbox implementation without changing behavior**

Keep the existing public function names and secret-masking behavior.

- [ ] **Step 3: Replace the spike file with a compatibility re-export**

The wrapper must contain no mailbox implementation.

- [ ] **Step 4: Verify Task 4**

Run: `node --test test/zoho-mailbox.test.js`

Expected: all tests PASS.

---

### Task 5: Create the `scan-login` stage

**Files:**
- Create: `src/scan-login.js`
- Create: `test/scan-login.test.js`
- Modify: `src/sites/oracle/authenticate.js`

**Interfaces:**
- Produces: `scanLogin(context, { job, config, evidence, mailbox, onNeedsHuman }) -> LoginScanResult`.
- Success result: `{ status: "application_ready", authentication_method: "otp" | "magic_link" | "email_only", page }`.
- Controlled non-success statuses include `needs_human`, `job_expired`, `otp_unresolved`, `authentication_blocked`, `application_not_confirmed`, and `failed`.

- [ ] **Step 1: Write failing stage-contract tests**

Cover:

- OTP entry, Verify click, required ten-second wait, one application-ready screenshot, and no OTP leakage;
- application opening directly after email without OTP;
- magic-link transition;
- optional consent present and absent;
- CAPTCHA returns or pauses as `needs_human` without starting application scanning;
- application readiness is not inferred merely from disappearance of the email field;
- the same page object is returned on success.

- [ ] **Step 2: Run the login tests and confirm failure**

Run: `node --test test/scan-login.test.js`

Expected: FAIL because `scanLogin` does not exist.

- [ ] **Step 3: Move and adapt the active authentication behavior**

Use Oracle selectors and the Zoho integration. Return `application_ready` instead of the old `authenticated` status. Route screenshots through the new evidence policy and remove the duplicate authenticated screenshot in standard mode.

- [ ] **Step 4: Replace the old authentication file with compatibility exports**

Keep old test imports functional until the final test move.

- [ ] **Step 5: Verify Task 5**

Run: `node --test test/scan-login.test.js test/scanner/authenticate.test.js`

Expected: all tests PASS.

---

### Task 6: Rename the Oracle scanner/runtime and create `scan-application`

**Files:**
- Create: `src/sites/oracle/scanner.js`
- Create: `src/sites/oracle/runtime.js`
- Create: `src/scan-application.js`
- Create: `test/scanner.test.js`
- Create: `test/scan-application.test.js`
- Modify: `src/sites/oracle/registryScanner.js`
- Modify: `src/sites/oracle/jetReady.js`
- Modify: `src/sites/oracle/navigator.js`

**Interfaces:**
- `oracle/scanner.js` preserves registry scanner exports including `scanRegistryPage`, option capture, repeater scanning, scoped locators, filling, flattening, and deduplication.
- `oracle/runtime.js` produces `waitForOracleJetReady(page, options)` and shared settle helpers.
- `scanApplication(page, options) -> ApplicationScanResult` preserves current terminal statuses and detector version.

- [ ] **Step 1: Add tests at the new paths**

Move the active registry and navigator expectations into the new tests. Add assertions that:

- every supported field appears once;
- nested repeater fields remain inside `repeater_schema`;
- Submit is visible but never clicked;
- standard mode captures one shared screenshot per page and assigns its reference to normal fields;
- ordinary fields do not trigger individual screenshots in standard mode;
- unclassified, incomplete, repeater, validation, loop, and unexpected failures request targeted evidence;
- only first and final unresolved validation states are captured;
- verbose mode retains per-field and page-after-fill evidence.

- [ ] **Step 2: Run the new tests and confirm failure**

Run: `node --test test/scanner.test.js test/scan-application.test.js`

Expected: FAIL because the new paths do not exist.

- [ ] **Step 3: Move registry and JET logic without behavior changes**

Create `scanner.js` and `runtime.js`, update their internal imports, and retain compatibility re-exports at the old paths.

- [ ] **Step 4: Move page orchestration into `scan-application.js`**

Replace direct screenshot calls with evidence kinds. Reuse one stable page screenshot for each page's normal field references. Keep stop-before-Submit and partial-result behavior unchanged.

- [ ] **Step 5: Verify Task 6**

Run: `node --test test/scanner.test.js test/scan-application.test.js test/scanner/registry-scanner.test.js test/scanner/navigator.test.js test/scanner/jet-ready.test.js`

Expected: all tests PASS.

---

### Task 7: Implement the complete pipeline and protected QA replacement

**Files:**
- Modify: `src/run.js`
- Create: `scripts/scan.js`
- Create: `test/run-pipeline.test.js`
- Modify: `spike/question_scan_spike.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `run(config, dependencies?) -> { runId, runDir, summary }`.
- Consumes: `scanLogin`, `scanApplication`, `replaceSuccessfulQaEntry`, `createEvidenceWriter`, and Zoho mailbox functions.
- Adds command: `npm run scan`.
- Keeps `npm run spike:scan` as a temporary compatibility alias.

- [ ] **Step 1: Write failing orchestration tests**

Verify:

- each job receives a fresh browser context;
- the exact page returned by `scanLogin` is passed to `scanApplication`;
- Phase 1 never runs for non-`application_ready` login results;
- QA updates exactly once for `submit_visible`;
- an existing QA entry remains byte-for-byte unchanged for login failure, CAPTCHA, navigation block, page limit, validation failure, or thrown error;
- failures for one job do not stop the remaining queue;
- contexts close in success and failure paths;
- run summary and partial evidence retain `user_id`, `job_id`, worker, and page.

- [ ] **Step 2: Run the pipeline tests and confirm failure**

Run: `node --test test/run-pipeline.test.js`

Expected: FAIL because the new orchestrator is incomplete.

- [ ] **Step 3: Implement the orchestration loop**

Use the launch gate, default concurrency one, and the same page handoff. Call QA replacement only after Phase 1 returns `submit_visible` and validation succeeds.

- [ ] **Step 4: Add the executable and compatibility command**

Make `scripts/scan.js` load `.env`, call `run`, print the safe summary, and set a nonzero exit code when jobs are incomplete. Point the old spike entrypoint to this executable behavior.

- [ ] **Step 5: Verify Task 7**

Run: `node --test test/run-pipeline.test.js test/pipeline.test.js test/qa.test.js`

Expected: all tests PASS.

---

### Task 8: Move the viewer to consolidated QA and current evidence

**Files:**
- Create: `viewer/server.js`
- Create: `viewer/index.html`
- Create: `test/viewer.test.js`
- Modify: `spike/question_scan_viewer.js`
- Modify: `spike/question_scan_viewer.html`
- Modify: `package.json`

**Interfaces:**
- Viewer server reads `data/qa.json` and `artifacts/current-qa-evidence/` only.
- Adds command: `npm run viewer`.
- Keeps `npm run viewer:scan` as a temporary compatibility alias.
- Exposes read-only index, job, and evidence endpoints; no answer-write or Submit endpoint exists.

- [ ] **Step 1: Write failing viewer tests**

Verify:

- all current QA jobs are listed;
- one normalized question renders once;
- phone composite, dropdown options, checkbox groups, conditions, and repeater schemas remain interactive in browser memory;
- normal fields resolve to their shared page screenshot in standard evidence;
- targeted problem evidence overrides the shared page screenshot when present;
- legacy run folders are not scanned as live QA sources;
- no POST/PUT/PATCH/DELETE route or persistence request exists.

- [ ] **Step 2: Run the viewer tests and confirm failure**

Run: `node --test test/viewer.test.js`

Expected: FAIL because the new viewer path does not exist.

- [ ] **Step 3: Move and adapt the viewer**

Read the consolidated QA document, preserve browser-memory-only interactions, and resolve current evidence references safely.

- [ ] **Step 4: Add compatibility wrappers and commands**

Point old viewer paths and `viewer:scan` to the new server during validation.

- [ ] **Step 5: Verify Task 8**

Run: `node --test test/viewer.test.js test/scanner/viewer.test.js`

Expected: all tests PASS.

---

### Task 9: Full fixture verification and headed end-to-end validation

**Files:**
- Modify only if validation exposes a defect in an active module.
- Produce: `artifacts/runs/<run_id>/summary.json`
- Produce/Update: `data/qa.json`
- Produce/Update: `artifacts/current-qa-evidence/<job_key>/`

**Interfaces:**
- Uses `npm run scan` with concurrency one and standard evidence.

- [ ] **Step 1: Run syntax checks**

Run `node --check` on every active JavaScript module and entrypoint.

Expected: all exit successfully.

- [ ] **Step 2: Run the complete local suite**

Run: `npm run test:scanner` plus all new root-level tests.

Expected: zero failures.

- [ ] **Step 3: Run one headed job**

Use a one-job `data/job-urls.json` or an explicit test input override with:

```text
SCANNER_CONCURRENCY=1
SCANNER_HEADLESS=false
SCANNER_EVIDENCE_LEVEL=standard
```

Do not run additional live jobs until the first result is reviewed.

- [ ] **Step 4: Verify live acceptance**

Confirm:

- login reaches `application_ready`;
- the same page continues into application scanning;
- only one shared screenshot exists per normal application page;
- extra application screenshots correspond only to errors or incomplete coverage;
- Submit remains untouched;
- `data/qa.json` replaces that URL only after success;
- the viewer reproduces the current questions and evidence;
- a deliberately simulated failed rescan leaves the successful QA entry unchanged.

---

### Task 10: Archive superseded code and historical evidence

**Files:**
- Create: `archive/legacy-2026-10-30/README.md`
- Move superseded files into:
  - `archive/legacy-2026-10-30/code/`
  - `archive/legacy-2026-10-30/screenshots/`
  - `archive/legacy-2026-10-30/results/`
  - `archive/legacy-2026-10-30/logs/`
  - `archive/legacy-2026-10-30/notes/`
- Modify: `package.json`
- Modify: `context.md`
- Modify: `PROJECT.md` only where active paths are documented.

**Interfaces:**
- Active commands use only the new modules.
- Archive README maps every old path to its replacement and records that archived contents are not loaded at runtime.

- [ ] **Step 1: Inventory exact archive candidates**

Generate a reviewed list of superseded spikes, legacy detectors, historical result folders, screenshots, logs, and obsolete notes. Exclude active fixtures, current QA, current evidence, latest validation run, current specs, and current plans.

- [ ] **Step 2: Confirm no active import or command references an archive candidate**

Use `rg` across `src/`, `scripts/`, `viewer/`, `test/`, and `package.json`.

Expected: every candidate is either unreferenced or referenced only by a compatibility wrapper being retired in this task.

- [ ] **Step 3: Move candidates into the dated archive**

Use explicit source and destination paths. Do not use broad recursive deletion or unresolved globs. Record the mapping in the archive README.

- [ ] **Step 4: Remove compatibility commands only after the move**

Keep `npm run scan`, `npm run viewer`, and the active test commands. Remove obsolete spike commands only when no documented workflow uses them.

- [ ] **Step 5: Run the entire test suite from the cleaned tree**

Run all active Node tests and syntax checks.

Expected: zero failures and no runtime import from `archive/`.

- [ ] **Step 6: Inspect the active tree**

Confirm that active source, data, viewer, tests, artifacts, docs, and archive are clearly separated and that no old screenshots remain mixed into active source folders.

- [ ] **Step 7: Verify active terminology**

Search active source, tests, scripts, viewer copy, package scripts, `PROJECT.md`, `STATE.md`, `context.md`, and current pipeline documentation for `Phase 0`, `phase0`, `Phase 1`, and `phase1`.

Expected: no active runtime or user-facing reference remains. Matches are allowed only inside `archive/legacy-2026-10-30/` and historical specifications/plans that document the earlier architecture.

---

## Final Acceptance

- One active input file: `data/job-urls.json`.
- One current QA file: `data/qa.json`.
- One login-stage public file: `src/scan-login.js`.
- One application-stage public file: `src/scan-application.js`.
- Active code, logs, commands, viewer copy, tests, QA metadata, and current documentation use `scan-login` and `scan-application`; the old phase names exist only in archived or historical material.
- One Oracle control scanner: `src/sites/oracle/scanner.js`.
- Zoho remains isolated under `src/integrations/zoho/`.
- Same-page handoff works from login to application scan.
- Failed rescans never replace successful QA.
- Standard evidence uses one screenshot per normal application page plus error/incomplete captures.
- Verbose mode retains deep debugging evidence.
- Viewer reads only current QA and current QA evidence.
- Submit is never clicked.
- Legacy files are moved to the dated archive only after live validation.
- All active tests and syntax checks pass after archive migration.

