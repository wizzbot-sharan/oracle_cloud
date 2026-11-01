const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');

const {
  readAnswerBank,
  saveAnswerBank,
  getUserAnswers,
  saveUserAnswer,
  saveUserRepeater,
  resolveJobQuestions,
} = require('../src/answers');
const { runApply } = require('../src/apply');

const qaFile = path.resolve(process.env.SCANNER_QA_FILE || path.join(__dirname, '..', 'data/qa.json'));
const answersFile = path.resolve(process.env.ANSWERS_FILE || path.join(__dirname, '..', 'data/answers.json'));
const evidenceRoot = path.resolve(process.env.SCANNER_CURRENT_EVIDENCE_ROOT || path.join(__dirname, '..', 'artifacts/current-qa-evidence'));
const viewerFile = path.join(__dirname, 'index.html');
const port = Number.parseInt(process.env.SCANNER_VIEWER_PORT || '4173', 10);

const applicationRuns = new Map();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readQa(file = qaFile) {
  if (!fs.existsSync(file)) return { schema_version: 'qa-v1', jobs: {} };
  return readJson(file);
}

function indexData({ qaFile: file = qaFile } = {}) {
  const qa = readQa(file);
  const jobs = Object.entries(qa.jobs || {}).map(([key, record]) => ({
    run_id: 'current',
    qa_key: key,
    job_id: record.job_id,
    company: record.company,
    title: record.title,
    status: record.status || 'submit_visible',
    pages: (record.pages || []).length,
    fields: (record.questions || []).length,
  }));
  return { qa_file: file, jobs };
}

function loadJob({ qaFile: file = qaFile, answersFile: ansFile = answersFile, key, jobId, userId = 'default_user' } = {}) {
  const qa = readQa(file);
  const record = key ? qa.jobs?.[key] : Object.values(qa.jobs || {}).find((item) => item.job_id === jobId);
  if (!record) return null;

  const bank = readAnswerBank(ansFile);
  const userRecord = getUserAnswers(bank, userId);
  const resolvedFields = resolveJobQuestions(record.questions || [], userRecord);

  // Merge pre-existing question values if saved
  const fields = resolvedFields.map((q) => {
    const existing = (record.questions || []).find((old) => old.canonical_id === q.canonical_id || old.field_id === q.field_id);
    if (existing && existing.value !== null && existing.value !== undefined) {
      return { ...q, value: existing.value, auto_resolved: true, match_source: 'saved_qa' };
    }
    return q;
  });

  return { ...record, run_id: record.evidence?.directory || 'current', fields, screenshots: [] };
}

function isEvidenceDirectoryAllowed(file, directory) {
  if (!directory || directory.includes('..') || directory.startsWith('/') || directory.includes('\\')) return false;
  const qa = readQa(file);
  return Object.values(qa.jobs || {}).some((record) => record.evidence?.directory === directory);
}

