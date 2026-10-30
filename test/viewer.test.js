const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const http = require('node:http');
const { isEvidenceDirectoryAllowed, createServer } = require('../viewer/server');

function request(server, requestPath, method = 'GET') {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: address.port, path: requestPath, method }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('viewer allows only evidence directories referenced by current QA records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-viewer-evidence-'));
  const qaFile = path.join(root, 'qa.json');
  fs.writeFileSync(qaFile, JSON.stringify({ schema_version: 'qa-v1', jobs: {
    one: { evidence: { directory: 'hash-one/run-one' } },
    two: { evidence: { directory: 'hash-two/run-two' } },
  }}));
  assert.equal(isEvidenceDirectoryAllowed(qaFile, 'hash-one/run-one'), true);
  assert.equal(isEvidenceDirectoryAllowed(qaFile, 'hash-three/run-three'), false);
  assert.equal(isEvidenceDirectoryAllowed(qaFile, '../run-one'), false);
});

test('viewer serves only the selected job manifest screenshot and rejects mutations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-viewer-http-'));
  const qaFile = path.join(root, 'qa.json');
  const evidenceRoot = path.join(root, 'evidence');
  fs.mkdirSync(path.join(evidenceRoot, 'hash-one', 'run-one', 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(evidenceRoot, 'hash-two', 'run-two', 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(evidenceRoot, 'hash-one', 'run-one', 'screenshots', 'one.png'), 'one');
  fs.writeFileSync(path.join(evidenceRoot, 'hash-two', 'run-two', 'screenshots', 'two.png'), 'two');
  fs.writeFileSync(qaFile, JSON.stringify({ schema_version: 'qa-v1', jobs: {
    one: { job_id: 'one', evidence: { directory: 'hash-one/run-one', screenshots: ['screenshots/one.png'] } },
    two: { job_id: 'two', evidence: { directory: 'hash-two/run-two', screenshots: ['screenshots/two.png'] } },
  }}));
  const server = createServer({ qaFile, evidenceRoot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(await request(server, '/artifacts/hash-one/run-one/screenshots/one.png?key=one'), 200);
    assert.equal(await request(server, '/artifacts/hash-two/run-two/screenshots/two.png?key=one'), 404);
    assert.equal(await request(server, '/artifacts/hash-one/run-one/screenshots/one.png?key=one', 'POST'), 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
