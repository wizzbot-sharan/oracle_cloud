const crypto = require('node:crypto');
const selectors = require('./selectors');
const { waitForOracleJetReady } = require('./runtime');

const OPTION_SELECTOR = selectors.oraclePopupOptions;

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 10);
}

function escapeRegExp(string) {
  return String(string ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldIdFor(field) {
  const identity = [
    field.page_index,
    field.section,
    field.label,
    field.control_family,
    field.locator?.control_id || '',
    field.locator?.question_container_path || '',
    field.conditional_path?.join('>') || '',
  ].join('|');
  const slug = normalize(`${field.section}-${field.label}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'field';
  return `${slug}-${hash(identity).slice(0, 8)}`;
}

function fieldIdentity(field) {
  return [field.locator?.control_id || '', field.locator?.question_container_path || '', field.type, field.label].join('|');
}

function captureMetadata(status, source, details = {}) {
  return {
    status,
    source,
    discovered_count: details.discovered_count || 0,
    scroll_rounds: details.scroll_rounds || 0,
    end_reached: Boolean(details.end_reached),
    incomplete_reason: details.incomplete_reason || '',
  };
}

function inaccessibleLocator(page) {
  return page.locator(':not(*)');
}

function attrSelector(name, value) {
  return `[${name}=${JSON.stringify(String(value))}]`;
}

function rootLocator(page, root) {
  return root || page.locator(selectors.formRoot).first();
}

function locatorFromPath(page, root, path) {
  return path ? root.locator(`xpath=${path}`) : inaccessibleLocator(page);
}

function locatorForRegistryField(page, field, component = null) {
  const target = component || field.locator || {};
  if (!target.interaction_safe && !component) return inaccessibleLocator(page);
  if (target.control_id) return page.locator(attrSelector('id', target.control_id)).first();
  const root = rootLocator(page);
  if (target.question_container_path) {
    const container = locatorFromPath(page, root, target.question_container_path);
    if (target.role) return container.locator(`[role="${target.role}"]`).first();
    if (target.type) return container.locator(`[type="${target.type}"]`).first();
    if (field.type === 'repeater') return container.getByRole('button', { name: field.label, exact: true }).first();
    return container;
  }
  if (target.control_name) return page.locator(attrSelector('name', target.control_name)).first();
  if (field.type === 'repeater' && field.label) return page.getByRole('button', { name: field.label, exact: true }).first();
  return field.label ? page.getByLabel(field.label, { exact: true }).first() : inaccessibleLocator(page);
}

function choiceLocator(page, field) {
  const container = field.locator?.choice_container_id
    ? page.locator(attrSelector('id', field.locator.choice_container_id)).first()
    : field.locator?.question_container_path
      ? locatorFromPath(page, rootLocator(page), field.locator.question_container_path)
      : locatorForRegistryField(page, field);
  const role = field.type === 'checkbox_group' || field.type === 'boolean_checkbox' ? 'checkbox' : 'radio';
  if (field.locator?.choice_container_id || field.locator?.question_container_path) {
    return container.locator(`[role="${role}"], input[type="${role}"]`);
  }
  return page.locator(`[role="${role}"], input[type="${role}"]`);
}

async function scanRegistryFields(page, {
  pageIndex,
  displayedSteps = [],
  conditionalPath = [],
  root: suppliedRoot = null,
} = {}) {
  const root = rootLocator(page, suppliedRoot);
  const raw = await root.evaluate((formRoot, args) => {
    const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    };
    const ancestor = (element, predicate) => {
      let node = element;
      while (node) {
        if (node.nodeType === Node.ELEMENT_NODE && predicate(node)) return node;
        node = node.parentElement;
      }
      return null;
    };
    const textByIds = (ids) => normalize(String(ids || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
    const domPath = (element) => {
      const parts = [];
      let node = element;
      while (node && node !== formRoot && node.nodeType === Node.ELEMENT_NODE) {
        const siblings = Array.from(node.parentElement?.children || []).filter((item) => item.tagName === node.tagName);
        parts.unshift(`${node.tagName.toLowerCase()}[${Math.max(1, siblings.indexOf(node) + 1)}]`);
        node = node.parentElement;
      }
      return parts.join('/');
    };
    const questionFor = (element) => ancestor(element, (node) => node.matches?.('.input-row, [data-question-id], .question, fieldset, .profile-item-container, .profile-item-content--form, [data-qa*="question" i]')) || element;
    const sectionFor = (element) => {
      const region = ancestor(element, (node) => node.matches?.('section, [role="region"], .apply-flow-block'));
      if (!region) return 'Unsectioned';
      const heading = region.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
      return normalize(heading?.textContent || region.getAttribute('aria-label') || 'Unsectioned') || 'Unsectioned';
    };
    const labelFor = (element, container) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) return { label: textByIds(labelledBy), source: 'aria' };
      const aria = normalize(element.getAttribute('aria-label'));
      if (aria) return { label: aria, source: 'aria' };
      const groupAriaLabel = container?.getAttribute('aria-label');
      const groupLabelledBy = container?.getAttribute('aria-labelledby');
      if (groupAriaLabel) return { label: normalize(groupAriaLabel), source: 'aria' };
      if (groupLabelledBy) return { label: textByIds(groupLabelledBy) || normalize(groupLabelledBy), source: 'aria' };
      const legend = container?.querySelector(':scope > legend');
      if (legend) return { label: normalize(legend.textContent), source: 'legend' };
      if (element.id) {
        const label = formRoot.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return { label: normalize(label.textContent), source: 'label' };
      }
      const wrapped = element.closest('label');
      if (wrapped) return { label: normalize(wrapped.textContent), source: 'label' };
      const nearby = container?.querySelector(':scope > label, :scope > legend, :scope > .input-row__label, :scope > [role="heading"]');
      if (nearby) return { label: normalize(nearby.textContent), source: 'nearby_dom' };
      const host = ancestor(element, (node) => node.tagName?.toLowerCase().startsWith('oj-'));
      const hint = normalize(host?.getAttribute('label-hint'));
      if (hint) return { label: hint, source: 'jet' };
      if (element.tagName.toLowerCase() === 'button' && normalize(element.textContent)) {
        return { label: normalize(element.textContent), source: 'button_text' };
      }
      return { label: normalize(element.getAttribute('name') || element.id || (element.tagName.toLowerCase() === 'button' ? element.textContent : '') || `Unlabelled ${element.tagName.toLowerCase()}`), source: 'none' };
    };
    const optionFor = (element) => {
      const linked = element.closest('label') || (element.id ? formRoot.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null);
      const rawValue = String(element.value || element.getAttribute('data-value') || '');
      return {
        label: normalize(linked?.textContent || element.getAttribute('aria-label') || element.textContent || element.value),
        value: rawValue && rawValue !== 'on' ? rawValue : (element.id || normalize(linked?.textContent || element.textContent)),
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
      };
    };
    const questionMeta = (container) => ({
      id: container.id || '',
      path: domPath(container),
      fingerprint: `${container.tagName.toLowerCase()}|${container.id || ''}|${normalize(container.getAttribute('aria-labelledby'))}|${normalize(container.getAttribute('data-qa'))}|${domPath(container)}`,
      tag: container.tagName.toLowerCase(),
    });
    const hostFor = (element) => ancestor(element, (node) => node.tagName?.toLowerCase().startsWith('oj-'));
    const controlType = (element, group, container) => {
      const tag = element.tagName.toLowerCase();
      const type = String(element.getAttribute('type') || 'text').toLowerCase();
      const role = element.getAttribute('role') || '';
      const hasTel = Boolean(container?.querySelector('input[type="tel"]'));
      const combos = container ? container.querySelectorAll('[role="combobox"]').length : 0;
      if (tag === 'button' && /\badd\b/i.test(normalize(element.textContent))) return 'repeater';
      if (hasTel && combos) return 'phone_composite';
      if (container?.matches('.datepicker-row') || (/date/i.test(container?.getAttribute('aria-label') || '') && combos > 1)) return 'date_composite';
      if (tag === 'textarea') return 'textarea';
      if (type === 'file') return 'file_upload';
      const isAutoSuggest = element.classList.contains('cx-select-input--auto-suggest')
        || /start typing|see suggestions/i.test(element.getAttribute('placeholder') || '')
        || /see suggestions/i.test(container ? container.textContent : '');
      if (isAutoSuggest && (role === 'combobox' || tag === 'input')) return 'search_autocomplete';
      if (role === 'combobox' || tag === 'select') return tag === 'select' ? 'native_select' : 'combobox';
      if (role === 'radio' || type === 'radio') return 'single_choice';
      if (role === 'checkbox' || type === 'checkbox') return (group.length > 1 || container?.matches('.input-row[role="group"], [role="radiogroup"], oj-checkboxset')) ? 'checkbox_group' : 'boolean_checkbox';
      if (type === 'email') return 'email';
      if (type === 'tel') return 'phone';
      if (type === 'number') return 'number';
      if (['date', 'month', 'week'].includes(type)) return 'date';
      return 'text';
    };
    const candidates = Array.from(formRoot.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"], [role="radio"], [role="checkbox"], button'))
      .filter((element) => visible(element) && (!element.matches('button') || ['radio', 'checkbox'].includes(element.getAttribute('role')) || /\badd\b/i.test(normalize(element.textContent))));
    const fields = [];
    const handled = new Set();
    for (const element of candidates) {
      const container = questionFor(element);
      const role = element.getAttribute('role') || '';
      const type = String(element.getAttribute('type') || '').toLowerCase();
      const radioGroup = role === 'radio' ? ancestor(element, (node) => node.matches?.('[role="radiogroup"], oj-buttonset-one, oj-radioset')) : null;
      const checkGroup = (role === 'checkbox' || type === 'checkbox') ? ancestor(element, (node) => node.matches?.('.input-row[role="group"], [role="group"], oj-checkboxset')) : null;
      const checkboxCount = checkGroup?.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length || 0;
      const groupContainer = radioGroup || (checkGroup && (checkboxCount > 1 || checkGroup.matches('.input-row[role="group"], [role="radiogroup"], oj-checkboxset')) ? checkGroup : null);
      const group = groupContainer
        ? Array.from(groupContainer.querySelectorAll(role === 'radio' ? '[role="radio"], input[type="radio"]' : 'input[type="checkbox"], [role="checkbox"]')).filter(visible)
        : ((type === 'radio' && element.name) ? candidates.filter((candidate) => candidate.getAttribute('type') === 'radio' && candidate.name === element.name) : [element]);
      const actualContainer = groupContainer || container;
      const fieldType = controlType(element, group, actualContainer);
      const key = `${questionMeta(actualContainer).fingerprint}|${fieldType}`;
      if (handled.has(key)) continue;
      handled.add(key);
      const labelInfo = groupContainer || fieldType === 'phone_composite' || fieldType === 'date_composite'
        ? labelFor(actualContainer, actualContainer)
        : labelFor(element, actualContainer);
      const section = sectionFor(element);
      const components = [];
      if (fieldType === 'phone_composite' || fieldType === 'date_composite') {
        actualContainer.querySelectorAll('input, [role="combobox"]').forEach((child) => {
          const childScope = child.closest('.phone-row__prefix, .phone-row__number, .datepicker-row') || actualContainer;
          const childLabel = labelFor(child, childScope);
          const compositeLabel = child.closest('.phone-row__prefix')?.querySelector('.input-field__label')?.textContent;
          components.push({ label: normalize(compositeLabel || childLabel.label), type: child.getAttribute('type') || (child.getAttribute('role') === 'combobox' ? 'combobox' : 'text'), control_id: child.id || '', control_name: child.getAttribute('name') || '', popup_id: child.getAttribute('aria-controls') || '', interaction_safe: Boolean(child.id || child.getAttribute('name')) });
        });
      }
      const options = fieldType === 'native_select'
        ? Array.from(element.options).map((option) => ({ label: normalize(option.textContent), value: option.value, disabled: option.disabled }))
        : ['single_choice', 'checkbox_group'].includes(fieldType)
          ? group.map(optionFor)
          : [];
      const host = hostFor(element);
      const question = questionMeta(actualContainer);
      const controlId = element.id || '';
      const interactionSafe = Boolean(controlId || element.name || question.path || fieldType === 'repeater');
      fields.push({
        page_index: args.pageIndex,
        displayed_steps: args.displayedSteps,
        section,
        label: labelInfo.label,
        label_source: labelInfo.source,
        label_confidence: labelInfo.source === 'none' ? 'none' : labelInfo.source === 'nearby_dom' ? 'medium' : 'high',
        needs_review: labelInfo.source === 'none' || labelInfo.source === 'nearby_dom',
        type: fieldType,
        semantic_type: host?.tagName?.toLowerCase() || fieldType,
        control_family: fieldType,
        coverage_status: interactionSafe ? 'captured' : 'unclassified',
        question_container: question,
        control_container: { id: actualContainer.id || '', path: domPath(actualContainer), tag: actualContainer.tagName.toLowerCase() },
        required: Boolean(element.required || element.getAttribute('aria-required') === 'true' || group.some((item) => item.required || item.getAttribute('aria-required') === 'true')),
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        read_only: Boolean(element.readOnly || element.getAttribute('aria-readonly') === 'true'),
        repeatable: fieldType === 'repeater',
        repeater_kind: fieldType === 'repeater' ? (/add\s+(education|experience|license|language|reference)/i.test(normalize(element.textContent)) ? 'profile' : 'inline') : '',
        repeater_schema: [],
        conditional_path: args.conditionalPath,
        conditional_parents: [],
        options,
        components,
        constraints: { accept: element.getAttribute('accept'), multiple: element.hasAttribute('multiple'), min: element.getAttribute('min'), max: element.getAttribute('max'), minLength: element.minLength >= 0 ? element.minLength : null, maxLength: element.maxLength >= 0 ? element.maxLength : null, pattern: element.getAttribute('pattern') },
        placeholder: element.getAttribute('placeholder') || '',
        locator: {
          control_id: controlId,
          control_name: element.getAttribute('name') || '',
          role,
          tag: element.tagName.toLowerCase(),
          input_type: type || 'text',
          interaction_safe: interactionSafe,
          question_container_id: question.id,
          question_container_path: question.path,
          choice_container_id: groupContainer?.id || '',
          popup_id: element.getAttribute('aria-controls') || '',
          option_role: role === 'combobox' ? 'gridcell' : role,
          target_text: fieldType === 'repeater' ? normalize(element.textContent) : '',
        },
        dom: { tag: element.tagName.toLowerCase(), input_type: type || 'text', role, aria_label: element.getAttribute('aria-label') || '', aria_labelledby: element.getAttribute('aria-labelledby') || '', aria_describedby: element.getAttribute('aria-describedby') || '' },
        jet: host ? { host_tag: host.tagName.toLowerCase(), required: host.getAttribute('required') || '', label_hint: host.getAttribute('label-hint') || '', validators: host.getAttribute('validators') || '' } : null,
      });
    }
    return fields;
  }, { pageIndex, displayedSteps, conditionalPath });
  return { page_index: pageIndex, displayed_steps: displayedSteps, fields: raw.map((field) => ({ ...field, field_id: fieldIdFor(field) })) };
}

async function waitSettled(page, settleMs = 0) {
  await waitForOracleJetReady(page, { timeoutMs: 2000 }).catch(() => {});
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

async function resolvePopup(page, field, control) {
  const ids = await control.evaluate((element) => [element.getAttribute('aria-controls'), element.getAttribute('aria-owns')].filter(Boolean).flatMap((value) => value.split(/\s+/))).catch(() => []);
  for (const id of ids) {
    const popup = page.locator(attrSelector('id', id)).first();
    if (await popup.isVisible().catch(() => false)) return popup;
  }
  const visiblePopups = page.locator(selectors.visibleListbox + ', [role="grid"]:visible, .cx-select__list:visible');
  return await visiblePopups.count() === 1 ? visiblePopups.first() : null;
}

async function capturePopup(page, popup, { settleMs = 0, maxRounds = 100, stagnantRounds = 2, onScroll, onOptionDiscovered } = {}) {
  const options = new Map();
  await popup.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll', { bubbles: true })); }).catch(() => {});
  await waitSettled(page, settleMs);
  let stagnant = 0;
  let bottom = false;
  for (let round = 0; round < maxRounds; round++) {
    const before = options.size;
    const found = await popup.locator(OPTION_SELECTOR).evaluateAll((items) => items.filter((item) => item.getClientRects().length > 0).map((item) => ({ label: String(item.textContent || '').replace(/\s+/g, ' ').trim(), value: item.getAttribute('data-value') || item.getAttribute('value') || String(item.textContent || '').replace(/\s+/g, ' ').trim(), disabled: item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('disabled') }))).catch(() => []);
    for (const option of found) {
      if (!option.label) continue;
      const key = `${option.value}|${option.label}`;
      if (!options.has(key)) await onOptionDiscovered?.(option);
      options.set(key, option);
    }
    stagnant = options.size === before ? stagnant + 1 : 0;
    const metrics = await popup.evaluate((element) => ({ top: element.scrollTop, height: element.scrollHeight, client: element.clientHeight })).catch(() => null);
    if (!metrics) return { options: [...options.values()], option_capture: captureMetadata('incomplete', 'oracle_popup', { discovered_count: options.size, incomplete_reason: 'popup_metrics_unavailable' }) };
    bottom = metrics.top + metrics.client >= metrics.height - 1;
    await onScroll?.({ scroll_round: round, discovered_count: options.size, end_reached: bottom });
    if (bottom && stagnant >= stagnantRounds) {
      const status = options.size ? 'complete' : 'incomplete';
      return { options: [...options.values()], option_capture: captureMetadata(status, 'oracle_popup', { discovered_count: options.size, scroll_rounds: round + 1, end_reached: true, incomplete_reason: options.size ? '' : 'no_option_nodes_found' }) };
    }
    await popup.evaluate((element) => { element.scrollTop += Math.max(element.clientHeight, 1); }).catch(() => {});
    await waitSettled(page, settleMs);
  }
  return { options: [...options.values()], option_capture: captureMetadata('incomplete', 'oracle_popup', { discovered_count: options.size, end_reached: bottom, incomplete_reason: 'max_scroll_rounds_reached' }) };
}

async function scanRegistryOptions(page, field, {
  settleMs = 0,
  captureComboboxOptions = false,
  maxRounds = 100,
  stagnantRounds = 2,
  cache = new Map(),
  onScroll,
  onOptionDiscovered,
} = {}) {
  if (cache.has(field.field_id)) return cache.get(field.field_id);
  let result;
  if (['single_choice', 'checkbox_group', 'boolean_checkbox', 'native_select'].includes(field.type)) {
    const values = field.options || [];
    result = { options: values, option_capture: captureMetadata(values.length ? 'complete' : 'incomplete', 'rendered_dom', { discovered_count: values.length, end_reached: Boolean(values.length), incomplete_reason: values.length ? '' : 'no_option_nodes_found' }) };
  } else if (field.type === 'search_autocomplete') {
    result = { options: [], option_capture: captureMetadata('complete', 'search_autocomplete', { discovered_count: 0, incomplete_reason: 'requires_query' }) };
  } else if (field.type === 'combobox' || field.type === 'phone_composite' || field.type === 'date_composite') {
    if (!captureComboboxOptions) {
      result = {
        options: field.options || [],
        option_capture: captureMetadata('complete', 'combobox_fast_mode', {
          discovered_count: (field.options || []).length,
          skipped_for_fast_mode: true,
        }),
      };
    } else {
      const componentList = field.components?.filter((component) => component.type === 'combobox' || component.popup_id) || [];
      const components = componentList.length ? componentList : [field.locator];
      const merged = [];
      let status = 'complete';
      let source = 'oracle_popup';
      for (const component of components) {
        const control = locatorForRegistryField(page, field, component);
        if (!await control.count().catch(() => 0)) continue;
        await control.scrollIntoViewIfNeeded().catch(() => {});
        await control.click().catch(() => control.press('ArrowDown').catch(() => {}));
        await waitSettled(page, settleMs);
        const popup = await resolvePopup(page, field, control);
        if (!popup) { status = 'incomplete'; source = 'oracle_popup'; continue; }
        const captured = await capturePopup(page, popup, { settleMs, maxRounds, stagnantRounds, onScroll, onOptionDiscovered });
        if (component !== field.locator) component.options = captured.options;
        merged.push(...captured.options);
        if (captured.option_capture.status !== 'complete') status = 'incomplete';
        await control.press('Escape').catch(() => {});
        await waitSettled(page, settleMs);
      }
      const unique = new Map(merged.map((option) => [`${option.value}|${option.label}`, option]));
      result = { options: [...unique.values()], option_capture: captureMetadata(status, source, { discovered_count: unique.size, end_reached: status === 'complete', incomplete_reason: status === 'complete' ? '' : 'one_or_more_popups_incomplete' }) };
    }
  } else {
    result = { options: field.options || [], option_capture: captureMetadata('not_applicable', 'not_applicable', { discovered_count: (field.options || []).length }) };
  }
  cache.set(field.field_id, result);
  return result;
}

async function chooseRegistryOption(page, field, option, settleMs = 0) {
  if (field.type === 'native_select') {
    const control = locatorForRegistryField(page, field);
    if (option.value) {
      const byVal = await control.selectOption(option.value).catch(() => null);
      if (byVal) return byVal;
    }
    return control.selectOption({ label: option.label }).catch(() => control.selectOption(option.value || option.label));
  }
  if (['single_choice', 'checkbox_group', 'boolean_checkbox'].includes(field.type)) {
    const controls = choiceLocator(page, field);
    const clickTimeout = 2000;

    // 1. If control itself or its wrapper has matching text (e.g. pills, radio buttons)
    const textCandidate = controls.filter({ hasText: option.label }).first();
    if (await textCandidate.count().catch(() => 0)) {
      return textCandidate.click({ timeout: clickTimeout });
    }

    // 2. Look for associated label or input by value inside the question container
    const container = field.locator?.choice_container_id
      ? page.locator(attrSelector('id', field.locator.choice_container_id)).first()
      : field.locator?.question_container_path
        ? locatorFromPath(page, rootLocator(page), field.locator.question_container_path)
        : null;

    if (container) {
      const containerLabel = container.locator('label, .oj-checkbox-label, .oj-radio-label, [role="presentation"]')
        .filter({ hasText: option.label }).first();
      if (await containerLabel.count().catch(() => 0)) {
        return containerLabel.click({ timeout: clickTimeout });
      }

      if (option.value) {
        const valueInput = container.locator(`input[value="${CSS.escape(option.value)}"], [data-value="${CSS.escape(option.value)}"]`).first();
        if (await valueInput.count().catch(() => 0)) {
          return valueInput.click({ timeout: clickTimeout, force: true });
        }
      }
    }

    // 3. Accessibility role lookup
    const role = field.type === 'single_choice' ? 'radio' : 'checkbox';
    const roleCandidate = page.getByRole(role, { name: option.label }).first();
    if (await roleCandidate.count().catch(() => 0)) {
      return roleCandidate.click({ timeout: clickTimeout, force: true });
    }

    // 4. Exact label fallback capped at 2s
    const label = page.getByLabel(option.label, { exact: true }).first();
    return label.click({ timeout: clickTimeout });
  }
  const control = locatorForRegistryField(page, field);
  await control.click({ timeout: 2000 }).catch(() => control.press('ArrowDown'));
  await waitSettled(page, settleMs);
  const popup = await resolvePopup(page, field, control);
  if (!popup) throw new Error('scoped Oracle popup not found');
  let candidate = popup.locator(OPTION_SELECTOR).filter({ hasText: option.label }).first();
  if (!await candidate.count().catch(() => 0)) {
    await control.fill(option.label).catch(() => {});
    await waitSettled(page, settleMs);
    candidate = popup.locator(OPTION_SELECTOR).filter({ hasText: option.label }).first();
  }
  await candidate.click({ timeout: 2000 });
  await waitSettled(page, settleMs);
}

async function scanRegistryRepeater(page, field, { pageIndex, displayedSteps, settleMs = 0, captureComboboxOptions = false, optionCaptureMaxRounds = 100, optionCaptureStagnantRounds = 2, optionCache = new Map(), onFieldDiscovered, onOptionCapture, onOptionDiscovered } = {}) {
  const trigger = locatorForRegistryField(page, field);
  if (await trigger.count() !== 1) return { fields: [], status: 'incomplete', reason: 'trigger_not_unique' };
  await trigger.click({ timeout: 3000 }).catch(() => null);
  await waitSettled(page, settleMs);
  const editor = page.locator(selectors.repeaterEditor).last();
  if (!await editor.count()) {
    const strayCancel = page.locator(selectors.repeaterCancel).first();
    if (await strayCancel.isVisible().catch(() => false)) await strayCancel.click().catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    await waitSettled(page, settleMs);
    return { fields: [], status: 'incomplete', reason: 'editor_not_found' };
  }
  const scan = await scanRegistryFields(page, { pageIndex, displayedSteps, root: editor, conditionalPath: [`${field.field_id}=opened`] });
  field.repeater_schema = scan.fields;
  field.repeatable_fields = scan.fields;
  for (const nested of scan.fields) {
    if (!['combobox', 'phone_composite', 'date_composite'].includes(nested.type)) continue;
    const captured = await scanRegistryOptions(page, nested, {
      settleMs,
      captureComboboxOptions,
      maxRounds: optionCaptureMaxRounds,
      stagnantRounds: optionCaptureStagnantRounds,
      cache: optionCache,
      onScroll: (progress) => onOptionCapture?.(nested, { status: 'scroll', ...progress }),
      onOptionDiscovered: (option) => onOptionDiscovered?.(nested, option),
    });
    nested.options = captured.options;
    nested.option_capture = captured.option_capture;
  }
  for (const nested of scan.fields) await onFieldDiscovered?.(nested);
  const cancel = editor.locator(selectors.repeaterCancel).or(page.locator(selectors.repeaterCancel)).first();
  if (await cancel.isVisible().catch(() => false)) await cancel.click().catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await waitSettled(page, settleMs);

  const disabledBar = page.locator(selectors.timelineDisabledAnchor);
  if (await disabledBar.count()) {
    await disabledBar.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }

  return { fields: scan.fields, status: 'captured' };
}

async function scanRegistryPage(page, {
  pageIndex,
  displayedSteps = [],
  settleMs = 0,
  captureComboboxOptions = false,
  defaultCountry = 'United States',
  optionCaptureMaxRounds = 100,
  optionCaptureStagnantRounds = 2,
  cascadeSampleStates = ['California', 'New York', 'Texas'],
  cascadeProfile = {},
  onOptionCapture,
  onOptionVisited,
  onOptionDiscovered,
  onFieldDiscovered,
} = {}) {
  const scan = await scanRegistryFields(page, { pageIndex, displayedSteps });
  const cache = new Map();
  const conditionalRegistry = new Map();
  for (const field of scan.fields) {
    if (!field.locator?.interaction_safe) { field.coverage_status = 'unclassified'; continue; }
    if (field.type === 'repeater') continue;
    await onOptionCapture?.(field, { status: 'started' });
    const captured = await scanRegistryOptions(page, field, {
      settleMs,
      captureComboboxOptions,
      maxRounds: optionCaptureMaxRounds,
      stagnantRounds: optionCaptureStagnantRounds,
      cache,
      onScroll: (progress) => onOptionCapture?.(field, { status: 'scroll', ...progress }),
      onOptionDiscovered: (option) => onOptionDiscovered?.(field, option),
    });
    field.options = captured.options;
    field.option_capture = captured.option_capture;
    if (captured.option_capture.status === 'incomplete' && field.type !== 'search_autocomplete') field.coverage_status = 'options_incomplete';
    await onOptionCapture?.(field, captured.option_capture);
  }
  const country = scan.fields.find((field) => /^country$/i.test(field.label));
  const hasAddressDetails = scan.fields.some((field) => /address line 1|street address/i.test(field.label));
  const state = scan.fields.find((field) => /^state$|^state\/province$/i.test(field.label));

  if (country && (country.type === 'combobox' || country.type === 'native_select')) {
    const targetCountry = defaultCountry || 'United States';
    const targetOption = (country.options || []).find((option) => new RegExp(escapeRegExp(targetCountry), 'i').test(option.label))
      || { label: targetCountry, value: targetCountry };

    // Select country to expand hidden address fields or trigger dynamic state options
    if (!hasAddressDetails || state) {
      await chooseRegistryOption(page, country, targetOption, settleMs).catch(() => {});
      await waitSettled(page, settleMs);

      const updatedScan = await scanRegistryFields(page, { pageIndex, displayedSteps });
      const knownIdentities = new Set(scan.fields.map(fieldIdentity));

      for (const newField of updatedScan.fields) {
        if (!knownIdentities.has(fieldIdentity(newField))) {
          scan.fields.push(newField);
          knownIdentities.add(fieldIdentity(newField));
          await onFieldDiscovered?.(newField);

          if (newField.locator?.interaction_safe && newField.type !== 'repeater') {
            await onOptionCapture?.(newField, { status: 'started' });
            const captured = await scanRegistryOptions(page, newField, {
              settleMs,
              captureComboboxOptions,
              maxRounds: optionCaptureMaxRounds,
              stagnantRounds: optionCaptureStagnantRounds,
              cache,
              onScroll: (progress) => onOptionCapture?.(newField, { status: 'scroll', ...progress }),
              onOptionDiscovered: (option) => onOptionDiscovered?.(newField, option),
            });
            newField.options = captured.options;
            newField.option_capture = captured.option_capture;
            if (captured.option_capture.status === 'incomplete' && newField.type !== 'search_autocomplete') newField.coverage_status = 'options_incomplete';
            await onOptionCapture?.(newField, captured.option_capture);
          }
        }
      }
    }

    const activeState = scan.fields.find((field) => /^state$|^state\/province$/i.test(field.label));
    const activeCounty = scan.fields.find((field) => /^county$/i.test(field.label));
    const activePostal = scan.fields.find((field) => /postal|zip/i.test(field.label));
    const activeCity = scan.fields.find((field) => /^city$/i.test(field.label));

    if (activeState) {
      cache.delete(activeState.field_id);
      const stateCapture = await scanRegistryOptions(page, activeState, {
        settleMs,
        captureComboboxOptions,
        maxRounds: optionCaptureMaxRounds,
        stagnantRounds: optionCaptureStagnantRounds,
        cache,
        onScroll: (progress) => onOptionCapture?.(activeState, { status: 'scroll', ...progress }),
      });
      activeState.options = stateCapture.options;
      activeState.option_capture = stateCapture.option_capture;
      activeState.cascade_samples = [];

      if (activeState.options && activeState.options.length > 0) {
        for (const sampleState of cascadeSampleStates) {
          const sampleProfile = cascadeProfile[sampleState] || {};
          const stateOption = activeState.options.find((option) => option.label.toLowerCase() === String(sampleState).toLowerCase());
          if (!stateOption) { activeState.cascade_samples.push({ state: sampleState, status: 'unavailable' }); continue; }
          await chooseRegistryOption(page, activeState, stateOption, settleMs).catch(() => {});
          await waitSettled(page, settleMs);
          const sample = { state: sampleState, status: 'captured' };
          if (activeCounty) {
            cache.delete(activeCounty.field_id);
            const countyCapture = await scanRegistryOptions(page, activeCounty, {
              settleMs,
              captureComboboxOptions,
              maxRounds: optionCaptureMaxRounds,
              stagnantRounds: optionCaptureStagnantRounds,
              cache,
            });
            activeCounty.options = countyCapture.options;
            activeCounty.option_capture = countyCapture.option_capture;
            sample.county_options = activeCounty.options;
            const countyOption = activeCounty.options.find((option) => option.label.toLowerCase() === String(sampleProfile.county || '').toLowerCase());
            if (countyOption) await chooseRegistryOption(page, activeCounty, countyOption, settleMs).catch(() => {});
          }
          if (activePostal) {
            const postalTarget = locatorForRegistryField(page, activePostal);
            await postalTarget.fill(sampleProfile.postalCode || '10001').catch(() => {});
            await waitSettled(page, settleMs);
            sample.postal_entered = true;
          }
          if (activeCity) sample.city_value = await locatorForRegistryField(page, activeCity).inputValue().catch(() => '') || sampleProfile.city || '';
          activeState.cascade_samples.push(sample);
        }
      }
    }
  }

  for (const field of scan.fields) {
    if (field.type === 'repeater') {
      await scanRegistryRepeater(page, field, {
        pageIndex,
        displayedSteps,
        settleMs,
        captureComboboxOptions,
        optionCaptureMaxRounds,
        optionCaptureStagnantRounds,
        optionCache: cache,
        onFieldDiscovered,
        onOptionCapture,
        onOptionDiscovered,
      });
      continue;
    }
    if (!['single_choice', 'radio_group', 'checkbox_group', 'boolean_checkbox'].includes(field.type)) continue;
    const original = await choiceLocator(page, field).evaluateAll((items) => items.filter((item) => item.checked || item.getAttribute('aria-checked') === 'true').map((item) => item.value || item.textContent.trim())).catch(() => []);
    for (const option of (field.options || []).filter((item) => !item.disabled && item.value)) {
      await onOptionVisited?.(field, option);
      await chooseRegistryOption(page, field, option, settleMs).catch(() => {});
      await waitSettled(page, settleMs);
      const discovered = await scanRegistryFields(page, { pageIndex, displayedSteps, conditionalPath: [...(field.conditional_path || []), `${field.field_id}=${option.label}`] });
      const known = new Set(scan.fields.map(fieldIdentity));
      for (const candidate of discovered.fields.filter((candidate) => !known.has(fieldIdentity(candidate)))) {
        const identity = fieldIdentity(candidate);
        const parent = { field_id: field.field_id, option_value: option.value, option_label: option.label };
        const existing = conditionalRegistry.get(identity);
        if (existing) {
          existing.conditional_parents = existing.conditional_parents || [];
          if (!existing.conditional_parents.some((item) => item.field_id === parent.field_id && item.option_value === parent.option_value)) existing.conditional_parents.push(parent);
          continue;
        }
        candidate.conditional_parents = [parent];
        conditionalRegistry.set(identity, candidate);
        field.conditional_fields = field.conditional_fields || [];
        field.conditional_fields.push(candidate);
        await onFieldDiscovered?.(candidate);
      }
    }
    if (field.type === 'single_choice') {
      if (original.length) {
        const restoreOption = field.options?.find((opt) => original.includes(opt.value) || original.includes(opt.label));
        if (restoreOption) await chooseRegistryOption(page, field, restoreOption, settleMs).catch(() => {});
      } else {
        const firstValid = (field.options || []).find((opt) => !opt.disabled && opt.value);
        if (firstValid) await chooseRegistryOption(page, field, firstValid, settleMs).catch(() => {});
      }
    } else if (field.type === 'checkbox_group' || field.type === 'boolean_checkbox') {
      for (const control of await choiceLocator(page, field).all()) {
        const value = await control.getAttribute('value').catch(() => null);
        const text = normalize(await control.textContent().catch(() => ''));
        const shouldBeChecked = original.includes(value || text);
        const checked = await control.isChecked().catch(async () => (await control.getAttribute('aria-checked')) === 'true');
        if (checked !== shouldBeChecked) await control.click({ timeout: 2000, force: true }).catch(() => {});
      }
    }
    field.coverage_status = field.coverage_status === 'options_incomplete' ? field.coverage_status : 'options_scanned';
  }
  return { ...scan, detector_version: 'registry-v1', fields: scan.fields };
}

function flattenRegistryFields(fields, { includeRepeaterSchema = true } = {}) {
  const result = [];
  for (const field of fields || []) {
    result.push(field);
    result.push(...flattenRegistryFields(field.conditional_fields, { includeRepeaterSchema }));
    if (includeRepeaterSchema) result.push(...flattenRegistryFields(field.repeater_schema, { includeRepeaterSchema }));
  }
  return result;
}

function dedupeRegistryFields(fields) {
  const byId = new Map();
  for (const field of fields || []) {
    const key = field.canonical_id || field.field_id || fieldIdentity(field);
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, field);
      continue;
    }
    existing.conditional_parents = [...(existing.conditional_parents || [])];
    for (const parent of field.conditional_parents || []) {
      if (!existing.conditional_parents.some((item) => item.field_id === parent.field_id && item.option_value === parent.option_value)) existing.conditional_parents.push(parent);
    }
    if (!(existing.options || []).length && (field.options || []).length) existing.options = field.options;
    if (!existing.option_capture && field.option_capture) existing.option_capture = field.option_capture;
  }
  return [...byId.values()];
}

function syntheticValue(field, profile) {
  const label = String(field.label || '').toLowerCase();
  if (field.type === 'number') return '1';
  if (/first name/.test(label)) return profile.firstName;
  if (/last name/.test(label)) return profile.lastName;
  if (/email/.test(label)) return profile.email;
  if (/phone|mobile/.test(label)) return profile.phone;
  if (/date/.test(label)) return profile.date;
  return profile.genericText;
}

async function fillRegistryRequiredFields(page, fields, profile, { settleMs = 0 } = {}) {
  const actions = [];
  const errors = [];
  for (const field of flattenRegistryFields(fields)) {
    if (!field.required || field.disabled || field.read_only || field.type === 'repeater' || field.type === 'unclassified_control') continue;
    const target = locatorForRegistryField(page, field);
    if (!await target.isVisible().catch(() => false)) continue;
    try {
      if (['text', 'textarea', 'email', 'phone', 'number', 'date', 'search_autocomplete'].includes(field.type)) {
        await target.fill(syntheticValue(field, profile));
        if (field.type === 'search_autocomplete') await target.press('Enter').catch(() => {});
      }
      else if (field.type === 'phone_composite') {
        const prefix = field.components?.find((component) => component.type === 'combobox');
        if (prefix) {
          const option = field.options?.find((item) => item.value && !item.disabled);
          if (option) await chooseRegistryOption(page, field, option, settleMs);
        }
        const number = field.components?.find((component) => component.type === 'tel');
        if (number) await locatorForRegistryField(page, field, number).fill(profile.phone);
      }
      else if (field.type === 'date_composite') {
        for (const component of field.components || []) {
          if (component.type === 'combobox') {
            const control = locatorForRegistryField(page, field, component);
            await control.fill(component.label.match(/year/i) ? '2000' : '1').catch(() => {});
            await control.press('Enter').catch(() => {});
          }
        }
      }
      else if (field.type === 'file_upload') await target.setInputFiles(profile.uploadPath);
      else if (field.type === 'native_select' || field.type === 'combobox') {
        const option = (field.options || []).find((item) => item.value && !item.disabled);
        if (option) await chooseRegistryOption(page, field, option, settleMs);
      } else if (field.type === 'boolean_checkbox') {
        await target.check().catch(() => target.click());
      } else if (['single_choice', 'checkbox_group'].includes(field.type)) {
        const option = (field.options || []).find((item) => !item.disabled && item.value);
        if (option) await chooseRegistryOption(page, field, option, settleMs);
      }
      await waitSettled(page, settleMs);
      actions.push({ field_id: field.field_id, result: 'filled' });
    } catch (error) {
      errors.push({ field_id: field.field_id, message: error.message });
    }
  }
  return { actions, errors };
}

module.exports = {
  scanRegistryFields,
  scanRegistryOptions,
  scanRegistryPage,
  scanRegistryRepeater,
  locatorForRegistryField,
  chooseRegistryOption,
  fillRegistryRequiredFields,
  flattenRegistryFields,
  dedupeRegistryFields,
  capturePopup,
};
