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

const PROGRESS_FILE            = path.join(__dirname, 'explanations_progress.json');
const OUTPUT_FILE              = path.join(__dirname, 'explanations.js');
const TRANSLATIONS_PROGRESS    = path.join(__dirname, 'translations_progress.json');
const TRANSLATIONS_OUTPUT      = path.join(__dirname, 'translations.js');
const EXAM_DATA_FILE           = path.join(__dirname, 'exam_data.js');

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

// ── Write explanations output ─────────────────────────────────────────────────
function writeOutput() {
  const compact = JSON.stringify(progress, null, 0);
  const js = `// Auto-generated by generate_explanations.js — do not edit by hand.\n// ${Object.keys(progress).length} explanations for KNM exam questions.\nconst EXPLANATIONS = ${compact};\n`;
  fs.writeFileSync(OUTPUT_FILE, js);
  console.log(`\nWritten to ${OUTPUT_FILE} (${Object.keys(progress).length} explanations, ${js.length} bytes)`);
}

// ── Translation generation ────────────────────────────────────────────────────
async function generateTranslation(task, attempt = 1) {
  const { examNum, q } = task;
  const emptySlots = q.options.map(o => `"${o.letter}":""`).join(',');
  const dutchOptions = q.options.map(o => `${o.letter}) ${o.text}`).join('\n');

  const prompt = `Translate this Dutch civic integration (KNM) exam question and all answer options into natural English.
Return ONLY valid JSON with this exact structure — no markdown, no explanation:
{"question":"","options":{${emptySlots}}}

Dutch question: ${q.text}
Options:
${dutchOptions}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (resp.status === 429 || resp.status >= 500) {
    if (attempt <= RETRY_LIMIT) {
      const delay = RETRY_DELAY * attempt;
      console.log(`  Rate limited on Exam ${examNum} Q${q.num} translation — retry ${attempt} in ${delay}ms`);
      await sleep(delay);
      return generateTranslation(task, attempt + 1);
    }
    throw new Error(`HTTP ${resp.status} after ${RETRY_LIMIT} retries`);
  }

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  const raw = data.content[0].text.trim();
  // Strip markdown code fences if present
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(jsonStr); // validate it's real JSON
}

function writeTranslationsOutput(translationProgress) {
  const compact = JSON.stringify(translationProgress, null, 0);
  const js = `// Auto-generated by generate_explanations.js — do not edit by hand.\n// ${Object.keys(translationProgress).length} translations for KNM exam questions.\nconst TRANSLATIONS = ${compact};\n`;
  fs.writeFileSync(TRANSLATIONS_OUTPUT, js);
  console.log(`Written to ${TRANSLATIONS_OUTPUT} (${Object.keys(translationProgress).length} translations, ${js.length} bytes)`);
}

async function runTranslations() {
  let translationProgress = {};
  if (fs.existsSync(TRANSLATIONS_PROGRESS)) {
    translationProgress = JSON.parse(fs.readFileSync(TRANSLATIONS_PROGRESS, 'utf8'));
    const done = Object.keys(translationProgress).length;
    console.log(`\nTranslations: resuming — ${done} already done, ${allTasks.length - done} remaining.`);
  } else {
    console.log(`\nStarting translation generation for ${allTasks.length} questions...`);
  }

  const pending = allTasks.filter(t => !translationProgress[cacheKey(t.examNum, t.q.num)]);
  if (pending.length === 0) {
    console.log('All translations already generated.');
    writeTranslationsOutput(translationProgress);
    return;
  }

  let completed = Object.keys(translationProgress).length;
  let errors = 0;
  const total = allTasks.length;

  async function worker(tasks) {
    for (const task of tasks) {
      const key = cacheKey(task.examNum, task.q.num);
      if (translationProgress[key]) { completed++; continue; }
      try {
        translationProgress[key] = await generateTranslation(task);
        completed++;
        fs.writeFileSync(TRANSLATIONS_PROGRESS, JSON.stringify(translationProgress, null, 2));
        const pct = ((completed / total) * 100).toFixed(1);
        process.stdout.write(`\r  [${pct}%] ${completed}/${total} translations done, ${errors} errors   `);
      } catch (err) {
        errors++;
        console.error(`\n  Translation error on Exam ${task.examNum} Q${task.q.num}: ${err.message}`);
      }
    }
  }

  // Divide pending tasks across workers
  const chunkSize = Math.ceil(pending.length / CONCURRENCY);
  const chunks = Array.from({ length: CONCURRENCY }, (_, i) =>
    pending.slice(i * chunkSize, (i + 1) * chunkSize)
  );
  await Promise.all(chunks.map(worker));
  console.log(`\nTranslations finished: ${completed} done, ${errors} errors.`);

  writeTranslationsOutput(translationProgress);

  if (Object.keys(translationProgress).length >= allTasks.length) {
    if (fs.existsSync(TRANSLATIONS_PROGRESS)) fs.unlinkSync(TRANSLATIONS_PROGRESS);
    console.log('Translations progress file removed (all done).');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  // ── Pass 1: Explanations ─────────────────────────────────────────────────
  const pending = allTasks.filter(t => !progress[cacheKey(t.examNum, t.q.num)]);
  console.log(`Explanations — Pending: ${pending.length}  |  Concurrency: ${CONCURRENCY}  |  Model: ${MODEL}\n`);

  if (pending.length > 0) {
    await runPool(allTasks, CONCURRENCY);
  } else {
    console.log('All explanations already generated.');
  }

  writeOutput();

  const totalExpected = allTasks.length;
  const totalDone = Object.keys(progress).length;
  if (totalDone >= totalExpected && fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('Explanations progress file removed (all done).');
  }

  // ── Pass 2: Translations ──────────────────────────────────────────────────
  await runTranslations();
})();