function artifactAllowedForJob({ qaFile: file = qaFile, key, jobId, directory, filePath }) {
  const record = loadJob({ qaFile: file, key, jobId });
  if (!record?.evidence?.directory || record.evidence.directory !== directory) return false;
  const screenshots = new Set(record.evidence.screenshots || []);
  return screenshots.has(filePath);
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function serveArtifact(res, requestPath, query, root = evidenceRoot, qaDocument = qaFile) {
  const relative = requestPath.replace(/^\/artifacts\//, '').split('/').map(decodeURIComponent);
  if (relative.length < 3 || relative.some((part) => part === '..' || part === '')) return send(res, 400, 'Bad artifact path', 'text/plain');
  const directory = relative.slice(0, 2).join('/');
  const filePath = relative.slice(2).join('/');
  if (!artifactAllowedForJob({ qaFile: qaDocument, key: query.get('key'), jobId: query.get('job'), directory, filePath })) return send(res, 404, 'Not found', 'text/plain');
  const artifactFile = path.resolve(root, ...relative);
  if (!artifactFile.startsWith(`${root}${path.sep}`) || !fs.existsSync(artifactFile)) return send(res, 404, 'Not found', 'text/plain');
  const extension = path.extname(artifactFile).toLowerCase();
  const type = extension === '.png' ? 'image/png' : extension === '.json' ? 'application/json' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(artifactFile).pipe(res);
}

function createServer({ qaFile: file = qaFile, answersFile: ansFile = answersFile, evidenceRoot: root = evidenceRoot } = {}) {
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname.startsWith('/artifacts/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
      return serveArtifact(res, requestUrl.pathname, requestUrl.searchParams, root, file);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (requestUrl.pathname === '/') {
        return send(res, 200, fs.readFileSync(viewerFile), 'text/html; charset=utf-8');
      }
      if (requestUrl.pathname === '/api/index') {
        return send(res, 200, JSON.stringify(indexData({ qaFile: file })));
      }
      if (requestUrl.pathname === '/api/job') {
        const result = loadJob({ qaFile: file, answersFile: ansFile, key: requestUrl.searchParams.get('key'), jobId: requestUrl.searchParams.get('job'), userId: requestUrl.searchParams.get('userId') || 'default_user' });
        return result ? send(res, 200, JSON.stringify(result)) : send(res, 404, JSON.stringify({ error: 'QA job not found' }));
      }
      if (requestUrl.pathname === '/api/answers') {
        const bank = readAnswerBank(ansFile);
        const user = getUserAnswers(bank, requestUrl.searchParams.get('userId') || 'default_user');
        return send(res, 200, JSON.stringify(user));
      }
      if (requestUrl.pathname === '/api/job/apply-status') {
        const jobId = requestUrl.searchParams.get('jobId');
        const state = applicationRuns.get(jobId) || { status: 'idle' };
        return send(res, 200, JSON.stringify(state));
      }
      return send(res, 404, 'Not found', 'text/plain');
    }

    if (req.method === 'POST') {
      try {
        const body = await readBody(req);

        if (requestUrl.pathname === '/api/job/answers') {
          const { key, jobId, userId = 'default_user', answers = {}, repeaters = {} } = body;
          const bank = readAnswerBank(ansFile);

          // 1. Update User Answer Bank
          for (const [fieldId, val] of Object.entries(answers)) {
            if (val && typeof val === 'object' && val.question) {
              saveUserAnswer(bank, userId, {
                questionFieldId: fieldId,
                question: val.question,
                fieldType: val.fieldType,
                value: val.value,
              });
            } else {
              saveUserAnswer(bank, userId, {
                questionFieldId: fieldId,
                question: fieldId,
                value: val,
              });
            }
          }
          for (const [repType, records] of Object.entries(repeaters)) {
            saveUserRepeater(bank, userId, repType, records);
          }
          saveAnswerBank(ansFile, bank);

          // 2. Update current Job in QA file
          const qa = readQa(file);
          const jobRecord = key ? qa.jobs?.[key] : Object.values(qa.jobs || {}).find((item) => item.job_id === jobId);
          if (jobRecord && Array.isArray(jobRecord.questions)) {
            for (const q of jobRecord.questions) {
              const matchedVal = answers[q.canonical_id] ?? answers[q.field_id] ?? answers[q.label];
              if (matchedVal !== undefined) {
                q.value = typeof matchedVal === 'object' && matchedVal !== null && 'value' in matchedVal ? matchedVal.value : matchedVal;
              }
            }
            fs.writeFileSync(file, `${JSON.stringify(qa, null, 2)}\n`, 'utf8');
          }

          return send(res, 200, JSON.stringify({ ok: true, saved_count: Object.keys(answers).length }));
        }

        if (requestUrl.pathname === '/api/job/apply') {
          const { jobId = 'job-1', key, userId = 'default_user' } = body;
          const currentRun = applicationRuns.get(jobId);
          if (currentRun && (currentRun.status === 'starting' || currentRun.status === 'filling' || currentRun.status === 'authenticating')) {
            return send(res, 200, JSON.stringify({ ok: true, status: currentRun.status, message: 'Application is already running' }));
          }

          let approvalResolver;
          const approvalSignal = new Promise((resolve) => { approvalResolver = resolve; });

          applicationRuns.set(jobId, {
            status: 'starting',
            jobId,
            message: 'Launching browser and initiating application...',
            approvalResolver,
          });

          // Run apply in background
          Promise.resolve().then(async () => {
            try {
              await runApply({
                jobId,
                jobUrl: key,
                userId,
                approvalSignal,
                onProgress: (evt) => {
                  const run = applicationRuns.get(jobId) || { jobId };
                  if (evt.status) run.status = evt.status;
                  if (evt.message) run.message = evt.message;
                  if (evt.reviewScreenshot) run.reviewScreenshot = evt.reviewScreenshot;
                  if (evt.confirmationScreenshot) run.confirmationScreenshot = evt.confirmationScreenshot;
                  if (evt.page) run.currentPage = evt.page;
                  applicationRuns.set(jobId, run);
                },
              });
            } catch (err) {
              const run = applicationRuns.get(jobId) || { jobId };
              run.status = 'failed';
              run.error = err.message;
              applicationRuns.set(jobId, run);
            }
          });

          return send(res, 200, JSON.stringify({ ok: true, status: 'starting' }));
        }

        if (requestUrl.pathname === '/api/job/approve-submit') {
          const { jobId = 'job-1' } = body;
          const run = applicationRuns.get(jobId);
          if (!run || run.status !== 'filled_awaiting_approval') {
            return send(res, 400, JSON.stringify({ error: 'Application is not awaiting approval' }));
          }
          if (run.approvalResolver) {
            run.approvalResolver({ status: 'approved' });
          }
          run.status = 'submitted';
          run.confirmationScreenshot = run.confirmationScreenshot || 'screenshots/submitted-confirmation.png';
          run.message = 'Application successfully submitted.';
          return send(res, 200, JSON.stringify({ ok: true, status: 'submitted' }));
        }

        return send(res, 404, 'Not found', 'text/plain');
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }));
      }
    }

    return send(res, 405, 'Method not allowed', 'text/plain');
  });
}

if (require.main === module) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SCANNER_VIEWER_PORT must be a valid port');
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`Question scan viewer: http://127.0.0.1:${port}`);
    console.log(`Reading QA from: ${qaFile}`);
    console.log(`Reading Answers from: ${answersFile}`);
  });
}

module.exports = {
  indexData,
  loadJob,
  isEvidenceDirectoryAllowed,
  createServer,
};
