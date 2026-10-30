# State (last updated: 2026-10-30, session wrap-up)

## Done
- `scan-login` authentication, email/OTP/magic-link flow, manual-form entry, and no-submit safeguards are implemented.
- `scan-application` traverses pages, waits 10 seconds after OTP verification, records screenshots/events, JET readiness, partial results, and stops at visible Submit.
- Scanner records JET host metadata, semantic types, stable container fingerprints, conditional parents, and marks unsafe controls as unclassified instead of clicking a global fallback.
- Local scanner tests cover JET controls, option discovery, partial-result preservation, slow interaction settling, authentication, and OTP parsing diagnostics.
- OTP parser supports common labelled and spaced-code layouts; unresolved matched emails emit structure-only diagnostics with no body or OTP.
- The legacy-to-active migration is complete: active runtime and tests do not import archived files.
- Pipeline repair is complete in static and fixture verification: immutable evidence, manifest-backed QA, masked URL diagnostics, selected-job viewer access, and circuit-breaker behavior are covered.

## In progress
- Run one complete post-repair headed validation after bounding the address-autocomplete crawl.

## Next
1. Bound the slow exhaustive address-autocomplete crawl.
2. Run one complete headed validation and compare it in the viewer; unclassified controls remain evidence-only.
3. Continue per-company OTP cooldown/rate-limit work, then resume DB schema and resolver work.

## Known limitations
- The prior Hilton dashboard artifact has 67 records and 40 unclassified controls; it is historical malformed evidence and must not be used for answer filling.
- The new choice/repeater behavior is fixture-tested; it still needs a live Oracle validation before it is trusted for production filling.
- BNY headed validation started at `2026-10-28T17-58-16-606Z` and reached OTP mailbox polling, but no completed artifact was written; treat it as incomplete evidence.
- A post-repair Safeway trial was intentionally stopped during a large address-autocomplete crawl; it did not modify `data/qa.json` or current evidence.
