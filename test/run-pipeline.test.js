const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../src/run');

function configWithOneJob() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-run-'));
  const jobsFile = path.join(root, 'jobs.json');
  fs.writeFileSync(jobsFile, JSON.stringify([{ job_id: 'job-1', company: 'Example', title: 'Example role', url: 'https://tenant.oraclecloud.com/hcmUI/CandidateExperience/en/job/1' }]));
  return { root, jobsFile, qaFile: path.join(root, 'qa.json'), outputRoot: path.join(root, 'runs'), currentEvidenceRoot: path.join(root, 'current'), concurrency: 1, launchGapMs: 0, launchJitterMs: 0, headless: true, userId: 'user-1', logLevel: 'summary' };
}

function evidence() {
  return { logEvent: async () => {}, writeSummary: async () => {}, writeJobResult: async () => {}, writePartialJobResult: async () => {}, runDir: '/tmp/run' };
}

test('run passes the exact login page into application scanning and commits only complete scans', async () => {
  const config = configWithOneJob();
  const page = { id: 'same-page' };
  let closed = false;
  let applicationPage;
  const writes = [];
  const browser = { newContext: async () => ({ close: async () => { closed = true; } }), close: async () => {} };
  const result = await run(config, {
    launchBrowser: async () => browser,
    createEvidenceWriter: () => evidence(),
    scanLogin: async () => ({ status: 'application_ready', page }),
    scanApplication: async (receivedPage) => { applicationPage = receivedPage; return { status: 'submit_visible', pages: [{ page_index: 1, section_names: ['Contact'], field_count: 1 }], fields: [{ canonical_id: 'name', page_index: 1, section: 'Contact', label: 'Name', type: 'text', coverage_status: 'captured', screenshot: 'screenshots/page.png' }], detector_version: 'registry-v1' }; },
    prepareJobEvidence: () => { writes.push({ type: 'evidence' }); return { directory: 'job-1/run-1', run_id: 'run-1', screenshots: ['screenshots/page.png'] }; },
    replaceSuccessfulQaEntry: (args) => writes.push(args),
  });
  assert.equal(applicationPage, page);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].type, 'evidence');
  assert.equal(closed, true);
  assert.equal(result.summary.completed_jobs, 1);
});

test('run preserves QA when login does not reach application_ready', async () => {
  const config = configWithOneJob();
  let applicationScanCalls = 0;
  let qaWrites = 0;
  const browser = { newContext: async () => ({ close: async () => {} }), close: async () => {} };
  await run(config, {
    launchBrowser: async () => browser,
    createEvidenceWriter: () => evidence(),
    scanLogin: async () => ({ status: 'otp_unresolved', page: {} }),
    scanApplication: async () => { applicationScanCalls++; },
    replaceSuccessfulQaEntry: () => { qaWrites++; },
  });
  assert.equal(applicationScanCalls, 0);
  assert.equal(qaWrites, 0);
});

test('run preserves an existing QA record when immutable evidence preparation fails', async () => {
  const config = configWithOneJob();
  const existing = '{"schema_version":"qa-v1","updated_at":null,"jobs":{"old":{"job_id":"old"}}}\n';
  fs.writeFileSync(config.qaFile, existing);
  const browser = { newContext: async () => ({ close: async () => {} }), close: async () => {} };
  const page = { id: 'same-page' };
  await run(config, {
    launchBrowser: async () => browser,
    createEvidenceWriter: () => evidence(),
    scanLogin: async () => ({ status: 'application_ready', page }),
    scanApplication: async () => ({ status: 'submit_visible', pages: [{ page_index: 1 }], fields: [{ canonical_id: 'name', page_index: 1, section: 'Contact', type: 'text', coverage_status: 'captured', screenshot: 'screenshots/page.png' }] }),
    prepareJobEvidence: () => { throw new Error('evidence staging failed'); },
  });
  assert.equal(fs.readFileSync(config.qaFile, 'utf8'), existing);
});

test('run stops a user queue after two consecutive terminal issues', async () => {
  const config = { ...configWithOneJob(), circuitBreakerFailures: 2 };
  let loginCalls = 0;
  const jobs = [1, 2, 3].map((id) => ({ job_id: `job-${id}`, company: 'Example', title: `Role ${id}`, url: `https://tenant.oraclecloud.com/job/${id}`, qa_key: `https://tenant.oraclecloud.com/job/${id}` }));
  const browser = { newContext: async () => ({ close: async () => {} }), close: async () => {} };
  const result = await run(config, {
    loadJobs: () => jobs,
    launchBrowser: async () => browser,
    createEvidenceWriter: () => evidence(),
    scanLogin: async () => { loginCalls++; return { status: 'otp_unresolved', page: {} }; },
  });
  assert.equal(loginCalls, 2);
  assert.equal(result.summary.incomplete_jobs, 3);
  assert.equal(result.results[2].status, 'circuit_breaker');
});

test('run closes the browser when context setup fails', async () => {
  const config = configWithOneJob();
  let browserClosed = false;
  const browser = { newContext: async () => { throw new Error('context setup failed'); }, close: async () => { browserClosed = true; } };
  const result = await run(config, {
    launchBrowser: async () => browser,
    createEvidenceWriter: () => evidence(),
  });
  assert.equal(browserClosed, true);
  assert.equal(result.summary.incomplete_jobs, 1);
});

test('run serializes jobs for the same company even with multiple workers', async () => {
  const config = { ...configWithOneJob(), concurrency: 2, circuitBreakerFailures: 5 };
  const jobs = [1, 2].map((id) => ({ job_id: `job-${id}`, company: 'Same Company', title: `Role ${id}`, url: `https://tenant.oraclecloud.com/job/${id}`, qa_key: `https://tenant.oraclecloud.com/job/${id}` }));
  const browser = { newContext: async () => ({ close: async () => {} }), close: async () => {} };
  let active = 0;
  let maximum = 0;
  await run(config, {
    loadJobs: () => jobs,
    launchBrowser: async () => browser,
    createEvidenceWriter: () => evidence(),
    scanLogin: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { status: 'otp_unresolved', page: {} };
    },
  });
  assert.equal(maximum, 1);
});
