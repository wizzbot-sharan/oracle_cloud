const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const { EvidenceWriter: ArtifactWriter } = require('../../src/evidence');
const { completeAuthenticationPage, waitForApplicationReady, waitForHumanChallenge } = require('../../src/scan-login');

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

test('completeAuthenticationPage uses OTP and reaches the application without leaking secrets', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'auth-run' });
  const page = await browser.newPage();
  await page.setContent(`
    <main id="auth">
      <label for="primary-email-0">Email Address</label><input id="primary-email-0" name="primary-email" type="email">
      <label><input id="legal" type="checkbox"> I agree with the terms and conditions</label>
      <div role="dialog" id="terms" hidden><button id="agree">Agree</button></div>
      <button id="next">Next</button>
    </main>
    <main id="loader" class="apply-flow" hidden>Loading identity check...</main>
    <h1 id="otp-heading" hidden>Confirm Your Identity</h1>
    <div id="otp" hidden>
      ${Array.from({ length: 6 }, (_, i) => `<input aria-label="Enter verification code digit ${i + 1} of six.">`).join('')}
      <button id="verify">Verify</button>
    </div>
    <main id="application-form" hidden><section><h2>Contact</h2><label>Name<input required></label><button type="submit">Submit</button></section></main>
    <script>
      legal.addEventListener('click', e => { e.preventDefault(); terms.hidden = false; });
      agree.addEventListener('click', () => { terms.hidden = true; legal.checked = true; });
      next.addEventListener('click', () => { if (legal.checked && document.querySelector('#primary-email-0').value) { auth.hidden = true; loader.hidden = false; setTimeout(() => { loader.hidden = true; document.querySelector('#otp-heading').hidden = false; otp.hidden = false; }, 6000); } });
      verify.addEventListener('click', () => {
        const code = Array.from(otp.querySelectorAll('input')).map(input => input.value).join('');
        if (code === '123456') { setTimeout(() => { otp.hidden = true; }, 1000); setTimeout(() => { document.querySelector('#otp-heading').hidden = true; document.querySelector('#application-form').hidden = false; }, 2000); }
      });
    </script>
  `);

  let polls = 0;
  const result = await completeAuthenticationPage(page, {
    job: { job_id: 'fixture-auth', company: 'Fixture Co', url: 'https://fixture.invalid/job/1' },
    config: { testEmail: 'scanner@example.test', typingDelayMs: 0, authSettleMs: 0, postNextSettleMs: 0, postVerifySettleMs: 2200 },
    writer,
    meta: { user_id: 'scan_trial', job_id: 'fixture-auth', worker_id: 1 },
    snapshotInbox: async () => new Set(),
    pollVerification: async () => { polls++; return { type: 'OTP', code: '123456', messageId: 'fixture-message' }; },
  });

  assert.equal(result.status, 'authenticated');
  assert.equal(await page.locator('#application-form').isVisible(), true);
  assert.equal(await page.locator('#otp').isHidden(), true);
  assert.equal(polls, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'auth-run', 'screenshot-manifest.json'), 'utf8'));
  assert.equal(manifest.some((entry) => entry.step === 'application_ready'), true);
  const events = fs.readFileSync(path.join(root, 'auth-run', 'events.jsonl'), 'utf8');
  assert.equal(events.includes('scanner@example.test'), false);
  assert.equal(events.includes('123456'), false);
  await page.close();
});

test('waitForHumanChallenge pauses only until the challenge disappears', async () => {
  const page = await browser.newPage();
  await page.setContent('<div id="challenge" aria-label="Verification challenge">Challenge</div>');
  let called = 0;

  const result = await waitForHumanChallenge(page, {
    pollMs: 10,
    onNeedsHuman: async () => {
      called++;
      await page.locator('#challenge').evaluate((element) => { element.hidden = true; });
    },
  });

  assert.equal(result, 'resolved');
  assert.equal(called, 1);
  await page.close();
});

test('waitForApplicationReady recognizes Oracle plain Submit buttons without activating them', async () => {
  const page = await browser.newPage();
  await page.setContent('<main id="application-form"><h2>Job application form</h2><label>Email<input type="email"></label><label>Name<input></label><button id="submit">Submit</button></main>');
  let submitted = false;
  await page.locator('#submit').evaluate((button) => button.addEventListener('click', () => { submitted = true; }));

  assert.equal(await waitForApplicationReady(page, { timeoutMs: 100 }), true);
  assert.equal(submitted, false);
  await page.close();
});

test('completeAuthenticationPage does not mistake a blocked authentication form for an application', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-blocked-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'auth-blocked' });
  const page = await browser.newPage();
  await page.setContent('<main><label>Email Address<input name="primary-email" type="email"></label><button>Next</button></main>');
  const result = await completeAuthenticationPage(page, {
    job: { job_id: 'blocked', company: 'Fixture', url: 'https://fixture.invalid/job/2' },
    config: { testEmail: 'scanner@example.test', typingDelayMs: 0 },
    writer,
    meta: { user_id: 'scan_trial', job_id: 'blocked', worker_id: 1 },
    snapshotInbox: async () => new Set(),
    pollVerification: async () => null,
  });
  assert.equal(result.status, 'authentication_incomplete');
  await page.close();
});

