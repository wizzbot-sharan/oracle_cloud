const path = require('node:path');
const selectors = require('./selectors');
const { waitForOracleJetReady } = require('./runtime');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function attrSelector(attr, value) {
  return `[${attr}="${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function rootLocator(page, root) {
  if (root) return root;
  return page.locator(selectors.formRoot).first();
}

function locatorFromPath(page, root, domPath) {
  let current = root;
  for (const part of (domPath || '').split('/').filter(Boolean)) {
    const match = part.match(/^([a-z0-9_-]+)\[(\d+)\]$/i);
    if (!match) continue;
    current = current.locator(`:scope > ${match[1]}`).nth(Number.parseInt(match[2], 10) - 1);
  }
  return current;
}

function inaccessibleLocator(page) {
  return page.locator('data-inaccessible-control').first();
}

function isFieldVisible(field, answersMap = {}) {
  if (!field.conditional_parents || field.conditional_parents.length === 0) return true;
  for (const parent of field.conditional_parents) {
    const parentVal = answersMap[parent.field_id] ?? answersMap[parent.label] ?? answersMap[parent.canonical_id];
    const targetVal = String(parent.option_value || parent.option_label || '').trim().toLowerCase();
    const actualVal = String(parentVal ?? '').trim().toLowerCase();

    if (!actualVal) return false;
    if (actualVal !== targetVal && !actualVal.includes(targetVal)) {
      return false;
    }
  }
  return true;
}

function locatorForRegistryField(page, field, component, rootContext) {
  const target = component || field.locator || {};
  if (!target.interaction_safe && !component) return inaccessibleLocator(page);
  const context = rootContext || page;
  const root = rootContext || rootLocator(page);

  let containerLocator = null;
  if (target.question_container_path) {
    const container = locatorFromPath(page, root, target.question_container_path);
    if (target.role) containerLocator = container.locator(`[role="${target.role}"]`).first();
    else if (target.type) containerLocator = container.locator(`[type="${target.type}"]`).first();
    else if (field.type === 'repeater') containerLocator = container.getByRole('button', { name: field.label, exact: true }).first();
    else containerLocator = container.locator('input, textarea, select, [role="combobox"]').first();
  }

  // Priority 1: exact ID
  let primary = target.control_id ? context.locator(attrSelector('id', target.control_id)).first() : null;

  // Fallback 1: name attribute
  let fallbackName = target.control_name ? context.locator(attrSelector('name', target.control_name)).first() : null;

  // Fallback 2: label text
  let fallbackLabel = field.label ? context.getByLabel(field.label, { exact: true }).first() : null;

  // Fallback 3: dynamic ID prefix (e.g. firstName-23 -> firstName-)
  let fallbackPrefix = target.control_name ? context.locator(`input[id^="${target.control_name}-"], textarea[id^="${target.control_name}-"]`).first() : null;

  let combined = primary;
  const candidates = [fallbackName, fallbackLabel, fallbackPrefix, containerLocator].filter(Boolean);
  for (const cand of candidates) {
    combined = combined ? combined.or(cand) : cand;
  }

  return combined ? combined.first() : inaccessibleLocator(page);
}

function choiceLocator(page, field, rootContext) {
  const container = field.locator?.choice_container_id
    ? (rootContext || page).locator(attrSelector('id', field.locator.choice_container_id)).first()
    : field.locator?.question_container_path
      ? locatorFromPath(page, rootContext || rootLocator(page), field.locator.question_container_path)
      : (rootContext || rootLocator(page)).locator(field.locator?.container_css || field.locator?.css || ':scope').first();
  return container.locator('[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"], label.apply-flow-input-checkbox, span.apply-flow-input-checkbox__button');
}

async function selectChoiceOption(page, field, optionValue, { actionDelayMs = 500, rootContext } = {}) {
  const choices = choiceLocator(page, field, rootContext);
  const targetText = String(optionValue?.label || optionValue?.value || optionValue).trim();
  const pattern = new RegExp(`^${escapeRegExp(targetText)}$`, 'i');

  let candidate = choices.filter({ hasText: pattern }).first();
  if (!await candidate.count()) {
    candidate = choices.filter({ has: page.locator(`xpath=ancestor-or-self::*[text()[normalize-space()="${targetText}"]]`) }).first();
  }
  if (!await candidate.count()) {
    candidate = choices.filter({ has: page.locator(`xpath=following-sibling::*[text()[normalize-space()="${targetText}"]]`) }).first();
  }
  if (!await candidate.count()) {
    candidate = (rootContext || page).getByLabel(targetText, { exact: true }).first();
  }
  if (await candidate.count()) {
    await candidate.click({ timeout: 3000 }).catch(() => null);
    await sleep(actionDelayMs);
  }
}

async function selectComboboxOption(page, field, optionValue, { keystrokeDelayMs = 75, actionDelayMs = 500, rootContext } = {}) {
  const target = locatorForRegistryField(page, field, null, rootContext);
  const text = String(optionValue?.label || optionValue?.value || optionValue).trim();
  if (await target.isVisible().catch(() => false)) {
    await target.focus().catch(() => {});
    await target.fill('').catch(() => {});
    if (keystrokeDelayMs > 0) {
      await target.pressSequentially(text, { delay: keystrokeDelayMs }).catch(() => target.fill(text));
    } else {
      await target.fill(text).catch(() => {});
    }
    await sleep(actionDelayMs);

    // Look for matching popup option
    const popup = page.locator(selectors.oraclePopupOptions).filter({ hasText: new RegExp(escapeRegExp(text), 'i') }).first();
    if (await popup.isVisible({ timeout: 2000 }).catch(() => false)) {
      await popup.click({ timeout: 2000 }).catch(() => {});
    } else {
      await target.press('Enter').catch(() => {});
    }
    await sleep(actionDelayMs);
  }
}

async function fillFieldAtHumanSpeed(page, field, value, { keystrokeDelayMs = 75, actionDelayMs = 500, rootContext } = {}) {
  if (value === null || value === undefined) return false;
  const target = locatorForRegistryField(page, field, null, rootContext);

  try {
    if (['text', 'textarea', 'email', 'phone', 'number', 'date', 'search_autocomplete'].includes(field.type)) {
      const text = String(value);
      if (await target.isVisible().catch(() => false)) {
        await target.focus().catch(() => {});
        await target.fill('').catch(() => {});
        if (keystrokeDelayMs > 0 && text.length <= 150) {
          await target.pressSequentially(text, { delay: keystrokeDelayMs }).catch(() => target.fill(text));
        } else {
          await target.fill(text).catch(() => {});
        }
        if (field.type === 'search_autocomplete') {
          await sleep(actionDelayMs);
          await target.press('Enter').catch(() => {});
        }
        await sleep(actionDelayMs);
        return true;
      }
    } else if (['single_choice', 'radio_group', 'checkbox_group'].includes(field.type)) {
      await selectChoiceOption(page, field, value, { actionDelayMs, rootContext });
      return true;
    } else if (field.type === 'boolean_checkbox') {
      const checked = Boolean(value === true || /^yes$|^true$|^1$/i.test(String(value)));
      if (await target.isVisible().catch(() => false)) {
        const isChecked = await target.isChecked().catch(() => false);
        if (checked !== isChecked) {
          await target.click({ timeout: 2000 }).catch(() => null);
          await sleep(actionDelayMs);
        }
        return true;
      }
    } else if (field.type === 'combobox' || field.type === 'native_select') {
      await selectComboboxOption(page, field, value, { keystrokeDelayMs, actionDelayMs, rootContext });
      return true;
    } else if (field.type === 'file_upload') {
      const filePath = typeof value === 'string' ? value : value?.path;
      if (filePath && (await target.isVisible().catch(() => false) || await target.count().catch(() => 0) > 0)) {
        await target.setInputFiles(path.resolve(filePath)).catch(() => null);
        await sleep(actionDelayMs);
        return true;
      }
    } else if (field.type === 'date_composite' && typeof value === 'object') {
      for (const component of field.components || []) {
        const subControl = locatorForRegistryField(page, field, component, rootContext);
        const subVal = /year/i.test(component.label) ? value.year : value.month;
        if (subVal && await subControl.isVisible().catch(() => false)) {
          await subControl.fill(String(subVal)).catch(() => {});
          await subControl.press('Enter').catch(() => {});
          await sleep(actionDelayMs);
        }
      }
      return true;
    } else if (field.type === 'phone_composite' && typeof value === 'object') {
      const prefix = field.components?.find((c) => c.type === 'combobox');
      if (prefix && value.country_code) {
        const control = locatorForRegistryField(page, field, prefix, rootContext);
        if (await control.isVisible().catch(() => false)) {
          await control.fill(String(value.country_code)).catch(() => {});
          await control.press('Enter').catch(() => {});
          await sleep(actionDelayMs);
        }
      }
      const numComp = field.components?.find((c) => c.type === 'tel' || c.type === 'text');
      if (numComp && value.number) {
        const control = locatorForRegistryField(page, field, numComp, rootContext);
        if (await control.isVisible().catch(() => false)) {
          await control.fill(String(value.number)).catch(() => {});
          await sleep(actionDelayMs);
        }
      }
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

async function fillRepeaterEntries(page, field, entries = [], { keystrokeDelayMs = 75, actionDelayMs = 500 } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return true;
  const trigger = locatorForRegistryField(page, field);

  for (const entry of entries) {
    if (!await trigger.isVisible().catch(() => false)) break;
    await trigger.click({ timeout: 4000 }).catch(() => null);
    await sleep(actionDelayMs);

    const editor = page.locator(selectors.repeaterEditor).last();
    if (!await editor.isVisible({ timeout: 4000 }).catch(() => false)) break;

    // Fill each field in the entry matching inputs inside editor
    for (const [key, val] of Object.entries(entry)) {
      if (val === null || val === undefined) continue;
      const input = editor.locator(`input[name*="${key}" i], input#${key}, textarea[name*="${key}" i], [data-qa*="${key}" i] input`).first();
      if (await input.isVisible().catch(() => false)) {
        if (typeof val === 'object' && val.month && val.year) {
          const monthInput = editor.locator(`input[name*="month" i], [aria-label*="month" i] input`).first();
          if (await monthInput.isVisible().catch(() => false)) {
            await monthInput.fill(String(val.month)).catch(() => {});
            await monthInput.press('Enter').catch(() => {});
          }
          const yearInput = editor.locator(`input[name*="year" i], [aria-label*="year" i] input`).first();
          if (await yearInput.isVisible().catch(() => false)) {
            await yearInput.fill(String(val.year)).catch(() => {});
            await yearInput.press('Enter').catch(() => {});
          }
        } else if (typeof val === 'boolean') {
          const checkbox = editor.locator(`input[type="checkbox"][name*="${key}" i]`).first();
          if (await checkbox.isVisible().catch(() => false)) {
            const isChecked = await checkbox.isChecked().catch(() => false);
            if (val !== isChecked) await checkbox.click().catch(() => {});
          }
        } else {
          await input.focus().catch(() => {});
          await input.fill(String(val)).catch(() => {});
        }
        await sleep(actionDelayMs);
      }
    }

    // Click Save on the repeater
    const saveBtn = editor.locator(selectors.repeaterSave).or(page.locator(selectors.repeaterSave)).first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click({ timeout: 3000 }).catch(() => null);
      await sleep(actionDelayMs);
    }

    // Wait for timeline action bar to unlock
    const disabledBar = page.locator(selectors.timelineDisabledAnchor);
    if (await disabledBar.count()) {
      await disabledBar.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
    }
    await sleep(actionDelayMs);
  }
  return true;
}

