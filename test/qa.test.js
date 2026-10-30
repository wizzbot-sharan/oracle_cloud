const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readQa, normalizeQaRecord, validateQaRecord, replaceSuccessfulQaEntry } = require('../src/qa');

function tempQaPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-qa-')), 'qa.json');
}

function completedScan(overrides = {}) {
  return {
    status: 'submit_visible',
    detector_version: 'registry-v1',
    pages: [{ page_index: 1, section_names: ['Contact'], field_count: 1 }],
    scan_user_id: 'scan-user',
    fields: [{ canonical_id: 'contact-first-name', field_id: 'contact-first-name', page_index: 1, section: 'Contact', label: 'First Name', type: 'text', coverage_status: 'captured', screenshot: 'screenshots/page.png', options: [] }],
    evidence: { directory: 'job-1/run-1', screenshots: ['screenshots/page.png'], run_id: 'run-1' },
    ...overrides,
  };
}

const job = { job_id: 'job-1', qa_key: 'https://tenant.oraclecloud.com/hcmUI/CandidateExperience/en/job/1', url: 'https://tenant.oraclecloud.com/hcmUI/CandidateExperience/en/job/1', company: 'Example', title: 'Example role' };

test('initializes missing QA files and writes a completed job by URL', () => {
  const file = tempQaPath();
  assert.deepEqual(readQa(file).jobs, {});
  const qa = replaceSuccessfulQaEntry({ file, job, scan: completedScan(), scannedAt: '2026-10-30T00:00:00.000Z', evidence: completedScan().evidence });
  assert.equal(qa.jobs[job.qa_key].questions[0].label, 'First Name');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).jobs[job.qa_key].job_id, 'job-1');
});

test('preserves unrelated jobs and replaces only the matching URL', () => {
  const file = tempQaPath();
  const other = { ...job, job_id: 'job-2', qa_key: 'https://tenant.oraclecloud.com/hcmUI/CandidateExperience/en/job/2', url: 'https://tenant.oraclecloud.com/hcmUI/CandidateExperience/en/job/2' };
  replaceSuccessfulQaEntry({ file, job, scan: completedScan(), scannedAt: '2026-10-30T00:00:00.000Z', evidence: completedScan().evidence });
  replaceSuccessfulQaEntry({ file, job: other, scan: completedScan(), scannedAt: '2026-10-30T00:01:00.000Z', evidence: completedScan().evidence });
  replaceSuccessfulQaEntry({ file, job, scan: completedScan({ fields: [{ canonical_id: 'contact-last-name', field_id: 'contact-last-name', page_index: 1, section: 'Contact', label: 'Last Name', type: 'text', coverage_status: 'captured', screenshot: 'screenshots/page.png', options: [] }] }), scannedAt: '2026-10-30T00:02:00.000Z', evidence: completedScan().evidence });
  const qa = readQa(file);
  assert.equal(qa.jobs[job.qa_key].questions[0].label, 'Last Name');
  assert.equal(qa.jobs[other.qa_key].questions[0].label, 'First Name');
});

