const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { indexData, loadJob, isEvidenceDirectoryAllowed } = require('../viewer/server');

test('active viewer indexes consolidated QA jobs instead of historical run folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-viewer-'));
  const qaFile = path.join(root, 'qa.json');
  fs.writeFileSync(qaFile, JSON.stringify({ schema_version: 'qa-v1', updated_at: null, jobs: {
    'https://tenant.oraclecloud.com/job/1': { job_id: 'job-1', url: 'https://tenant.oraclecloud.com/job/1', company: 'Example', title: 'Example role', pages: [{ page_index: 1 }], questions: [{ field_id: 'name', canonical_id: 'name', label: 'Name', type: 'text' }], evidence: {} },
  } }));
  const data = indexData({ qaFile });
  assert.equal(data.jobs.length, 1);
  assert.equal(data.jobs[0].job_id, 'job-1');
  const job = loadJob({ qaFile, key: 'https://tenant.oraclecloud.com/job/1' });
  assert.equal(job.fields[0].label, 'Name');
  assert.equal(isEvidenceDirectoryAllowed(qaFile, 'unknown-directory'), false);
});
