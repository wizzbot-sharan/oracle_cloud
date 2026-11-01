const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUrl, findJobInQa, runApply } = require('../src/apply');

test('normalizeUrl standardizes ports, trailing slashes, and query params', () => {
  assert.equal(
    normalizeUrl('https://example.com:443/hcmUI/job/123/?utm_source=feed'),
    'https://example.com/hcmUI/job/123'
  );
  assert.equal(
    normalizeUrl('https://example.com/apply/'),
    'https://example.com/apply'
  );
});

test('findJobInQa locates jobs by URL, normalized URL, or job_id', () => {
  const qaDocument = {
    jobs: {
      'https://example.com/hcmUI/job/101': {
        job_id: 'job-101',
        title: 'Software Engineer',
        company: 'Acme',
        url: 'https://example.com:443/hcmUI/job/101/',
      },
    },
  };

  const byUrl = findJobInQa(qaDocument, { jobUrl: 'https://example.com:443/hcmUI/job/101' });
  assert.equal(byUrl.job_id, 'job-101');

  const byId = findJobInQa(qaDocument, { jobId: 'job-101' });
  assert.equal(byId.title, 'Software Engineer');

  const fallback = findJobInQa(qaDocument, {});
  assert.equal(fallback.job_id, 'job-101');
});

test('runApply orchestrates login and filler, halting before submit', async () => {
  const progressEvents = [];

  const mockBrowser = {
    newContext: async () => ({
      pages: () => [],
      waitForEvent: async () => null,
    }),
    close: async () => {},
  };

  const mockPage = {
    screenshot: async () => {},
    close: async () => {},
  };

  const mockScanLogin = async () => ({
    status: 'application_ready',
    page: mockPage,
  });

  const mockFillApplicationJob = async (page, opts) => {
    opts.onProgress?.({ step: 'page_fill', page: 1, action: 'start' });
    opts.onReviewReady?.({ reviewScreenshot: '/tmp/final-review.png', page: 1 });
    return {
      status: 'filled_awaiting_approval',
      page: 1,
      reviewScreenshot: '/tmp/final-review.png',
    };
  };

  const mockQa = {
    jobs: {
      'https://example.com/job/1': {
        job_id: 'test-job',
        title: 'Tester',
        company: 'TestCorp',
        url: 'https://example.com/job/1',
        questions: [],
      },
    },
  };

  const mockBank = {
    users: {
      default_user: {
        profile: { first_name: 'Test' },
        answers: [],
        repeaters: {},
      },
    },
  };

  const result = await runApply({
    jobId: 'test-job',
    userId: 'default_user',
    headless: true,
    onProgress: (evt) => progressEvents.push(evt.step),
    dependencies: {
      config: {
        answersFile: '/mock/answers.json',
        qaFile: '/mock/qa.json',
        outputRoot: '/tmp',
        fillerHeadless: true,
        testEmail: 'test@example.com',
      },
      findJobInQa: () => mockQa.jobs['https://example.com/job/1'],
      readAnswerBank: () => mockBank,
      getUserAnswers: (b, id) => b.users[id],
      createEvidenceWriter: () => ({ logEvent: async () => {} }),
      chromium: { launch: async () => mockBrowser },
      scanLogin: mockScanLogin,
      fillApplicationJob: mockFillApplicationJob,
    },
  });

  assert.equal(result.status, 'filled_awaiting_approval');
  assert.equal(result.reviewScreenshot, '/tmp/final-review.png');
  assert.ok(progressEvents.includes('init'));
  assert.ok(progressEvents.includes('login'));
  assert.ok(progressEvents.includes('fill'));
  assert.ok(progressEvents.includes('review_ready'));
  assert.ok(progressEvents.includes('halted_at_review'));
});

test('runApply handles login failure and exits cleanly without running filler', async () => {
  let fillerCalled = false;
  let browserClosed = false;

  const mockBrowser = {
    newContext: async () => ({}),
    close: async () => { browserClosed = true; },
  };

  const mockQa = {
    jobs: {
      'https://example.com/job/1': { job_id: 'test-job', title: 'T', company: 'C', url: 'https://example.com' },
    },
  };

  const result = await runApply({
    jobId: 'test-job',
    headless: true,
    dependencies: {
      config: { outputRoot: '/tmp', testEmail: 't@example.com' },
      findJobInQa: () => mockQa.jobs['https://example.com/job/1'],
      readAnswerBank: () => ({ users: { default_user: {} } }),
      getUserAnswers: () => ({}),
      createEvidenceWriter: () => ({ logEvent: async () => {} }),
      chromium: { launch: async () => mockBrowser },
      scanLogin: async () => ({ status: 'captcha_blocked' }),
      fillApplicationJob: async () => { fillerCalled = true; },
    },
  });

  assert.equal(result.status, 'captcha_blocked');
  assert.equal(fillerCalled, false, 'Filler should not be called when login fails');
  assert.equal(browserClosed, true, 'Browser must be closed on login failure');
});
