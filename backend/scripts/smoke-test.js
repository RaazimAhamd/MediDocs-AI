/**
 * End-to-end check against a RUNNING backend (and real Ollama):
 *   npm run smoke                       (backend must be running on http://127.0.0.1:3000)
 *   npm run smoke -- --base http://127.0.0.1:3000 --cleanup
 * Uploads the fictional sample documents, waits for processing, asks the questions in
 * sample-documents/expected-questions.json and checks the retrieved source passages.
 * Exit code 0 = all hard checks passed. Soft checks (answer wording) are reported as warnings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SAMPLE_DIR, evaluate, loadExpected, mimeFor } from './lib/expected.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = option('--base', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const model = option('--model', undefined);
const waitMs = Number(option('--wait-seconds', '600')) * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (url, init) => {
  const res = await fetch(`${base}/api${url}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};

async function main() {
  const expected = loadExpected();

  const health = await api('/health').catch(() => null);
  if (!health) throw new Error(`Backend not reachable at ${base}. Start it first (start.bat or "npm start" in backend).`);
  if (!health.body.ollama?.ready) {
    throw new Error(`Ollama is not ready: ${health.body.ollama?.message ?? `missing models: ${health.body.ollama?.missingModels?.join(', ')}`}`);
  }
  console.log(`Backend OK, Ollama ${health.body.ollama.version}\n`);

  const existing = (await api('/documents')).body.documents;
  const createdIds = [];
  for (const rel of expected.documents) {
    const name = path.basename(rel);
    let doc = existing.find((d) => d.name === name && d.status === 'ready');
    if (!doc) {
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(path.join(SAMPLE_DIR, rel))], { type: mimeFor(rel) }), name);
      const up = await api('/documents', { method: 'POST', body: form });
      if (up.status !== 202) throw new Error(`Upload of ${name} failed: ${JSON.stringify(up.body)}`);
      doc = up.body.document;
      createdIds.push(doc.id);
      console.log(`Uploaded ${name}`);
    } else {
      console.log(`Reusing ${name}`);
    }
    const start = Date.now();
    for (;;) {
      const s = (await api(`/documents/${doc.id}/status`)).body;
      if (s.status === 'ready') break;
      if (s.status === 'failed') throw new Error(`${name} failed to process: ${s.error?.message}`);
      if (Date.now() - start > waitMs) throw new Error(`Timed out waiting for ${name}`);
      process.stdout.write(`  ${name}: ${s.stage}${s.progress ? ` ${s.progress.done}/${s.progress.total}` : ''}\r`);
      await sleep(1000);
    }
  }

  let hardFailures = 0;
  let warnings = 0;
  console.log('');
  for (const q of expected.questions) {
    const t0 = Date.now();
    const res = await api('/chat/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q.question, ...(model ? { model } : {}) }),
    });
    if (res.status !== 200) {
      hardFailures++;
      console.log(`FAIL ${q.id} ${q.question}\n     HTTP ${res.status}: ${res.body.error?.message}\n`);
      continue;
    }
    const { hard, soft } = evaluate(q, res.body);
    const label = hard.length ? 'FAIL' : soft.length ? 'WARN' : 'PASS';
    if (hard.length) hardFailures++;
    if (soft.length) warnings++;
    console.log(`${label} ${q.id} ${q.question}  (${((Date.now() - t0) / 1000).toFixed(1)}s, grounded=${res.body.grounded}, best score ${res.body.retrieval.bestScore})`);
    console.log(`     answer: ${res.body.answer.replace(/\s+/g, ' ').slice(0, 220)}`);
    const sources = res.body.sources.map((s) => `${s.documentName}${s.page ? ` p.${s.page}` : ` #${s.chunkIndex + 1}`} (${s.score})`);
    if (sources.length) console.log(`     sources: ${sources.join('; ')}`);
    for (const m of hard) console.log(`     ✗ ${m}`);
    for (const m of soft) console.log(`     ! ${m}`);
    console.log('');
  }

  if (flag('--cleanup')) {
    for (const id of createdIds) await api(`/documents/${id}`, { method: 'DELETE' });
    console.log(`Removed ${createdIds.length} document(s) uploaded by this run.`);
  }
  console.log(`${expected.questions.length} questions: ${expected.questions.length - hardFailures} passed hard checks, ${hardFailures} failed, ${warnings} with wording warnings.`);
  process.exit(hardFailures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nSmoke test could not run: ${err.message}`);
  process.exit(2);
});
