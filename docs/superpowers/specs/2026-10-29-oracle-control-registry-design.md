# Oracle Control Registry Scanner Design

## Intent

Phase 1 needs one trustworthy question record per Oracle application question, while preserving the proven Phase 0 authentication and page traversal flow. The registry detector uses stable Oracle containers, ARIA relationships and controlled popup IDs rather than global indexes or question text alone.

## Control model

Every field records its section, label source/confidence, control family, normalized type, question/control containers, locator strategy, options, option-capture status, conditional parents, repeater schema and evidence references. Radio and checkbox groups are represented once with ordered options. Phone and segmented date controls retain child components under one logical field.

## Option and repeater behavior

Finite native, radio, checkbox and Oracle `gridcell` options are captured once. Oracle popups are opened through the field's `aria-controls`, scrolled until the bottom is stable, and cached for later navigation. Search autocomplete results are observed but never marked exhaustive. Repeaters are sampled once in a scoped editor, then cancelled or removed.

## Viewer and safety

The viewer reconstructs captured controls as browser-local inputs, selects, radios, checkboxes, file pickers and repeater cards. Conditional fields follow recorded parent selections. No viewer action writes answers, opens Oracle, calls Submit or persists state. Unclassified and incomplete controls remain visible with warnings.

## Diagnostics

JSONL remains the durable evidence format. A masked terminal reporter projects the same events at `SCANNER_LOG_LEVEL=summary|verbose`; summary mode reports field and option progress, while verbose mode includes each option label. OTPs, secrets and unmasked emails are never printed.

## Bounded address sampling

The scanner captures all Country and US State choices, then exercises California, New York and Texas for downstream County, Postal Code and City behavior. It does not enumerate every country/state combination.
