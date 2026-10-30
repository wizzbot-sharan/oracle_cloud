const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'qa-v1';

function emptyQa() {
  return { schema_version: SCHEMA_VERSION, updated_at: null, jobs: {} };
}

function readQa(file) {
  if (!fs.existsSync(file)) return emptyQa();
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { throw new Error('Invalid QA JSON'); }
  if (!parsed || parsed.schema_version !== SCHEMA_VERSION || !parsed.jobs || typeof parsed.jobs !== 'object' || Array.isArray(parsed.jobs)) throw new Error('Invalid QA document');
  return parsed;
}

function buildSuccessfulQaRecord({ job, scan, scannedAt = new Date().toISOString(), evidence = {}, scanUserId } = {}) {
  if (scan.status !== 'submit_visible') throw new Error('QA updates require submit_visible');
  const questions = (scan.fields || []).map((field) => ({ ...field, canonical_id: field.canonical_id || field.field_id }));
  const ids = new Set();
  for (const question of questions) {
    if (!question.canonical_id) throw new Error('QA question missing canonical_id');
    if (ids.has(question.canonical_id)) throw new Error(`duplicate canonical_id: ${question.canonical_id}`);
    ids.add(question.canonical_id);
  }
  const record = {
    job_id: job.job_id,
    url: job.url,
    company: job.company,
    title: job.title,
    scanned_at: scannedAt,
    detector_version: scan.detector_version || 'registry-v1',
    scan_user_id: scan.scan_user_id || scanUserId || evidence.scan_user_id || 'unknown',
    pages: scan.pages || [],
    questions,
    evidence,
  };
  validateQaRecord(record, { requireEvidence: false });
  return record;
}

function normalizeQaRecord({ job, scan, scannedAt, evidence = {} }) {
  const record = buildSuccessfulQaRecord({ job, scan, scannedAt, evidence });
  record.evidence = evidence;
  validateQaRecord(record);
  return record;
}

function validateQaRecord(record, { requireEvidence = true } = {}) {
  for (const key of ['job_id', 'url', 'company', 'title', 'scanned_at', 'detector_version', 'scan_user_id']) {
    if (!record?.[key]) throw new Error(`QA record missing ${key}`);
  }
  if (!Array.isArray(record.pages) || record.pages.length === 0) throw new Error('QA record requires pages');
  if (!Array.isArray(record.questions) || record.questions.length === 0) throw new Error('QA record requires questions');
  if (requireEvidence && (!record.evidence?.directory || !record.evidence?.run_id || !Array.isArray(record.evidence.screenshots) || record.evidence.screenshots.length === 0)) throw new Error('QA record requires evidence');
  const evidenceScreenshots = new Set(record.evidence?.screenshots || []);
  const ids = new Set();
  for (const question of record.questions) {
    for (const key of ['canonical_id', 'page_index', 'section', 'type', 'coverage_status', 'screenshot']) if (!question[key]) throw new Error(`QA question missing ${key}`);
    if (requireEvidence && !evidenceScreenshots.has(question.screenshot)) throw new Error(`question screenshot missing from evidence manifest: ${question.canonical_id}`);
    if (question.coverage_status === 'incomplete') throw new Error(`QA question has incomplete coverage: ${question.canonical_id}`);
    if (ids.has(question.canonical_id)) throw new Error(`duplicate canonical_id: ${question.canonical_id}`);
    ids.add(question.canonical_id);
  }
}

function replaceValidatedQaEntry({ file, key, record }) {
  validateQaRecord(record);
  const qa = readQa(file);
  const next = { ...qa, updated_at: record.scanned_at, jobs: { ...qa.jobs, [key] : record } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
  return next;
}

function replaceSuccessfulQaEntry({ file, job, scan, scannedAt = new Date().toISOString(), evidence = {} }) {
  const record = normalizeQaRecord({ job, scan, scannedAt, evidence });
  return replaceValidatedQaEntry({ file, key: job.qa_key, record });
}

module.exports = { SCHEMA_VERSION, readQa, buildSuccessfulQaRecord, normalizeQaRecord, validateQaRecord, replaceValidatedQaEntry, replaceSuccessfulQaEntry };