test('refuses incomplete scans and duplicate canonical questions without changing a previous success', () => {
  const file = tempQaPath();
  replaceSuccessfulQaEntry({ file, job, scan: completedScan(), scannedAt: '2026-10-30T00:00:00.000Z', evidence: completedScan().evidence });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => replaceSuccessfulQaEntry({ file, job, scan: completedScan({ status: 'navigation_blocked' }), scannedAt: '2026-10-30T00:01:00.000Z', evidence: completedScan().evidence }), /submit_visible/);
  assert.throws(() => replaceSuccessfulQaEntry({ file, job, scan: completedScan({ fields: [completedScan().fields[0], completedScan().fields[0]] }), scannedAt: '2026-10-30T00:01:00.000Z', evidence: completedScan().evidence }), /duplicate canonical_id/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('rejects malformed existing QA without overwriting it', () => {
  const file = tempQaPath();
  fs.writeFileSync(file, '{not valid json');
  assert.throws(() => replaceSuccessfulQaEntry({ file, job, scan: completedScan(), scannedAt: '2026-10-30T00:00:00.000Z', evidence: completedScan().evidence }), /Invalid QA JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{not valid json');
});

test('validateQaRecord rejects an empty or evidence-less completed scan', () => {
  const record = {
    job_id: 'job-1', url: job.url, company: job.company, title: job.title,
    scanned_at: '2026-10-30T00:00:00.000Z', detector_version: 'registry-v1',
    scan_user_id: 'scan-user', pages: [], questions: [],
    evidence: { directory: 'job-1/run-1', screenshots: [] },
  };
  assert.throws(() => validateQaRecord(record), /pages|questions/i);
  record.pages = [{ page_index: 1, section_names: ['Contact'], field_count: 1 }];
  record.questions = [{ canonical_id: 'name', page_index: 1, section: 'Contact', label: 'Name', type: 'text', coverage_status: 'captured', screenshot: 'screenshots/page.png' }];
  assert.throws(() => validateQaRecord(record), /evidence/i);
});

test('validateQaRecord accepts a complete record with immutable evidence', () => {
  const record = {
    job_id: 'job-1', url: job.url, company: job.company, title: job.title,
    scanned_at: '2026-10-30T00:00:00.000Z', detector_version: 'registry-v1',
    scan_user_id: 'scan-user', pages: [{ page_index: 1, section_names: ['Contact'], field_count: 1 }],
    questions: [{ canonical_id: 'name', page_index: 1, section: 'Contact', label: 'Name', type: 'text', coverage_status: 'captured', screenshot: 'screenshots/page.png' }],
    evidence: { directory: 'job-1/run-1', screenshots: ['screenshots/page.png'], run_id: 'run-1' },
  };
  assert.doesNotThrow(() => validateQaRecord(record));
});

test('validateQaRecord rejects question screenshots not present in the evidence manifest', () => {
  const record = {
    job_id: 'job-1', url: job.url, company: job.company, title: job.title,
    scanned_at: '2026-10-30T00:00:00.000Z', detector_version: 'registry-v1', scan_user_id: 'scan-user',
    pages: [{ page_index: 1, section_names: ['Contact'], field_count: 1 }],
    questions: [{ canonical_id: 'name', page_index: 1, section: 'Contact', label: 'Name', type: 'text', coverage_status: 'captured', screenshot: 'screenshots/missing.png' }],
    evidence: { directory: 'job-1/run-1', screenshots: ['screenshots/page.png'], run_id: 'run-1' },
  };
  assert.throws(() => validateQaRecord(record), /screenshot.*manifest/i);
});

test('validateQaRecord rejects a question with incomplete coverage', () => {
  const record = {
    job_id: 'job-1', url: job.url, company: job.company, title: job.title,
    scanned_at: '2026-10-30T00:00:00.000Z', detector_version: 'registry-v1', scan_user_id: 'scan-user',
    pages: [{ page_index: 1, section_names: ['Contact'], field_count: 1 }],
    questions: [{ canonical_id: 'name', page_index: 1, section: 'Contact', label: 'Name', type: 'text', coverage_status: 'incomplete', screenshot: 'screenshots/page.png' }],
    evidence: { directory: 'job-1/run-1', screenshots: ['screenshots/page.png'], run_id: 'run-1' },
  };
  assert.throws(() => validateQaRecord(record), /incomplete coverage/i);
});

test('rename failure preserves the old QA file and removes the temporary file', () => {
  const file = tempQaPath();
  replaceSuccessfulQaEntry({ file, job, scan: completedScan(), scannedAt: '2026-10-30T00:00:00.000Z', evidence: completedScan().evidence });
  const before = fs.readFileSync(file, 'utf8');
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('rename failed'); };
  try {
    assert.throws(() => replaceSuccessfulQaEntry({ file, job, scan: completedScan(), scannedAt: '2026-10-30T00:01:00.000Z', evidence: completedScan().evidence }), /rename failed/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp')), []);
});

test('temporary write failure preserves the old QA file and removes the temporary file when created', () => {
  const file = tempQaPath();
  replaceSuccessfulQaEntry({ file, job, scan: completedScan(), scannedAt: '2026-10-30T00:00:00.000Z', evidence: completedScan().evidence });
  const before = fs.readFileSync(file, 'utf8');
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = (target, ...args) => {
    if (String(target).endsWith('.tmp')) throw new Error('temporary write failed');
    return originalWrite(target, ...args);
  };
  try {
    assert.throws(() => replaceSuccessfulQaEntry({ file, job, scan: completedScan(), scannedAt: '2026-10-30T00:01:00.000Z', evidence: completedScan().evidence }), /temporary write failed/);
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp')), []);
});
