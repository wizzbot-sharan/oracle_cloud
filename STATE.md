# State (last updated: 2026-10-30, session wrap-up)

## Done
- `scan-login` authentication, email/OTP/magic-link flow, manual-form entry, and no-submit safeguards are implemented.
- `scan-application` traverses pages, records screenshots/events, JET readiness, partial results, and stops at visible Submit.
- Scanner records JET host metadata, semantic types, stable container fingerprints, conditional parents, and marks unsafe controls as unclassified.
- Fixed scanner timeouts: fast combobox mode (`SCANNER_CAPTURE_COMBOBOX_OPTIONS=false`), progressive address gating (`SCANNER_DEFAULT_COUNTRY`), JET readiness race timer (resolves in ~135ms), and container-scoped choice clicks with surgical timeouts.
- Broadened Zoho OTP matcher to accept `no-reply@oracle.com`, `noreply@oracle.com`, `workflow.mail`, and `oraclecloud.com`. Verified in live run (OTP received in 18s).
- Solved Oracle timeline repeater mutual exclusion (`<beautiful-timeline>` / `<timeline-form-inline>`): added `repeaterEditor` and `repeaterCancel` in `selectors.js`, fixed button text labels, added safe `.cancel-btn` dismissal to discard drafts cleanly without validation errors, and added action bar unlock wait.
- All 41 scanner unit tests pass (100%), and full project test suite passes (78/78).
- Designed Phase 2 architecture: separating the Job Blueprint (`qa.json`) from the User Answer Bank (`data/answers.json`), dynamic input adapters, and dashboard Save/Apply workflow.

## In progress
- Transitioning to Phase 2: User Answer Bank, Question Similarity Matching, Dashboard Save/Apply actions, and Live Application Filler.

## Next
1. Build the normalized User Answer Bank schema (`data/answers.json`) and question similarity matcher (exact, synonym alias, token Jaccard).
2. Add "Save Answers" and "Apply" endpoints and UI buttons to the dashboard viewer (`viewer/`).
3. Build the Oracle Live Application Filler (`src/sites/oracle/filler.js`) with dynamic input adapters (text, radio, checkbox, combobox, timeline repeaters, file uploads) and the final Submit-visible screenshot gate.

## Known limitations
- The prior Hilton dashboard artifact has 67 records and 40 unclassified controls; it is historical malformed evidence and must not be used for answer filling.
- Live application submission remains strictly gated (`applications.status = 'approved'`); the filler must never click Submit automatically.
