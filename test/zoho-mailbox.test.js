const test = require('node:test');
const assert = require('node:assert/strict');

const { extractTenantFromUrl, extractOtpCode, maskOtpForLog, magicLinkLogMessage } = require('../src/integrations/zoho/mailbox');

test('Zoho integration retains tenant correlation and safe OTP parsing', () => {
  assert.equal(extractTenantFromUrl('https://eofd.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/job/785103'), 'eofd');
  assert.equal(extractOtpCode('Your verification code is 123456'), '123456');
  assert.equal(maskOtpForLog('123456'), '[masked-otp]');
  assert.doesNotMatch(maskOtpForLog('123456'), /\d/);
});

test('magic-link diagnostics never include the URL or token', () => {
  const message = magicLinkLogMessage('https://oracle.example.test/verify?token=secret-token');
  assert.equal(message, 'magic_link_received');
  assert.doesNotMatch(message, /oracle|token|secret/i);
});
