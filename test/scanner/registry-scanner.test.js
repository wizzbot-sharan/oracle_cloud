const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const { scanRegistryFields, scanRegistryOptions, scanRegistryPage, fillRegistryRequiredFields } = require('../../src/sites/oracle/scanner');

let browser;
let html;
let dynamicHtml;
let timelineHtml;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
  html = fs.readFileSync(path.join(__dirname, '../fixtures/oracle-registry-real.html'), 'utf8');
  dynamicHtml = fs.readFileSync(path.join(__dirname, '../fixtures/oracle-dynamic-form.html'), 'utf8');
  timelineHtml = fs.readFileSync(path.join(__dirname, '../fixtures/oracle-timeline-repeater.html'), 'utf8');
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
  const result = await scanRegistryPage(page, { pageIndex: 1, settleMs: 0, captureComboboxOptions: true });
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

test('registry scans mutually-exclusive timeline repeaters in sequence without hanging', async () => {
  const page = await browser.newPage();
  await page.setContent(timelineHtml);
  const result = await scanRegistryPage(page, { pageIndex: 1, settleMs: 0 });
  const experience = result.fields.find((field) => field.label === 'Add Experience');
  const education = result.fields.find((field) => field.label === 'Add Education');
  assert.ok(experience, 'Add Experience should be discovered');
  assert.ok(education, 'Add Education should be discovered');
  assert.equal(experience.type, 'repeater');
  assert.equal(education.type, 'repeater');
  assert.equal(experience.repeater_schema.some((field) => field.label === 'Employer Name'), true);
  assert.equal(experience.repeater_schema.some((field) => field.label === 'Job Title'), true);
  assert.equal(education.repeater_schema.some((field) => field.label === 'School'), true);
  assert.equal(education.repeater_schema.some((field) => field.label === 'Degree'), true);
  // Ensure timeline actions are restored and unblocked
  const anchorDisabled = await page.locator('#timeline-anchor.work-and-education-timeline__actions-container--disabled').count();
  assert.equal(anchorDisabled, 0, 'Timeline action bar must not be left disabled');
  await page.close();
});

test('registry option inventory is cached and does not reopen the same dropdown twice', async () => {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.evaluate(() => { window.countryClicks = 0; document.querySelector('#country-1').addEventListener('click', () => window.countryClicks++); });
  const cache = new Map();
  const scan = await scanRegistryFields(page, { pageIndex: 1 });
  const country = scan.fields.find((field) => field.label === 'Country');
  await scanRegistryOptions(page, country, { cache, captureComboboxOptions: true, settleMs: 0 });
  await scanRegistryOptions(page, country, { cache, captureComboboxOptions: true, settleMs: 0 });
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

test('registry combobox fast mode skips popup scrolling when captureComboboxOptions is false', async () => {
  const page = await browser.newPage();
  await page.setContent(html);
  const result = await scanRegistryPage(page, { pageIndex: 1, settleMs: 0, captureComboboxOptions: false });
  const country = result.fields.find((field) => field.label === 'Country');
  assert.equal(country.type, 'combobox');
  assert.deepEqual(country.options, []);
  assert.equal(country.option_capture.status, 'complete');
  assert.equal(country.option_capture.source, 'combobox_fast_mode');
  await page.close();
});

test('registry classifies auto-suggest inputs as search_autocomplete and bypasses popup crawling', async () => {
  const page = await browser.newPage();
  const addressHtml = `
    <main id="application-form">
      <div class="input-row">
        <label for="address-1">Address Line 1</label>
        <input id="address-1" class="cx-select-input--auto-suggest" role="combobox" placeholder="Start typing an address" aria-describedby="address-help">
        <span id="address-help">Enter your street name and other address details to see suggestions</span>
      </div>
    </main>
  `;
  await page.setContent(addressHtml);
  const result = await scanRegistryPage(page, { pageIndex: 1, settleMs: 0 });
  const address = result.fields.find((field) => field.label === 'Address Line 1');
  assert.equal(address.type, 'search_autocomplete');
  assert.deepEqual(address.options, []);
  assert.equal(address.option_capture.status, 'complete');
  assert.equal(address.option_capture.source, 'search_autocomplete');
  await page.close();
});

test('progressive gating selects default country and reveals address sub-fields', async () => {
  const page = await browser.newPage();
  const gatingHtml = `
    <main id="application-form">
      <div class="input-row">
        <label for="country">Country</label>
        <select id="country" required>
          <option value="">Select country</option>
          <option value="United States">United States</option>
          <option value="Canada">Canada</option>
        </select>
      </div>
      <div id="address-container" hidden>
        <div class="input-row">
          <label for="address-1">Address Line 1</label>
          <input id="address-1" class="cx-select-input--auto-suggest" placeholder="Start typing an address" required>
        </div>
        <div class="input-row">
          <label for="city">City</label>
          <input id="city" required>
        </div>
        <div class="input-row">
          <label for="state">State</label>
          <input id="state" required>
        </div>
        <div class="input-row">
          <label for="zip">Postal Code</label>
          <input id="zip" required>
        </div>
      </div>
    </main>
    <script>
      document.querySelector('#country').addEventListener('change', (e) => {
        document.querySelector('#address-container').hidden = !e.target.value;
      });
    </script>
  `;
  await page.setContent(gatingHtml);
  const result = await scanRegistryPage(page, { pageIndex: 1, settleMs: 0, defaultCountry: 'United States' });
  const labels = result.fields.map((f) => f.label);
  assert.equal(labels.includes('Country'), true);
  assert.equal(labels.includes('Address Line 1'), true);
  assert.equal(labels.includes('City'), true);
  assert.equal(labels.includes('State'), true);
  assert.equal(labels.includes('Postal Code'), true);
  assert.equal(result.fields.filter((f) => f.label === 'Country').length, 1);
  assert.equal(result.fields.filter((f) => f.label === 'Address Line 1').length, 1);
  await page.close();
});

test('single-choice branching probes conditional questions and leaves first valid option selected', async () => {
  const page = await browser.newPage();
  await page.setContent(dynamicHtml);
  const result = await scanRegistryPage(page, { pageIndex: 1, settleMs: 0, optionCaptureMaxRounds: 5 });
  const sponsorship = result.fields.find((field) => field.label === 'Do you need sponsorship?');
  assert.equal(sponsorship.conditional_fields.some((field) => field.label === 'Please explain sponsorship needs'), true);
  const yesChecked = await page.locator('input[name="sponsorship"][value="yes"]').isChecked();
  assert.equal(yesChecked, true);
  await page.close();
});
