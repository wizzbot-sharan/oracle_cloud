const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const { waitForOracleJetReady } = require('../../src/sites/oracle/runtime');

let browser;

test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

test('waitForOracleJetReady reports jet_unavailable without blocking a non-JET page', async () => {
  const page = await browser.newPage();
  await page.setContent('<main>Plain form</main>');

  const result = await waitForOracleJetReady(page, { timeoutMs: 50 });

  assert.deepEqual(result, { status: 'jet_unavailable', busy_states: [] });
  await page.close();
});

test('waitForOracleJetReady waits for the public page BusyContext', async () => {
  const page = await browser.newPage();
  await page.setContent(`<script>
    window.oj = { Context: { getPageContext: () => ({ getBusyContext: () => ({
      whenReady: () => Promise.resolve(true), getBusyStates: () => []
    }) }) } };
  </script>`);

  const result = await waitForOracleJetReady(page, { timeoutMs: 50 });

  assert.deepEqual(result, { status: 'ready', busy_states: [] });
  await page.close();
});

test('waitForOracleJetReady returns busy-state descriptions when JET readiness times out', async () => {
  const page = await browser.newPage();
  await page.setContent(`<script>
    window.oj = { Context: { getPageContext: () => ({ getBusyContext: () => ({
      whenReady: () => Promise.reject(new Error('timed out')),
      getBusyStates: () => [{ description: 'opening listbox' }, { description: 'loading application questions' }]
    }) }) } };
  </script>`);

  const result = await waitForOracleJetReady(page, { timeoutMs: 50 });

  assert.deepEqual(result, {
    status: 'timeout',
    busy_states: ['opening listbox', 'loading application questions'],
  });
  await page.close();
});
