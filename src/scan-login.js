const selectors = require('./sites/oracle/selectors');

async function isVisible(locator, timeout = 0) {
  return locator.first().isVisible({ timeout }).catch(() => false);
}

async function anyVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index++) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function firstVisibleLocator(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index++) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function applicationReadyNow(page) {
  const authStillVisible = await anyVisible(page.locator(selectors.emailInput));
  const manualVisible = await page.getByText(selectors.manualGateHeading).first().isVisible().catch(() => false);
  const submitVisible = await anyVisible(page.locator(selectors.submitButton));
  const nextVisible = await anyVisible(page.locator(selectors.nextButton));
  const applicationControlVisible = await anyVisible(page.locator([
    'input:not([type="hidden"]):not([type="email"])',
    'textarea',
    'select',
    '[role="combobox"]',
  ].join(', ')));
  return !authStillVisible && (manualVisible || submitVisible || (nextVisible && applicationControlVisible));
}

async function waitForPostAuthState(page, { timeoutMs = 30000, authFailureMs = 1500 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const authStillVisible = await anyVisible(page.locator(selectors.emailInput));
    if (await anyVisible(page.locator(selectors.captcha))) return 'captcha';
    if (await anyVisible(page.locator(selectors.otpInputs))) return 'otp';
    if (await applicationReadyNow(page)) return 'application';
    if (!authStillVisible && await anyVisible(page.locator(selectors.applyButton))) return 'magic_link';
    if (authStillVisible && Date.now() - startedAt >= authFailureMs) return 'blocked';
    await page.waitForTimeout(100);
  }
  return 'timeout';
}

async function waitForApplicationReady(page, options = {}) {
  return (await waitForPostAuthState(page, options)) === 'application';
}

async function dismissCookies(page) {
  const reject = page.locator(selectors.cookieReject).first();
  if (await isVisible(reject, 1000)) {
    await reject.click();
    return 'rejected';
  }
  const accept = page.locator(selectors.cookieAccept).first();
  if (await isVisible(accept, 500)) {
    await accept.click();
    return 'accepted';
  }
  return 'not_present';
}

async function waitForHumanChallenge(page, { onNeedsHuman, pollMs = 1000 }) {
  const challenge = page.locator(selectors.captcha).first();
  if (!await isVisible(challenge)) return 'not_present';
  await onNeedsHuman?.();
  while (await isVisible(challenge)) {
    await page.waitForTimeout(pollMs);
  }
  return 'resolved';
}

async function settleAfterAction(page, writer, meta, action, delayMs) {
  if (delayMs > 0) await page.waitForTimeout(delayMs);
  await writer.logEvent({ ...meta, page: 0, step: 'authentication', action, result: 'settled', detail: { delay_ms: delayMs } });
}

async function recordNeedsHumanCheckpoint(writer, job, meta, page = null) {
  const entry = { ...meta, page: 0, step: 'captcha_needs_human' };
  await writer.captureScreenshot(page, entry, { fullPage: true, kind: 'error' });
  await writer.logEvent({ ...meta, page: 0, step: 'captcha', action: 'pause', result: 'needs_human' });
  await writer.writePartialJobResult(job.job_id, { ...job, ...meta, status: 'needs_human', pages: [], fields: [] });
}

