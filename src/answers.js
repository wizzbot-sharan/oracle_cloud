const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'answers-v1';

const CONCEPT_SYNONYMS = [
  [/\bu\.s\.a?/gi, 'united states'],
  [/\b(us|usa|united states of america)\b/gi, 'united states'],
  [/\b(legally authorized to work|legal right to work|authorized to work|eligible to work)\b/gi, 'authorized_work'],
  [/\b(require\s+(?:employment\s+)?(?:visa\s+)?sponsorship|need\s+(?:visa\s+)?sponsorship|employment\s+visa\s+sponsorship|visa\s+sponsorship)\b/gi, 'visa_sponsorship'],
  [/\b(18 years of age or older|18 or older|at least 18 years old|at least 18|age 18)\b/gi, 'age_18'],
  [/\b(salary expectation|desired salary|expected salary|target compensation|salary requirements?)\b/gi, 'expected_salary'],
  [/\b(veteran status|protected veteran|military service)\b/gi, 'veteran_status'],
  [/\b(disability status|have a disability|individual with a disability)\b/gi, 'disability_status'],
  [/\b(gender identity|your gender|sex)\b/gi, 'gender_identity'],
  [/\b(race\b|ethnicity\b|racial background)\b/gi, 'race_ethnicity'],
];

const STOP_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does',
  'for', 'from', 'has', 'have', 'he', 'how', 'i', 'in', 'is', 'it', 'its',
  'many', 'much', 'my', 'now', 'of', 'on', 'or', 'our', 'please', 'state',
  'tell', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'what',
  'which', 'who', 'will', 'with', 'would', 'you', 'your',
]);

function normalizeText(text) {
  if (!text) return '';
  let str = String(text).toLowerCase();
  for (const [pattern, replacement] of CONCEPT_SYNONYMS) {
    str = str.replace(pattern, replacement);
  }
  const clean = str.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(/\s+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  return words.join(' ');
}

function tokenize(text) {
  const norm = normalizeText(text);
  if (!norm) return new Set();
  return new Set(norm.split(/\s+/).filter(Boolean));
}

function tokenSimilarity(text1, text2) {
  const set1 = tokenize(text1);
  const set2 = tokenize(text2);
  if (set1.size === 0 || set2.size === 0) return 0;
  let intersection = 0;
  for (const token of set1) {
    if (set2.has(token)) intersection++;
  }
  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function emptyBank() {
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    users: {},
  };
}

function readAnswerBank(file) {
  if (!fs.existsSync(file)) return emptyBank();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema_version !== SCHEMA_VERSION) return emptyBank();
    return parsed;
  } catch (_) {
    return emptyBank();
  }
}

function saveAnswerBank(file, data) {
  data.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
  return data;
}

function getUserAnswers(bank, userId = 'default_user') {
  if (!bank.users?.[userId]) {
    bank.users = bank.users || {};
    bank.users[userId] = {
      user_id: userId,
      profile: {},
      answers: [],
      repeaters: { work_experience: [], education: [] },
    };
  }
  return bank.users[userId];
}

