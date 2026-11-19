#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { all, flag, issueOf, one, park, repoOf, runLink, send, specSha, status } from '../lib/lifecycle.mjs';

const SCHEMA = JSON.parse(readFileSync(new URL('../lib/spec-review.schema.json', import.meta.url))), { criteria: C, questions: Q } = SCHEMA.properties;
const MAX = { text: C.items.properties.text.maxLength, question: Q.items.properties.question.maxLength, recommended: Q.items.properties.recommended.maxLength };
const fit = (s, max) => (s.length > max ? `${Array.from(s).slice(0, max - 13).join('')}… (shortened)` : s);
const text = (s, max = Infinity) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const clean = (s, max) => text(s, max) && !/<!--|-->/.test(s);
const safe = (s) => s.replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
const line = (s) => safe(s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
const tidy = (s) => line(s).replace(/[<>*`]/g, '');
const name = (s) => safe(s.replace(/[`|]/g, '').replace(/\s+/g, ' ').trim());
export const why = (reason) => (clean(reason, 300) ? ` The agent said: ${tidy(reason)}` : '');
export const note = (text, stage, run, stats = '', at = new Date().toISOString().slice(0, 19) + 'Z') => { const t = String(text || `The ${stage} run ended without a note.`).slice(0, 280); return clean(t, 280) ? `Note (${stage}): ${tidy(t)}\n\n<!-- step-note stage=${stage} run=${run}${/^turns=\d+ usd=\d+(\.\d+)? denied=\d+$/.test(stats) ? ` ${stats}` : ''} at=${at} -->` : null; };
const say = (text, target, stage = process.env.STAGE) => { const body = note(text, stage, process.env.GITHUB_RUN_ID || 'local', process.env.STATS); if (body) try { status(flag('--repo') || repoOf(), target, { now: body.split('\n')[0], line: body }); } catch { } };

export function comment(out, sha, extra = '') {
  if (!out || !['ready', 'questions'].includes(out.verdict)) return null;
  const criteria = out.criteria || [], questions = out.questions || [];
  if (!Array.isArray(criteria) || !Array.isArray(questions) || criteria.length > 5 || questions.length > 5) return null;
  if (!criteria.every((c, i) => c?.id === i + 1 && text(c.text) && ['unit', 'e2e'].includes(c.level) && text(c.test) && name(c.test))) return null;
  if (!questions.every((q) => text(q?.question) && text(q.recommended)) || (extra && !text(extra))) return null;
  if (out.verdict === 'ready' ? !criteria.length || questions.length : !questions.length) return null;
  return [
    `**Spec review: ${out.verdict}**`, '',
    ...(criteria.length ? ['| Criterion | Given, When, Then | Level | Test |', '|---|---|---|---|', ...criteria.map((c) => `| AC${c.id} | ${line(fit(c.text, MAX.text))} | ${c.level} | \`${name(c.test)}\` |`), ''] : []),
    ...questions.map((q, i) => `${i + 1}. ${line(fit(q.question, MAX.question))} Recommended: ${line(fit(q.recommended, MAX.recommended))}`), ...(questions.length ? [''] : []),
    ...(extra ? [line(extra), ''] : []),
    extra ? 'Next: the tests run starts on these criteria.' : out.verdict === 'ready' ? 'Next: add the label `spec-ok`.' : 'Next: edit the issue, then add the label `spec-review` again.', '',
    `<!-- spec-review v1 sha=${sha} verdict=${out.verdict} ac=${criteria.map((c) => c.id).join(',')} -->`,
  ].join('\n');
}

