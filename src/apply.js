const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const { loadConfig } = require('./config');
const { createEvidenceWriter, createTerminalReporter } = require('./evidence');
const { scanLogin } = require('./scan-login');
const { fillApplicationJob } = require('./sites/oracle/filler');
const { readAnswerBank, getUserAnswers } = require('./answers');
const { snapshotInboxMessageIds, pollForVerificationEmail } = require('./integrations/zoho/mailbox');

chromium.use(stealthPlugin());

function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '').replace(':443', '');
  } catch (_) {
    return String(value || '').replace(':443', '').replace(/\/$/, '');
  }
}

function findJobInQa(qaDocument, { jobId, jobUrl } = {}) {
  const qa = typeof qaDocument === 'string' ? JSON.parse(fs.readFileSync(qaDocument, 'utf8')) : qaDocument;
  const jobs = qa?.jobs || {};

  if (jobUrl) {
    const norm = normalizeUrl(jobUrl);
    for (const [key, job] of Object.entries(jobs)) {
      if (normalizeUrl(key) === norm || normalizeUrl(job.url) === norm) {
        return { ...job, qa_key: key };
      }
    }
  }

  if (jobId) {
    for (const [key, job] of Object.entries(jobs)) {
      if (job.job_id === jobId || key.includes(jobId)) {
        return { ...job, qa_key: key };
      }
    }
  }

  // Fallback: first job in qa.json
  const firstKey = Object.keys(jobs)[0];
  if (firstKey) {
    return { ...jobs[firstKey], qa_key: firstKey };
  }

  return null;
}

function loadTrialJob(trailFile = 'data/trail_job.json') {
  if (!fs.existsSync(trailFile)) return null;
  try {
    const list = JSON.parse(fs.readFileSync(trailFile, 'utf8'));
    return Array.isArray(list) && list.length > 0 ? list[0] : null;
  } catch (_) {
    return null;
  }
}

async function runApply({
  jobId,
  jobUrl,
  userId = 'default_user',
  headless,
  keystrokeDelayMs,
  actionDelayMs,
  approvalSignal,
  onProgress,
  dependencies = {},
} = {}) {
  const config = dependencies.config || loadConfig(process.env);
  const isHeadless = headless !== undefined ? Boolean(headless) : Boolean(config.fillerHeadless);
  const kDelay = keystrokeDelayMs ?? config.fillerKeystrokeDelayMs ?? 75;
  const aDelay = actionDelayMs ?? config.fillerActionDelayMs ?? 500;

  // 1. Resolve Job from QA blueprint
  let targetUrl = jobUrl;
  if (!targetUrl && !jobId) {
    const trail = (dependencies.loadTrialJob || loadTrialJob)(config.jobsFile || 'data/trail_job.json');
    if (trail) {
      targetUrl = trail.job_url || trail.url;
    }
  }

  const qaDocPath = config.qaFile || 'data/qa.json';
  const findJobFn = dependencies.findJobInQa || findJobInQa;
  const job = findJobFn(qaDocPath, { jobId, jobUrl: targetUrl });
  if (!job) {
    throw new Error(`Target job not found in QA blueprint (jobId: ${jobId}, url: ${targetUrl})`);
  }

  // 2. Resolve User Answers
  const readBankFn = dependencies.readAnswerBank || readAnswerBank;
  const getUserAnswersFn = dependencies.getUserAnswers || getUserAnswers;
  const bank = readBankFn(config.answersFile || 'data/answers.json');
  const userRecord = getUserAnswersFn(bank, userId);

  // 3. Prepare Evidence Run Directory
  const runId = `apply-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outputDir = path.join(config.outputRoot || 'artifacts/runs', runId);
  fs.mkdirSync(path.join(outputDir, 'screenshots'), { recursive: true });

  const writer = (dependencies.createEvidenceWriter || createEvidenceWriter)({
    rootDir: config.outputRoot || 'artifacts/runs',
    runId,
    level: config.evidenceLevel || 'standard',
    reporter: createTerminalReporter({ level: config.logLevel || 'summary' }),
  });

  const meta = { user_id: userId, job_id: job.job_id, worker_id: 1, run_id: runId };

  // 4. Launch Browser
  const browserLauncher = dependencies.chromium || chromium;
  const browser = await browserLauncher.launch({
    headless: isHeadless,
    channel: isHeadless ? undefined : 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  }).catch(() => browserLauncher.launch({
    headless: isHeadless,
    args: ['--disable-blink-features=AutomationControlled'],
  }));

  try {
    const context = await browser.newContext({
      viewport: isHeadless ? { width: 1440, height: 1000 } : null,
      locale: 'en-US',
    });

    onProgress?.({
      step: 'init',
      status: 'starting',
      jobId: job.job_id,
      company: job.company,
      title: job.title,
      message: `Starting live application for ${job.company} - ${job.title}...`,
    });

    // 5. Authenticate via candidate flow
    onProgress?.({ step: 'login', status: 'authenticating', message: `Entering application portal with ${config.testEmail}...` });
    const loginFn = dependencies.scanLogin || scanLogin;
    const loginResult = await loginFn(context, {
      job: {
        job_id: job.job_id,
        company: job.company,
        verification_company: job.company,
        title: job.title,
        url: job.url,
      },
      config,
      evidence: writer,
      meta,
      mailbox: dependencies.mailbox || { snapshotInboxMessageIds, pollForVerificationEmail },
      onNeedsHuman: dependencies.onNeedsHuman,
    });

    if (loginResult.status !== 'application_ready') {
      onProgress?.({ step: 'login', status: 'failed', error: loginResult.status });
      await browser.close().catch(() => {});
      return {
        status: loginResult.status,
        runId,
        error: `Authentication failed: ${loginResult.status}`,
      };
    }

    onProgress?.({ step: 'login', status: 'success', message: 'Application flow loaded successfully.' });

    // 6. Fill Application Fields
    onProgress?.({ step: 'fill', status: 'filling', message: 'Filling application fields at human speed...' });
    const fillerFn = dependencies.fillApplicationJob || fillApplicationJob;
    const fillResult = await fillerFn(loginResult.page, {
      job,
      userRecord,
      keystrokeDelayMs: kDelay,
      actionDelayMs: aDelay,
      maxPages: config.maxPages || 20,
      outputDir,
      onProgress: (evt) => {
        onProgress?.(evt);
      },
      onReviewReady: (reviewData) => {
        onProgress?.({
          step: 'review_ready',
          status: 'filled_awaiting_approval',
          ...reviewData,
          message: 'All fields filled. Oracle Submit button is visible. Halting before Submit.',
        });
      },
      approvalSignal,
    });

    if (fillResult.status === 'filled_awaiting_approval') {
      onProgress?.({
        step: 'halted_at_review',
        status: 'filled_awaiting_approval',
        reviewScreenshot: fillResult.reviewScreenshot,
        message: 'Review screenshot captured. Application ready for review; submit button was NOT clicked.',
      });
    } else if (fillResult.status === 'submitted') {
      onProgress?.({
        step: 'submitted',
        status: 'submitted',
        confirmationScreenshot: fillResult.confirmationScreenshot,
        message: 'Application approved and submitted successfully.',
      });
    }

    return {
      ...fillResult,
      runId,
      outputDir,
      page: loginResult.page,
      browser,
    };
  } catch (error) {
    onProgress?.({ step: 'error', status: 'failed', error: error.message });
    await browser.close().catch(() => {});
    throw error;
  }
}

module.exports = {
  normalizeUrl,
  findJobInQa,
  loadTrialJob,
  runApply,
};
