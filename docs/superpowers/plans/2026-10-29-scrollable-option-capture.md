# Scrollable Oracle Option Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture and display every safely reachable option in native and lazy-loaded Oracle dropdown controls, with explicit completion evidence.

**Architecture:** Extend the existing `enumerateFieldOptions` path with a scoped-overlay resolver and a scroll-until-proven-complete collector. Preserve the current `options` array and attach capture metadata to the field and cascade mappings. The viewer consumes that metadata to display option count and incomplete coverage.

**Tech Stack:** Node.js, Playwright, Node test runner, local HTML fixtures, existing static scan viewer.

**Spec:** `docs/superpowers/specs/2026-10-29-scrollable-option-capture-design.md`

## Global Constraints

- No new dependency or database migration.
- Configuration remains environment-only.
- All Oracle selectors stay in `src/sites/oracle/selectors.js`.
- Never click Submit; never use global fallback locators for ambiguous controls.
- Events and artifacts must not contain OTPs, secrets, or unmasked emails.
- Keep per-user browser-context isolation and existing pacing behavior.

## Review Focus

- Virtualized rows that reuse DOM nodes must still yield every distinct value once; Task 2 fixture test.
- A lazy list that loads after scrolling must not be marked complete too early; Task 2 fixture test.
- Two visible listboxes must not contaminate each other; Task 1 fixture test.
- A list with no proven endpoint must be marked incomplete; Task 2 fixture test.
- Cascade mappings must retain the child's capture metadata for every explored parent option; Task 3 fixture test.

---

### Task 1: Scoped listbox resolution and option-capture metadata

**Files:**
- Modify: `src/sites/oracle/selectors.js`
- Modify: `src/sites/oracle/dynamicControls.js`
- Modify: `test/fixtures/oracle-dynamic-form.html`
- Modify: `test/scanner/dynamic-controls.test.js`

**Interfaces:**
- Produces: `resolveScopedListbox(page, field, control)` returning a single Playwright locator or `null`.
- Produces: `captureMetadata(status, source, details)` returning `{ status, source, discovered_count, scroll_rounds, end_reached, incomplete_reason }`.
- Updates: `enumerateFieldOptions(page, field, options)` returns `{ options, option_capture }` for all option-bearing controls.

- [ ] **Step 1: Write failing tests for native controls and scoped overlays**

Add tests that assert a native select returns every option with `option_capture.status === 'complete'`, and that a combobox reads only options belonging to its own linked listbox when another listbox is visible.

- [ ] **Step 2: Run the focused test file to verify failure**

Run: `node --test test/scanner/dynamic-controls.test.js`

Expected: FAIL because `enumerateFieldOptions` returns an array rather than options plus capture metadata.

- [ ] **Step 3: Add selector and resolver support**

Add selectors for active listbox overlays and implement `resolveScopedListbox(page, field, control)`. Resolve in this order: `aria-controls`/`aria-owns`, then a unique visible listbox created for the opened field. Return `null` if scope cannot be proven.

- [ ] **Step 4: Return metadata for fully rendered controls**

Refactor `enumerateFieldOptions(page, field, options = {})` to return `{ options, option_capture }`. Native selects and existing rendered choice groups return `complete`, preserving order and disabled state.

- [ ] **Step 5: Run focused tests to verify pass**

Run: `node --test test/scanner/dynamic-controls.test.js`

Expected: PASS for the newly added tests and existing dynamic-control tests.

### Task 2: Virtualized and lazy-loaded listbox traversal

**Files:**
- Modify: `src/sites/oracle/dynamicControls.js`
- Modify: `test/fixtures/oracle-dynamic-form.html`
- Modify: `test/scanner/dynamic-controls.test.js`

**Interfaces:**
- Consumes: `resolveScopedListbox` and `captureMetadata` from Task 1.
- Produces: `captureScrollableListbox(page, listbox, { settleMs, maxRounds, stagnantRounds })` returning `{ options, option_capture }`.

- [ ] **Step 1: Write failing tests for virtualized, delayed, and incomplete lists**

Create fixture controls for: a list with options revealed only after scrolling; a virtualized list that replaces visible rows; and a list that cannot reach a stable bottom. Assert option order, deduplication by value plus label, complete status for the first two, and an explicit incomplete reason for the third.

- [ ] **Step 2: Run the focused test file to verify failure**

