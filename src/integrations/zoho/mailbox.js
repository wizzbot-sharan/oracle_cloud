/**
 * Zoho mailbox integration for scan-login.
 *
 * Zoho Mail Reader Client for Automated OTP & Magic Link Retrieval.
 * Interfaces with: https://zoho-mail-reader.onrender.com
 *
 * Capabilities:
 * - Polls Zoho inbox API for candidate email verification messages
 * - Correlates by Oracle tenant code (e.g. 'emje' extracted from job_url)
 * - Correlates by Company name in sender, subject, and message body
 * - Matches verification subjects ("identity", "verification", "confirm", "passcode")
 * - Pre-action snapshot: excludes older messages that already existed before Next click
 * - Extracts 6-digit OTP codes and Magic Links
 * - Strict masking of secrets and candidate emails
 */

const ZOHO_READER_BASE_URL = process.env.ZOHO_READER_BASE_URL || 'https://zoho-mail-reader.onrender.com';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskEmail(email) {
  if (!email) return '***';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : '***';
  return `${maskedName}@${domain}`;
}

function maskOtpForLog() {
  return '[masked-otp]';
}

function magicLinkLogMessage() {
  return 'magic_link_received';
}

/**
 * Extract Oracle Cloud tenant code from job URL hostname.
 * Examples:
 *   "https://emje.fa.us6.oraclecloud.com/..." -> "emje"
 *   "https://hcwx.fa.us2.oraclecloud.com/..." -> "hcwx"
 *   "https://fa-exty-saasfaprod1.fa.ocs.oraclecloud.com/..." -> "fa-exty-saasfaprod1"
 */
function extractTenantFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const parts = host.split('.');
    if (parts.length > 0 && parts[0] !== 'www') {
      return parts[0];
    }
  } catch (_) {}
  return null;
}

/**
 * Check if the email subject indicates an identity / verification message
 */
function isVerificationSubject(subject) {
  if (!subject) return false;
  return /identity|verification|confirm|passcode|pass\s*code|one-time|application/i.test(subject);
}

/**
 * Match sender and subject against tenant code and company metadata
 */
function matchesCompanyOrTenant(from, subject, company, tenant) {
  const fromLower = (from || '').toLowerCase();
  const subjLower = (subject || '').toLowerCase();

  // 1. Precise Oracle tenant match (e.g. emje.fa.sender@workflow...)
  if (tenant && fromLower.includes(tenant.toLowerCase())) {
    return true;
  }

  // 2. Company name match in sender or subject
  if (company) {
    const normCompany = company.toLowerCase().trim();
    if (fromLower.includes(normCompany) || subjLower.includes(normCompany)) {
      return true;
    }
    // Check significant company tokens (e.g. "southern" in "Southern Company")
    const words = normCompany.split(/[\s,.-]+/).filter(w => w.length >= 4 && !/company|corp|inc|llc|group/i.test(w));
    for (const w of words) {
      if (fromLower.includes(w) || subjLower.includes(w)) {
        return true;
      }
    }
  }

  return false;
}

function shouldAcceptVerificationMessage({ from, subject, company, tenant }) {
  const verificationSubject = isVerificationSubject(subject);
  if (!verificationSubject) return false;
  if (matchesCompanyOrTenant(from, subject, company, tenant)) return true;

  // A generic Oracle sender is only safe when this job has no tenant or employer identity to match.
  // Otherwise a shared mailbox can contain a fresh OTP for another concurrent Oracle application.
  const sender = (from || '').toLowerCase();
  return !tenant && !company && (sender.includes('oracle') || sender.includes('recruiting') || sender.includes('workflow.mail'));
}

/**
 * Fetch inbox message list for a candidate email
 */
async function fetchInbox(email, limit = 8) {
  const url = `${ZOHO_READER_BASE_URL}/api/zoho/ui/inbox?email=${encodeURIComponent(email)}&limit=${limit}&start=1`;
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!response.ok) {
    throw new Error(`Zoho API inbox fetch failed with HTTP ${response.status}`);
  }
  return await response.json();
}

/**
 * Snapshot existing message IDs currently in the mailbox before taking an action
 */
async function snapshotInboxMessageIds(email) {
  try {
    const inboxData = await fetchInbox(email, 15);
    const ids = new Set((inboxData.messages || []).map(m => m.messageId));
    return ids;
  } catch (_) {
    return new Set();
  }
}

/**
 * Fetch full body (textContent + htmlContent) of a specific message
 */
