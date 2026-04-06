/**
 * Unit tests for KNM exam data and answer correction logic.
 * Run with: node exam.test.js
 */

// ── Load data ──────────────────────────────────────────────────────────────
const fs = require('fs');

const src = fs.readFileSync('./exam_data.js', 'utf8');
// expose EXAM_DATA in this scope
eval(src.replace('const EXAM_DATA', 'global.EXAM_DATA'));

// ── Minimal test runner ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(description, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push({ description, message: err.message });
    process.stdout.write('F');
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message ?? `Expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`);
}

function assertIncludes(arr, value, message) {
  if (!arr.includes(value)) throw new Error(message ?? `Expected [${arr}] to include ${JSON.stringify(value)}`);
}

// ── Helper: simulate answer grading (mirrors the browser logic) ────────────
function gradeAnswer(exam, qNum, userLetter) {
  const correctLetter = exam.answers[String(qNum)];
  return userLetter === correctLetter;
}

// ── Suite 1: Data shape ────────────────────────────────────────────────────
console.log('\nSuite 1: Data shape');

test('EXAM_DATA is an array', () => {
  assert(Array.isArray(EXAM_DATA), 'EXAM_DATA should be an array');
});

test('Contains exactly 25 exams', () => {
  assertEqual(EXAM_DATA.length, 25, `Expected 25 exams, got ${EXAM_DATA.length}`);
});

test('Exams are numbered 1–25 with no duplicates', () => {
  const nums = EXAM_DATA.map(e => e.num).sort((a, b) => a - b);
  for (let i = 0; i < 25; i++) {
    assertEqual(nums[i], i + 1, `Missing or duplicate exam number at position ${i}: got ${nums[i]}`);
  }
});

test('Every exam has a questions array', () => {
  EXAM_DATA.forEach(e => {
    assert(Array.isArray(e.questions), `Exam ${e.num}: questions must be an array`);
  });
});

test('Every exam has an answers object', () => {
  EXAM_DATA.forEach(e => {
    assert(e.answers && typeof e.answers === 'object' && !Array.isArray(e.answers),
      `Exam ${e.num}: answers must be a plain object`);
  });
});

// ── Suite 2: Question integrity ────────────────────────────────────────────
console.log('\nSuite 2: Question integrity');

test('Every question has a numeric num between 1 and 40', () => {
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      assert(Number.isInteger(q.num) && q.num >= 1 && q.num <= 40,
        `Exam ${e.num} Q${q.num}: num must be 1–40`);
    });
  });
});

test('Every question has non-empty text', () => {
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      assert(typeof q.text === 'string' && q.text.trim().length > 0,
        `Exam ${e.num} Q${q.num}: text must be a non-empty string`);
    });
  });
});

test('Every question has at least 2 options', () => {
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      assert(Array.isArray(q.options) && q.options.length >= 2,
        `Exam ${e.num} Q${q.num}: must have at least 2 options, got ${q.options?.length}`);
    });
  });
});

test('Every question has at most 4 options', () => {
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      assert(q.options.length <= 4,
        `Exam ${e.num} Q${q.num}: must have at most 4 options, got ${q.options.length}`);
    });
  });
});

test('Options are labelled A, B, C, D in order without gaps', () => {
  const validSequences = [['A','B'],['A','B','C'],['A','B','C','D']];
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      const letters = q.options.map(o => o.letter);
      const valid = validSequences.some(seq =>
        seq.length === letters.length && seq.every((l, i) => l === letters[i])
      );
      assert(valid, `Exam ${e.num} Q${q.num}: option letters must be A–D in order, got [${letters}]`);
    });
  });
});

test('Every option has non-empty text', () => {
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      q.options.forEach(opt => {
        assert(typeof opt.text === 'string' && opt.text.trim().length > 0,
          `Exam ${e.num} Q${q.num} option ${opt.letter}: text must be non-empty`);
      });
    });
  });
});

