const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const { createEvidenceWriter } = require('../src/evidence');
const { scanApplication } = require('../src/scan-application');

test('scanApplication uses shared page evidence in standard mode and never clicks Submit', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'application-scan-'));
  await page.setContent(fs.readFileSync(path.join(__dirname, 'fixtures/oracle-multipage.html'), 'utf8'));
  const evidence = createEvidenceWriter({ rootDir: root, runId: 'run-1', level: 'standard' });
  const result = await scanApplication(page, {
    writer: evidence,
    profile: { firstName: 'Test', lastName: 'Candidate', fullName: 'Test Candidate', email: 'scanner@example.test', phone: '2025550100', genericText: 'Synthetic', date: '2000-01-01', uploadPath: path.join(__dirname, '../data/fixtures/dummy-resume.txt') },
    meta: { user_id: 'user-1', job_id: 'job-1', worker_id: 1 },
    maxPages: 5,
    stepRetries: 2,
    fieldSettleMs: 0,
  });
  assert.equal(result.status, 'submit_visible');
  assert.equal(await page.evaluate(() => window.submitClicks), 0);
  assert.equal(result.fields.every((field) => field.screenshot), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'run-1', 'screenshot-manifest.json'), 'utf8'));
  assert.equal(manifest.some((entry) => entry.field_id), false);
  assert.equal(manifest.filter((entry) => entry.kind === 'page').length, 2);
  await browser.close();
});
