const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { shouldCaptureEvidence, createEvidenceWriter, maskSensitive, prepareJobEvidence } = require('../src/evidence');

test('standard evidence skips ordinary fields but keeps pages and failures', () => {
  assert.equal(shouldCaptureEvidence('standard', 'field'), false);
  assert.equal(shouldCaptureEvidence('standard', 'page_after_fill'), false);
  assert.equal(shouldCaptureEvidence('standard', 'page'), true);
  assert.equal(shouldCaptureEvidence('standard', 'error'), true);
  assert.equal(shouldCaptureEvidence('standard', 'incomplete'), true);
  assert.equal(shouldCaptureEvidence('verbose', 'field'), true);
});

test('evidence writer returns one reusable page reference and does not create skipped files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-evidence-'));
  const writer = createEvidenceWriter({ rootDir: root, runId: 'run-1', level: 'standard' });
  const page = { locator: () => ({}), screenshot: async ({ path: file }) => fs.writeFileSync(file, 'image') };
  const entry = { user_id: 'user-1', job_id: 'job-1', worker_id: 1, page: 1, step: 'page_scan', action: 'screenshot', result: 'saved' };
  const pageShot = await writer.capture(page, entry, { kind: 'page', fullPage: true });
  const fieldShot = await writer.capture(page, { ...entry, field_id: 'first-name' }, { kind: 'field' });
  assert.match(pageShot.file, /^screenshots\//);
  assert.equal(fieldShot, null);
  assert.equal(fs.readdirSync(path.join(root, 'run-1', 'screenshots')).length, 1);
});

test('masks verification data in nested evidence values', () => {
  const safe = maskSensitive({ email: 'scanner@example.test', verification_code: '123456', detail: 'OTP: 123456' });
  assert.equal(safe.email, 's***r@example.test');
  assert.equal(safe.verification_code, '******');
  assert.doesNotMatch(safe.detail, /123456/);
});

test('masks magic-link URLs and tokens embedded in error diagnostics', () => {
  const safe = maskSensitive({ detail: 'Navigation failed at https://oracle.example.test/verify?token=super-secret-token' });
  assert.doesNotMatch(safe.detail, /oracle\.example|token=|super-secret/i);
  assert.match(safe.detail, /redacted-url/);
});

test('prepares only the requested job screenshots in an immutable evidence directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-evidence-promote-'));
  const runDir = path.join(root, 'run');
  fs.mkdirSync(path.join(runDir, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'screenshots', 'job-1-page.png'), 'job-one');
  fs.writeFileSync(path.join(runDir, 'screenshots', 'job-2-page.png'), 'job-two');
  const evidence = prepareJobEvidence({
    runDir,
    currentRoot: path.join(root, 'current'),
    runId: 'run-1',
    jobKey: 'https://tenant.oraclecloud.com/job/1',
    userId: 'user-1',
    jobId: 'job-1',
    manifest: [
      { user_id: 'user-1', job_id: 'job-1', file: 'screenshots/job-1-page.png' },
      { user_id: 'user-1', job_id: 'job-2', file: 'screenshots/job-2-page.png' },
    ],
  });
  assert.equal(fs.readFileSync(path.join(root, 'current', evidence.directory, 'screenshots', 'job-1-page.png'), 'utf8'), 'job-one');
  assert.equal(fs.existsSync(path.join(root, 'current', evidence.directory, 'screenshots', 'job-2-page.png')), false);
  assert.equal(evidence.run_id, 'run-1');
});

test('refuses to overwrite an existing immutable evidence directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-evidence-collision-'));
  const runDir = path.join(root, 'run');
  fs.mkdirSync(path.join(runDir, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'screenshots', 'page.png'), 'new');
  const currentRoot = path.join(root, 'current');
  const jobKey = 'https://tenant.oraclecloud.com/job/1';
  const crypto = require('node:crypto');
  const hash = crypto.createHash('sha256').update(jobKey).digest('hex').slice(0, 16);
  const existing = path.join(currentRoot, hash, 'run-1', 'screenshots');
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, 'page.png'), 'old');
  assert.throws(() => prepareJobEvidence({ runDir, currentRoot, runId: 'run-1', jobKey, userId: 'user-1', jobId: 'job-1', manifest: [{ user_id: 'user-1', job_id: 'job-1', file: 'screenshots/page.png' }] }), /already exists/i);
  assert.equal(fs.readFileSync(path.join(existing, 'page.png'), 'utf8'), 'old');
});