async function completeAuthenticationPage(page, {
  job,
  config,
  writer,
  meta,
  snapshotInbox,
  pollVerification,
  onNeedsHuman,
}) {
  const authSettleMs = config.authSettleMs ?? 2000;
  const postNextSettleMs = config.postNextSettleMs ?? 3500;
  const postVerifySettleMs = config.postVerifySettleMs ?? 10000;
  await dismissCookies(page);
  const emailSwitch = page.locator(selectors.emailSwitch).first();
  if (await isVisible(emailSwitch, 1000)) {
    await emailSwitch.click();
    await settleAfterAction(page, writer, meta, 'settle_after_email_switch', authSettleMs);
  }

  await page.locator(selectors.emailInput).first().waitFor({ state: 'attached', timeout: 20000 });
  const email = await firstVisibleLocator(page.locator(selectors.emailInput));
  if (!email) throw new Error('No visible Oracle authentication email control found');
  await email.fill('');
  await email.click();
  await page.keyboard.type(config.testEmail, { delay: config.typingDelayMs });
  if (await email.inputValue().catch(() => '') !== config.testEmail) {
    await email.fill(config.testEmail);
  }
  await writer.logEvent({ ...meta, page: 0, step: 'authentication', action: 'enter_email', result: 'filled', email: config.testEmail });
  await email.press('Tab').catch(() => {});
  await email.dispatchEvent('change').catch(() => {});
  await email.dispatchEvent('blur').catch(() => {});
  const emailState = await email.evaluate((element) => ({
    value_length: String(element.value || '').length,
    valid: element.checkValidity(),
    id: element.id || null,
    name: element.getAttribute('name') || null,
    type: element.getAttribute('type') || null,
    disabled: Boolean(element.disabled),
    read_only: Boolean(element.readOnly),
  }));
  emailState.candidates = await page.locator('input[name="primary-email"]').evaluateAll((inputs) => inputs.map((element) => ({
    id: element.id || null,
    value_length: String(element.value || '').length,
    visible: element.getClientRects().length > 0,
    disabled: Boolean(element.disabled),
    read_only: Boolean(element.readOnly),
  })));
  await writer.logEvent({ ...meta, page: 0, step: 'authentication', action: 'confirm_email_entry', result: emailState.valid ? 'valid' : 'invalid', detail: emailState });
  await settleAfterAction(page, writer, meta, 'settle_after_email', authSettleMs);

  const consent = await firstVisibleLocator(page.locator(selectors.consentCheckbox));
  if (consent) {
    await consent.click();
    await settleAfterAction(page, writer, meta, 'settle_after_consent', authSettleMs);
    const confirm = await firstVisibleLocator(page.locator(selectors.consentConfirm));
    if (confirm) {
      await confirm.click();
      await settleAfterAction(page, writer, meta, 'settle_after_consent_confirm', authSettleMs);
    }
  }

  const knownMessageIds = await snapshotInbox(config.testEmail);
  const requestedAt = Date.now();
  const next = page.locator(selectors.nextButton).first();
  await next.waitFor({ state: 'visible', timeout: 10000 });
  await next.click();
  await settleAfterAction(page, writer, meta, 'settle_after_next', postNextSettleMs);

  const secondaryConfirm = await firstVisibleLocator(page.locator(selectors.consentConfirm));
  if (secondaryConfirm) {
    await secondaryConfirm.click();
    await settleAfterAction(page, writer, meta, 'settle_after_secondary_confirm', authSettleMs);
    if (await isVisible(next, 1000)) await next.click();
    await settleAfterAction(page, writer, meta, 'settle_after_secondary_next', postNextSettleMs);
  }

  let state = await waitForPostAuthState(page);
  let authenticationMethod = state === 'application' ? 'email_only' : null;
  for (let verificationRound = 0; verificationRound < 3 && state !== 'application'; verificationRound++) {
    if (state === 'captcha') {
      await recordNeedsHumanCheckpoint(writer, job, meta, page);
      await waitForHumanChallenge(page, {
        onNeedsHuman: onNeedsHuman || (async () => {}),
        pollMs: 1000,
      });
      state = await waitForPostAuthState(page);
      continue;
    }

    if (state !== 'otp' && state !== 'magic_link') break;
    const step = state === 'otp' ? 'otp' : 'magic_link';
    await writer.logEvent({ ...meta, page: 0, step, action: 'poll_mailbox', result: 'started' });
    const verification = await pollVerification({
      email: config.testEmail,
      jobUrl: job.url,
      company: job.verification_company || job.company,
      jobTitle: job.title,
      minReceivedTime: requestedAt,
      knownMessageIds,
      maxWaitSec: state === 'otp' ? 180 : 60,
      intervalSec: 10,
      onParseDiagnostic: async ({ diagnostic }) => {
        await writer.logEvent({
          ...meta,
          page: 0,
          step,
          action: 'parse_diagnostic',
          result: 'unresolved',
          detail: diagnostic,
        });
      },
    });
    if (!verification) return { status: `${step}_unresolved`, page };
    if (verification.messageId) knownMessageIds.add(verification.messageId);

    if (verification.type === 'MAGIC_LINK') {
      authenticationMethod = 'magic_link';
      await page.goto(verification.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await writer.logEvent({ ...meta, page: 0, step, action: 'navigate', result: 'completed' });
    } else if (verification.type === 'OTP') {
      authenticationMethod = 'otp';
      const otpInputs = page.locator(selectors.otpInputs);
      const visibleOtpInputs = [];
      for (let index = 0; index < await otpInputs.count(); index++) {
        if (await otpInputs.nth(index).isVisible().catch(() => false)) visibleOtpInputs.push(otpInputs.nth(index));
      }
      if (visibleOtpInputs.length >= 6) {
        for (let index = 0; index < 6; index++) await visibleOtpInputs[index].fill(verification.code[index]);
      } else if (visibleOtpInputs.length === 1) {
        await visibleOtpInputs[0].fill(verification.code);
      } else {
        return { status: 'otp_unresolved', page };
      }
      const verify = await firstVisibleLocator(page.locator(selectors.verifyButton));
      if (verify) await verify.click();
      await writer.logEvent({ ...meta, page: 0, step, action: 'verify', result: 'completed' });
      await settleAfterAction(page, writer, meta, 'settle_after_verify', postVerifySettleMs);
      state = await waitForPostAuthState(page, { timeoutMs: 10000 });
      if (state === 'otp') {
        await writer.logEvent({ ...meta, page: 0, step, action: 'confirm_transition', result: 'otp_still_visible' });
        return { status: 'otp_transition_unconfirmed', page };
      }
      continue;
    } else {
      return { status: `${step}_unresolved`, page };
    }
    state = await waitForPostAuthState(page);
  }

  if (state !== 'application') {
    const visibleMarkers = await page.evaluate(() => ({
      headings: Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
        .filter((item) => item.getClientRects().length > 0)
        .map((item) => String(item.textContent || '').replace(/\s+/g, ' ').trim()),
      buttons: Array.from(document.querySelectorAll('button'))
        .filter((item) => item.getClientRects().length > 0)
        .map((item) => String(item.textContent || item.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()),
    }));
    await writer.captureScreenshot(page, { ...meta, page: 0, step: 'authentication_incomplete' }, { fullPage: true, kind: 'incomplete' });
    await writer.logEvent({ ...meta, page: 0, step: 'authentication', action: 'confirm_application', result: 'incomplete', detail: visibleMarkers });
    return { status: 'authentication_incomplete', page };
  }
  await writer.captureScreenshot(page, { ...meta, page: 0, step: 'application_ready' }, { fullPage: true, kind: 'application_ready' });
  await writer.logEvent({ ...meta, page: 0, step: 'authentication', action: 'confirm_application', result: 'authenticated' });
  return { status: 'authenticated', authentication_method: authenticationMethod || 'email_only', page };
}

async function authenticateJob(context, { job, config, writer, meta, snapshotInbox, pollVerification, onNeedsHuman }) {
  let page = await context.newPage();
  await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissCookies(page);

  const expired = page.getByText(/job is no longer available|job is no longer open/i).first();
  if (await isVisible(expired, 1500)) return { status: 'job_expired', page };

  const apply = page.locator(selectors.applyButton).first();
  await apply.waitFor({ state: 'visible', timeout: 15000 });
  const existing = context.pages();
  const pageEvent = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await apply.click();
  const opened = await pageEvent;
  page = opened || context.pages().find((candidate) => !existing.includes(candidate)) || page;
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return completeAuthenticationPage(page, { job, config, writer, meta, snapshotInbox, pollVerification, onNeedsHuman });
}

async function scanLogin(context, { job, config, evidence, mailbox, onNeedsHuman, authenticate = authenticateJob, meta = { user_id: config.userId, job_id: job.job_id, worker_id: 1 } }) {
  const result = await authenticate(context, {
    job,
    config,
    writer: evidence,
    meta,
    snapshotInbox: mailbox.snapshotInboxMessageIds,
    pollVerification: mailbox.pollForVerificationEmail,
    onNeedsHuman,
  });
  return result.status === 'authenticated'
    ? { status: 'application_ready', authentication_method: result.authentication_method || 'email_only', page: result.page }
    : result;
}

module.exports = {
  authenticateJob,
  completeAuthenticationPage,
  dismissCookies,
  waitForHumanChallenge,
  waitForApplicationReady,
  waitForPostAuthState,
  recordNeedsHumanCheckpoint,
  scanLogin,
};
