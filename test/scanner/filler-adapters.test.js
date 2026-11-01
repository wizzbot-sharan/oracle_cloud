const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const {
  isFieldVisible,
  locatorForRegistryField,
  fillFieldAtHumanSpeed,
  fillRepeaterEntries,
  fillApplicationPage,
  fillApplicationJob,
} = require('../../src/sites/oracle/filler');

let browser;
let timelineHtml;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
  timelineHtml = fs.readFileSync(path.join(__dirname, '../fixtures/oracle-timeline-repeater.html'), 'utf8');
});

test.after(async () => browser?.close());

test('fillFieldAtHumanSpeed types text and observes keystroke delays', async () => {
  const page = await browser.newPage();
  await page.setContent('<input id="name-field" name="applicantName">');

  const field = {
    field_id: 'name-field',
    type: 'text',
    label: 'Applicant Name',
    locator: { control_id: 'name-field', interaction_safe: true },
  };

  const start = Date.now();
  const ok = await fillFieldAtHumanSpeed(page, field, 'John Doe', { keystrokeDelayMs: 20, actionDelayMs: 10 });
  const duration = Date.now() - start;

  assert.equal(ok, true);
  assert.equal(await page.locator('#name-field').inputValue(), 'John Doe');
  assert.ok(duration >= 100, `Expected duration >= 100ms for keystrokes, got ${duration}ms`);
  await page.close();
});

test('fillFieldAtHumanSpeed toggles boolean checkbox accurately', async () => {
  const page = await browser.newPage();
  await page.setContent('<input id="agree-check" type="checkbox">');

  const field = {
    field_id: 'agree-check',
    type: 'boolean_checkbox',
    label: 'I Agree',
    locator: { control_id: 'agree-check', interaction_safe: true },
  };

  assert.equal(await page.locator('#agree-check').isChecked(), false);
  await fillFieldAtHumanSpeed(page, field, true, { actionDelayMs: 5 });
  assert.equal(await page.locator('#agree-check').isChecked(), true);

  await fillFieldAtHumanSpeed(page, field, false, { actionDelayMs: 5 });
  assert.equal(await page.locator('#agree-check').isChecked(), false);
  await page.close();
});

test('fillRepeaterEntries loops through records, fills fields, and saves each entry', async () => {
  const page = await browser.newPage();
  await page.setContent(timelineHtml);

  const field = {
    field_id: 'timeline-add-experience-button',
    type: 'repeater',
    label: 'Add Experience',
    locator: { control_id: 'timeline-add-experience-button', interaction_safe: true },
  };

  const entries = [
    { employerName: 'First Corp', jobTitle: 'Junior Dev' },
  ];

  const ok = await fillRepeaterEntries(page, field, entries, { keystrokeDelayMs: 0, actionDelayMs: 10 });
  assert.equal(ok, true);

  // Verify form was filled and save clicked, closing the modal
  const disabledBar = await page.locator('#timeline-anchor.work-and-education-timeline__actions-container--disabled').count();
  assert.equal(disabledBar, 0, 'Timeline action bar should be restored after Save');
  await page.close();
});

test('fillApplicationPage maps questions and invokes progress callback', async () => {
  const page = await browser.newPage();
  await page.setContent(`
    <form>
      <input id="q1" name="q1">
      <input id="q2" name="q2">
    </form>
  `);

  const fields = [
    { field_id: 'q1', type: 'text', locator: { control_id: 'q1', interaction_safe: true } },
    { field_id: 'q2', type: 'text', locator: { control_id: 'q2', interaction_safe: true } },
  ];

  const answers = { q1: 'Value 1', q2: 'Value 2' };
  const filled = [];
  const results = await fillApplicationPage(page, fields, answers, {
    keystrokeDelayMs: 0,
    actionDelayMs: 5,
    onFieldFilled: (f, val) => filled.push({ id: f.field_id, val }),
  });

  assert.equal(results.length, 2);
  assert.equal(await page.locator('#q1').inputValue(), 'Value 1');
  assert.equal(await page.locator('#q2').inputValue(), 'Value 2');
  assert.equal(filled.length, 2);
  await page.close();
});

