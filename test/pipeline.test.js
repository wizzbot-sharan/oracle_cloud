const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { normalizeJobUrl, loadJobs, createLaunchGate } = require('../src/run');

test('loads the active job list and defaults to one worker', () => {
  const config = loadConfig({ TEST_EMAIL: 'scanner@example.test' });
  const jobs = loadJobs(path.resolve('data/job-urls.json'));
  assert.equal(config.concurrency, 1);
  assert.equal(jobs.length, 6);
  assert.equal(jobs[0].verification_company, 'Albertsons');
});

test('rejects invalid job URLs and normalizes non-identity URL decoration', () => {
  assert.throws(() => loadJobs(path.resolve('test/fixtures/invalid-job-urls.json')), /Invalid scanner job/);
  assert.equal(
    normalizeJobUrl('https://eofd.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/job/785103/?utm_medium=jobshare#details'),
    'https://eofd.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/job/785103',
  );
  assert.notEqual(
    normalizeJobUrl('https://eofd.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/job/785103'),
    normalizeJobUrl('https://eofd.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/job/785104'),
  );
});

test('launch gate preserves configured spacing plus jitter', async () => {
  let now = 1000;
  const waits = [];
  const gate = createLaunchGate({
    gapMs: 15000,
    jitterMs: 5000,
    now: () => now,
    random: () => 0.5,
    sleep: async (ms) => { waits.push(ms); now += ms; },
  });
  await gate.wait();
  await gate.wait();
  assert.deepEqual(waits, [17500]);
});

test('accepts only standard or verbose evidence levels', () => {
  assert.equal(loadConfig({ TEST_EMAIL: 'scanner@example.test' }).evidenceLevel, 'standard');
  assert.equal(loadConfig({ TEST_EMAIL: 'scanner@example.test', SCANNER_EVIDENCE_LEVEL: 'verbose' }).evidenceLevel, 'verbose');
  assert.throws(() => loadConfig({ TEST_EMAIL: 'scanner@example.test', SCANNER_EVIDENCE_LEVEL: 'every-action' }), /SCANNER_EVIDENCE_LEVEL/);
});

test('defaults the circuit breaker to two terminal failures and accepts an override', () => {
  assert.equal(loadConfig({ TEST_EMAIL: 'scan@example.test' }).circuitBreakerFailures, 2);
  assert.equal(loadConfig({ TEST_EMAIL: 'scan@example.test', SCANNER_CIRCUIT_BREAKER_FAILURES: '3' }).circuitBreakerFailures, 3);
});
