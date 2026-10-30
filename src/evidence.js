const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!name || !domain) return '***';
  return `${name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : '***'}@${domain}`;
}

function maskString(value, key = '') {
  const withUrlsMasked = String(value).replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]');
  const withEmailsMasked = withUrlsMasked.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, maskEmail);
  if (/password|secret|token/i.test(key)) return withEmailsMasked ? '***' : withEmailsMasked;
  if (/^(otp|code|passcode|verification_code)$/i.test(key) && /^\d{6}$/.test(withEmailsMasked)) return '******';
  return withEmailsMasked.replace(/((?:one[- ]time\s+)?(?:otp|pass\s*code|verification\s+code|code)\s*[:=-]?\s*)\d{6}\b/gi, '$1******');
}

function maskSensitive(value, key = '') {
  if (typeof value === 'string') return maskString(value, key);
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, maskSensitive(child, childKey)]));
  return value;
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function prepareJobEvidence({ runDir, currentRoot, runId, jobKey, userId, jobId, manifest }) {
  const jobHash = crypto.createHash('sha256').update(String(jobKey)).digest('hex').slice(0, 16);
  const directory = path.posix.join(jobHash, safeSegment(runId));
  const source = path.join(runDir, 'screenshots');
  const target = path.join(currentRoot, directory, 'screenshots');
  const selected = (manifest || []).filter((item) => item.user_id === userId && item.job_id === jobId && typeof item.file === 'string');
  if (!selected.length) throw new Error(`No evidence exists for job: ${jobId}`);
  if (fs.existsSync(path.join(currentRoot, directory))) throw new Error(`Immutable evidence directory already exists: ${directory}`);
  fs.mkdirSync(target, { recursive: true });
  for (const item of selected) {
    const relative = item.file.replace(/^screenshots[\\/]/, '');
    const sourceFile = path.resolve(source, relative);
    if (!sourceFile.startsWith(`${path.resolve(source)}${path.sep}`) || !fs.existsSync(sourceFile)) throw new Error(`Missing evidence file for job: ${jobId}`);
    const destination = path.resolve(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(sourceFile, destination);
  }
  return { directory, screenshot_root: 'screenshots', screenshots: selected.map((item) => item.file), run_id: runId, job_key: jobKey };
}

function shouldCaptureEvidence(level, kind) {
  if (level === 'verbose') return true;
  return ['application_ready', 'page', 'submit', 'error', 'incomplete'].includes(kind);
}

function createTerminalReporter({ level = 'summary', write = console.log } = {}) {
  if (!['summary', 'verbose'].includes(level)) throw new Error('SCANNER_LOG_LEVEL must be summary or verbose');
  return (event) => {
    if (level === 'summary' && ['visit', 'discover'].includes(event.action)) return;
    const safe = maskSensitive(event);
    const parts = [`[scan][${safe.job_id || 'job'}]`, `w${safe.worker_id ?? '?'}`, `p${safe.page ?? '?'}`, safe.step, safe.action, safe.result];
    for (const [key, label] of [['section', 'section'], ['field_id', 'field'], ['field_type', 'type'], ['label', 'label'], ['discovered_count', 'options'], ['scroll_round', 'scroll'], ['option', 'option'], ['incomplete_reason', 'reason']]) {
      if (safe[key] !== undefined && safe[key] !== '') parts.push(`${label}=${typeof safe[key] === 'string' ? JSON.stringify(safe[key]) : safe[key]}`);
    }
    write(parts.filter(Boolean).join(' '));
  };
}

class EvidenceWriter {
  constructor({ rootDir, runId, level = 'standard', reporter = null }) {
    this.runId = safeSegment(runId);
    this.runDir = path.join(rootDir, this.runId);
    this.jobsDir = path.join(this.runDir, 'jobs');
    this.screenshotsDir = path.join(this.runDir, 'screenshots');
    this.eventsFile = path.join(this.runDir, 'events.jsonl');
    this.manifestFile = path.join(this.runDir, 'screenshot-manifest.json');
    this.level = level;
    this.reporter = reporter;
    this.sequence = 0;
    this.manifest = [];
    this.writeQueue = Promise.resolve();
    fs.mkdirSync(this.jobsDir, { recursive: true });
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
  }

  enqueue(operation) {
    this.writeQueue = this.writeQueue.then(operation, operation);
    return this.writeQueue;
  }

  async logEvent(event) {
    const required = ['user_id', 'job_id', 'worker_id', 'page', 'step', 'action', 'result'];
    for (const key of required) if (event[key] === undefined || event[key] === null) throw new Error(`Event is missing required field: ${key}`);
    const safe = maskSensitive({ timestamp: new Date().toISOString(), run_id: this.runId, ...event });
    try { this.reporter?.(safe); } catch (_) { /* diagnostics never stop scanning */ }
    await this.enqueue(() => fs.promises.appendFile(this.eventsFile, `${JSON.stringify(safe)}\n`, 'utf8'));
    return safe;
  }

  async capture(page, entry, { kind = 'error', fullPage = false } = {}) {
    if (!shouldCaptureEvidence(this.level, kind)) return null;
    const sequence = ++this.sequence;
    const filename = [String(sequence).padStart(5, '0'), safeSegment(entry.job_id), safeSegment(entry.step), entry.field_id ? safeSegment(entry.field_id).slice(0, 64) : null].filter(Boolean).join('-') + '.png';
    const absolutePath = path.join(this.screenshotsDir, filename);
    const mask = [
      page.locator('input[type="password"]'), page.locator('input[type="email"]'), page.locator('input[autocomplete="one-time-code"]'), page.locator('input[aria-label*="verification code" i]'), page.locator('input[id*="verification-code" i]'), page.locator('[class*="email" i], [id*="email" i], [data-qa*="email" i], [aria-label*="email" i]'), page.locator('[role="alert"]').filter?.({ hasText: '@' }) || page.locator('[role="alert"]'),
    ];
    await page.screenshot({ path: absolutePath, fullPage, animations: 'disabled', mask, maskColor: '#000000' });
    const saved = maskSensitive({ sequence, ...entry, kind, file: path.posix.join('screenshots', filename) });
    this.manifest.push(saved);
    await this.enqueue(() => fs.promises.writeFile(this.manifestFile, JSON.stringify(this.manifest, null, 2), 'utf8'));
    return saved;
  }

  async recordScreenshot(entry) {
    const saved = maskSensitive({ sequence: ++this.sequence, ...entry });
    this.manifest.push(saved);
    await this.enqueue(() => fs.promises.writeFile(this.manifestFile, JSON.stringify(this.manifest, null, 2), 'utf8'));
    return saved;
  }

  captureScreenshot(page, entry, options = {}) { return this.capture(page, entry, { ...options, kind: options.kind || 'error' }); }

  async writeJobResult(jobId, result, name = 'fields.json') {
    const directory = path.join(this.jobsDir, safeSegment(jobId));
    await this.enqueue(async () => { await fs.promises.mkdir(directory, { recursive: true }); await fs.promises.writeFile(path.join(directory, name), JSON.stringify(maskSensitive(result), null, 2), 'utf8'); });
  }

  writePartialJobResult(jobId, result) { return this.writeJobResult(jobId, result, 'fields.partial.json'); }
  writeSummary(summary) { return this.enqueue(() => fs.promises.writeFile(path.join(this.runDir, 'summary.json'), JSON.stringify(maskSensitive(summary), null, 2), 'utf8')); }
}

function createEvidenceWriter(options) { return new EvidenceWriter(options); }

module.exports = { EvidenceWriter, createEvidenceWriter, createTerminalReporter, maskSensitive, safeSegment, shouldCaptureEvidence, prepareJobEvidence };