test('fillApplicationJob stops at visible Submit and does not click without approval', async () => {
  const page = await browser.newPage();
  let submitClicked = false;
  await page.setContent(`
    <form id="application-form">
      <input id="q1" name="q1">
      <button type="submit" id="sub-btn">Submit</button>
    </form>
    <script>
      document.querySelector('#sub-btn').addEventListener('click', (e) => {
        e.preventDefault();
        window.__submitted = true;
      });
    </script>
  `);

  const job = {
    questions: [
      { field_id: 'q1', canonical_id: 'q1', type: 'text', page_index: 1, locator: { control_id: 'q1', interaction_safe: true } },
    ],
  };

  const userRecord = {
    answers: [{ question_field_id: 'q1', question: 'q1', value: 'Hello' }],
  };

  const result = await fillApplicationJob(page, {
    job,
    userRecord,
    keystrokeDelayMs: 0,
    actionDelayMs: 5,
    outputDir: '/tmp',
  });

  assert.equal(result.status, 'filled_awaiting_approval');
  const wasSubmitted = await page.evaluate(() => window.__submitted);
  assert.equal(wasSubmitted, undefined, 'Submit button must NOT be clicked without approval');
  await page.close();
});

test('fillApplicationJob clicks Submit when approvalSignal is explicitly approved', async () => {
  const page = await browser.newPage();
  await page.setContent(`
    <form id="application-form">
      <button type="submit" id="sub-btn">Submit</button>
    </form>
    <script>
      document.querySelector('#sub-btn').addEventListener('click', (e) => {
        e.preventDefault();
        window.__submitted = true;
      });
    </script>
  `);

  const job = { questions: [] };
  const userRecord = { answers: [] };

  const result = await fillApplicationJob(page, {
    job,
    userRecord,
    keystrokeDelayMs: 0,
    actionDelayMs: 5,
    outputDir: '/tmp',
    approvalSignal: Promise.resolve({ status: 'approved' }),
  });

  assert.equal(result.status, 'submitted');
  const wasSubmitted = await page.evaluate(() => window.__submitted);
  assert.equal(wasSubmitted, true, 'Submit button must be clicked when approved');
  await page.close();
});

test('isFieldVisible gates conditional fields based on parent selection', () => {
  const normalField = { field_id: 'q1', label: 'Full Name' };
  assert.equal(isFieldVisible(normalField, {}), true);

  const referralField = {
    field_id: 'internal-employee-name',
    label: 'Internal Employee Name',
    conditional_parents: [
      { field_id: 'hear-about-job', option_value: 'Employee Referral', option_label: 'Employee Referral' },
    ],
  };

  assert.equal(isFieldVisible(referralField, { 'hear-about-job': 'LinkedIn' }), false);
  assert.equal(isFieldVisible(referralField, { 'hear-about-job': 'Employee Referral' }), true);
});

test('locatorForRegistryField falls back to name and label when dynamic control_id changed', async () => {
  const page = await browser.newPage();
  // Form has name="firstName" and dynamic id="firstName-99", while scanned id was "firstName-23"
  await page.setContent('<input id="firstName-99" name="firstName" aria-label="First Name">');

  const field = {
    field_id: 'first-name-field',
    type: 'text',
    label: 'First Name',
    locator: {
      control_id: 'firstName-23', // Outdated ID from previous session
      control_name: 'firstName',   // Stable attribute
      interaction_safe: true,
    },
  };

  const loc = locatorForRegistryField(page, field);
  assert.equal(await loc.isVisible(), true);
  await loc.fill('John');
  assert.equal(await page.locator('#firstName-99').inputValue(), 'John');
  await page.close();
});
