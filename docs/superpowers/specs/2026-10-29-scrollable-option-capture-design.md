# Scrollable Oracle Option Capture Design

## Intent

Capture every safely reachable option for Oracle dropdowns and comboboxes, including options that appear only as the user scrolls a virtualized or lazy-loaded list. Persist the full option list in scan JSON and render it in the local evidence dashboard.

## Goals

- Treat each dropdown's opened overlay as a scoped scanning surface.
- Save every discovered option in displayed order with label, value, disabled state, and stable deduplication.
- Wait for Oracle JET BusyContext and the configured settle delay after opening and each scroll.
- Prove completion using the listbox scroll position plus repeated no-growth observations.
- Mark a field incomplete when the scanner cannot prove it reached the end, rather than claiming an exhaustive option list.
- Show saved options and completion status in the viewer.
- Preserve existing no-submit, per-user isolation, OTP masking, and container-scoped interaction safeguards.

## Non-goals

- Selecting every option for answer matching or form filling.
- Reading private Oracle JET view models or data providers.
- Combining unrelated parent choices to discover every possible cross-field combination.
- Changing authentication, concurrency, database schema, or production dashboard behavior.

## Approaches considered

1. Inspect Oracle JET data providers directly. This is tenant/version dependent and cannot be trusted as the primary extraction path.
2. Scroll the visible listbox, record rendered options, and verify the actual end of the list. **Selected** because it observes the same options a person can access and works for standard and virtualized listboxes.
3. Combine scrolling with private JET internals. Rejected for now because it increases fragility without being necessary to meet the evidence requirement.

## Design

### Option capture record

Each option-bearing field retains its `options` array and gains:

```js
{
  options: [{ label, value, disabled }],
  option_capture: {
    status: 'complete' | 'incomplete' | 'not_applicable',
    source: 'native_select' | 'scrolled_listbox' | 'rendered_choice_group',
    discovered_count: 0,
    scroll_rounds: 0,
    end_reached: false,
    incomplete_reason: ''
  }
}
```

Native `<select>` controls and fully rendered radio/checkbox/button groups are complete after reading their DOM options. Custom comboboxes use the scrolling process.

### Scoped scrolling process

1. Resolve the field's uniquely scoped control. If it is not safe, leave it unclassified and do not open a global overlay.
2. Open the control and identify the associated visible listbox. Associate it through `aria-controls`, `aria-owns`, JET overlay ownership, or a single visible overlay created immediately after opening. If exactly one listbox cannot be established, record incomplete coverage.
3. Read currently rendered options only from that listbox. Normalize whitespace, preserve the first display order, and deduplicate by stable value plus label.
4. Measure `scrollTop`, `scrollHeight`, and `clientHeight`. Scroll by approximately one viewport, wait for JET readiness and the configured settle delay, then rescan the same listbox.
5. Stop only when both conditions hold: the listbox is at its bottom tolerance and two consecutive rescans add no options. This accounts for delayed/lazy fetches near the end.
6. Bound the process with configuration for maximum rounds and maximum stagnant rounds. A bound, closed overlay, changed overlay identity, or page error produces `incomplete` status with a machine-readable reason.
7. Close the list with Escape and verify the overlay is gone before continuing the page scan.

### Cascades and conditionals

When a parent option changes a child dropdown's list, the scanner runs the same scoped capture for that child while the parent option is selected. The saved cascade mapping contains the child's full `options` and `option_capture` record for that parent option. It then restores the parent value.

### Artifacts and viewer

- Log `option_capture_started`, each `option_capture_scroll`, `option_capture_completed`, and `option_capture_incomplete` without secrets or unmasked emails.
- Maintain per-field screenshots already produced by the scanner; add an option-capture screenshot only on incomplete capture or unexpected overlay changes.
- The viewer displays all captured options, option count, completion status, and any incomplete reason. A complete field shows its choices. An incomplete field remains visibly flagged for review.

## Tests

Local Playwright fixtures will cover:

- Native select option capture.
- A custom listbox whose items become visible only after scrolling.
- A virtualized listbox that reuses DOM rows while values change.
- Lazy loading that adds options after a scroll delay.
- Duplicate labels with distinct values.
- Disabled and placeholder options.
- A list that cannot prove its end and is marked incomplete.
- Two simultaneously visible listboxes, proving the scanner only reads the one scoped to its control.
- A cascading parent dropdown whose child options are fully captured for each parent option.
- Viewer rendering for complete and incomplete option captures.

## Acceptance criteria

- A dropdown's JSON contains every observed option exactly once and preserves display order.
- `option_capture.status` is `complete` only when the end-of-list criteria were met.
- The dashboard displays every saved option and tells the user when coverage is incomplete.
- No unscoped overlay or unrelated control is clicked.
- Submit is never clicked.
- Existing scanner tests still pass, and the new fixture tests pass before a headed Oracle validation.
