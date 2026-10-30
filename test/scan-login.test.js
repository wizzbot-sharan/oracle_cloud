const test = require('node:test');
const assert = require('node:assert/strict');

const { scanLogin, recordNeedsHumanCheckpoint } = require('../src/scan-login');

const job = { job_id: 'job-1', url: 'https://tenant.oraclecloud.com/job/1', company: 'Example', title: 'Example role' };

test('scanLogin returns the exact authenticated page as application_ready', async () => {
  const page = { marker: 'same-page' };
  const result = await scanLogin({}, {
    job,
    config: {},
    evidence: {},
    mailbox: {},
    authenticate: async () => ({ status: 'authenticated', authentication_method: 'otp', page }),
  });
  assert.equal(result.status, 'application_ready');
  assert.equal(result.authentication_method, 'otp');
  assert.equal(result.page, page);
});

test('scanLogin preserves the authentication method for email-only and magic-link paths', async () => {
  const page = { marker: 'same-page' };
  for (const method of ['email_only', 'magic_link']) {
    const result = await scanLogin({}, {
      job,
      config: {},
      evidence: {},
      mailbox: {},
      authenticate: async () => ({ status: 'authenticated', authentication_method: method, page }),
    });
    assert.equal(result.authentication_method, method);
  }
});

test('scanLogin preserves controlled non-success results without starting application scan', async () => {
  const page = { marker: 'blocked-page' };
  const result = await scanLogin({}, {
    job,
    config: {},
    evidence: {},
    mailbox: {},
    authenticate: async () => ({ status: 'otp_unresolved', page }),
  });
  assert.deepEqual(result, { status: 'otp_unresolved', page });
});

test('CAPTCHA checkpoint is persisted before human resolution waits', async () => {
  const calls = [];
  const writer = {
    captureScreenshot: async (...args) => calls.push(['screenshot', args]),
    logEvent: async (...args) => calls.push(['event', args]),
    writePartialJobResult: async (...args) => calls.push(['partial', args]),
  };
  await recordNeedsHumanCheckpoint(writer, job, { user_id: 'scan-user', worker_id: 1 });
  assert.deepEqual(calls.map(([kind]) => kind), ['screenshot', 'event', 'partial']);
  assert.equal(calls[2][1][1].status, 'needs_human');
});
