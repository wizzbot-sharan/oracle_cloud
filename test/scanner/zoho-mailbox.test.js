const test = require('node:test');
const assert = require('node:assert/strict');

const { extractOtpCode, otpParseDiagnostic, shouldAcceptVerificationMessage } = require('../../src/integrations/zoho/mailbox');

test('does not use a general Oracle verification email for a different tenant-scoped job', () => {
  assert.equal(shouldAcceptVerificationMessage({
    from: 'noreply@oracle.com',
    subject: 'Your Oracle identity verification',
    company: 'Tradeweb',
    tenant: 'ecnf',
  }), false);
});

test('accepts a tenant-matched verification email and only uses the generic fallback without correlation data', () => {
  assert.equal(shouldAcceptVerificationMessage({
    from: 'ecnf.fa.sender@workflow.email.us-phoenix-1.ocs.oraclecloud.com',
    subject: 'Confirm your identity',
    company: 'Tradeweb',
    tenant: 'ecnf',
  }), true);
  assert.equal(shouldAcceptVerificationMessage({
    from: 'noreply@oracle.com',
    subject: 'Your Oracle identity verification',
    company: '',
    tenant: '',
  }), true);
});

test('extracts an OTP separated from its label by an HTML non-breaking-space entity', () => {
  assert.equal(extractOtpCode('', 'confirm your identify using the one-time pass code:&nbsp;123456'), '123456');
});

test('extracts an OTP when the verification email says code is before the digits', () => {
  assert.equal(extractOtpCode('', 'Your one-time verification code is: 123456.'), '123456');
});

test('extracts a spaced OTP from a sign-in instruction', () => {
  assert.equal(extractOtpCode('Use 123 456 to sign in to your application.', ''), '123456');
});

test('returns a sanitized diagnostic without message content or OTP digits', () => {
  const diagnostic = otpParseDiagnostic('Use 654321 to sign in.', '<table><tr><td>Use 654321 to sign in.</td></tr></table>');

  assert.deepEqual(diagnostic, {
    text_present: true,
    html_present: true,
    normalized_text_length: 22,
    normalized_html_length: 22,
    candidate_counts: { text: 1, html: 1 },
    candidate_digit_lengths: [6],
    matched_pattern: 'action_phrase',
    html_structure: { table: true, span: false, line_break: false },
  });
  assert.equal(JSON.stringify(diagnostic).includes('654321'), false);
});
