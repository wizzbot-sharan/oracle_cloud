# Scan Pipeline Restructure Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `test-driven-development`, then `executing-plans`, task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the active `scan-login` → `scan-application` pipeline to the approved restructure plan’s complete, safe, clean-tree acceptance level.

**Architecture:** Preserve the working scanner and two-stage handoff. Replace mutable job evidence with immutable versioned evidence directories, validate QA before committing it, and make the runner own safe job outcomes, circuit-breaking, and resource cleanup. Retire only legacy code whose active imports and tests have first moved to the new modules.

**Tech Stack:** Node.js, Playwright, Node test runner, existing vanilla viewer; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-scan-pipeline-restructure-repair-design.md`

## Global Constraints

- Never click Submit; only `submit_visible` is a successful scan terminal state.
- Do not log or store OTPs, magic-link URLs/tokens, email contents, or unmasked emails.
- Each job has a fresh browser context; login and application scanning receive the same live page.
- Default concurrency remains one; delays and circuit-breaker threshold come from environment variables.
- A failed/incomplete rescan must leave the prior QA bytes and its referenced evidence untouched.
- `needs_human` pauses only its job and writes masked partial evidence before waiting.
- The first terminal issue continues to the next job; the second consecutive terminal issue stops that user’s remaining queue. `job_expired` and a paused `needs_human` do not count; `submit_visible` resets the counter.
- No database work, answer persistence, submission, or scanning-feature expansion.
- This workspace has no Git repository: record task completion and exact test output in the existing SDD ledger instead of commits.

## Review Focus

- Cross-job screenshot files must never appear in another job’s current-evidence directory — Task 1 tests manifest-filtered promotion.
- A QA validation, copy, or rename failure must preserve the old QA bytes and old evidence directory — Tasks 1–2 inject each failure.
- Magic-link, OTP, and email diagnostic paths must not expose credentials — Task 1 tests terminal and JSONL-safe diagnostics.
- Two consecutive terminal outcomes must stop later jobs while a successful job resets the counter — Task 3 tests mixed queues.
- The cleaned active tree must not import a legacy spike path or expose old Phase wording — Task 4 runs import and terminology checks.

## File structure and responsibilities

- `src/evidence.js`: screenshot masking, run evidence, immutable job-evidence preparation, and terminal reporting.
- `src/qa.js`: normalization, explicit QA validation, and atomic replacement of already-validated records.
- `src/run.js`: one-job execution, evidence/QA commit order, per-user circuit breaker, and browser cleanup.
- `src/scan-login.js`: exact authentication method and persisted CAPTCHA pause outcome.
- `src/integrations/zoho/mailbox.js`: secret-safe mailbox diagnostics.
- `viewer/server.js` and `viewer/index.html`: resolve only immutable evidence referenced by QA.
- Active tests import only the modules above plus `src/sites/oracle/{scanner,runtime,selectors}.js`.

### Task 1: Make mailbox diagnostics and current evidence safe

**Files:**
- Modify: `src/integrations/zoho/mailbox.js`
- Modify: `src/evidence.js`
- Modify: `test/zoho-mailbox.test.js`
- Modify: `test/evidence.test.js`

**Interfaces:**
- Produce `prepareJobEvidence({ runDir, currentRoot, runId, jobKey, userId, jobId, manifest }) -> EvidenceReference`.
- `EvidenceReference` is `{ directory, screenshot_root, screenshots, run_id, job_key }`, where `directory` is a final immutable path based on a stable hash of normalized job URL plus `runId`.
- `prepareJobEvidence` copies only manifest entries matching the supplied `user_id` and `job_id`; it never mutates any existing evidence directory.

- [ ] **Step 1: Write failing mailbox safety tests**

Add tests proving magic-link polling logs only `magic_link_received` (never a URL, token, or URL fragment) and that existing OTP masking remains complete.

- [ ] **Step 2: Run the focused mailbox tests**

Run: `node --test test/zoho-mailbox.test.js`

Expected: FAIL because magic-link logging currently prints a URL prefix.

- [ ] **Step 3: Remove magic-link URL logging**

In `src/integrations/zoho/mailbox.js`, replace the magic-link console message with a generic, token-free event. Preserve the returned URL solely in memory for `scan-login` navigation.

- [ ] **Step 4: Write failing evidence-promotion tests**

Create a manifest containing two jobs’ screenshots. Assert preparation copies only the requested job’s files into a unique final directory, leaves an existing prior directory byte-for-byte unchanged, and returns a reference whose files all exist.

- [ ] **Step 5: Implement immutable, manifest-filtered evidence preparation**

Replace `promoteJobEvidence` in `src/evidence.js` with `prepareJobEvidence`. Derive a stable safe job key from normalized URL using Node `crypto.createHash('sha256')`; copy manifest-selected screenshot paths to a new `<hash>/<runId>/screenshots/` directory. Validate each manifest path remains below the run screenshots root before copying. Never call `rmSync` on current evidence.

- [ ] **Step 6: Verify Task 1**

Run: `node --test test/evidence.test.js test/zoho-mailbox.test.js`

Expected: PASS.

### Task 2: Validate QA completely and commit evidence/QA in safe order

**Files:**
- Modify: `src/qa.js`
- Modify: `src/run.js`
- Modify: `test/qa.test.js`
- Modify: `test/run-pipeline.test.js`

**Interfaces:**
- Produce `validateQaRecord(record) -> void`.
- Produce `buildSuccessfulQaRecord({ job, scan, scannedAt, evidence, scanUserId }) -> QaJobRecord`.
- Produce `replaceValidatedQaEntry({ file, key, record }) -> QaDocument`.
- `runJob` commits in this order: build/validate record, prepare immutable job evidence, rebuild/validate record with that evidence, atomically replace QA, then write job result.

- [ ] **Step 1: Write failing QA validation tests**

Cover rejected empty pages/questions, missing required record metadata, missing canonical ID, duplicate canonical ID, missing field screenshot reference, and missing evidence directory/reference. Confirm every rejection leaves a valid existing QA file byte-for-byte unchanged.

- [ ] **Step 2: Write failing atomic-write failure tests**

Inject temporary-write and rename failures through filesystem dependencies. Assert the old QA file is unchanged and temporary artifacts are cleaned when possible.

- [ ] **Step 3: Implement explicit QA validation**

Refactor `src/qa.js` so `buildSuccessfulQaRecord` normalizes data and `validateQaRecord` enforces completed non-empty scans, scan metadata including `scan_user_id`, unique questions, required field metadata, and immutable evidence references. Keep QA keyed by normalized URL as global form metadata.

- [ ] **Step 4: Refactor successful commit ordering in `src/run.js`**

Extract `commitSuccessfulScan({ config, writer, job, scan, meta })`. It validates before and after evidence preparation, calls `replaceValidatedQaEntry` only after preparation succeeds, and treats a failed commit as a partial failed job without modifying previous QA or current evidence.

- [ ] **Step 5: Add pipeline preservation tests**

Simulate evidence preparation failure, QA validation failure, and QA rename failure after a previous success. Assert prior QA bytes and the prior referenced evidence file hashes remain unchanged for every case.

- [ ] **Step 6: Verify Task 2**

Run: `node --test test/qa.test.js test/run-pipeline.test.js`

Expected: PASS.

### Task 3: Correct login outcomes, CAPTCHA persistence, circuit breaking, and cleanup

**Files:**
- Modify: `src/scan-login.js`
- Modify: `src/run.js`
- Modify: `src/config.js`
- Modify: `test/scan-login.test.js`
- Modify: `test/run-pipeline.test.js`

**Interfaces:**
- `scanLogin(...) -> { status: 'application_ready', authentication_method: 'otp'|'magic_link'|'email_only', page } | ControlledFailure`.
- Add config `SCANNER_CIRCUIT_BREAKER_FAILURES`, default `2`.
- Extract `runJob(...) -> JobOutcome` from `run`; `run` owns per-user consecutive terminal-failure counting.

- [ ] **Step 1: Write failing authentication-path tests**

Assert direct email access returns `email_only`, OTP verification returns `otp`, and magic-link navigation returns `magic_link`; assert the exact page object remains unchanged.

- [ ] **Step 2: Write failing CAPTCHA-persistence tests**

Assert CAPTCHA first writes a masked screenshot/event and a `fields.partial.json` result with `status: 'needs_human'` before the callback/wait begins; assert it resumes only after challenge disappearance.

- [ ] **Step 3: Implement explicit authentication-method tracking and CAPTCHA partial result**

Track the confirmed branch in `scan-login.js`. Pass the job result context needed to `EvidenceWriter.writePartialJobResult`; do not write QA from login scanning.

- [ ] **Step 4: Write failing circuit-breaker tests**

Use a three-job same-user queue. Assert one terminal error allows the next job, a second consecutive terminal error prevents remaining jobs, `submit_visible` resets the count, and `job_expired`/`needs_human` do not increment it.

- [ ] **Step 5: Implement `runJob` and per-user breaker**

Add validated breaker configuration, classify terminal outcomes in one function, and log/write a circuit-breaker partial outcome for skipped jobs. Put browser close, context close, and summary write behind `try/finally` paths so setup failures do not leak resources.

- [ ] **Step 6: Verify Task 3**

Run: `node --test test/scan-login.test.js test/run-pipeline.test.js test/pipeline.test.js`

Expected: PASS.

### Task 4: Make the viewer resolve immutable evidence only

**Files:**
- Modify: `viewer/server.js`
- Modify: `viewer/index.html`
- Modify: `test/viewer-active.test.js`
- Create: `test/viewer.test.js`

**Interfaces:**
- `loadJob()` returns the QA record’s immutable evidence reference unchanged.
- `/artifacts/` resolves only paths below the QA-selected immutable evidence directory for the requested job, never an arbitrary sibling job directory.

- [ ] **Step 1: Write failing viewer evidence tests**

Create two QA records and two evidence trees. Assert a selected job resolves its page screenshot, a sibling job path returns 404, and no mutating HTTP method is exposed.

- [ ] **Step 2: Implement per-record evidence path resolution**

Replace global `run_id` path assumptions with a validated evidence-reference resolver. The server must derive the allowed root from the requested QA record, reject traversal and sibling-job directories, and continue serving only GET read-only data.

- [ ] **Step 3: Update client screenshot URLs**

Make `viewer/index.html` use the selected record’s immutable evidence reference for field/page screenshots, with its page screenshot as the normal-field fallback.

- [ ] **Step 4: Verify Task 4**

Run: `node --test test/viewer.test.js test/viewer-active.test.js`

Expected: PASS.

### Task 5: Complete the active-tree migration and archive mapping

**Files:**
- Modify: `package.json`, `.env.example`, `context.md`, `PROJECT.md`, `STATE.md`
- Modify active tests under `test/` and `test/scanner/`
- Move: `src/scanner/{runner,config,artifacts,terminalReporter,types}.js` to `archive/legacy-2026-10-30/code/` when no active import remains
- Move: `src/sites/oracle/{authenticate,navigator,registryScanner,jetReady,dynamicControls,fieldDetector}.js` to the same archive when no active import remains
- Move obsolete tests to `archive/legacy-2026-10-30/tests/` only when their equivalent active-module coverage exists
- Modify: `archive/legacy-2026-10-30/README.md`

**Interfaces:**
- Active commands remain only `npm run scan`, `npm run viewer`, `npm test`, and `npm run test:scanner`.
- Active tests import `scan-login`, `scan-application`, `evidence`, `config`, `run`, `qa`, `integrations/zoho/mailbox`, `sites/oracle/scanner`, and `sites/oracle/runtime` directly.

- [ ] **Step 1: Inventory and test active imports before moving files**

Add a Node test or shell verification asserting no active runtime/test import references `spike/`, compatibility wrappers, or `archive/`. Update surviving tests to active paths first; preserve equivalent coverage for authentication, navigation, scanner, JET runtime, Zoho, configuration, evidence, and terminal reporting.

- [ ] **Step 2: Remove obsolete commands and wrappers**

Confirm `package.json` contains no spike aliases. Move the exact legacy modules above only after `rg` confirms active callers no longer reference them.

- [ ] **Step 3: Repair archive structure and mapping**

Flatten `archive/legacy-2026-10-30/results/results/` to `results/` using explicit moves. Expand the archive README with a source-path → replacement-path table and an explicit statement that archive files are not runtime dependencies.

- [ ] **Step 4: Update current terminology and operating documentation**

Replace active Phase 0/Phase 1 wording with `scan-login`/`scan-application` in context, state, current README-style docs, tests, package scripts, and terminal copy. Update `STATE.md` with the successful Safeway validation and the remaining repair work only when this task is being completed as the current session wrap-up.

- [ ] **Step 5: Verify Task 5**

Run: `rg -n "Phase 0|phase0|Phase 1|phase1|spike/|viewer:scan|spike:scan" src scripts viewer test package.json context.md PROJECT.md STATE.md`.

Expected: no active-path matches except allowed historical descriptions in archive.

### Task 6: Verify the cleaned pipeline and live acceptance

**Files:**
- Modify only if a verification failure proves an active defect.
- Produce: one new `artifacts/runs/<run_id>/` validation run, updated `data/qa.json`, and one immutable current-evidence directory.

- [ ] **Step 1: Run static and non-browser checks**

Run `node --check` on every active module and `npm test` from the cleaned tree. If local sandbox restrictions prevent Chromium, rerun the isolated browser fixture tests with the approved host permission and record the reason separately; module-resolution failures are never acceptable.

- [ ] **Step 2: Run one headed validation job**

Use an explicit one-job override, `SCANNER_CONCURRENCY=1`, `SCANNER_HEADLESS=false`, and standard evidence. Confirm login handoff, one shared page screenshot per normal page, Submit untouched, QA commit, and no secret-bearing logs.

- [ ] **Step 3: Validate the viewer against the new QA record**

Start `npm run viewer`; inspect the successful job’s fields and screenshots. Confirm field screenshots resolve from its immutable evidence directory and interactive controls remain browser-memory-only.

- [ ] **Step 4: Simulate a failed rescan**

With a test seam, force a post-scan incomplete/commit failure. Assert the prior QA bytes and hashes of every referenced evidence screenshot remain unchanged.

- [ ] **Step 5: Record final results**

Update `.superpowers/sdd/2026-10-30-scan-pipeline-restructure/progress.md` with exact commands, results, and any environment-only test constraint. Do not claim acceptance if any active test or import check fails.

## Self-review

- The evidence transaction, QA validation, masking, login outcomes, CAPTCHA pause, circuit breaker, viewer isolation, migration cleanup, and acceptance verification each have an owning task.
- All proposed interfaces are defined before their consumers.
- The plan intentionally does not add database, answer matching, or submission behavior.
- Every review-focus failure mode is exercised by a named task test.