test('No duplicate question numbers within an exam', () => {
  EXAM_DATA.forEach(e => {
    const seen = new Set();
    e.questions.forEach(q => {
      assert(!seen.has(q.num), `Exam ${e.num}: duplicate question number ${q.num}`);
      seen.add(q.num);
    });
  });
});

// ── Suite 3: Answer key integrity ──────────────────────────────────────────
console.log('\nSuite 3: Answer key integrity');

/**
 * Known OCR-damaged entries in the source PDF — confirmed by manual inspection.
 * These cannot be fixed without the original source material.
 *
 *  Exam 9  Q25 : question body unreadable in PDF → question not parsed, key entry orphaned
 *  Exam 10 Q1  : answer key page in PDF omits Q1  → question parsed OK, key entry missing
 *  Exam 19 Q7  : question body unreadable in PDF → question not parsed, key entry orphaned
 *  Exam 19 Q15 : question body unreadable in PDF → question not parsed, key entry orphaned
 *  Exam 21 Q14 : question body unreadable in PDF → question not parsed, key entry orphaned
 *  Exam 21 Q23 : question body unreadable in PDF → question not parsed, key entry orphaned
 *  Exam 21 Q31 : question body unreadable in PDF → question not parsed, key entry orphaned
 *  Exam 23 Q38 : option C text destroyed by OCR   → question parsed with only A/B; key says C
 */
const OCR_DAMAGED = [
  { exam: 9,  qNum: 25, issue: 'question body unreadable — not parsed; answer key entry orphaned' },
  { exam: 10, qNum: 1,  issue: 'answer key page omits Q1 — question OK but no key entry' },
  { exam: 19, qNum: 7,  issue: 'question body unreadable — not parsed; answer key entry orphaned' },
  { exam: 19, qNum: 15, issue: 'question body unreadable — not parsed; answer key entry orphaned' },
  { exam: 21, qNum: 14, issue: 'question body unreadable — not parsed; answer key entry orphaned' },
  { exam: 21, qNum: 23, issue: 'question body unreadable — not parsed; answer key entry orphaned' },
  { exam: 21, qNum: 31, issue: 'question body unreadable — not parsed; answer key entry orphaned' },
  { exam: 23, qNum: 38, issue: 'option C text destroyed by OCR — question has only A/B but key says C' },
];

function isOcrDamaged(examNum, qNum) {
  return OCR_DAMAGED.some(d => d.exam === examNum && d.qNum === qNum);
}

test('Every answer key entry maps to a valid question number (1–40)', () => {
  EXAM_DATA.forEach(e => {
    Object.keys(e.answers).forEach(k => {
      const n = parseInt(k, 10);
      assert(Number.isInteger(n) && n >= 1 && n <= 40,
        `Exam ${e.num}: answer key contains invalid question number "${k}"`);
    });
  });
});

test('Every answer letter is A, B, C, or D', () => {
  const valid = new Set(['A','B','C','D']);
  EXAM_DATA.forEach(e => {
    Object.entries(e.answers).forEach(([k, v]) => {
      assert(valid.has(v),
        `Exam ${e.num} Q${k}: answer "${v}" is not a valid letter`);
    });
  });
});

test('Answer key entries without a matching question are only known OCR gaps', () => {
  EXAM_DATA.forEach(e => {
    const qNums = new Set(e.questions.map(q => q.num));
    Object.keys(e.answers).forEach(k => {
      const n = parseInt(k, 10);
      if (!qNums.has(n)) {
        assert(isOcrDamaged(e.num, n),
          `Exam ${e.num}: answer key has entry for Q${n} but no such question — not a known OCR gap`);
      }
    });
  });
});

test('Documented OCR gaps (orphaned answer key entries) are exactly as expected', () => {
  const orphanGaps = OCR_DAMAGED.filter(d => d.issue.includes('not parsed'));
  orphanGaps.forEach(({ exam: examNum, qNum }) => {
    const e = EXAM_DATA.find(e => e.num === examNum);
    const qNums = new Set(e.questions.map(q => q.num));
    assert(!qNums.has(qNum),
      `Exam ${examNum} Q${qNum}: expected this question to be missing (OCR gap) but it was parsed`);
    assert(e.answers[String(qNum)] !== undefined,
      `Exam ${examNum} Q${qNum}: expected an orphaned key entry but none found`);
  });
});