test('completeAuthenticationPage uses the visible primary email control when Oracle renders a hidden duplicate', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-visible-email-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'auth-visible-email' });
  const page = await browser.newPage();
  await page.setContent(`
    <main id="auth"><input name="primary-email" hidden><label>Email<input id="visible-email" name="primary-email"></label><button id="next">Next</button></main>
    <main id="application-form" hidden><h2>Questions</h2><button type="submit">Submit</button></main>
    <script>document.querySelector('#next').onclick=()=>{if(document.querySelector('#visible-email').value){document.querySelector('#auth').hidden=true;document.querySelector('#application-form').hidden=false;}}</script>
  `);
  const result = await completeAuthenticationPage(page, {
    job: { job_id: 'visible-email', company: 'Fixture', url: 'https://fixture.invalid/job/visible-email' },
    config: { testEmail: 'scanner@example.test', typingDelayMs: 0, authSettleMs: 0, postNextSettleMs: 0 },
    writer,
    meta: { user_id: 'scan_trial', job_id: 'visible-email', worker_id: 1 },
    snapshotInbox: async () => new Set(),
    pollVerification: async () => null,
  });
  assert.equal(result.status, 'authenticated');
  assert.equal(await page.locator('#visible-email').inputValue(), 'scanner@example.test');
  await page.close();
});

test('completeAuthenticationPage follows a mailbox magic link after job-page redirect', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-magic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'auth-magic' });
  const page = await browser.newPage();
  await page.setContent(`
    <main id="auth"><label>Email Address<input name="primary-email" type="email"></label><button id="next">Next</button></main>
    <div id="job" hidden><button>Apply Now</button></div>
    <script>next.onclick=()=>{auth.hidden=true;job.hidden=false;}</script>
  `);
  let polls = 0;
  const magicHtml = encodeURIComponent('<main id="application-form"><section><h2>Questions</h2><button type="submit">Submit</button></section></main>');
  const result = await completeAuthenticationPage(page, {
    job: { job_id: 'magic', company: 'Fixture', url: 'https://fixture.invalid/job/3' },
    config: { testEmail: 'scanner@example.test', typingDelayMs: 0 },
    writer,
    meta: { user_id: 'scan_trial', job_id: 'magic', worker_id: 1 },
    snapshotInbox: async () => new Set(),
    pollVerification: async () => { polls++; return { type: 'MAGIC_LINK', url: `data:text/html,${magicHtml}` }; },
  });
  assert.equal(result.status, 'authenticated');
  assert.equal(result.authentication_method, 'magic_link');
  assert.equal(polls, 1);
  assert.equal(await page.locator('#application-form').isVisible(), true);
  await page.close();
});

test('completeAuthenticationPage accepts a generic Oracle form after the email control disappears', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-generic-form-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'auth-generic-form' });
  const page = await browser.newPage();
  await page.setContent(`
    <main id="auth"><label>Email Address<input name="primary-email" type="email"></label><button id="next">Next</button></main>
    <main id="loader" class="apply-flow" hidden>Loading application...</main>
    <main id="generic-form" hidden><h2>Contact Information</h2><label>First Name<input required></label><button>Next</button></main>
    <script>document.querySelector('#next').onclick=()=>{document.querySelector('#auth').hidden=true;document.querySelector('#loader').hidden=false;setTimeout(()=>{document.querySelector('#loader').hidden=true;document.querySelector('#generic-form').hidden=false;},1500);}</script>
  `);
  const result = await completeAuthenticationPage(page, {
    job: { job_id: 'generic', company: 'Fixture', url: 'https://fixture.invalid/job/4' },
    config: { testEmail: 'scanner@example.test', typingDelayMs: 0 },
    writer,
    meta: { user_id: 'scan_trial', job_id: 'generic', worker_id: 1 },
    snapshotInbox: async () => new Set(),
    pollVerification: async () => null,
  });
  assert.equal(result.status, 'authenticated');
  assert.equal(await page.locator('#generic-form').isVisible(), true);
  await page.close();
});

test('completeAuthenticationPage chooses the visible Oracle consent control when the native input is hidden', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-custom-consent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writer = new ArtifactWriter({ rootDir: root, runId: 'auth-custom-consent' });
  const page = await browser.newPage();
  await page.setContent(`
    <main id="auth">
      <label>Email Address<input name="primary-email" type="email"></label>
      <input id="legal-disclaimer-checkbox" type="checkbox" hidden>
      <span class="apply-flow-input-checkbox__button" role="checkbox">I agree with the terms</span>
      <div role="dialog" hidden><button id="agree">Agree</button></div>
      <button id="next">Next</button>
    </main>
    <main id="generic-form" hidden><h2>Questions</h2><label>Name<input required></label><button type="submit">Submit</button></main>
    <script>
      const checkboxButton = document.querySelector('.apply-flow-input-checkbox__button');
      const dialog = document.querySelector('[role=dialog]');
      checkboxButton.onclick=()=>{dialog.hidden=false;};
      agree.onclick=()=>{dialog.hidden=true;document.querySelector('#legal-disclaimer-checkbox').checked=true;};
      next.onclick=()=>{if(document.querySelector('#legal-disclaimer-checkbox').checked){auth.hidden=true;document.querySelector('#generic-form').hidden=false;}};
    </script>
  `);
  const result = await completeAuthenticationPage(page, {
    job: { job_id: 'custom-consent', company: 'Fixture', url: 'https://fixture.invalid/job/5' },
    config: { testEmail: 'scanner@example.test', typingDelayMs: 0 },
    writer,
    meta: { user_id: 'scan_trial', job_id: 'custom-consent', worker_id: 1 },
    snapshotInbox: async () => new Set(),
    pollVerification: async () => null,
  });
  assert.equal(result.status, 'authenticated');
  assert.equal(await page.locator('#legal-disclaimer-checkbox').isChecked(), true);
  await page.close();
});