async function fetchMessageBody(email, accountId, folderId, messageId) {
  const url = `${ZOHO_READER_BASE_URL}/api/zoho/ui/message?email=${encodeURIComponent(email)}&accountId=${encodeURIComponent(accountId)}&folderId=${encodeURIComponent(folderId)}&messageId=${encodeURIComponent(messageId)}`;
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!response.ok) {
    throw new Error(`Zoho API message body fetch failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.message || {};
}

/**
 * Extract 6-digit OTP code from email text or HTML
 */
function normalizeOtpSource(value, { html = false } = {}) {
  return String(value || '')
    .replace(/<[^>]*>/g, html ? ' ' : '')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/\u00a0|[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function otpCandidates(value) {
  return [...String(value || '').matchAll(/\b(?:\d{6}|\d{3}[\s-]\d{3})\b/g)]
    .map((match) => match[0].replace(/\D/g, ''));
}

function parseOtp(text, html) {
  const sources = [
    { name: 'text', value: normalizeOtpSource(text) },
    { name: 'html', value: normalizeOtpSource(html, { html: true }) },
  ];
  const codeExpression = '(\\d{6}|\\d{3}[\\s-]\\d{3})';
  const patterns = [
    ['labelled_code', new RegExp(`(?:one-time pass code|one-time passcode|passcode|verification code|pass code|authentication code|security code)\\s*(?:is\\s*)?[:\\-]?\\s*${codeExpression}`, 'i')],
    ['action_phrase', new RegExp(`(?:use|enter|provide|type|sign in with)\\s+${codeExpression}`, 'i')],
  ];

  for (const source of sources) {
    for (const [pattern, expression] of patterns) {
      const match = source.value.match(expression);
      if (match?.[1]) return { code: match[1].replace(/\D/g, ''), pattern, source: source.name };
    }
  }

  const candidates = [...new Set(sources.flatMap((source) => otpCandidates(source.value)))];
  const verificationLanguage = sources.some((source) => /code|passcode|sign in|verify|verification|identity/i.test(source.value));
  if (verificationLanguage && candidates.length === 1) {
    return { code: candidates[0], pattern: 'single_verification_candidate', source: 'combined' };
  }
  return { code: null, pattern: 'none', source: null };
}

function otpParseDiagnostic(text, html) {
  const normalizedText = normalizeOtpSource(text);
  const normalizedHtml = normalizeOtpSource(html, { html: true });
  const parsed = parseOtp(text, html);
  const candidateLengths = [...new Set([...otpCandidates(normalizedText), ...otpCandidates(normalizedHtml)].map((candidate) => candidate.length))].sort((a, b) => a - b);
  return {
    text_present: Boolean(normalizedText),
    html_present: Boolean(normalizedHtml),
    normalized_text_length: normalizedText.length,
    normalized_html_length: normalizedHtml.length,
    candidate_counts: { text: otpCandidates(normalizedText).length, html: otpCandidates(normalizedHtml).length },
    candidate_digit_lengths: candidateLengths,
    matched_pattern: parsed.pattern,
    html_structure: {
      table: /<table\b/i.test(String(html || '')),
      span: /<span\b/i.test(String(html || '')),
      line_break: /<br\b/i.test(String(html || '')),
    },
  };
}

function extractOtpCode(text, html) {
  const parsed = parseOtp(text, html);
  return parsed.code;
}

/**
 * Extract Magic Link / Draft Application URL from email HTML or text
 */
function extractMagicLink(html, text) {
  if (!html && !text) return null;

  // Pattern A: <a href="...">job application</a> or complete application
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?(?:job application|complete.*?application|continue.*?application|verify)[\s\S]*?<\/a>/i;
  const linkMatch = (html || '').match(linkRegex);
  if (linkMatch && linkMatch[1]) {
    return linkMatch[1].replace(/&amp;/g, '&');
  }

  // Pattern B: Any Oracle CandidateExperience or verify URL in text/html
  const urlRegex = /(https:\/\/[^\s"'<>]*(?:CandidateExperience|verify|token=)[^\s"'<>]*)/i;
  const urlMatch = `${html || ''} ${text || ''}`.match(urlRegex);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].replace(/&amp;/g, '&');
  }

  return null;
}

/**
 * Poll Zoho Mail for incoming verification message (OTP or Magic Link)
 *
 * @param {Object} options
 * @param {string} options.email - Candidate Zoho email address
 * @param {string} [options.jobUrl] - Target job URL (used to extract tenant code)
 * @param {string} [options.company] - Company name from job definition
 * @param {string} [options.jobTitle] - Job title from job definition
 * @param {number} options.minReceivedTime - Timestamp when Next was clicked (ms)
 * @param {Set<string>} [options.knownMessageIds] - Existing message IDs to ignore (snapshot)
 * @param {number} [options.maxWaitSec=180] - Max seconds to poll
 * @param {number} [options.intervalSec=10] - Interval between polls
 * @returns {Promise<{ type: 'OTP', code: string } | { type: 'MAGIC_LINK', url: string } | null>}
 */
async function pollForVerificationEmail(options) {
  const {
    email,
    jobUrl = '',
    company = '',
    jobTitle = '',
    minReceivedTime,
    knownMessageIds = new Set(),
    maxWaitSec = 180,
    intervalSec = 10,
    onParseDiagnostic,
  } = options;

  const tenant = extractTenantFromUrl(jobUrl);
  const startTime = Date.now();

  console.log(`[Zoho Poller] Polling mailbox for ${maskEmail(email)}...`);
  console.log(`[Zoho Poller] Target: Company="${company || 'N/A'}", Tenant="${tenant || 'N/A'}", Title="${jobTitle || 'N/A'}"`);
  console.log(`[Zoho Poller] Timeout: ${maxWaitSec}s, Known IDs to ignore: ${knownMessageIds.size}`);

  let attempt = 0;
  const diagnosedMessageIds = new Set();
  while ((Date.now() - startTime) < (maxWaitSec * 1000)) {
    attempt++;
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

    try {
      const inboxData = await fetchInbox(email, 10);
      const messages = inboxData.messages || [];
      const accountId = inboxData.accountId;

      // Filter: must not be in pre-action snapshot AND received >= minReceivedTime
      const candidateMessages = messages.filter(m => {
        if (knownMessageIds.has(m.messageId)) return false;
        const rTime = parseInt(m.receivedTime, 10);
        return !isNaN(rTime) && rTime >= (minReceivedTime - 2000); // 2s clock skew tolerance
      });

      console.log(`[Zoho Poller] Attempt #${attempt} (${elapsedSec}s elapsed): Found ${candidateMessages.length} fresh candidate message(s).`);

      for (const msg of candidateMessages) {
        const fromStr = (msg.from || '').toLowerCase();
        const subjectStr = (msg.subject || '').toLowerCase();

        // Check subject verification keywords
        const matchesOrg = matchesCompanyOrTenant(fromStr, subjectStr, company, tenant);

        if (shouldAcceptVerificationMessage({ from: fromStr, subject: subjectStr, company, tenant })) {
          // Subjects and sender display names can contain a verification code or address.
          console.log('[Zoho Poller] Matching verification email found.');
          const bodyData = await fetchMessageBody(email, accountId, msg.folderId, msg.messageId);
          const { textContent, htmlContent } = bodyData;

          // If body contains company name, further confirms correlation
          if (company) {
            const bodyCombined = `${textContent || ''} ${htmlContent || ''}`.toLowerCase();
            if (!bodyCombined.includes(company.toLowerCase()) && !matchesOrg) {
              console.log(`[Zoho Poller] Message body did not mention "${company}". Checking anyway for OTP...`);
            }
          }

          // Check for 6-digit OTP code
          const otpCode = extractOtpCode(textContent, htmlContent);
          if (otpCode) {
            console.log(`[Zoho Poller] >>> SUCCESS: Matched 6-digit OTP code: ${maskOtpForLog(otpCode)} <<<`);
            return {
              type: 'OTP',
              code: otpCode,
              messageId: msg.messageId,
              subject: msg.subject,
              sender: msg.from,
            };
          }

          // Check for Magic Link / Draft application link
          const magicLink = extractMagicLink(htmlContent, textContent);
          if (magicLink) {
            console.log(`[Zoho Poller] >>> ${magicLinkLogMessage()} <<<`);
            return {
              type: 'MAGIC_LINK',
              url: magicLink,
              messageId: msg.messageId,
              subject: msg.subject,
              sender: msg.from,
            };
          }

          if (!diagnosedMessageIds.has(msg.messageId)) {
            diagnosedMessageIds.add(msg.messageId);
            await onParseDiagnostic?.({
              message_id: msg.messageId,
              diagnostic: otpParseDiagnostic(textContent, htmlContent),
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[Zoho Poller] Warning during poll attempt #${attempt}:`, err.message);
    }

    await sleep(intervalSec * 1000);
  }

  console.log(`[Zoho Poller] Timeout reached (${maxWaitSec}s). No matching verification email found.`);
  return null;
}

module.exports = {
  fetchInbox,
  snapshotInboxMessageIds,
  fetchMessageBody,
  extractTenantFromUrl,
  isVerificationSubject,
  matchesCompanyOrTenant,
  shouldAcceptVerificationMessage,
  extractOtpCode,
  otpParseDiagnostic,
  extractMagicLink,
  pollForVerificationEmail,
  maskEmail,
  maskOtpForLog,
  magicLinkLogMessage,
};
