import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_DIR = path.resolve(fileURLToPath(new URL('../../../sample-documents', import.meta.url)));

export function loadExpected() {
  return JSON.parse(fs.readFileSync(path.join(SAMPLE_DIR, 'expected-questions.json'), 'utf8'));
}

export const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

export function mimeFor(file) {
  return file.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain';
}

/**
 * Evaluate one /api/chat/ask response against an expected-question entry.
 * hard = failures that mean retrieval/grounding is wrong, soft = LLM wording differences.
 */
export function evaluate(q, result) {
  const hard = [];
  const soft = [];
  if (typeof q.expectGrounded === 'boolean' && result.grounded !== q.expectGrounded) {
    hard.push(`expected grounded=${q.expectGrounded} but got ${result.grounded} (${result.reason})`);
  }
  if (q.expectedSnippets?.length) {
    const haystack = norm(result.sources.map((s) => s.text).join(' '));
    for (const snippet of q.expectedSnippets) {
      if (!haystack.includes(norm(snippet))) hard.push(`retrieved passages do not contain "${snippet}"`);
    }
    if (q.expectedDocument && !result.sources.some((s) => s.documentName === q.expectedDocument)) {
      hard.push(`no retrieved passage came from ${q.expectedDocument}`);
    }
    if (q.expectedPage) {
      const match = result.sources.find(
        (s) => s.documentName === q.expectedDocument && q.expectedSnippets.every((sn) => norm(s.text).includes(norm(sn))),
      );
      if (match && match.page !== q.expectedPage) hard.push(`snippet found on page ${match.page}, expected page ${q.expectedPage}`);
    }
  }
  const answer = norm(result.answer);
  for (const hint of q.expectedAnswerHints ?? []) {
    if (!answer.includes(norm(hint))) soft.push(`answer does not mention "${hint}"`);
  }
  for (const bad of q.answerMustNotContain ?? []) {
    if (answer.includes(norm(bad))) hard.push(`answer contains forbidden text "${bad}"`);
  }
  return { hard, soft };
}
