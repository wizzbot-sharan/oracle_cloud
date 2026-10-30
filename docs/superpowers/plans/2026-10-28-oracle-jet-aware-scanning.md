# Oracle JET-Aware Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Oracle application scanner JET-aware while preserving existing authentication, navigation, and no-submit safeguards.

**Architecture:** Add an optional Oracle JET BusyContext guard, enrich field records with component-host and rendered-control metadata, and recognize custom button choice groups. Integrate guards at scan/navigation boundaries and verify against local Playwright fixtures only.

**Tech Stack:** Node.js, CommonJS, Playwright 1.49, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-28-oracle-jet-aware-scanning-design.md`

## Global Constraints

- Never click Submit.
- JET unavailable/timeout is recorded as evidence and does not break non-JET scanning.
- No external network during tests; no secrets in artifacts.
- Keep Oracle selectors in `src/sites/oracle/selectors.js`.

## Review Focus

- JET absent: scanner continues and reports `jet_unavailable` — Task 1 test.
- BusyContext timeout: result includes state descriptions without sensitive content — Task 1 test.
- Button Yes/No options: grouped into one question — Task 2 test.
- JET host plus rendered input: preserve both metadata records — Task 2 test.
- Submit remains unclicked when readiness guard is installed — Task 3 navigator test.

### Task 1: Oracle JET readiness guard

**Files:**
- Create: `src/sites/oracle/jetReady.js`
- Test: `test/scanner/jet-ready.test.js`

**Interfaces:**
- Produces: `waitForOracleJetReady(page, { timeoutMs? }) -> Promise<{status:string,busy_states:string[]}>`.

- [ ] Write failing tests for unavailable JET, ready JET, and a timed-out BusyContext.
- [ ] Implement the smallest public-BusyContext guard that passes them.
- [ ] Run `node --test --test-concurrency=1 test/scanner/jet-ready.test.js`.

### Task 2: JET-aware field detection

**Files:**
- Modify: `src/sites/oracle/fieldDetector.js`
- Modify: `src/scanner/types.js`
- Modify: `src/sites/oracle/selectors.js`
- Create: `test/fixtures/oracle-jet-form.html`
- Modify: `test/scanner/field-detector.test.js`

**Interfaces:**
- Consumes: field detector page scan.
- Produces: field `jet` and `dom` metadata; `single_choice` button groups with complete options.

- [ ] Write failing fixture test for host metadata and button Yes/No grouping.
- [ ] Implement scoped host/container discovery and metadata collection.
- [ ] Run the field-detector tests.

### Task 3: Scan/navigation integration

**Files:**
- Modify: `src/sites/oracle/navigator.js`
- Modify: `test/scanner/navigator.test.js`

**Interfaces:**
- Consumes: `waitForOracleJetReady`.
- Produces: readiness events around scan/navigation boundaries.

- [ ] Write failing navigator test that observes readiness evidence and zero Submit clicks.
- [ ] Integrate guard calls without making JET failures terminal.
- [ ] Run the navigator tests and then `npm run test:scanner`.

### Task 4: Verification and documentation

**Files:**
- Create: `.agent-context/playwright-oj-rules.md`

- [ ] Record public JET extraction rules, fallbacks, and redaction requirements.
- [ ] Run `node --check` on all changed JavaScript files and the full scanner test suite.
