/**
 * generate_explanations.js
 *
 * Pre-generates an English explanation for every KNM exam question and
 * writes them to explanations.js, which the exam page loads as a static
 * script — no API key needed at runtime.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node generate_explanations.js
 *
 * The script is resumable: progress is saved to explanations_progress.json
 * after every question. Re-run after an interruption and it picks up where
 * it left off.
 *
 * Tune CONCURRENCY to match your API tier's requests-per-minute limit.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const API_KEY      = process.env.ANTHROPIC_API_KEY;
const MODEL        = 'claude-haiku-4-5-20251001';
const MAX_TOKENS   = 220;
const CONCURRENCY  = 5;   // parallel requests at a time
const RETRY_LIMIT  = 3;
const RETRY_DELAY  = 2000; // ms between retries

const PROGRESS_FILE     = path.join(__dirname, 'explanations_progress.json');
const OUTPUT_FILE       = path.join(__dirname, 'explanations.js');
const EXAM_DATA_FILE    = path.join(__dirname, 'exam_data.js');

// ── Load exam data ───────────────────────────────────────────────────────────
if (!API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
  console.error('Run as:  ANTHROPIC_API_KEY=sk-ant-... node generate_explanations.js');
  process.exit(1);
}

let EXAM_DATA;
eval(fs.readFileSync(EXAM_DATA_FILE, 'utf8').replace('const EXAM_DATA', 'EXAM_DATA'));

// Build a flat list of all questions that need explanations
const allTasks = [];
for (const exam of EXAM_DATA) {
  for (const q of exam.questions) {
    const correctLetter = exam.answers[String(q.num)];
    if (!correctLetter) continue; // skip OCR-damaged questions with no key
    allTasks.push({ examNum: exam.num, q, correctLetter, exam });
  }
}

console.log(`Total questions to explain: ${allTasks.length}`);

// ── Load progress ────────────────────────────────────────────────────────────
let progress = {};
if (fs.existsSync(PROGRESS_FILE)) {
  progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  const done = Object.keys(progress).length;
  console.log(`Resuming — ${done} already done, ${allTasks.length - done} remaining.`);
}

function cacheKey(examNum, qNum) {
  return `${examNum}-${qNum}`;
}

function saveProgress() {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ── API call ─────────────────────────────────────────────────────────────────
async function generateExplanation(task, attempt = 1) {
  const { examNum, q, correctLetter, exam } = task;
  const correctOpt = q.options.find(o => o.letter === correctLetter);
  const optionsList = q.options.map(o => `${o.letter}) ${o.text}`).join('\n');

  const prompt = `You are helping immigrants study for the KNM exam (Kennis van de Nederlandse Maatschappij — Knowledge of Dutch Society), a civic integration test required in the Netherlands.

Question (in Dutch): ${q.text}
Options:
${optionsList}
Correct answer: ${correctLetter}) ${correctOpt ? correctOpt.text : ''}

In 2–3 sentences in English, explain why this is the correct answer. Give the learner useful context about Dutch law, culture, or society to help them understand and remember it. Be concise and educational.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (resp.status === 429 || resp.status >= 500) {
    if (attempt <= RETRY_LIMIT) {
      const delay = RETRY_DELAY * attempt;
      console.log(`  Rate limited / server error on Exam ${examNum} Q${q.num} — retry ${attempt} in ${delay}ms`);
      await sleep(delay);
      return generateExplanation(task, attempt + 1);
    }
    throw new Error(`HTTP ${resp.status} after ${RETRY_LIMIT} retries`);
  }

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.content[0].text.trim();
}

// ── Worker pool ───────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runPool(tasks, concurrency) {
  let index = 0;
  let completed = 0;
  let errors = 0;
  const total = tasks.length;

  async function worker() {
    while (index < tasks.length) {
      const task = tasks[index++];
      const key = cacheKey(task.examNum, task.q.num);

      if (progress[key]) {
        completed++;
        continue;
      }

      try {
        const explanation = await generateExplanation(task);
        progress[key] = explanation;
        completed++;
        saveProgress();

        const pct = ((completed / total) * 100).toFixed(1);
        process.stdout.write(`\r  [${pct}%] ${completed}/${total} done, ${errors} errors   `);
      } catch (err) {
        errors++;
        console.error(`\n  Error on Exam ${task.examNum} Q${task.q.num}: ${err.message}`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  console.log(`\nFinished: ${completed} done, ${errors} errors.`);
}

// ── Write output ──────────────────────────────────────────────────────────────
function writeOutput() {
  const compact = JSON.stringify(progress, null, 0);
  const js = `// Auto-generated by generate_explanations.js — do not edit by hand.\n// ${Object.keys(progress).length} explanations for KNM exam questions.\nconst EXPLANATIONS = ${compact};\n`;
  fs.writeFileSync(OUTPUT_FILE, js);
  console.log(`\nWritten to ${OUTPUT_FILE} (${Object.keys(progress).length} explanations, ${js.length} bytes)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const pending = allTasks.filter(t => !progress[cacheKey(t.examNum, t.q.num)]);
  console.log(`Pending: ${pending.length} questions  |  Concurrency: ${CONCURRENCY}  |  Model: ${MODEL}\n`);

  if (pending.length > 0) {
    await runPool(allTasks, CONCURRENCY);
  } else {
    console.log('All explanations already generated.');
  }

  writeOutput();

  // Clean up progress file once complete
  const totalExpected = allTasks.length;
  const totalDone = Object.keys(progress).length;
  if (totalDone >= totalExpected) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('Progress file removed (all done).');
  }
})();