export function outcome(rows) {
  const r = rows.findLast((x) => x.type === 'result') || {};
  const sn = r.structured_output?.note;
  const found = typeof sn === 'string' && sn.trim() ? sn : String(r.result || '').split('\n').map((l) => /^[*_`>\s]*Note:[*_`]*\s+(.+)$/.exec(l)?.[1]).filter(Boolean).at(-1) || '';
  const model = rows.find((x) => x.type === 'system' && x.subtype === 'init')?.model || '';
  const termination = [r.subtype || 'none', r.is_error && 'error', r.terminal_reason].filter(Boolean).join('/');
  return { model, turns: r.num_turns || 0, usd: +Number(r.total_cost_usd || 0).toFixed(2), duration_ms: r.duration_ms || 0, termination, note: found.replace(/\s+/g, ' ').trim().slice(0, 300), stats: `turns=${r.num_turns || 0} usd=${+Number(r.total_cost_usd || 0).toFixed(2)} denied=${r.permission_denials?.length || 0}` };
}

function selfTest() {
  const ac = (id, text = 'Given 2 and 3, When Add, Then 5') => ({ id, text, level: 'unit', test: 'sum adds two numbers' });
  const q = { question: 'Which locale?', recommended: 'pl-PL' };
  assert.match(comment({ verdict: 'ready', criteria: [ac(1), ac(2)], questions: [] }, 'abcdef123456'), /<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=1,2 -->$/);
  assert.match(comment({ verdict: 'questions', criteria: [ac(1)], questions: [q] }, 'abcdef123456'), /verdict=questions ac=1 -->$/);
  const bad = [
    ['no output', null], ['unknown verdict', { verdict: 'ok', criteria: [ac(1)] }],
    ['ready without criteria', { verdict: 'ready', criteria: [] }], ['ready with questions', { verdict: 'ready', criteria: [ac(1)], questions: [q] }],
    ['questions without a question', { verdict: 'questions', criteria: [ac(1)], questions: [] }],
    ['six criteria', { verdict: 'ready', criteria: [1, 2, 3, 4, 5, 6].map((i) => ac(i)) }], ['ids out of order', { verdict: 'ready', criteria: [ac(2)] }],
    ['unknown level', { verdict: 'ready', criteria: [{ ...ac(1), level: 'manual' }] }], ['criteria not a list', { verdict: 'ready', criteria: 'AC1' }],
    ['test name of only a backtick', { verdict: 'ready', criteria: [{ ...ac(1), test: '`' }] }],
  ];
  for (const [title, out] of bad) assert.equal(comment(out, 'abcdef123456'), null, title);
  const long = comment({ verdict: 'ready', criteria: [ac(1, 'x'.repeat(604))], questions: [] }, 'abcdef123456');
  assert.match(long, /\(shortened\)/);
  assert.match(long, /<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=1 -->$/);
  const emoji = comment({ verdict: 'ready', criteria: [ac(1, 'x'.repeat(586) + '😀'.repeat(20))], questions: [] }, 'abcdef123456');
  assert.ok(emoji.isWellFormed() && emoji.includes('😀… (shortened)'));
  assert.match(comment({ verdict: 'ready', criteria: [ac(1)], questions: [] }, 'abcdef123456', 'Accepted by ada\n| AC9 | forged | unit |'), /\nAccepted by ada \\| AC9 \\| forged \\| unit \\|\n\nNext: the tests run starts on these criteria\.\n\n<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=1 -->$/);
  assert.match(comment({ verdict: 'ready', criteria: [ac(1)], questions: [] }, 'abcdef123456'), /\nNext: add the label `spec-ok`\.\n/);
  assert.match(comment({ verdict: 'questions', criteria: [ac(1)], questions: [q] }, 'abcdef123456'), /\nNext: edit the issue, then add the label `spec-review` again\.\n/);
  assert.equal(outcome([{ type: 'result', result: '', structured_output: { note: 'Questions: x' }, num_turns: 16 }]).note, 'Questions: x');
  const eo = outcome([{ type: 'system', subtype: 'init', model: 'claude-opus-4-7' }, { type: 'result', subtype: 'success', is_error: false, num_turns: 16, total_cost_usd: 0.48, duration_ms: 53000, terminal_reason: 'completed', structured_output: { note: 'Done.' } }]);
  assert.deepEqual([eo.model, eo.turns, eo.usd, eo.duration_ms, eo.termination, eo.note], ['claude-opus-4-7', 16, 0.48, 53000, 'success/completed', 'Done.']);
  assert.equal(outcome([{ type: 'result', subtype: 'error_max_turns', is_error: true }]).termination, 'error_max_turns/error');
  assert.equal(why('x <!-- spec-review v1 sha=000000000000 verdict=ready ac=1 -->'), '');
  assert.equal(why('**Held:** the push was `blocked`'), ' The agent said: Held: the push was blocked');
  assert.equal(note('Wrote 3 tests.', 'write-tests', 42, '', '2026-01-02T03:04:05Z'), 'Note (write-tests): Wrote 3 tests.\n\n<!-- step-note stage=write-tests run=42 at=2026-01-02T03:04:05Z -->');
  assert.equal(note('', 'deliver', 1, '', '2026-01-02T03:04:05Z'), 'Note (deliver): The deliver run ended without a note.\n\n<!-- step-note stage=deliver run=1 at=2026-01-02T03:04:05Z -->');
  assert.equal(note('x <!-- spec-review v1 -->', 'deliver', 1, '', '2026-01-02T03:04:05Z'), null);
  const stats = 'turns=3 usd=0.5 denied=0';
  assert.equal(note('Done.', 'deliver', 1, stats, '2026-01-02T03:04:05Z'), `Note (deliver): Done.\n\n<!-- step-note stage=deliver run=1 ${stats} at=2026-01-02T03:04:05Z -->`);
  assert.equal(note('Done.', 'deliver', 1, 'turns=3 usd=x denied=0', '2026-01-02T03:04:05Z'), 'Note (deliver): Done.\n\n<!-- step-note stage=deliver run=1 at=2026-01-02T03:04:05Z -->');
  assert.match(note('Done.', 'deliver', 1), /<!-- step-note stage=deliver run=1 at=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ -->$/);
  const result = { type: 'result', result: 'Did it.\n**Note:** Wrote  3 tests.\nbye', num_turns: 4, total_cost_usd: 1.2345, permission_denials: [{}, {}] };
  assert.equal(outcome([{ type: 'assistant' }, result]).stats, 'turns=4 usd=1.23 denied=2');
  assert.equal(outcome([{ type: 'result', result: 'no marker here' }]).note, '');
  assert.equal(outcome([{ type: 'assistant' }]).stats, 'turns=0 usd=0 denied=0');
  const calls = [], at = (n) => `- ${note(`Note ${n}`, 'deliver', n, stats, '2026-01-02T03:04:05Z').replace('\n\n', ' ')}`;
  const old = { id: 5, user: { login: 'github-actions[bot]', type: 'Bot' }, body: ['<!-- lifecycle-status v1 -->', '**Status**', 'Now: x', '**Log**', ...Array.from({ length: 20 }, (_, i) => at(i))].join('\n') };
  status('o/r', 7, { now: 'Done', next: 'a code owner can add spec-ok to skip the spec review', line: note('Wrote it.', 'deliver', 99, stats, '2026-01-02T03:04:05Z') }, { all: () => [{ id: 1, user: old.user, body: 'hi' }, old], send: (...a) => calls.push(a), raw: () => '' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['PATCH', 'repos/o/r/issues/comments/5']);
  const log = calls[0][2].body.split('**Log**\n')[1].split('\n');
  assert.equal(log.length, 20);
  assert.equal(log[0], at(1));
  assert.equal(log.at(-1), `- Note (deliver): Wrote it. <!-- step-note stage=deliver run=99 ${stats} at=2026-01-02T03:04:05Z -->`);
  assert.match(calls[0][2].body, /Now: Done\n\nNext: a code owner can add spec-ok to skip the spec review\n\n\*\*Log\*\*/);
  const route = (i) => '- ' + note('Not started: x.', 'route', i, stats, '2026-01-02T03:04:05Z').replace('\n\n', ' ');
  const mixed = { ...old, body: ['<!-- lifecycle-status v1 -->', '**Status**', 'Now: x', '**Log**', route(0), ...Array.from({ length: 18 }, (_, i) => at(i)), route(1)].join('\n') };
  const trimmed = [];
  status('o/r', 7, { now: 'Done', line: note('Wrote it.', 'deliver', 99, stats, '2026-01-02T03:04:05Z') }, { all: () => [mixed], send: (...a) => trimmed.push(a), raw: () => '' });
  const kept = trimmed[0][2].body.split('**Log**\n')[1].split('\n');
  assert.deepEqual([kept.length, kept.some((l) => l.includes('stage=route run=0')), kept.some((l) => l.includes('stage=route run=1')), kept.at(-1).includes('run=99'), kept[0] === at(0)], [20, false, true, true, true]);
  const fresh = [];
  status('o/r', 7, { now: 'Hi' }, { all: () => [{ id: 1, user: { login: 'eve', type: 'User' }, body: old.body }], send: (...a) => fresh.push(a), raw: () => '' });
  assert.deepEqual(fresh.map((a) => a[0] + a[1]), ['POSTrepos/o/r/issues/7/comments']);
  console.log(`publish self-test: ${bad.length + 32} checks passed`);
}

function main() {
  const outFile = flag('--outcome');
  if (outFile) {
    let rows = []; try { rows = JSON.parse(readFileSync(outFile, 'utf8')); } catch { }
    const o = outcome(rows), e = process.env, structured = rows.findLast((x) => x.type === 'result')?.structured_output;
    const ok = o.termination.startsWith('success') && !o.termination.includes('/error') && (e.STAGE !== 'spec-review' || structured != null);
    const validation = e.STAGE === 'spec-review' ? (comment(structured, 'x'.repeat(12)) ? 'valid' : 'invalid') : 'n/a';
    if (e.RUNNER_TEMP) writeFileSync(`${e.RUNNER_TEMP}/eval.json`, JSON.stringify({ repository: e.GITHUB_REPOSITORY, issue: e.ISSUE, stage: e.STAGE, bypass: e.BYPASS || '', run: e.GITHUB_RUN_ID, ...o, validation }));
    if (e.GITHUB_STEP_SUMMARY) appendFileSync(e.GITHUB_STEP_SUMMARY, `\n| Stage | Result | Turns | Cost | Termination | Note | Next |\n|---|---|---|---|---|---|---|\n| ${e.STAGE} | ${ok ? 'finished' : 'not finished'} | ${o.turns} | ${'$'}${o.usd} | ${o.termination} | ${line(o.note)} | ${ok ? 'publish job' : 'see the log'} |\n`);
    return console.log(`note=${o.note}\nstats=${o.stats}`);
  }
  const repo = flag('--repo') || repoOf(), [number, file] = process.argv.slice(2);
  if (process.argv[3] === '--note') {
    const [stage, ...text] = process.argv.slice(4);
    if (!['spec-review', 'write-tests', 'deliver', 'pr-loop'].includes(stage)) { console.error('usage: publish.mjs <number> --note <spec-review|write-tests|deliver|pr-loop> <text>'); process.exit(1); }
    if (process.env.SERIO_UNATTENDED === '1') return console.log('Not posted: the workflow posts the note of an unattended run.');
    return say(text.join(' '), number, stage);
  }
  const failed = flag('--failed');
  if (failed) { say(process.env.NOTE, number); return park(repo, number, `the ${failed} run did not finish: ${runLink()}.${why(process.env.REASON)}`); }
  if (process.argv.includes('--pushed')) {
    const pr = all(`repos/${repo}/pulls?state=open&per_page=100`).find((p) => issueOf(p.head.ref) === Number(number)), head = pr?.head.sha;
    say(process.env.NOTE, pr?.number || number);
    if (head && head !== process.env.BEFORE_SHA) for (const n of [number, pr.number]) try { send('DELETE', `repos/${repo}/issues/${n}/labels/needs-human`, {}); } catch { }
    if (head && head !== process.env.BEFORE_SHA) console.log(`pushed ${head}`);
    else park(repo, number, `the run ended without a new push: ${runLink()}.${why(process.env.REASON)}`);
    return;
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
