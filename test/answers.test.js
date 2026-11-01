const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeText,
  tokenSimilarity,
  readAnswerBank,
  saveAnswerBank,
  getUserAnswers,
  saveUserAnswer,
  saveUserRepeater,
  findBestAnswer,
  resolveJobQuestions,
} = require('../src/answers');

const testBankFile = path.join('/tmp', 'test-answers.tmp.json');

test.afterEach(() => {
  if (fs.existsSync(testBankFile)) fs.unlinkSync(testBankFile);
});

test('normalizeText standardizes punctuation and synonym aliases', () => {
  const t1 = normalizeText('Are you legally authorized to work in the U.S.?');
  const t2 = normalizeText('Are you authorized to work in the United States?');
  assert.equal(t1, 'authorized_work united states');
  assert.equal(t2, 'authorized_work united states');
});

test('tokenSimilarity computes Jaccard word similarity between rephrased questions', () => {
  const q1 = 'Will you require visa sponsorship now or in the future?';
  const q2 = 'Do you need visa sponsorship to work?';
  const score = tokenSimilarity(q1, q2);
  assert.ok(score >= 0.3, `Expected score >= 0.3, got ${score}`);
});

test('findBestAnswer matches rephrased questions using synonyms and fuzzy tokens', () => {
  const bank = [
    {
      question_field_id: 'q-auth',
      question: 'Are you legally authorized to work in the United States?',
      field_type: 'single_choice',
      value: 'Yes',
    },
    {
      question_field_id: 'q-age',
      question: 'Are you 18 years of age or older?',
      field_type: 'single_choice',
      value: 'Yes',
    },
  ];

  const match1 = findBestAnswer('Are you authorized to work in the US?', bank);
  assert.ok(match1);
  assert.equal(match1.match.value, 'Yes');
  assert.equal(match1.confidence, 'high');

  const match2 = findBestAnswer('Are you 18 or older?', bank);
  assert.ok(match2);
  assert.equal(match2.match.value, 'Yes');

  const match3 = findBestAnswer('What is your favorite hobby?', bank);
  assert.equal(match3, null);
});

test('saveAnswerBank writes atomically and getUserAnswers retrieves user records', () => {
  const initial = readAnswerBank(testBankFile);
  assert.deepEqual(initial.users, {});

  saveUserAnswer(initial, 'user_1', {
    questionFieldId: 'q-1',
    question: 'Desired Salary',
    fieldType: 'text',
    value: '$120,000',
  });

  saveUserRepeater(initial, 'user_1', 'work_experience', [
    { employerName: 'Tech Corp', jobTitle: 'Lead Dev' },
  ]);

  saveAnswerBank(testBankFile, initial);

  const loaded = readAnswerBank(testBankFile);
  const user = getUserAnswers(loaded, 'user_1');
  assert.equal(user.answers.length, 1);
  assert.equal(user.answers[0].value, '$120,000');
  assert.equal(user.repeaters.work_experience[0].employerName, 'Tech Corp');
});

test('resolveJobQuestions auto-populates profile, repeaters, and fuzzy bank answers', () => {
  const userRecord = {
    profile: {
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@example.com',
      phone: { country_code: '+1', number: '1234567890' },
      address: { line1: '500 Pine St', city: 'Seattle', state: 'WA', postal_code: '98101', country: 'United States' },
    },
    answers: [
      {
        question_field_id: 'auth-us',
        question: 'Are you legally authorized to work in the United States?',
        value: 'Yes',
      },
    ],
    repeaters: {
      work_experience: [{ employerName: 'Startup Inc', jobTitle: 'Dev' }],
    },
  };

  const questions = [
    { label: 'First Name', type: 'text' },
    { label: 'Primary Email', type: 'email' },
    { label: 'Are you authorized to work in the US?', type: 'single_choice' },
    { label: 'Add Experience', type: 'repeater' },
    { label: 'What is your favorite color?', type: 'text' },
  ];

  const resolved = resolveJobQuestions(questions, userRecord);

  assert.equal(resolved[0].value, 'Alice');
  assert.equal(resolved[0].auto_resolved, true);

  assert.equal(resolved[1].value, 'alice@example.com');
  assert.equal(resolved[1].auto_resolved, true);

  assert.equal(resolved[2].value, 'Yes');
  assert.equal(resolved[2].auto_resolved, true);
  assert.equal(resolved[2].match_confidence, 'high');

  assert.equal(resolved[3].value.length, 1);
  assert.equal(resolved[3].value[0].employerName, 'Startup Inc');

  assert.equal(resolved[4].value, null);
  assert.equal(resolved[4].auto_resolved, false);
});
