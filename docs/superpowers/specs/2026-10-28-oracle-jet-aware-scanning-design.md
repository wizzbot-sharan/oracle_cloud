# Oracle JET-Aware Scanning Design

## Intent

Make the application-question scanner wait for Oracle JET render cycles when they are available, and preserve JET host metadata alongside the visible control that Playwright operates. This improves evidence and detection for custom Oracle controls without changing the tested sign-in or non-submission behavior.

## Goals

- Treat JET readiness as an optional guard, never a prerequisite for non-JET pages.
- Record a JET host's tag and public DOM metadata with every detected field.
- Recognize custom button-based Yes/No groups as a single question with options.
- Use readiness waits around scanning and page-changing interactions.
- Preserve one field record per question and never click Submit.

## Non-goals

- Reverse-engineering private Oracle HCM view models or bypassing closed shadow roots.
- Replacing Phase 0 authentication, changing concurrency, or running a live scan in this implementation.
- Claiming complete coverage when a visible control cannot be classified.

## Approaches

1. Global readiness wait only: small but does not identify custom questions.
2. Integrated JET-aware extraction: selected. It extends the existing detector with host metadata and question-group recognition while retaining one scanner.
3. Parallel JET-only scanner: rejected because it would duplicate navigation and artifact behavior.

## Design

`src/sites/oracle/jetReady.js` exposes a safe `waitForOracleJetReady(page, options)` result. It calls public `oj.Context` BusyContext readiness when available; otherwise it returns `jet_unavailable`. It reports active busy-state descriptions on timeout/error and never logs application data.

`fieldDetector` keeps rendered semantic controls as the interaction source and adds a nearest `oj-*` host record. Custom visible button choices that share a question container are emitted as one `single_choice` field. Fields preserve a `dom` record so later code can distinguish semantic input type from JET component host.

The navigator waits after manual entry, before page scans, after form filling, and after Next. A JET timeout is evidence, not a reason to stop a potentially non-JET application form.

## Constraints

- Configuration remains environment-only.
- No secrets, OTPs, or unmasked emails in artifacts.
- Selectors stay in `src/sites/oracle/selectors.js`.
- Tests use local HTML fixtures and no external network.
