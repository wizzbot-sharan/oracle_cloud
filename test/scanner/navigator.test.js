const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const { EvidenceWriter: ArtifactWriter } = require('../../src/evidence');
const {
  detectDisplayedSteps,
  enterManualApplication,
  scanApplication,
} = require('../../src/scan-application');

let browser;
const profile = {
  firstName: 'Test',
  lastName: 'Candidate',
  fullName: 'Test Candidate',
  email: 'scanner@example.test',
  phone: '2025550100',
  genericText: 'Synthetic scanner value',
  date: '2000-01-01',
};

test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

test('enterManualApplication clicks manually and confirms the form', async () => {
  const page = await browser.newPage();
  await page.setContent(`
    <h1 hidden>Let's make this quick</h1>
    <h1>Let's make this quick</h1>
    <span hidden role="link">manually</span>
    <span id="manual" role="link">manually</span>
    <main id="application-form" hidden><section><h2>Contact</h2><label>Name<input required></label><button type="submit">Submit</button></section></main>
    <script>document.querySelector('#manual').onclick=()=>{document.querySelectorAll('h1')[1].hidden=true;document.querySelector('#manual').hidden=true;document.querySelector('main').hidden=false;}</script>
  `);

  assert.equal(await enterManualApplication(page), true);
  assert.equal(await page.locator('#application-form').isVisible(), true);
  await page.close();
});

test('enterManualApplication recognizes the Oracle resume gate from its quick-profile control', async () => {
  const page = await browser.newPage();
  await page.setContent(`
    <input id="quickProfileImport" type="file" hidden>
    <span id="manual" role="link">manually</span>
    <main id="application-form" hidden><label>Name<input></label><button type="submit">Submit</button></main>
    <script>document.querySelector('#manual').onclick=()=>{document.querySelector('#quickProfileImport').hidden=true;document.querySelector('#manual').hidden=true;document.querySelector('#application-form').hidden=false;}</script>
  `);
  assert.equal(await enterManualApplication(page), true);
  assert.equal(await page.locator('#application-form').isVisible(), true);
  await page.close();
});

test('scanApplication traverses pages, records fields, and never clicks Submit', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navigator-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'run-nav' });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.setContent(fs.readFileSync(path.join(__dirname, '../fixtures/oracle-multipage.html'), 'utf8'));

  assert.deepEqual(await detectDisplayedSteps(page), [1, 2]);
  const result = await scanApplication(page, {
    writer,
    profile,
    meta: { user_id: 'scan_trial', job_id: 'fixture-job', worker_id: 1 },
    maxPages: 5,
    stepRetries: 2,
  });

  assert.equal(result.status, 'submit_visible');
  assert.equal(result.pages.length, 2);
  assert.deepEqual(result.pages.map((entry) => entry.section_names), [['Contact Information'], ['Application Questions']]);
  assert.equal(await page.evaluate(() => window.submitClicks), 0);
  assert.equal(result.fields.some((field) => field.label === 'First Name'), true);
  assert.equal(result.fields.some((field) => field.label === 'Are you available?'), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'run-nav', 'screenshot-manifest.json'), 'utf8'));
  assert.equal(manifest.some((entry) => entry.step === 'submit_visible'), true);
  assert.equal(manifest.some((entry) => entry.field_id), false);
  assert.equal(result.fields.every((field) => field.screenshot), true);
  await page.close();
});

test('scanApplication stops on a repeated page instead of looping', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navigator-loop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'run-loop' });
  const page = await browser.newPage();
  await page.setContent('<main id="application-form"><section><h2>Questions</h2><button type="button">Next</button></section></main>');

  const result = await scanApplication(page, {
    writer,
    profile,
    meta: { user_id: 'scan_trial', job_id: 'loop-job', worker_id: 1 },
    maxPages: 5,
    stepRetries: 1,
  });

  assert.equal(result.status, 'navigation_blocked');
  assert.equal(result.pages.length, 1);
  await page.close();
});

test('scanApplication distinguishes pages with the same heading by their visible fields', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navigator-same-heading-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'run-same-heading' });
  const page = await browser.newPage();
  await page.setContent(`
    <main id="application-form">
      <section id="one"><h2>Questions</h2><label>First answer<input required></label><button id="next">Next</button></section>
      <section id="two" hidden><h2>Questions</h2><label>Second answer<input required></label><button type="submit">Submit</button></section>
    </main>
    <script>next.onclick=()=>{one.hidden=true;two.hidden=false;}</script>
  `);
  const result = await scanApplication(page, {
    writer,
    profile,
    meta: { user_id: 'scan_trial', job_id: 'same-heading', worker_id: 1 },
    maxPages: 5,
    stepRetries: 1,
  });
  assert.equal(result.status, 'submit_visible');
  assert.equal(result.pages.length, 2);
  await page.close();
});

test('scanApplication records JET readiness evidence and still never clicks Submit', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navigator-jet-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'run-jet' });
  const page = await browser.newPage();
  await page.setContent(`
    <script>window.oj = { Context: { getPageContext: () => ({ getBusyContext: () => ({ whenReady: () => Promise.resolve(true), getBusyStates: () => [] }) }) } };</script>
    <main id="application-form"><section><h2>Questions</h2><label>Answer<input required></label><button type="submit" onclick="window.submitClicks=(window.submitClicks||0)+1">Submit</button></section></main>
  `);

  const result = await scanApplication(page, {
    writer,
    profile,
    meta: { user_id: 'scan_trial', job_id: 'jet-job', worker_id: 1 },
    maxPages: 2,
    stepRetries: 1,
  });

  const events = fs.readFileSync(path.join(root, 'run-jet', 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(result.status, 'submit_visible');
  assert.equal(events.some((event) => event.action === 'wait_for_jet' && event.result === 'ready'), true);
  assert.equal(await page.evaluate(() => window.submitClicks || 0), 0);
  await page.close();
});

test('scanApplication preserves a partial field result when capture fails mid-page', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navigator-partial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'run-partial' });
  const originalCapture = writer.captureScreenshot.bind(writer);
  let captures = 0;
  writer.captureScreenshot = async (...args) => {
    captures += 1;
    if (captures === 2) throw new Error('Target page, context or browser has been closed');
    return originalCapture(...args);
  };
  const page = await browser.newPage();
  await page.setContent('<main id="application-form"><section><h2>Questions</h2><label>Name<input id="name"></label><button type="submit">Submit</button></section></main>');

  await assert.rejects(() => scanApplication(page, {
    writer, profile, meta: { user_id: 'scan_trial', job_id: 'partial-job', worker_id: 1 }, maxPages: 1, stepRetries: 1, fieldSettleMs: 0,
  }), /Target page/);

  const partial = JSON.parse(fs.readFileSync(path.join(root, 'run-partial', 'jobs', 'partial-job', 'fields.partial.json'), 'utf8'));
  assert.equal(partial.status, 'scanning');
  assert.equal(partial.fields.some((field) => field.label === 'Name'), true);
  await page.close();
});
