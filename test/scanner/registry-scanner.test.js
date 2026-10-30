const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const { scanRegistryFields, scanRegistryPage, fillRegistryRequiredFields } = require('../../src/sites/oracle/scanner');

let browser;
let html;
let dynamicHtml;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
  html = fs.readFileSync(path.join(__dirname, '../fixtures/oracle-registry-real.html'), 'utf8');
  dynamicHtml = fs.readFileSync(path.join(__dirname, '../fixtures/oracle-dynamic-form.html'), 'utf8');
});

test.after(async () => browser?.close());

test('registry groups Oracle pills and unnamed checkbox options into one question each', async () => {
  const page = await browser.newPage();
  await page.setContent(html);
  const result = await scanRegistryFields(page, { pageIndex: 1 });
  const races = result.fields.find((field) => field.label === 'Select the races you identify with.');
  const title = result.fields.find((field) => field.label === 'Title');
  assert.equal(races.type, 'checkbox_group');
  assert.deepEqual(races.options.map((option) => option.label), ['Asian', 'White']);
  assert.equal(title.type, 'single_choice');
  assert.deepEqual(title.options.map((option) => option.label), ['Doctor', 'Ms.']);
  const ethnicity = result.fields.find((field) => field.label === 'Ethnicity');
  assert.equal(ethnicity.type, 'checkbox_group');
  assert.deepEqual(ethnicity.options.map((option) => option.label), ['I am Hispanic or Latino']);
  await page.close();
});

test('registry represents phone as one composite question with a scoped country-code component', async () => {
  const page = await browser.newPage();
  await page.setContent(html);
  const result = await scanRegistryFields(page, { pageIndex: 1 });
  const phone = result.fields.find((field) => field.type === 'phone_composite');
  assert.equal(phone.label, 'Phone Number');
  assert.deepEqual(phone.components.map((component) => component.label), ['Country code', 'Phone Number']);
  await page.close();
});

test('registry captures grid dropdown choices and repeater schema without duplicate top-level fields', async () => {
  const page = await browser.newPage();
  await page.setContent(html);
  const result = await scanRegistryPage(page, { pageIndex: 1, settleMs: 0 });
  const country = result.fields.find((field) => field.label === 'Country');
  const education = result.fields.find((field) => field.label === 'Add Education');
  const resume = result.fields.find((field) => field.label === 'Upload Resume');
  assert.deepEqual(country.options.map((option) => option.label), ['United States', 'Canada', 'India']);
  assert.equal(country.option_capture.status, 'complete');
  assert.equal(education.repeater_schema.some((field) => field.label === 'School'), true);
  const degree = education.repeater_schema.find((field) => field.label === 'Degree');
  assert.deepEqual(degree.options.map((option) => option.label), ['Bachelor', 'Master']);
  assert.equal(resume.constraints.multiple, true);
  assert.equal(result.fields.filter((field) => field.label === 'School').length, 0);
  await page.close();
});

test('registry option inventory is cached and does not reopen the same dropdown twice', async () => {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.evaluate(() => { window.countryClicks = 0; document.querySelector('#country-1').addEventListener('click', () => window.countryClicks++); });
  await scanRegistryPage(page, { pageIndex: 1, settleMs: 0 });
  assert.equal(await page.evaluate(() => window.countryClicks), 1);
  await page.close();
});

test('registry filler handles scoped text and file controls without navigation', async () => {
  const page = await browser.newPage();
  await page.setContent(html);
  const scan = await scanRegistryPage(page, { pageIndex: 1, settleMs: 0 });
  const result = await fillRegistryRequiredFields(page, scan.fields, { firstName: 'Test', lastName: 'Candidate', email: 'scanner@example.test', phone: '2025550100', genericText: 'Synthetic', date: '2000-01-01', uploadPath: path.join(__dirname, '../../data/fixtures/dummy-resume.txt') }, { settleMs: 0 });
  assert.equal(result.errors.length, 0);
  assert.equal(await page.locator('#firstName-1').inputValue(), 'Test');
  assert.equal(await page.locator('#attachment-upload-77').evaluate((input) => input.files.length), 1);
  await page.close();
});

test('registry branches record only newly revealed conditional fields once', async () => {
  const page = await browser.newPage();
  await page.setContent(dynamicHtml);
  const result = await scanRegistryPage(page, { pageIndex: 1, settleMs: 0, optionCaptureMaxRounds: 5 });
  const sponsorship = result.fields.find((field) => field.label === 'Do you need sponsorship?');
  assert.equal(sponsorship.conditional_fields.some((field) => field.label === 'Please explain sponsorship needs'), true);
  assert.equal(result.fields.filter((field) => field.label === 'Country').length, 1);
  await page.close();
});