function saveUserAnswer(bank, userId = 'default_user', { questionFieldId, question, fieldType, value }) {
  const user = getUserAnswers(bank, userId);
  const normTarget = normalizeText(question);
  const existing = user.answers.find((item) => (questionFieldId && item.question_field_id === questionFieldId) || normalizeText(item.question) === normTarget);
  const now = new Date().toISOString();
  if (existing) {
    existing.value = value;
    existing.updated_at = now;
    if (fieldType) existing.field_type = fieldType;
    if (question && !existing.question) existing.question = question;
  } else {
    user.answers.push({
      question_field_id: questionFieldId || `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      question,
      field_type: fieldType || 'text',
      value,
      created_at: now,
      updated_at: now,
    });
  }
  return user;
}

function saveUserRepeater(bank, userId = 'default_user', repeaterType, records) {
  const user = getUserAnswers(bank, userId);
  user.repeaters = user.repeaters || {};
  user.repeaters[repeaterType] = records;
  return user;
}

function findBestAnswer(questionLabel, userAnswers = [], { threshold = 0.50 } = {}) {
  if (!questionLabel || !userAnswers.length) return null;
  const normQuery = normalizeText(questionLabel);
  const queryTokens = tokenize(questionLabel);

  // Exact normalized match
  for (const item of userAnswers) {
    const itemNorm = normalizeText(item.question);
    if (itemNorm === normQuery) {
      return { match: item, score: 1.0, confidence: 'high' };
    }
  }

  // Key concept matching (e.g. both have authorized_work or visa_sponsorship)
  const coreConcepts = ['authorized_work', 'visa_sponsorship', 'age_18', 'expected_salary', 'veteran_status', 'disability_status', 'gender_identity', 'race_ethnicity'];
  for (const concept of coreConcepts) {
    if (queryTokens.has(concept)) {
      const conceptMatch = userAnswers.find((item) => tokenize(item.question).has(concept));
      if (conceptMatch) {
        return { match: conceptMatch, score: 0.95, confidence: 'high' };
      }
    }
  }

  // Token Jaccard similarity fallback
  let best = null;
  let bestScore = 0;
  for (const item of userAnswers) {
    const score = tokenSimilarity(questionLabel, item.question);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (best && bestScore >= threshold) {
    return {
      match: best,
      score: bestScore,
      confidence: bestScore >= 0.70 ? 'high' : 'medium',
    };
  }

  return null;
}

function resolveProfileField(field, profile = {}) {
  const label = (field.label || '').toLowerCase();
  const name = (field.locator?.control_name || '').toLowerCase();
  const id = (field.locator?.control_id || '').toLowerCase();

  if (/preferred\s*first\s*name/i.test(label)) return profile.preferred_first_name || profile.first_name || null;
  if (/first\s*name/i.test(label) || /firstname/i.test(name) || /firstname/i.test(id)) return profile.first_name || null;
  if (/last\s*name/i.test(label) || /lastname/i.test(name) || /lastname/i.test(id)) return profile.last_name || null;
  if (/middle\s*name/i.test(label) || /middlename/i.test(name)) return profile.middle_name || '';
  if (/^title$/i.test(label) || /salutation/i.test(label)) return profile.title || 'Mr.';
  if (/^full\s*name$/i.test(label) || (field.section === 'E-Signature' && /name/i.test(label))) return profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || null;
  if (/^email$|primary\s*email|email\s*address/i.test(label) || /email/i.test(name)) return profile.email || null;
  if (/phone|mobile/i.test(label) && field.type !== 'phone_composite') return profile.phone?.number || null;
  if (field.type === 'phone_composite') return profile.phone || null;
  if (/address\s*line\s*1|street\s*address/i.test(label)) return profile.address?.line1 || null;
  if (/address\s*line\s*2/i.test(label)) return profile.address?.line2 || '';
  if (/^city$/i.test(label)) return profile.address?.city || null;
  if (/^state$|^state\/province$/i.test(label)) return profile.address?.state || null;
  if (/postal\s*code|zip\s*code/i.test(label)) return profile.address?.postal_code || null;
  if (/^county$/i.test(label)) return profile.address?.county || '';
  if (/^country$/i.test(label)) return profile.address?.country || null;
  if (field.type === 'file_upload' && /resume|cv|profile/i.test(label || field.section || '')) return profile.resume_path || null;

  return null;
}

function resolveJobQuestions(questions, userRecord) {
  const profile = userRecord?.profile || {};
  const answers = userRecord?.answers || [];
  const repeaters = userRecord?.repeaters || {};

  return questions.map((question) => {
    // 1. Check profile fields
    const profileValue = resolveProfileField(question, profile);
    if (profileValue !== null && profileValue !== undefined) {
      return {
        ...question,
        value: profileValue,
        auto_resolved: true,
        match_confidence: 'high',
        match_source: 'profile',
      };
    }

    // 2. Check repeater data
    if (question.type === 'repeater') {
      const isEdu = /education|school|degree/i.test(question.label);
      const isExp = /experience|work|employment/i.test(question.label);
      const repeaterItems = isEdu ? repeaters.education : isExp ? repeaters.work_experience : [];
      if (repeaterItems && repeaterItems.length > 0) {
        return {
          ...question,
          value: repeaterItems,
          auto_resolved: true,
          match_confidence: 'high',
          match_source: 'repeater',
        };
      }
    }

    // 3. Check Question Answer Bank via Fuzzy/Synonym matcher
    const matchResult = findBestAnswer(question.label, answers);
    if (matchResult && matchResult.match.value !== null && matchResult.match.value !== undefined) {
      return {
        ...question,
        value: matchResult.match.value,
        auto_resolved: true,
        match_confidence: matchResult.confidence,
        match_score: matchResult.score,
        match_source: 'answer_bank',
      };
    }

    return {
      ...question,
      value: null,
      auto_resolved: false,
      match_confidence: 'none',
      match_source: 'none',
    };
  });
}

module.exports = {
  SCHEMA_VERSION,
  normalizeText,
  tokenize,
  tokenSimilarity,
  emptyBank,
  readAnswerBank,
  saveAnswerBank,
  getUserAnswers,
  saveUserAnswer,
  saveUserRepeater,
  findBestAnswer,
  resolveProfileField,
  resolveJobQuestions,
};