Run: `node --test test/scanner/dynamic-controls.test.js`

Expected: FAIL because list scrolling has no end-of-list proof or incomplete status.

- [ ] **Step 3: Implement `captureScrollableListbox`**

Read visible options from only the scoped listbox. Preserve first discovery order in a `Map` keyed by value plus label. Scroll by one viewport, wait for JET readiness and settle delay, and require bottom tolerance plus two consecutive no-growth passes before returning `complete`. Stop at configured maximum rounds or overlay loss with `incomplete` metadata.

- [ ] **Step 4: Make capture bounds configurable**

Add validated scanner configuration for maximum option-capture rounds and stagnant rounds. Keep safe defaults in `src/scanner/config.js`; pass the values through scanner enrichment without hardcoding site-specific limits.

- [ ] **Step 5: Run focused tests to verify pass**

Run: `node --test test/scanner/dynamic-controls.test.js test/scanner/config-artifacts.test.js`

Expected: PASS for virtualized, lazy, incomplete, and configuration cases.

### Task 3: Persist option-capture evidence through dynamic discovery

**Files:**
- Modify: `src/sites/oracle/dynamicControls.js`
- Modify: `src/sites/oracle/navigator.js`
- Modify: `test/scanner/dynamic-controls.test.js`
- Modify: `test/scanner/navigator.test.js`

**Interfaces:**
- Consumes: `{ options, option_capture }` from `enumerateFieldOptions`.
- Produces: fields with `options`, `option_capture`, and cascade mappings containing `options` plus `option_capture`.

- [ ] **Step 1: Write failing tests for stored field and cascade evidence**

Assert that enriched combobox fields store the full options plus capture metadata, cascading child mappings store the same metadata for each parent option, and incomplete capture is reflected in a field's coverage status without stopping the scan.

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `node --test test/scanner/dynamic-controls.test.js test/scanner/navigator.test.js`

Expected: FAIL because current enrichment stores option arrays only.

- [ ] **Step 3: Persist metadata and events**

Assign `options` and `option_capture` after every enumeration. Include capture metadata in cascade mappings. Add structured scanner events for start, scroll, complete, and incomplete outcomes through existing logging callbacks; no option values that could be secrets are logged beyond normal application choices.

- [ ] **Step 4: Run focused tests to verify pass**

Run: `node --test test/scanner/dynamic-controls.test.js test/scanner/navigator.test.js`

Expected: PASS and Submit remains unclicked.

### Task 4: Render option coverage in the local viewer

**Files:**
- Modify: `spike/question_scan_viewer.html`
- Modify: `test/scanner/viewer.test.js`

**Interfaces:**
- Consumes: field `options` and optional `option_capture` metadata.
- Produces: visible option count, completion status, incomplete reason, and every stored option in a field preview.

- [ ] **Step 1: Write a failing static viewer test**

Assert that the viewer references `option_capture`, `discovered_count`, `incomplete_reason`, and renders options for select/combobox controls.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `node --test test/scanner/viewer.test.js`

Expected: FAIL because the viewer has no option-capture evidence rendering.

- [ ] **Step 3: Add option coverage presentation**

Render all saved options for select and combobox controls. Show a clear complete badge when proven and an incomplete warning with reason when not proven. Keep the viewer read-only.

- [ ] **Step 4: Run focused test to verify pass**

Run: `node --test test/scanner/viewer.test.js`

Expected: PASS.

### Task 5: Full verification and headed readiness

**Files:**
- Modify: `context.md`

**Interfaces:**
- Consumes: all option-capture behavior from Tasks 1–4.
- Produces: verified local option capture and a documented live validation checklist.

- [ ] **Step 1: Run syntax checks**

Run: `node --check src/sites/oracle/dynamicControls.js && node --check src/sites/oracle/navigator.js && node --check src/scanner/config.js`

Expected: no output and exit code 0.

- [ ] **Step 2: Run the full scanner suite**

Run: `npm run test:scanner`

Expected: all tests pass.

- [ ] **Step 3: Update context**

Record the new option-capture behavior, completion semantics, and any known limitation for remote search-only autocompletes in `context.md`.

- [ ] **Step 4: Report headed validation readiness**

Confirm that a future headed run should validate one normal Oracle dropdown, one long/virtualized dropdown, and one cascade; report no live run as completed unless actually executed.
