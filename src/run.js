const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createEvidenceWriter, createTerminalReporter, prepareJobEvidence } = require('./evidence');
const { scanLogin } = require('./scan-login');
const { scanApplication } = require('./scan-application');
const { snapshotInboxMessageIds, pollForVerificationEmail } = require('./integrations/zoho/mailbox');
const { buildSuccessfulQaRecord, replaceSuccessfulQaEntry, replaceValidatedQaEntry } = require('./qa');

chromium.use(stealthPlugin());

function normalizeJobUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:') throw new Error('Job URL must use HTTPS');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function loadJobs(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Job URL file must contain a non-empty array');
  return parsed.map((job, index) => {
    const normalized = {
      job_id: String(job.job_id || `job-${index + 1}`),
      company: String(job.company || job.company_name || '').trim(),
      verification_company: String(job.verification_company || job.company || job.company_name || '').trim(),
      title: String(job.title || job.job_title || '').trim(),
      url: String(job.url || job.job_url || '').trim(),
    };
    if (!normalized.company || !normalized.title || !normalized.url) throw new Error(`Invalid scanner job: ${normalized.job_id}`);
    try { normalized.qa_key = normalizeJobUrl(normalized.url); } catch (_) { throw new Error(`Invalid scanner job: ${normalized.job_id}`); }
    return normalized;
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function createLaunchGate({ gapMs, jitterMs, now = Date.now, random = Math.random, sleep: wait = sleep }) {
  let lastLaunch = null;
  let queue = Promise.resolve();
  return {
    wait() {
      const ticket = queue.then(async () => {
        if (lastLaunch !== null) {
          const targetGap = gapMs + Math.floor(random() * jitterMs);
          const remaining = targetGap - (now() - lastLaunch);
          if (remaining > 0) await wait(remaining);
        }
        lastLaunch = now();
      });
      queue = ticket.catch(() => {});
      return ticket;
    },
  };
}

function summarizeRun(results) {
  return {
    total_jobs: results.length,
    completed_jobs: results.filter((item) => item.status === 'submit_visible').length,
    incomplete_jobs: results.filter((item) => item.status !== 'submit_visible').length,
    outcomes: results.map(({ job_id, company, status, error }) => ({ job_id, company, status, error: error || null })),
  };
}

function countsAsTerminalIssue(status) {
  return status !== 'submit_visible' && status !== 'job_expired' && status !== 'needs_human' && status !== 'circuit_breaker';
}

async function acquireCompanyLock(queues, company) {
  const key = String(company || 'unknown').trim().toLowerCase();
  const previous = queues.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  queues.set(key, current);
  await previous;
  return () => {
    release();
    if (queues.get(key) === current) queues.delete(key);
  };
}

async function launchBrowser(config) {
  return chromium.launch({
    headless: config.headless,
    channel: config.headless ? undefined : 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  }).catch(() => chromium.launch({ headless: config.headless, args: ['--disable-blink-features=AutomationControlled'] }));
}

async function run(config, dependencies = {}) {
  const jobs = (dependencies.loadJobs || loadJobs)(config.jobsFile);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const writer = (dependencies.createEvidenceWriter || createEvidenceWriter)({
    rootDir: config.outputRoot,
    runId,
    level: config.evidenceLevel || 'standard',
    reporter: createTerminalReporter({ level: config.logLevel || 'summary' }),
  });
  const profilePath = path.resolve('data/fixtures/dummy-profile.json');
  const profile = {
    ...JSON.parse(fs.readFileSync(profilePath, 'utf8')),
    email: config.testEmail,
    uploadPath: path.resolve('data/fixtures/dummy-resume.txt'),
  };
  const gate = createLaunchGate({ gapMs: config.launchGapMs, jitterMs: config.launchJitterMs });
  const results = [];
  let cursor = 0;
  let failureStreak = 0;
  let circuitTripped = false;
  const breakerLimit = config.circuitBreakerFailures || 2;
  const companyQueues = new Map();
  let browser = null;

  async function recordCircuitBreaker(job, workerId) {
    const meta = { user_id: config.userId, job_id: job.job_id, worker_id: workerId };
    const skipped = { ...job, user_id: config.userId, status: 'circuit_breaker', pages: [], fields: [] };
    results.push(skipped);
    await writer.logEvent({ ...meta, page: 0, step: 'pipeline', action: 'circuit_breaker', result: 'skipped' });
    await writer.writePartialJobResult(job.job_id, skipped);
  }

  async function worker(workerId) {
    while (true) {
      const index = cursor++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      if (circuitTripped) {
        await recordCircuitBreaker(job, workerId);
        continue;
      }
      await gate.wait();
      const meta = { user_id: config.userId, job_id: job.job_id, worker_id: workerId };
      const releaseCompany = await acquireCompanyLock(companyQueues, job.company);
      if (circuitTripped) {
        releaseCompany();
        await recordCircuitBreaker(job, workerId);
        continue;
      }
      let context = null;
      let result = { ...job, status: 'failed', pages: [], fields: [] };
      try {
        context = await browser.newContext({ viewport: config.headless ? { width: 1440, height: 1000 } : null, locale: 'en-US' });
        await writer.logEvent({ ...meta, page: 0, step: 'scan_login', action: 'start', result: 'started' });
        const login = await (dependencies.scanLogin || scanLogin)(context, {
          job,
          config,
          evidence: writer,
          meta,
          mailbox: dependencies.mailbox || { snapshotInboxMessageIds, pollForVerificationEmail },
          onNeedsHuman: dependencies.onNeedsHuman,
        });
        if (login.status !== 'application_ready') {
          result = { ...job, status: login.status, pages: [], fields: [] };
          await writer.writePartialJobResult(job.job_id, result);
          if (countsAsTerminalIssue(result.status)) {
            failureStreak += 1;
            if (failureStreak >= breakerLimit) circuitTripped = true;
          }
          continue;
        }
        await writer.logEvent({ ...meta, page: 0, step: 'scan_application', action: 'start', result: 'started' });
        const scan = await (dependencies.scanApplication || scanApplication)(login.page, {
          writer,
          profile,
          meta,
          maxPages: config.maxPages,
          stepRetries: config.stepRetries,
          fieldSettleMs: config.fieldSettleMs,
          optionCaptureMaxRounds: config.optionCaptureMaxRounds,
          optionCaptureStagnantRounds: config.optionCaptureStagnantRounds,
          cascadeSampleStates: config.cascadeSampleStates,
          cascadeProfile: profile.addressSamples || {},
        });
        result = { ...job, ...scan };
        if (scan.status === 'submit_visible') {
          // Validate the scan shape before copying any evidence; a malformed scan must not create a new current snapshot.
          const candidate = buildSuccessfulQaRecord({ job, scan, scanUserId: config.userId });
          const promotedEvidence = (dependencies.prepareJobEvidence || prepareJobEvidence)({
            runDir: writer.runDir,
            currentRoot: config.currentEvidenceRoot,
            runId,
            jobKey: job.qa_key,
            userId: config.userId,
            jobId: job.job_id,
            manifest: writer.manifest || [],
          });
          const committedRecord = { ...candidate, evidence: { scan_user_id: config.userId, ...promotedEvidence } };
          if (dependencies.replaceValidatedQaEntry) {
            replaceValidatedQaEntry({ file: config.qaFile, key: job.qa_key, record: committedRecord });
          } else {
            (dependencies.replaceSuccessfulQaEntry || replaceSuccessfulQaEntry)({ file: config.qaFile, job, scan, evidence: committedRecord.evidence });
          }
          await writer.writeJobResult(job.job_id, result);
          failureStreak = 0;
        } else {
          await writer.writePartialJobResult(job.job_id, result);
          if (countsAsTerminalIssue(result.status)) {
            failureStreak += 1;
            if (failureStreak >= breakerLimit) circuitTripped = true;
          }
        }
      } catch (error) {
        result = { ...job, status: 'failed', pages: result.pages || [], fields: result.fields || [], error: error.message };
        await writer.logEvent({ ...meta, page: 0, step: 'pipeline', action: 'fail', result: 'failed', detail: error.message }).catch(() => {});
        await writer.writePartialJobResult(job.job_id, result).catch(() => {});
        failureStreak += 1;
        if (failureStreak >= breakerLimit) circuitTripped = true;
      } finally {
        results.push(result);
        await context?.close().catch(() => {});
        releaseCompany();
      }
    }
  }

  let summary;
  try {
    browser = await (dependencies.launchBrowser || launchBrowser)(config);
    await Promise.all(Array.from({ length: config.concurrency }, (_, index) => worker(index + 1)));
  } finally {
    await browser?.close().catch(() => {});
    summary = summarizeRun(results);
    await writer.writeSummary(summary).catch(() => {});
  }
  return { runId, runDir: writer.runDir, summary, results };
}

module.exports = { normalizeJobUrl, loadJobs, createLaunchGate, summarizeRun, countsAsTerminalIssue, acquireCompanyLock, run };