test('The correct answer letter exists as one of the question\'s options (skip known OCR gaps)', () => {
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      const ca = e.answers[String(q.num)];
      if (ca === undefined) return; // covered by the missing-key test below
      if (isOcrDamaged(e.num, q.num)) return; // known OCR damage
      const letters = q.options.map(o => o.letter);
      assertIncludes(letters, ca,
        `Exam ${e.num} Q${q.num}: correct answer "${ca}" not found in options [${letters}]`);
    });
  });
});

test('Every parsed question has a corresponding answer key entry (skip known OCR gaps)', () => {
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      if (isOcrDamaged(e.num, q.num)) return;
      const ca = e.answers[String(q.num)];
      assert(ca !== undefined,
        `Exam ${e.num} Q${q.num}: no answer key entry found`);
    });
  });
});

test('OCR-damaged questions with missing key entries are exactly as expected', () => {
  const missingKeyGaps = OCR_DAMAGED.filter(d => d.issue.includes('no key entry'));
  missingKeyGaps.forEach(({ exam: examNum, qNum }) => {
    const e = EXAM_DATA.find(e => e.num === examNum);
    const q = e.questions.find(q => q.num === qNum);
    assert(q !== undefined,
      `Exam ${examNum} Q${qNum}: expected question to exist (only key is missing)`);
    assert(e.answers[String(qNum)] === undefined,
      `Exam ${examNum} Q${qNum}: expected missing key entry but one was found`);
  });
});

test('OCR-damaged questions with truncated options are exactly as expected', () => {
  const truncatedGaps = OCR_DAMAGED.filter(d => d.issue.includes('only A/B'));
  truncatedGaps.forEach(({ exam: examNum, qNum }) => {
    const e = EXAM_DATA.find(e => e.num === examNum);
    const q = e.questions.find(q => q.num === qNum);
    assert(q !== undefined, `Exam ${examNum} Q${qNum}: expected question to exist`);
    const letters = q.options.map(o => o.letter);
    assert(!letters.includes('C'),
      `Exam ${examNum} Q${qNum}: expected option C to be missing (OCR damage) but it was parsed`);
    const ca = e.answers[String(qNum)];
    assert(ca === 'C',
      `Exam ${examNum} Q${qNum}: expected answer key to say C (pointing to lost option)`);
  });
});

// ── Suite 4: Grading logic ─────────────────────────────────────────────────
console.log('\nSuite 4: Grading logic');

test('Selecting the correct answer returns true', () => {
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      const ca = e.answers[String(q.num)];
      if (!ca) return;
      assert(gradeAnswer(e, q.num, ca) === true,
        `Exam ${e.num} Q${q.num}: grading correct answer "${ca}" should return true`);
    });
  });
});

test('Selecting a wrong answer returns false', () => {
  const all = ['A','B','C','D'];
  EXAM_DATA.forEach(e => {
    e.questions.forEach(q => {
      const ca = e.answers[String(q.num)];
      if (!ca) return;
      const wrong = all.find(l => l !== ca && q.options.some(o => o.letter === l));
      if (!wrong) return; // only 1 option (shouldn't happen)
      assert(gradeAnswer(e, q.num, wrong) === false,
        `Exam ${e.num} Q${q.num}: grading wrong answer "${wrong}" should return false`);
    });
  });
});

test('Grading is case-sensitive — lowercase letter returns false', () => {
  const e = EXAM_DATA[0];
  const q = e.questions[0];
  const ca = e.answers[String(q.num)];
  if (ca) {
    assert(gradeAnswer(e, q.num, ca.toLowerCase()) === false,
      `Exam 1 Q1: lowercase answer "${ca.toLowerCase()}" should not match`);
  }
});

