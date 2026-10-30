# Oracle JET Playwright Extraction Rules

## Readiness

- Before scanning a form and after a JET interaction, call `waitForOracleJetReady(page)`.
- The helper uses the public `oj.Context.getPageContext().getBusyContext().whenReady()` API when available.
- `jet_unavailable`, `timeout`, and `guard_error` are diagnostic outcomes, not permission to stop scanning a visible non-JET form.
- Log the outcome and sanitized busy-state descriptions. Never log OTPs, secrets, or unmasked email addresses.

## Component discovery

- Prefer rendered semantic controls (`input`, `textarea`, `select`, ARIA roles) for Playwright actions.
- Record the nearest `oj-*` component host as metadata; use only public attributes such as `label-hint`, `required`, and `validators`.
- Playwright locators pierce open shadow roots. Do not depend on private view-model fields or attempt to bypass closed shadow roots.
- A field is complete only when its visible question/container, semantic control, and any JET host are recorded together.

## Choice and popup controls

- Treat a radiogroup/checkbox group, including button-based controls, as one question with all option values.
- Scope dynamic popup/listbox lookup to the control that opened it whenever ownership attributes or a component container are available.
- After selecting an option, wait for JET readiness before re-scanning conditionally revealed controls.

## Safety

- Never click Submit.
- Keep authentication and browser contexts isolated per user/job.
- When a visible control cannot be classified, emit an explicit `unknown` or `unclassified_control` record rather than silently omitting it.
