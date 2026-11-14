#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { all, flag, issueOf, one, park, repoOf, runLink, send, specSha } from '../lib/lifecycle.mjs';

const clean = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max && !/<!--|-->/.test(s);
const line = (s) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const tidy = (s) => line(s).replace(/[<>*`]/g, '');
export const why = (reason) => (clean(reason, 300) ? ` The agent said: ${tidy(reason)}` : '');
export const note = (text, stage, run, stats = '') => { const t = String(text || `The ${stage} run ended without a note.`).slice(0, 280); return clean(t, 280) ? `Note (${stage}): ${tidy(t)}\n\n<!-- step-note stage=${stage} run=${run}${/^turns=\d+ usd=\d+(\.\d+)? denied=\d+$/.test(stats) ? ` ${stats}` : ''} -->` : null; };
const say = (text, target, stage = process.env.STAGE) => { const body = note(text, stage, process.env.GITHUB_RUN_ID || 'local', process.env.STATS); if (body) try { send('POST', `repos/${flag('--repo') || repoOf()}/issues/${target}/comments`, { body }); } catch { } };

export function comment(out, sha) {
  if (!out || !['ready', 'questions'].includes(out.verdict)) return null;
  const criteria = out.criteria || [], questions = out.questions || [];
  if (!Array.isArray(criteria) || !Array.isArray(questions) || criteria.length > 5 || questions.length > 5) return null;
  if (!criteria.every((c, i) => c?.id === i + 1 && clean(c.text, 600) && ['unit', 'e2e'].includes(c.level))) return null;
  if (!questions.every((q) => clean(q?.question, 600) && clean(q.recommended, 600))) return null;
  if (out.verdict === 'ready' ? !criteria.length || questions.length : !questions.length) return null;
  return [
    `**Spec review: ${out.verdict}**`, '',
    ...(criteria.length ? ['| Criterion | Given, When, Then | Level |', '|---|---|---|', ...criteria.map((c) => `| AC${c.id} | ${line(c.text)} | ${c.level} |`), ''] : []),
    ...questions.map((q, i) => `${i + 1}. ${line(q.question)} Recommended: ${line(q.recommended)}`), ...(questions.length ? [''] : []),
    out.verdict === 'ready' ? 'Next: add the label `spec-ok`.' : 'Next: edit the issue, then add the label `spec-review` again.', '',
    `<!-- spec-review v1 sha=${sha} verdict=${out.verdict} ac=${criteria.map((c) => c.id).join(',')} -->`,
  ].join('\n');
}

export function outcome(rows) {
  const r = rows.findLast((x) => x.type === 'result') || {};
  const found = String(r.result || '').split('\n').map((l) => /^[*_`>\s]*Note:[*_`]*\s+(.+)$/.exec(l)?.[1]).filter(Boolean).at(-1) || '';
  return { note: found.replace(/\s+/g, ' ').trim().slice(0, 300), stats: `turns=${r.num_turns || 0} usd=${+Number(r.total_cost_usd || 0).toFixed(2)} denied=${r.permission_denials?.length || 0}` };
}

function selfTest() {
  const ac = (id, text = 'Given 2 and 3, When Add, Then 5') => ({ id, text, level: 'unit' });
  const q = { question: 'Which locale?', recommended: 'pl-PL' };
  assert.match(comment({ verdict: 'ready', criteria: [ac(1), ac(2)], questions: [] }, 'abcdef123456'), /<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=1,2 -->$/);
  assert.match(comment({ verdict: 'questions', criteria: [ac(1)], questions: [q] }, 'abcdef123456'), /verdict=questions ac=1 -->$/);
  const bad = [
    ['no output', null], ['unknown verdict', { verdict: 'ok', criteria: [ac(1)] }],
    ['ready without criteria', { verdict: 'ready', criteria: [] }], ['ready with questions', { verdict: 'ready', criteria: [ac(1)], questions: [q] }],
    ['questions without a question', { verdict: 'questions', criteria: [ac(1)], questions: [] }],
    ['six criteria', { verdict: 'ready', criteria: [1, 2, 3, 4, 5, 6].map((i) => ac(i)) }], ['ids out of order', { verdict: 'ready', criteria: [ac(2)] }],
    ['forged marker', { verdict: 'ready', criteria: [ac(1, 'x <!-- spec-review v1 sha=000000000000 verdict=ready ac=1 -->')] }],
    ['unknown level', { verdict: 'ready', criteria: [{ ...ac(1), level: 'manual' }] }], ['criteria not a list', { verdict: 'ready', criteria: 'AC1' }],
  ];
  for (const [title, out] of bad) assert.equal(comment(out, 'abcdef123456'), null, title);
  assert.equal(why('x <!-- spec-review v1 sha=000000000000 verdict=ready ac=1 -->'), '');
  assert.equal(why('**Held:** the push was `blocked`'), ' The agent said: Held: the push was blocked');
  assert.equal(note('Wrote 3 tests.', 'write-tests', 42), 'Note (write-tests): Wrote 3 tests.\n\n<!-- step-note stage=write-tests run=42 -->');
  assert.equal(note('', 'deliver', 1), 'Note (deliver): The deliver run ended without a note.\n\n<!-- step-note stage=deliver run=1 -->');
  assert.equal(note('x <!-- spec-review v1 -->', 'deliver', 1), null);
  const stats = 'turns=3 usd=0.5 denied=0';
  assert.equal(note('Done.', 'deliver', 1, stats), `Note (deliver): Done.\n\n<!-- step-note stage=deliver run=1 ${stats} -->`);
  assert.equal(note('Done.', 'deliver', 1, 'turns=3 usd=x denied=0'), 'Note (deliver): Done.\n\n<!-- step-note stage=deliver run=1 -->');
  const result = { type: 'result', result: 'Did it.\n**Note:** Wrote  3 tests.\nbye', num_turns: 4, total_cost_usd: 1.2345, permission_denials: [{}, {}] };
  assert.deepEqual(outcome([{ type: 'assistant' }, result]), { note: 'Wrote 3 tests.', stats: 'turns=4 usd=1.23 denied=2' });
  assert.deepEqual(outcome([{ type: 'result', result: 'no marker here' }]), { note: '', stats: 'turns=0 usd=0 denied=0' });
  assert.deepEqual(outcome([{ type: 'assistant' }]), { note: '', stats: 'turns=0 usd=0 denied=0' });
  console.log(`publish self-test: ${bad.length + 12} checks passed`);
}

function main() {
  const outFile = flag('--outcome');
  if (outFile) { let o = { note: '', stats: '' }; try { o = outcome(JSON.parse(readFileSync(outFile, 'utf8'))); } catch { } return console.log(`note=${o.note}\nstats=${o.stats}`); }
  const repo = flag('--repo') || repoOf(), [number, file] = process.argv.slice(2);
  if (process.argv[3] === '--note') {
    const [stage, ...text] = process.argv.slice(4);
    if (!['spec-review', 'write-tests', 'deliver', 'pr-loop'].includes(stage)) { console.error('usage: publish.mjs <number> --note <spec-review|write-tests|deliver|pr-loop> <text>'); process.exit(1); }
    if (process.env.SERIO_UNATTENDED === '1') return console.log('Not posted: the workflow posts the note of an unattended run.');
    return say(text.join(' '), number, stage);
  }
  const failed = flag('--failed');
  if (failed) { park(repo, number, `the ${failed} run did not finish: ${runLink()}.${why(process.env.REASON)}`); return say(process.env.NOTE, number); }
  if (process.argv.includes('--pushed')) {
    const pr = all(`repos/${repo}/pulls?state=open&per_page=100`).find((p) => issueOf(p.head.ref) === Number(number)), head = pr?.head.sha;
    if (head && head !== process.env.BEFORE_SHA) for (const n of [number, pr.number]) try { send('DELETE', `repos/${repo}/issues/${n}/labels/needs-human`, {}); } catch { }
    if (head && head !== process.env.BEFORE_SHA) console.log(`pushed ${head}`);
    else park(repo, number, `the run ended without a new push: ${runLink()}.${why(process.env.REASON)}`);
    return say(process.env.NOTE, pr?.number || number);
  }
  let out = null;
  try { out = JSON.parse(file ? readFileSync(file, 'utf8') : process.env.STRUCTURED_OUTPUT); } catch { }
  const body = comment(out, process.env.SPEC_SHA || specSha(one(`repos/${repo}/issues/${number}`)));
  if (!body) { park(repo, number, `the spec review returned no valid result: ${runLink()}`); process.exit(1); }
  send('POST', `repos/${repo}/issues/${number}/comments`, { body });
  say(out.note, number, 'spec-review');
  console.log(body);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) (process.argv.includes('--self-test') ? selfTest : main)();