test('gradeAnswer with undefined user answer returns false', () => {
  const e = EXAM_DATA[0];
  const q = e.questions[0];
  assert(gradeAnswer(e, q.num, undefined) === false,
    'Undefined answer should return false');
});

test('Score calculation: all correct answers give 100%', () => {
  EXAM_DATA.forEach(e => {
    const userAnswers = {};
    e.questions.forEach(q => { userAnswers[q.num] = e.answers[String(q.num)]; });
    const correct = e.questions.filter(q => gradeAnswer(e, q.num, userAnswers[q.num])).length;
    assertEqual(correct, e.questions.length,
      `Exam ${e.num}: perfect answers should give ${e.questions.length}/${e.questions.length}, got ${correct}`);
  });
});

test('Score calculation: all wrong answers give 0%', () => {
  const all = ['A','B','C','D'];
  EXAM_DATA.forEach(e => {
    const userAnswers = {};
    e.questions.forEach(q => {
      const ca = e.answers[String(q.num)];
      userAnswers[q.num] = all.find(l => l !== ca) ?? 'A';
    });
    const correct = e.questions.filter(q => gradeAnswer(e, q.num, userAnswers[q.num])).length;
    assertEqual(correct, 0,
      `Exam ${e.num}: all wrong answers should give 0, got ${correct}`);
  });
});

// ── Suite 5: Spot-checks (known values from PDF) ───────────────────────────
console.log('\nSuite 5: Spot-checks against known answer key values');

const e1 = EXAM_DATA.find(e => e.num === 1);
const e2 = EXAM_DATA.find(e => e.num === 2);

test('Exam 1 Q1 text contains "GBA"', () => {
  const q = e1.questions.find(q => q.num === 1);
  assert(q && q.text.includes('GBA'), `Exam 1 Q1 text: "${q?.text}"`);
});

test('Exam 1 Q1 correct answer is B', () => {
  assertEqual(e1.answers['1'], 'B', `Exam 1 Q1 answer should be B, got ${e1.answers['1']}`);
});

test('Exam 1 Q6 correct answer is B', () => {
  assertEqual(e1.answers['6'], 'B', `Exam 1 Q6 answer should be B, got ${e1.answers['6']}`);
});

test('Exam 1 Q9 correct answer is A (AOW)', () => {
  assertEqual(e1.answers['9'], 'A', `Exam 1 Q9 answer should be A, got ${e1.answers['9']}`);
});

test('Exam 1 Q40 correct answer is B', () => {
  assertEqual(e1.answers['40'], 'B', `Exam 1 Q40 answer should be B, got ${e1.answers['40']}`);
});

test('Exam 2 Q1 correct answer is A', () => {
  assertEqual(e2.answers['1'], 'A', `Exam 2 Q1 answer should be A, got ${e2.answers['1']}`);
});

test('Exam 2 Q12 correct answer is B (Watersnoodramp 1953)', () => {
  assertEqual(e2.answers['12'], 'B', `Exam 2 Q12 answer should be B, got ${e2.answers['12']}`);
});

test('Exam 1 Q1 option B text contains "Gemeentelijke"', () => {
  const q = e1.questions.find(q => q.num === 1);
  const optB = q?.options.find(o => o.letter === 'B');
  assert(optB && optB.text.includes('Gemeentelijke'),
    `Exam 1 Q1 option B: "${optB?.text}"`);
});

test('Exam 1 Q9 option A text contains "AOW"', () => {
  const q = e1.questions.find(q => q.num === 9);
  const optA = q?.options.find(o => o.letter === 'A');
  assert(optA && optA.text.includes('AOW'), `Exam 1 Q9 option A: "${optA?.text}"`);
});

// ── Report ─────────────────────────────────────────────────────────────────
console.log('\n');
if (failures.length > 0) {
  console.log('FAILURES:');
  failures.forEach(({ description, message }) => {
    console.log(`  ✗ ${description}`);
    console.log(`    ${message}`);
  });
  console.log('');
}
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