async function fillApplicationPage(page, fields, answersMap = {}, { keystrokeDelayMs = 75, actionDelayMs = 500, onFieldFilled } = {}) {
  const results = [];
  for (const field of fields) {
    if (field.disabled || field.read_only || field.type === 'unclassified_control') continue;
    if (!isFieldVisible(field, answersMap)) continue;
    const value = answersMap[field.canonical_id || field.field_id] ?? answersMap[field.label] ?? field.value;
    if (value === null || value === undefined) continue;

    if (field.type === 'repeater' && Array.isArray(value)) {
      const ok = await fillRepeaterEntries(page, field, value, { keystrokeDelayMs, actionDelayMs });
      results.push({ field_id: field.field_id, type: 'repeater', success: ok });
      if (ok) onFieldFilled?.(field, value);
    } else {
      const ok = await fillFieldAtHumanSpeed(page, field, value, { keystrokeDelayMs, actionDelayMs });
      results.push({ field_id: field.field_id, type: field.type, success: ok });
      if (ok) onFieldFilled?.(field, value);
    }
  }
  return results;
}

async function fillApplicationJob(page, {
  job,
  userRecord,
  keystrokeDelayMs = 75,
  actionDelayMs = 500,
  maxPages = 20,
  outputDir = 'artifacts/runs/current',
  onProgress,
  onReviewReady,
  approvalSignal,
} = {}) {
  const { resolveJobQuestions } = require('../../answers');
  const questions = job.questions || [];
  const resolved = resolveJobQuestions(questions, userRecord);
  const answersMap = {};
  for (const q of resolved) {
    if (q.value !== null && q.value !== undefined) {
      if (q.canonical_id) answersMap[q.canonical_id] = q.value;
      if (q.field_id) answersMap[q.field_id] = q.value;
      if (q.label) answersMap[q.label] = q.value;
    }
  }

  let currentPage = 1;
  while (currentPage <= maxPages) {
    onProgress?.({ step: 'page_fill', page: currentPage, action: 'start' });
    const pageQuestions = resolved.filter((q) => q.page_index === currentPage);
    await fillApplicationPage(page, pageQuestions, answersMap, {
      keystrokeDelayMs,
      actionDelayMs,
      onFieldFilled: (field, val) => onProgress?.({ step: 'field_fill', page: currentPage, field_id: field.field_id, value: val }),
    });

    await waitForOracleJetReady(page, 3000).catch(() => {});
    await sleep(actionDelayMs);

    // Check if Submit button is visible
    const submitBtn = page.locator(selectors.submitButton).first();
    const isSubmitVisible = await submitBtn.isVisible().catch(() => false);

    if (isSubmitVisible) {
      const reviewScreenshot = path.join(outputDir, `screenshots/final-review.png`);
      await page.screenshot({ path: reviewScreenshot, fullPage: true }).catch(() => {});
      onProgress?.({ step: 'review_ready', page: currentPage, reviewScreenshot });
      onReviewReady?.({ reviewScreenshot, page: currentPage });

      if (approvalSignal) {
        const approved = await Promise.resolve(approvalSignal).catch(() => false);
        if (approved === true || approved?.status === 'approved') {
          // Explicit approval granted: click submit
          await submitBtn.click({ timeout: 5000 });
          await waitForOracleJetReady(page, 5000).catch(() => {});
          await sleep(2000);
          const confirmationScreenshot = path.join(outputDir, `screenshots/submitted-confirmation.png`);
          await page.screenshot({ path: confirmationScreenshot, fullPage: true }).catch(() => {});
          return { status: 'submitted', page: currentPage, confirmationScreenshot };
        }
      }

      return { status: 'filled_awaiting_approval', page: currentPage, reviewScreenshot };
    }

    // Advance to next page
    const nextBtn = page.locator(selectors.nextButton).first();
    if (!await nextBtn.isVisible().catch(() => false)) {
      break;
    }

    const beforeUrl = page.url();
    const beforeHeadings = await page.locator('h1, h2, h3, [role="heading"]').allTextContents().catch(() => []);

    await nextBtn.click({ timeout: 5000 });
    await waitForOracleJetReady(page, 5000).catch(() => {});
    await sleep(actionDelayMs);

    const afterUrl = page.url();
    const afterHeadings = await page.locator('h1, h2, h3, [role="heading"]').allTextContents().catch(() => []);
    const pageChanged = beforeUrl !== afterUrl || JSON.stringify(beforeHeadings) !== JSON.stringify(afterHeadings);

    if (!pageChanged) {
      // Check for real visible validation error messages if page failed to advance
      const rawErrors = await page.locator(selectors.validationErrors).allTextContents().catch(() => []);
      const realErrors = rawErrors.map((s) => s.trim()).filter(Boolean);
      if (realErrors.length > 0) {
        const errorScreenshot = path.join(outputDir, `screenshots/validation-error-page-${currentPage}.png`);
        await page.screenshot({ path: errorScreenshot, fullPage: true }).catch(() => {});
        return { status: 'validation_error', page: currentPage, errors: realErrors, errorScreenshot };
      }
    }

    currentPage++;
  }

  return { status: 'completed_without_submit', page: currentPage };
}

module.exports = {
  sleep,
  isFieldVisible,
  locatorForRegistryField,
  choiceLocator,
  selectChoiceOption,
  selectComboboxOption,
  fillFieldAtHumanSpeed,
  fillRepeaterEntries,
  fillApplicationPage,
  fillApplicationJob,
};
