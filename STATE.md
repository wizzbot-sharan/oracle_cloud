# State (last updated: 2026-10-30)

## Done
- `scan-login` authentication, email/OTP/magic-link flow, manual-form entry, and no-submit safeguards are implemented.
- `scan-application` traverses pages, waits 10 seconds after OTP verification, records screenshots/events, JET readiness, partial results, and stops at visible Submit.
- Scanner records JET host metadata, semantic types, stable container fingerprints, conditional parents, and marks unsafe controls as unclassified instead of clicking a global fallback.
- Local scanner tests cover JET controls, option discovery, partial-result preservation, slow interaction settling, authentication, and OTP parsing diagnostics.
- OTP parser supports common labelled and spaced-code layouts; unresolved matched emails emit structure-only diagnostics with no body or OTP.

## In progress
- Run one complete post-repair headed validation. The repaired pipeline now uses immutable per-job evidence, strict QA validation, selected-job viewer access, masked URL diagnostics, and the two-issue circuit breaker; fixture/static verification is complete.
- Continue per-company OTP cooldown/rate-limit work, then resume DB schema and resolver work.

## Next
1. Run one complete post-repair headed validation and compare it in the viewer; unclassified controls must remain visible as evidence and must not be filled.
2. Investigate/bound the slow exhaustive address-autocomplete crawl before treating that live validation as production acceptance.
3. Continue per-company OTP cooldown/rate-limit work, then resume DB schema and resolver work.

## Known limitations
- The prior Hilton dashboard artifact has 67 records and 40 unclassified controls; it is historical malformed evidence and must not be used for answer filling.
- The new choice/repeater behavior is fixture-tested; it still needs a live Oracle validation before it is trusted for production filling.
- BNY headed validation started at `2026-10-28T17-58-16-606Z` and reached OTP mailbox polling, but no completed artifact was written; treat it as incomplete evidence.
- A post-repair Safeway trial was intentionally stopped during a large address-autocomplete crawl; it did not modify `data/qa.json` or current evidence.
