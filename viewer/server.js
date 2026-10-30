const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');

const qaFile = path.resolve(process.env.SCANNER_QA_FILE || path.join(__dirname, '..', 'data/qa.json'));
const evidenceRoot = path.resolve(process.env.SCANNER_CURRENT_EVIDENCE_ROOT || path.join(__dirname, '..', 'artifacts/current-qa-evidence'));
const viewerFile = path.join(__dirname, 'index.html');
const port = Number.parseInt(process.env.SCANNER_VIEWER_PORT || '4173', 10);

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
    status: 'submit_visible',
    pages: (record.pages || []).length,
    fields: (record.questions || []).length,
  }));
  return { qa_file: file, jobs };
}

function loadJob({ qaFile: file = qaFile, key, jobId } = {}) {
  const qa = readQa(file);
  const record = key ? qa.jobs?.[key] : Object.values(qa.jobs || {}).find((item) => item.job_id === jobId);
  if (!record) return null;
  return { ...record, run_id: record.evidence?.directory || 'current', fields: record.questions || [], screenshots: [] };
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

function createServer({ qaFile: file = qaFile, evidenceRoot: root = evidenceRoot } = {}) {
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    if (requestUrl.pathname === '/') {
      return send(res, 200, fs.readFileSync(viewerFile), 'text/html; charset=utf-8');
    }
    if (requestUrl.pathname === '/api/index') {
      return send(res, 200, JSON.stringify(indexData({ qaFile: file })));
    }
    if (requestUrl.pathname === '/api/job') {
      const result = loadJob({ qaFile: file, key: requestUrl.searchParams.get('key'), jobId: requestUrl.searchParams.get('job') });
      return result ? send(res, 200, JSON.stringify(result)) : send(res, 404, JSON.stringify({ error: 'QA job not found' }));
    }
    if (requestUrl.pathname.startsWith('/artifacts/')) return serveArtifact(res, requestUrl.pathname, requestUrl.searchParams, root, file);
    return send(res, 404, 'Not found', 'text/plain');
  });
}

if (require.main === module) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SCANNER_VIEWER_PORT must be a valid port');
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`Question scan viewer: http://127.0.0.1:${port}`);
    console.log(`Reading QA from: ${qaFile}`);
  });
}

module.exports = { createServer, indexData, loadJob, readQa, isEvidenceDirectoryAllowed, artifactAllowedForJob, serveArtifact };
