const test = require('node:test');
const assert = require('node:assert/strict');
const { createTerminalReporter } = require('../../src/evidence');

test('summary reporter prints field and option-capture progress without sensitive values', () => {
  const lines = [];
  const reporter = createTerminalReporter({ level: 'summary', write: (line) => lines.push(line) });
  reporter({ user_id: 'u', job_id: 'j', worker_id: 1, page: 1, step: 'field_scan', action: 'inspect', result: 'captured', field_id: 'country', section: 'Address', field_type: 'combobox', label: 'Country' });
  reporter({ user_id: 'u', job_id: 'j', worker_id: 1, page: 1, step: 'option_capture', action: 'option_capture_completed', result: 'complete', field_id: 'country', discovered_count: 200 });
  reporter({ user_id: 'u', job_id: 'j', worker_id: 1, page: 1, step: 'auth', action: 'otp', result: 'matched', email: 'secret@example.com', otp: '123456' });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Country/);
  assert.match(lines[1], /200/);
  assert.doesNotMatch(lines[2], /secret@example\.com|123456/);
});

test('verbose reporter prints each option label but never raw OTPs', () => {
  const lines = [];
  const reporter = createTerminalReporter({ level: 'verbose', write: (line) => lines.push(line) });
  reporter({ user_id: 'u', job_id: 'j', worker_id: 1, page: 1, step: 'option_scan', action: 'visit', result: 'scanned', field_id: 'country', option: 'United States' });
  assert.match(lines[0], /United States/);
});
