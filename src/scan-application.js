const crypto = require('node:crypto');
const selectors = require('./sites/oracle/selectors');
const { scanRegistryPage, fillRegistryRequiredFields, flattenRegistryFields, dedupeRegistryFields, locatorForRegistryField } = require('./sites/oracle/scanner');
const { waitForOracleJetReady } = require('./sites/oracle/runtime');

async function detectDisplayedSteps(page) {
  const values = await page.locator(selectors.stepItems).evaluateAll((items) => items
    .filter((item) => item.getClientRects().length > 0)
    .map((item) => Number.parseInt(item.getAttribute('data-step') || item.textContent, 10))
    .filter(Number.isInteger)).catch(() => []);
  return [...new Set(values)].sort((a, b) => a - b);
}

async function firstVisibleLocator(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index++) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function enterManualApplication(page) {
  let heading = await firstVisibleLocator(
    page.locator('h1, h2, h3, [role="heading"]').filter({ hasText: selectors.manualGateHeading })
  );
  let quickProfile = await page.locator('#quickProfileImport').count() ? page.locator('#quickProfileImport').first() : null;
  if (!heading && !quickProfile) {
    await page.waitForTimeout(1000);
    heading = await firstVisibleLocator(
      page.locator('h1, h2, h3, [role="heading"]').filter({ hasText: selectors.manualGateHeading })
    );
    quickProfile = await page.locator('#quickProfileImport').count() ? page.locator('#quickProfileImport').first() : null;
  }
  if (!heading && !quickProfile) return false;
  const manual = await firstVisibleLocator(page.locator(selectors.manualGateControl))
    || await firstVisibleLocator(page.getByText(/\bmanually\b/i));
  if (!manual) throw new Error('Resume gate is visible but the manual application control is missing');
  await manual.click();
  await page.waitForFunction(() => {
    const resumeGateVisible = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
      .some((item) => item.getClientRects().length > 0 && /let\s*'?s make this quick/i.test(item.textContent || ''));
    const controls = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'))
      .filter((control) => control.getClientRects().length > 0 && control.id !== 'quickProfileImport');
    const nextOrSubmit = Array.from(document.querySelectorAll('button')).some((button) => /next|submit/i.test(button.textContent || button.getAttribute('aria-label') || ''));
    return !resumeGateVisible && (controls.length > 0 || nextOrSubmit);
  }, { timeout: 10000 });
  return true;
}

async function visible(locator) {
  return locator.first().isVisible().catch(() => false);
}

async function pageStateHash(page) {
  const state = await page.evaluate(() => ({
    url: location.href,
    headings: Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
      .filter((item) => item.getClientRects().length > 0)
      .map((item) => String(item.textContent || '').replace(/\s+/g, ' ').trim()),
    actions: Array.from(document.querySelectorAll('button,a'))
      .filter((item) => item.getClientRects().length > 0 && /next|submit|back/i.test(item.textContent || item.getAttribute('aria-label') || ''))
      .map((item) => String(item.textContent || item.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()),
  }));
  return crypto.createHash('sha1').update(JSON.stringify(state)).digest('hex');
}

async function capture(writer, page, meta, pageIndex, step, extra = {}, options = {}) {
  const screenshot = await writer.captureScreenshot(page, { ...meta, page: pageIndex, step, ...extra }, options);
  await writer.logEvent({
    ...meta,
    page: pageIndex,
    step,
    action: 'screenshot',
    result: screenshot ? 'saved' : 'skipped',
    screenshot: screenshot?.file,
    ...extra,
  });
  return screenshot;
}

async function recordJetReadiness(writer, page, meta, pageIndex, step) {
  const readiness = await waitForOracleJetReady(page);
  await writer.logEvent({
    ...meta,
    page: pageIndex,
    step,
    action: 'wait_for_jet',
    result: readiness.status,
    busy_states: readiness.busy_states,
  });
  return readiness;
}

async function scanApplication(page, {
  writer, profile, meta, maxPages, stepRetries, fieldSettleMs = 2000,
  optionCaptureMaxRounds = 100, optionCaptureStagnantRounds = 2,
  cascadeSampleStates = ['California', 'New York', 'Texas'],
  cascadeProfile = {},
}) {
  let enteredManual = await enterManualApplication(page).catch((error) => { throw error; });
  if (!enteredManual) {
    await page.waitForTimeout(1000);
    enteredManual = await enterManualApplication(page).catch((error) => { throw error; });
  }
  await writer.logEvent({
    ...meta,
    page: 0,
    step: 'resume_gate',
    action: 'enter_manual',
    result: enteredManual ? 'entered' : 'not_present',
  });
  await recordJetReadiness(writer, page, meta, 0, 'resume_gate');
  const pages = [];
  const allFields = [];
  const seenStates = new Set();

  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex++) {
    await recordJetReadiness(writer, page, meta, pageIndex, 'before_page_scan');
    const stateHash = await pageStateHash(page);
    if (seenStates.has(stateHash)) {
      await writer.logEvent({ ...meta, page: pageIndex, step: 'navigation', action: 'detect_loop', result: 'blocked' });
      return { status: 'navigation_blocked', detector_version: 'registry-v1', pages, fields: allFields };
    }
    seenStates.add(stateHash);
    const displayedSteps = await detectDisplayedSteps(page);
    const pageScreenshot = await capture(writer, page, meta, pageIndex, 'page_scan', {}, { fullPage: true, kind: 'page' });

    const pageScan = await scanRegistryPage(page, {
      pageIndex,
      displayedSteps,
      settleMs: fieldSettleMs,
      optionCaptureMaxRounds,
      optionCaptureStagnantRounds,
      cascadeSampleStates,
      cascadeProfile,
      onFieldDiscovered: async (field) => {
        await writer.logEvent({
          ...meta, page: pageIndex, step: 'field_scan', action: 'discover_dynamic', result: 'captured',
          field_id: field.field_id, section: field.section, field_type: field.type,
        });
      },
      onOptionVisited: async (field, option) => {
        await writer.logEvent({ ...meta, page: pageIndex, step: 'option_scan', action: 'visit', result: 'scanned', field_id: field.field_id, option: option.label });
      },
      onOptionDiscovered: async (field, option) => {
        await writer.logEvent({ ...meta, page: pageIndex, step: 'option_scan', action: 'discover', result: 'captured', field_id: field.field_id, option: option.label });
      },
      onOptionCapture: async (field, capture) => {
        const action = capture.status === 'started' ? 'option_capture_started'
          : capture.status === 'scroll' ? 'option_capture_scroll'
            : capture.status === 'complete' ? 'option_capture_completed'
              : 'option_capture_incomplete';
        await writer.logEvent({
          ...meta, page: pageIndex, step: 'option_capture', action, result: capture.status,
          field_id: field.field_id, discovered_count: capture.discovered_count,
          scroll_round: capture.scroll_round, end_reached: capture.end_reached,
          incomplete_reason: capture.incomplete_reason,
        });
      },
    });
    await writer.writePartialJobResult(meta.job_id, {
      status: 'scanning', detector_version: pageScan.detector_version,
      pages,
      fields: [...allFields, ...pageScan.fields],
      worklist: pageScan.fields.map((field) => ({ field_id: field.field_id, status: field.coverage_status })),
    });
    const fields = dedupeRegistryFields(flattenRegistryFields(pageScan.fields, { includeRepeaterSchema: false }));
    for (const field of fields) {
      const locator = locatorForRegistryField(page, field);
      if (await locator.isVisible().catch(() => false)) await locator.scrollIntoViewIfNeeded().catch(() => {});
      const screenshot = await capture(writer, page, meta, pageIndex, 'field_scan', { field_id: field.field_id }, { kind: 'field' });
      field.screenshot = (screenshot || pageScreenshot)?.file || '';
      await writer.logEvent({
        ...meta, page: pageIndex, step: 'field_scan', action: 'inspect', result: field.coverage_status,
        field_id: field.field_id, section: field.section, field_type: field.type,
      });
      await writer.writePartialJobResult(meta.job_id, {
        status: 'scanning', detector_version: pageScan.detector_version, pages, fields: [...allFields, ...fields],
        worklist: fields.map((item) => ({ field_id: item.field_id, status: item.field_id === field.field_id ? 'captured' : item.coverage_status })),
      });
    }

    const sectionNames = [...new Set(fields.map((field) => field.section))];
    pages.push({ page_index: pageIndex, displayed_steps: displayedSteps, section_names: sectionNames, field_count: fields.length });
    allFields.push(...fields);
    await writer.writePartialJobResult(meta.jobId || meta.job_id, {
      status: 'scanning', pages, fields: allFields,
      worklist: fields.map((field) => ({ field_id: field.field_id, status: field.coverage_status || 'captured' })),
    });

    const fillResult = await fillRegistryRequiredFields(page, pageScan.fields, profile, { settleMs: fieldSettleMs });
    for (const action of fillResult.actions) {
      await writer.logEvent({ ...meta, page: pageIndex, step: 'dummy_fill', action: 'fill', result: action.result, field_id: action.field_id });
    }
    await recordJetReadiness(writer, page, meta, pageIndex, 'after_dummy_fill');
    for (const error of fillResult.errors) {
      await writer.logEvent({ ...meta, page: pageIndex, step: 'dummy_fill', action: 'fill', result: 'error', field_id: error.field_id, detail: error.message });
    }
    await capture(writer, page, meta, pageIndex, 'page_after_fill', {}, { fullPage: true, kind: 'page_after_fill' });

    const submit = page.locator(selectors.submitButton).first();
    if (await visible(submit)) {
      await capture(writer, page, meta, pageIndex, 'submit_visible', {}, { fullPage: true, kind: 'submit' });
      await writer.logEvent({ ...meta, page: pageIndex, step: 'submit_visible', action: 'stop_before_submit', result: 'success' });
      return { status: 'submit_visible', detector_version: 'registry-v1', pages, fields: allFields };
    }

    const next = page.locator(selectors.nextButton).first();
    if (!await visible(next)) {
      await writer.logEvent({ ...meta, page: pageIndex, step: 'navigation', action: 'find_next', result: 'missing' });
      return { status: 'incomplete_no_next_or_submit', detector_version: 'registry-v1', pages, fields: allFields };
    }

    let advanced = false;
    for (let attempt = 1; attempt <= stepRetries; attempt++) {
      const before = await pageStateHash(page);
      await next.click();
      await recordJetReadiness(writer, page, meta, pageIndex, 'after_next');
      await page.waitForTimeout(fieldSettleMs);
      const after = await pageStateHash(page);
      await writer.logEvent({ ...meta, page: pageIndex, step: 'navigation', action: 'click_next', result: before === after ? 'no_change' : 'advanced', attempt });
      if (before !== after) {
        advanced = true;
        break;
      }
      const validation = await page.locator(selectors.validationErrors).allTextContents().catch(() => []);
      await writer.logEvent({ ...meta, page: pageIndex, step: 'validation', action: 'collect', result: validation.length ? 'errors_found' : 'no_visible_errors', detail: validation });
      const retryScan = await scanRegistryPage(page, {
        pageIndex,
        displayedSteps,
        settleMs: fieldSettleMs,
        optionCaptureMaxRounds,
        optionCaptureStagnantRounds,
        cascadeSampleStates,
        cascadeProfile,
      });
      await fillRegistryRequiredFields(page, retryScan.fields, profile, { settleMs: fieldSettleMs });
      if (attempt === 1 || attempt === stepRetries) await capture(writer, page, meta, pageIndex, 'validation_retry', { attempt }, { fullPage: true, kind: 'incomplete' });
    }
    if (!advanced) return { status: 'navigation_blocked', detector_version: 'registry-v1', pages, fields: allFields };
  }

  return { status: 'max_pages_reached', detector_version: 'registry-v1', pages, fields: allFields };
}

module.exports = { detectDisplayedSteps, enterManualApplication, pageStateHash, scanApplication };
