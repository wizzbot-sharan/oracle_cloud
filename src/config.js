const path = require('node:path');

function positiveInteger(env, name, fallback) {
  const value = Number.parseInt(env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(env, name, fallback) {
  const value = Number.parseInt(env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function booleanValue(env, name, fallback) {
  if (env[name] === undefined) return fallback;
  if (/^true$/i.test(env[name])) return true;
  if (/^false$/i.test(env[name])) return false;
  throw new Error(`${name} must be true or false`);
}

function enumValue(env, name, fallback, values) {
  const value = env[name] || fallback;
  if (!values.includes(value)) throw new Error(`${name} must be ${values.join(' or ')}`);
  return value;
}

function commaList(env, name, fallback) {
  if (env[name] === undefined) return fallback;
  const values = env[name].split(',').map((item) => item.trim()).filter(Boolean);
  if (!values.length) throw new Error(`${name} must contain at least one value`);
  return values;
}

function loadConfig(env = process.env) {
  if (!env.TEST_EMAIL?.trim()) throw new Error('TEST_EMAIL is required');
  return Object.freeze({
    testEmail: env.TEST_EMAIL.trim(),
    userId: env.SCANNER_USER_ID || 'scan_trial',
    concurrency: positiveInteger(env, 'SCANNER_CONCURRENCY', 1),
    launchGapMs: positiveInteger(env, 'SCANNER_LAUNCH_GAP_MS', 15000),
    launchJitterMs: nonNegativeInteger(env, 'SCANNER_LAUNCH_JITTER_MS', 5000),
    headless: booleanValue(env, 'SCANNER_HEADLESS', false),
    maxPages: positiveInteger(env, 'SCANNER_MAX_PAGES', 20),
    stepRetries: positiveInteger(env, 'SCANNER_STEP_RETRIES', 3),
    circuitBreakerFailures: positiveInteger(env, 'SCANNER_CIRCUIT_BREAKER_FAILURES', 2),
    authSettleMs: nonNegativeInteger(env, 'SCANNER_AUTH_SETTLE_MS', 2000),
    postNextSettleMs: nonNegativeInteger(env, 'SCANNER_POST_NEXT_SETTLE_MS', 3500),
    postVerifySettleMs: nonNegativeInteger(env, 'SCANNER_POST_VERIFY_SETTLE_MS', 10000),
    fieldSettleMs: positiveInteger(env, 'SCANNER_FIELD_SETTLE_MS', 300),
    captureComboboxOptions: booleanValue(env, 'SCANNER_CAPTURE_COMBOBOX_OPTIONS', false),
    defaultCountry: env.SCANNER_DEFAULT_COUNTRY?.trim() || 'United States',
    optionCaptureMaxRounds: positiveInteger(env, 'SCANNER_OPTION_CAPTURE_MAX_ROUNDS', 100),
    optionCaptureStagnantRounds: positiveInteger(env, 'SCANNER_OPTION_CAPTURE_STAGNANT_ROUNDS', 2),
    evidenceLevel: enumValue(env, 'SCANNER_EVIDENCE_LEVEL', 'standard', ['standard', 'verbose']),
    logLevel: enumValue(env, 'SCANNER_LOG_LEVEL', 'summary', ['summary', 'verbose']),
    cascadeSampleStates: commaList(env, 'SCANNER_CASCADE_SAMPLE_STATES', ['California', 'New York', 'Texas']),
    typingDelayMs: nonNegativeInteger(env, 'TYPING_DELAY_MS', 100),
    fillerKeystrokeDelayMs: nonNegativeInteger(env, 'FILLER_KEYSTROKE_DELAY_MS', 75),
    fillerActionDelayMs: nonNegativeInteger(env, 'FILLER_ACTION_DELAY_MS', 500),
    fillerHeadless: booleanValue(env, 'FILLER_HEADLESS', false),
    jobsFile: path.resolve(env.SCANNER_JOBS_FILE || 'data/job-urls.json'),
    qaFile: path.resolve(env.SCANNER_QA_FILE || 'data/qa.json'),
    answersFile: path.resolve(env.ANSWERS_FILE || 'data/answers.json'),
    outputRoot: path.resolve(env.SCANNER_OUTPUT_ROOT || 'artifacts/runs'),
    currentEvidenceRoot: path.resolve(env.SCANNER_CURRENT_EVIDENCE_ROOT || 'artifacts/current-qa-evidence'),
    zohoReaderBaseUrl: env.ZOHO_READER_BASE_URL || 'https://zoho-mail-reader.onrender.com',
  });
}

module.exports = { loadConfig };
