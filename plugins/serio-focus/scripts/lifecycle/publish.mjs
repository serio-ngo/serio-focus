#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace as traced } from '../trace.mjs';
import { scan } from '../lib/gitleaks.mjs';
import { all, flag, one, park, raw, redact, repoOf, runLink, send, specSha, status, taskOf, TESTS_PARK } from '../lib/lifecycle.mjs';

const SCHEMA = JSON.parse(readFileSync(new URL('../lib/spec-review.schema.json', import.meta.url))), { criteria: C, questions: Q } = SCHEMA.properties;
const MAX = { text: C.items.properties.text.maxLength, question: Q.items.properties.question.maxLength, recommended: Q.items.properties.recommended.maxLength };
const fit = (s, max) => (s.length > max ? `${Array.from(s).slice(0, max - 13).join('')}… (shortened)` : s);
const text = (s, max = Infinity) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const clean = (s, max) => text(s, max) && !/<!--|-->/.test(s);
const safe = (s) => s.replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
const line = (s) => safe(s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
const tidy = (s) => line(s).replace(/[<>*`]/g, '');
const name = (s) => safe(s.replace(/[`|]/g, '').replace(/\s+/g, ' ').trim());
export const why = (reason) => (clean(reason, 300) ? ` The agent said: ${tidy(redact(reason))}` : '');
export const note = (text, stage, run, stats = '', at = new Date().toISOString().slice(0, 19) + 'Z') => { const t = redact(String(text || `The ${stage} run ended without a note.`)).slice(0, 280); return clean(t, 280) ? `Note (${stage}): ${tidy(t)}\n\n<!-- step-note stage=${stage} run=${run}${/^turns=\d+ usd=\d+(\.\d+)? denied=\d+$/.test(stats) ? ` ${stats}` : ''} at=${at} -->` : null; };
const say = (text, target, stage = process.env.STAGE, io, repo) => { const body = note(text, stage, process.env.GITHUB_RUN_ID || 'local', process.env.STATS); if (body) try { status(repo || flag('--repo') || repoOf(), target, { now: body.split('\n')[0], line: body }, io); } catch { } };

const ownerLevels = (spec) => (/### Acceptance criteria\n([\s\S]*?)(?=\n###|$)/i.exec((spec || '').replace(/\r\n/g, '\n'))?.[1] || '').split('\n').filter((l) => /^\d+\.\s/.test(l)).map((l) => (/^\d+\.\s+\*\*[^*]*e2e/i.test(l) || /Level: e2e/i.test(l) ? 'e2e' : 'other'));

export function refusal(out, extra = '', spec = '') {
  if (!out || !['ready', 'questions'].includes(out.verdict)) return 'the verdict is not ready or questions';
  const criteria = out.criteria || [], questions = out.questions || [], held = out.held || [];
  if (!Array.isArray(criteria) || !Array.isArray(questions) || !Array.isArray(held)) return 'criteria, questions or held is not a list';
  if (criteria.length > 5 || questions.length > 5) return 'more than 5 criteria or questions';
  const bad = criteria.findIndex((c) => !(text(c?.text) && ['unit', 'e2e'].includes(c.level) && text(c.test) && name(c.test)));
  if (bad >= 0) return `criterion ${bad + 1} lacks its text, level or test`;
  if (!questions.every((q) => text(q?.question) && text(q.recommended)) || (extra && !text(extra))) return 'a question lacks its recommended answer';
  if (out.checks !== undefined && (!Array.isArray(out.checks) || out.checks.length > 5 || !out.checks.every((c) => text(c, MAX.text)))) return 'checks are not 0 to 5 texts';
  if (out.verdict === 'ready' ? (!criteria.length && !(out.checks || []).length) || questions.length : !questions.length) return 'the verdict does not match the criteria and questions';
  const owner = ownerLevels(spec);
  if (out.verdict !== 'ready' || !owner.length || !criteria.every((c) => Number.isInteger(c.from))) return '';
  const seen = [...criteria.map((c) => c.from), ...held.map((h) => h?.from)], missing = owner.map((_, i) => i + 1).filter((n) => !seen.includes(n));
  const outside = seen.filter((n) => !(n >= 1 && n <= owner.length));
  if (outside.length) return `from ${outside.join(', ')} names no owner criterion`;
  if (missing.length) return `owner criteria ${missing.join(', ')} are neither a criterion nor held`;
  const lowered = criteria.filter((c) => owner[c.from - 1] === 'e2e' && c.level !== 'e2e').map((c) => c.from);
  if (lowered.length) return `owner criteria ${lowered.join(', ')} lost their e2e level`;
  const unproven = held.filter((h) => !/\S+:\d+/.test(h?.where || '')).map((h) => h?.from);
  return unproven.length ? `held owner criteria ${unproven.join(', ')} cite no file:line that makes them true` : '';
}

export const uncited = (held, tree, read) => (held || []).filter((h) => {
  const [, file, n] = /^(.+?):(\d+)/.exec(h?.where || '') || [], hits = file ? tree.filter((p) => p === file || p.endsWith(`/${file}`)) : [];
  return hits.length !== 1 || read(hits[0]).split('\n').length < +n;
}).map((h) => h.where);

export function comment(out, sha, extra = '', spec = '') {
  if (refusal(out, extra, spec)) return null;
  const criteria = out.criteria || [], questions = out.questions || [], checks = out.checks || [];
  const e2e = criteria.filter((c) => c.level === 'e2e').length, named = ownerLevels(spec).filter((l) => l === 'e2e').length;
  const counted = !criteria.every((c) => Number.isInteger(c.from));
  return [
    `**Spec review: ${out.verdict}**`, '',
    ...(checks.length ? [line(`Review checks: ${checks.join('; ')}`), ''] : []),
    ...(criteria.length ? ['| Criterion | Given, When, Then | Level | Test |', '|---|---|---|---|', ...criteria.map((c, i) => `| AC${i + 1} | ${line(fit(c.text, MAX.text))} | ${c.level} | \`${name(c.test)}\` |`), ''] : []),
    ...questions.map((q, i) => `${i + 1}. ${line(fit(q.question, MAX.question))} Recommended: ${line(fit(q.recommended, MAX.recommended))}`), ...(questions.length ? [''] : []),
    ...(extra ? [line(extra), ''] : []),
    ...(counted && e2e < named ? [`Levels: the spec names ${named} e2e criteria; this review has ${e2e}.`, ''] : []),
    extra ? 'Next: the tests run starts on these criteria.' : out.verdict === 'ready' ? 'Next: add the label `spec-ok`.' : 'Next: edit the issue, then add the label `spec-review` again.', '',
    `<!-- spec-review v1 sha=${sha} verdict=${out.verdict} ac=${criteria.map((_, i) => i + 1).join(',')} -->`,
  ].join('\n');
}

const scrub = (v) => JSON.parse(JSON.stringify(v), (k, x) => (typeof x === 'string' ? redact(x) : x));
const str = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const trace = (r) => {
  if (r.type === 'assistant') return (r.message?.content || []).filter((c) => c.type === 'tool_use').map((c) => `trace: ${r.parent_tool_use_id ? 'agent' : 'main'} call ${c.name} ${str(c.input).slice(0, 300)}`);
  if (r.type === 'user') return (r.message?.content || []).filter((c) => c.type === 'tool_result' && c.is_error === true).map((c) => `trace: error ${str(c.content).slice(0, 400)}`);
  if (r.type === 'result') return [`trace: result turns=${r.num_turns} ${String(r.result ?? '').slice(0, 800)}`, ...(r.permission_denials || []).map((d) => `trace: denied ${d.tool_name} ${str(d.tool_input).slice(0, 300)}`)];
  return [];
};
export const transcriptFile = (rows) => scrub(rows).map((r) => `${JSON.stringify(r)}\n`).join('');
export const logText = (rows, isPrivate) => { const clean = scrub(rows); return [...clean.flatMap(trace), ...(isPrivate ? clean.map((r) => JSON.stringify(r)) : [])].join('\n'); };
export const evalOf = (file) => scrub(JSON.parse(readFileSync(file, 'utf8')));
const PLUGIN = JSON.parse(readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url))).version;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const revision = () => { const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
const withDir = (fn) => { const dir = mkdtempSync(join(tmpdir(), 'serio-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
export function archive({ repo, run, attempt, stage, at, transcript, evaluation = null, gate = null, artifact, isPrivate, to, rev = revision(), plugin = PLUGIN }, io) {
  const day = new Date(at).toISOString(), file = `runs/${repo}/${day.slice(0, 10)}/${run}-${attempt}-${stage}.json`, api = `repos/${to}/contents/${file}`, rel = `repos/${to}/releases`;
  const rows = transcript ? transcript.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [], init = rows.find((x) => x.type === 'system' && x.subtype === 'init');
  const count = (l) => l.reduce((o, x) => ({ ...o, [x.tool]: (o[x.tool] || 0) + 1 }), {}), t = transcript ? withDir((dir) => (writeFileSync(join(dir, 't.jsonl'), transcript), traced(join(dir, 't.jsonl')))) : null;
  const record = { trace: t && { ...t, errors: count(t.errors), denied: count(t.denied), repeats: count(t.repeats) }, eval: evaluation, result: rows.findLast((x) => x.type === 'result')?.structured_output ?? null, gate, revision: evaluation?.revision || rev, plugin, model: null, effort: init?.effort ?? null, dropped: [] };
  record.model = init?.model ?? record.trace?.models?.[0] ?? null;
  try {
    let hits;
    try { hits = withDir((dir) => { for (const [k, v] of Object.entries(record)) if (k !== 'dropped' && v !== null) writeFileSync(join(dir, `${k}.json`), JSON.stringify(v)); return io.scan(dir); }); } catch { return { ok: false, note: 'The run archive was not written: gitleaks unavailable' }; }
    for (const h of hits) { const k = h.replace(/\.json$/, ''); if (k in record) (record[k] = null, record.dropped.push(k)); }
    const content = Buffer.from(JSON.stringify(record)).toString('base64');
    for (let i = 1; ; i++) {
      let sha; try { sha = io.one(api).sha; } catch { }
      try { io.send('PUT', api, { message: `Archive run ${run}-${attempt}-${stage}`, content, sha }); break; } catch (e) { if (i === 4 || !/HTTP 409/.test(e.message)) throw e; io.sleep(i * 1000); }
    }
    if (artifact && !isPrivate) io.drop(artifact);
    const cutoff = new Date(new Date(at).getTime() - 90 * 864e5).toISOString();
    try { for (const r of io.all(`${rel}?per_page=100`).filter((x) => x.tag_name?.startsWith('raw-'))) {
      const old = (r.assets || []).filter((a) => a.created_at < cutoff);
      for (const a of old) io.send('DELETE', `${rel}/assets/${a.id}`, {});
      if (old.length && old.length === r.assets.length) io.send('DELETE', `${rel}/${r.id}`, {});
    } } catch { }
    return { ok: true, note: '' };
  } catch (e) { return { ok: false, note: redact(`The run archive was not written: ${file}: ${String(e.message).trim().split('\n').at(-1).slice(0, 160)}`) }; }
}

export function outcome(rows) {
  const r = rows.findLast((x) => x.type === 'result') || {};
  const sn = r.structured_output?.note;
  const found = typeof sn === 'string' && sn.trim() ? sn : String(r.result || '').split('\n').map((l) => /^[*_`>\s]*Note:[*_`]*\s+(.+)$/.exec(l)?.[1]).filter(Boolean).at(-1) || '';
  const model = rows.find((x) => x.type === 'system' && x.subtype === 'init')?.model || '';
  const termination = [r.subtype || 'none', r.is_error && 'error', r.terminal_reason].filter(Boolean).join('/');
  return { model, revision: revision(), reason: String(r.result || '').replace(/\s+/g, ' ').trim().slice(0, 300), turns: r.num_turns || 0, usd: +Number(r.total_cost_usd || 0).toFixed(2), duration_ms: r.duration_ms || 0, termination, note: found.replace(/\s+/g, ' ').trim().slice(0, 300), stats: `turns=${r.num_turns || 0} usd=${+Number(r.total_cost_usd || 0).toFixed(2)} denied=${r.permission_denials?.length || 0}` };
}

function selfTest() {
  const ac = (text = 'Given 2 and 3, When Add, Then 5') => ({ text, level: 'unit', test: 'sum adds two numbers' });
  const q = { question: 'Which locale?', recommended: 'pl-PL' };
  assert.match(comment({ verdict: 'ready', criteria: [ac(), ac()], questions: [] }, 'abcdef123456'), /<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=1,2 -->$/);
  assert.match(comment({ verdict: 'ready', criteria: [], questions: [], checks: ['both skills sit under .agents/skills'] }, 'abcdef123456'), /Review checks: both skills sit under \.agents\/skills\n[\s\S]*verdict=ready ac= -->$/, 'a ready review with no criteria names its review checks');
  const bad = [
    ['no output', null], ['unknown verdict', { verdict: 'ok', criteria: [ac()] }],
    ['ready without criteria', { verdict: 'ready', criteria: [] }], ['ready with an empty check', { verdict: 'ready', criteria: [], checks: [' '] }], ['ready with questions', { verdict: 'ready', criteria: [ac()], questions: [q] }],
    ['questions without a question', { verdict: 'questions', criteria: [ac()], questions: [] }],
    ['six criteria', { verdict: 'ready', criteria: [1, 2, 3, 4, 5, 6].map(() => ac()) }],
    ['unknown level', { verdict: 'ready', criteria: [{ ...ac(), level: 'manual' }] }], ['criteria not a list', { verdict: 'ready', criteria: 'AC1' }],
  ];
  for (const [title, out] of bad) assert.equal(comment(out, 'abcdef123456'), null, title);
  assert.match(comment({ verdict: 'ready', criteria: [{ ...ac(), id: 9 }, { ...ac(), id: 3 }] }, 'abcdef123456'), /AC1[\s\S]*AC2[\s\S]*ac=1,2 -->$/, 'criteria are numbered by position');
  assert.equal(refusal({ verdict: 'ready', criteria: [ac()] }), '');
  assert.match(refusal({ verdict: 'ok' }), /verdict/);
  const bare = { verdict: 'ready', criteria: [{ ...ac(), test: '' }] };
  assert.match(refusal(bare), /criterion 1 lacks/);
  assert.equal(comment(bare, 'abcdef123456'), null);
  const spec = ['### Acceptance criteria', '1. Level: e2e one', '2. Level: e2e two', '3. Level: unit three'].join('\n'), from = (n, level = 'unit') => ({ ...ac(), from: n, level }), sha = 'abcdef123456';
  const held = [{ from: 2, where: 'a/b.ext:3' }], trace = (criteria, h = held) => ({ verdict: 'ready', criteria, held: h });
  assert.doesNotMatch(comment(trace([from(1, 'e2e'), from(3)]), sha, '', spec), /Levels:/, 'traced criteria need no count');
  assert.match(refusal(trace([from(1, 'e2e')]), '', spec), /owner criteria 3 are neither/);
  assert.match(refusal(trace([from(1), from(3)]), '', spec), /owner criteria 1 lost their e2e level/);
  assert.match(refusal(trace([from(1, 'e2e'), from(3)], [{ from: 2, where: 'nowhere' }]), '', spec), /owner criteria 2 cite no file:line/);
  assert.match(comment({ verdict: 'ready', criteria: [ac()] }, sha, '', spec), /Levels: the spec names 2 e2e criteria; this review has 0./);
  assert.equal(refusal({ verdict: 'questions', criteria: [from(1)], held: [], questions: [q] }, '', spec), '');
  assert.match(refusal(trace([from(1, 'e2e'), from(3), from(9)]), '', spec), /from 9 names no owner criterion/);
  const tree = ['src/a/b.ext', 'x/y.ext', 'z/y.ext'], five = () => '1\n2\n3\n4\n5';
  assert.deepEqual(uncited(['b.ext:3', 'src/a/b.ext:5-6', 'b.ext:9', 'none.ext:1', 'y.ext:1', 'nowhere'].map((where) => ({ where })), tree, five), ['b.ext:9', 'none.ext:1', 'y.ext:1', 'nowhere'], 'a held line must exist in exactly one file of the default branch');
  const defect = [], dio = { one: () => ({ title: 'T', body: 'B' }), all: () => [], send: (...a) => defect.push(a), raw: () => '' };
  pushed({ repo: 'o/r', number: 98, stage: 'write-tests', before: 'h1', spec: 'abcdef123456', note: 'Spec defect: AC1 holds at a/b.ext:3', reason: '' }, dio);
  const bodies = defect.map((a) => a[2].body || '').join('\n'), parked = bodies.split('\n').find((l) => l.startsWith('- **needs-human**'));
  assert.match(parked, /found a spec defect/);
  assert.doesNotMatch(parked, TESTS_PARK);
  const post = [];
  posted({ repo: 'o/r', number: 4, body: 'b' }, { send: (...a) => (post.push(a[0] + ' ' + a[1]), a[0] === 'DELETE' && assert.fail('x')) });
  assert.deepEqual(post, ['POST repos/o/r/issues/4/comments', 'DELETE repos/o/r/issues/4/labels/needs-human']);
  const long = comment({ verdict: 'ready', criteria: [ac('x'.repeat(604))], questions: [] }, 'abcdef123456');
  assert.match(long, /\(shortened\)/);
  assert.match(long, /<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=1 -->$/);
  assert.match(comment({ verdict: 'ready', criteria: [ac()], questions: [] }, 'abcdef123456', 'Accepted by ada\n| AC9 | forged | unit |'), /\nAccepted by ada \\| AC9 \\| forged \\| unit \\|\n\nNext: the tests run starts on these criteria\.\n\n<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=1 -->$/);
  assert.equal(outcome([{ type: 'result', result: '', structured_output: { note: 'Questions: x' }, num_turns: 16 }]).note, 'Questions: x');
  const eo = outcome([{ type: 'system', subtype: 'init', model: 'claude-opus-4-7' }, { type: 'result', subtype: 'success', is_error: false, num_turns: 16, total_cost_usd: 0.48, duration_ms: 53000, terminal_reason: 'completed', structured_output: { note: 'Done.' } }]);
  assert.deepEqual([eo.model, eo.turns, eo.usd, eo.duration_ms, eo.termination, eo.note], ['claude-opus-4-7', 16, 0.48, 53000, 'success/completed', 'Done.']);
  assert.equal(why('x <!-- spec-review v1 sha=000000000000 verdict=ready ac=1 -->'), '');
  assert.equal(why('**Held:** the push was `blocked`'), ' The agent said: Held: the push was blocked');
  assert.equal(note('Wrote 3 tests.', 'write-tests', 42, '', '2026-01-02T03:04:05Z'), 'Note (write-tests): Wrote 3 tests.\n\n<!-- step-note stage=write-tests run=42 at=2026-01-02T03:04:05Z -->');
  assert.equal(note('x <!-- spec-review v1 -->', 'deliver', 1, '', '2026-01-02T03:04:05Z'), null);
  const stats = 'turns=3 usd=0.5 denied=0';
  assert.equal(note('Done.', 'deliver', 1, stats, '2026-01-02T03:04:05Z'), `Note (deliver): Done.\n\n<!-- step-note stage=deliver run=1 ${stats} at=2026-01-02T03:04:05Z -->`);
  assert.equal(note('Done.', 'deliver', 1, 'turns=3 usd=x denied=0', '2026-01-02T03:04:05Z'), 'Note (deliver): Done.\n\n<!-- step-note stage=deliver run=1 at=2026-01-02T03:04:05Z -->');
  const result = { type: 'result', result: 'Did it.\n**Note:** Wrote  3 tests.\nbye', num_turns: 4, total_cost_usd: 1.2345, permission_denials: [{}, {}] };
  assert.equal(outcome([{ type: 'assistant' }, result]).stats, 'turns=4 usd=1.23 denied=2');
  const calls = [], at = (n) => `- ${note(`Note ${n}`, 'deliver', n, stats, '2026-01-02T03:04:05Z').replace('\n\n', ' ')}`;
  const old = { id: 5, user: { login: 'github-actions[bot]', type: 'Bot' }, body: ['<!-- lifecycle-status v1 -->', '**Status**', 'Now: x', '**Log**', ...Array.from({ length: 20 }, (_, i) => at(i))].join('\n') };
  status('o/r', 7, { now: 'Done', next: 'a code owner can add spec-ok to skip the spec review', line: note('Wrote it.', 'deliver', 99, stats, '2026-01-02T03:04:05Z') }, { all: () => [{ id: 1, user: old.user, body: 'hi' }, old], send: (...a) => calls.push(a), raw: () => '' });
  assert.deepEqual(calls[0].slice(0, 2), ['PATCH', 'repos/o/r/issues/comments/5']);
  const log = calls[0][2].body.split('**Log**\n')[1].split('\n');
  assert.equal(log.length, 20);
  assert.equal(log.at(-1), `- Note (deliver): Wrote it. <!-- step-note stage=deliver run=99 ${stats} at=2026-01-02T03:04:05Z -->`);
  const route = (i) => '- ' + note('Not started: x.', 'route', i, stats, '2026-01-02T03:04:05Z').replace('\n\n', ' ');
  const mixed = { ...old, body: ['<!-- lifecycle-status v1 -->', '**Status**', 'Now: x', '**Log**', route(0), ...Array.from({ length: 18 }, (_, i) => at(i)), route(1)].join('\n') };
  const trimmed = [];
  status('o/r', 7, { now: 'Done', line: note('Wrote it.', 'deliver', 99, stats, '2026-01-02T03:04:05Z') }, { all: () => [mixed], send: (...a) => trimmed.push(a), raw: () => '' });
  const kept = trimmed[0][2].body.split('**Log**\n')[1].split('\n');
  assert.deepEqual([kept.length, kept.some((l) => l.includes('stage=route run=0')), kept.some((l) => l.includes('stage=route run=1')), kept.at(-1).includes('run=99'), kept[0] === at(0)], [20, false, true, true, true]);
  const fresh = [];
  status('o/r', 7, { now: 'Hi' }, { all: () => [{ id: 1, user: { login: 'eve', type: 'User' }, body: old.body }], send: (...a) => fresh.push(a), raw: () => '' });
  assert.deepEqual(fresh.map((a) => a[0] + a[1]), ['POSTrepos/o/r/issues/7/comments']);
  const quoted = [];
  status('o/r', 7, { now: 'Hi' }, { all: () => [{ id: 1, user: old.user, body: `See ${old.body}` }], send: (...a) => quoted.push(a), raw: () => '' });
  assert.deepEqual(quoted.map((a) => a[0] + a[1]), ['POSTrepos/o/r/issues/7/comments']);
  const runs = (stage, before, spec, repo = 'o/r', pushedSha = 'h2') => { const sent = []; pushed({ repo: 'o/r', number: 98, stage, before, spec, pushedSha, note: '', reason: '' }, { one: () => ({ title: 'T', body: 'B' }), all: (url) => url.startsWith('repos/o/r/pulls?state=open') ? [{ number: 5, draft: true, head: { ref: 'agent/98-x', sha: 'h2', repo: { full_name: repo } }, base: { repo: { full_name: 'o/r' } } }] : [], send: (...a) => sent.push(a), raw: () => '' }); return sent.map((a) => `${a[1]} ${JSON.stringify(a[2])}`).join('\n'); };
  assert.match(runs('write-tests', 'h1'), /issues\/98\/comments \{"body":"<!-- write-tests v1 spec=[0-9a-f]{12} -->"\}/, 'a tests run that pushed records the spec it wrote tests for');
  assert.match(runs('write-tests', 'h1', 'abcdef123456'), /<!-- write-tests v1 spec=abcdef123456 -->/, 'the marker names the spec the run started from');
  assert.doesNotMatch(runs('write-tests', 'h2'), /write-tests v1 spec=/, 'a tests run whose push was refused records no spec');
  assert.match(runs('write-tests', 'h1', '', 'x/r'), /issues\/98\/labels/, 'a fork pull request is not the task draft');
  assert.match(runs('pr-loop', 'h2'), /issues\/5\/labels[\s\S]*\(pr-loop\)\. pr-loop does not start again on head h2\./, 'a pr-loop run without a push parks the pull request with its head');
  assert.doesNotMatch(runs('write-tests', 'h1', '', 'o/r', ''), /write-tests v1 spec=/, 'a head another push moved records no spec');
  assert.match(runs('write-tests', 'h1', '', 'o/r', ''), /\(write-tests\)\./, 'a write-tests run whose head another push moved parks, so it counts toward the cap');
  const keeps = [
    ['- **needs-human**: the run ended without a new push: u (pr-loop). pr-loop does not start again on head h1. <!-- park at=2026-01-02T03:04:05Z -->', true],
    ['- **needs-human**: the write-tests run did not finish: u. <!-- park at=2026-01-02T03:04:05Z -->', true],
    ['- **needs-human**: the run ended without a new push: u (write-tests). <!-- park at=2026-01-02T03:04:05Z -->', true],
    ['- **needs-human**: the pr-loop run did not finish: u. The agent said: pr-loop does not start again on head h1. <!-- park at=2026-01-02T03:04:05Z -->', false],
    ['- Note (pr-loop): pr-loop does not start again on head h1. <!-- step-note stage=pr-loop run=1 at=2026-01-02T03:04:05Z -->', false],
  ];
  for (const [first, kept] of keeps) {
    const sent = [];
    status('o/r', 7, { now: 'x', line: note('Wrote it.', 'deliver', 99, stats, '2026-01-02T03:04:05Z') }, { all: () => [{ ...old, body: old.body.replace(at(0), first) }], send: (...a) => sent.push(a), raw: () => '' });
    assert.equal(sent[0][2].body.includes(first), kept, first);
  }
  console.log(`publish self-test: ${bad.length + 43 + keeps.length} checks passed`);
}

const unlabel = (repo, numbers, io) => { for (const n of numbers) try { io.send('DELETE', `repos/${repo}/issues/${n}/labels/needs-human`, {}); } catch { } };
export function posted({ repo, number, body }, io = { send }) { io.send('POST', `repos/${repo}/issues/${number}/comments`, { body }); unlabel(repo, [number], io); }

export function pushed({ repo, number, stage, before, spec, pushedSha, note: text, reason }, io = { one, all, send, raw }) {
  const pr = io.all(`repos/${repo}/pulls?state=open&per_page=100`).find((p) => taskOf(p) === Number(number)), head = pr?.head.sha;
  say(text, pr?.number || number, stage, io, repo);
  if (head && head !== before && (stage !== 'write-tests' || pushedSha === head)) {
    unlabel(repo, [number, pr.number], io);
    if (stage === 'write-tests') io.send('POST', `repos/${repo}/issues/${number}/comments`, { body: `<!-- write-tests v1 spec=${spec || specSha(io.one(`repos/${repo}/issues/${number}`))} -->` });
    return console.log(`pushed ${head}`);
  }
  if (stage === 'deliver' && pr && !pr.draft) return;
  if (stage === 'write-tests' && /^Spec defect:/.test(text || '')) {
    return park(repo, number, `the write-tests run found a spec defect: ${runLink()}. Remove and add the label spec-review; the review reads this note.${why(reason)}`, io);
  }
  const loop = stage === 'pr-loop' && pr;
  park(repo, loop ? pr.number : number, `the run ended without a new push: ${runLink()} (${stage}).${loop ? ` pr-loop does not start again on head ${head}.` : ''}${why(reason)}`, io);
}

const io = { one, all, send, scan, sleep };
function main() {
  const first = process.argv[2];
  if (!['--archive', '--gate', '--outcome', '--log'].includes(first) && !/^\d+$/.test(first)) { console.error(`not an issue number: ${first}`); process.exit(1); }
  const outFile = flag('--outcome');
  if (outFile) {
    let rows = []; try { rows = scrub(JSON.parse(readFileSync(outFile, 'utf8'))); } catch { }
    const o = outcome(rows), e = process.env, structured = rows.findLast((x) => x.type === 'result')?.structured_output;
    const ok = o.termination.startsWith('success') && !o.termination.includes('/error') && (e.STAGE !== 'spec-review' || structured != null);
    const validation = e.STAGE === 'spec-review' ? (comment(structured, 'x'.repeat(12)) ? 'valid' : 'invalid') : 'n/a';
    if (e.RUNNER_TEMP) writeFileSync(`${e.RUNNER_TEMP}/eval.json`, JSON.stringify({ repository: e.GITHUB_REPOSITORY, issue: e.ISSUE, stage: e.STAGE, bypass: e.BYPASS || '', run: e.GITHUB_RUN_ID, ...o, structured, validation }));
    if (e.GITHUB_STEP_SUMMARY) appendFileSync(e.GITHUB_STEP_SUMMARY, `\n| Stage | Result | Turns | Cost | Termination | Note | Next |\n|---|---|---|---|---|---|---|\n| ${e.STAGE} | ${ok ? 'finished' : 'not finished'} | ${o.turns} | ${'$'}${o.usd} | ${o.termination} | ${line(o.note)} | ${ok ? 'publish job' : 'see the log'} |\n`);
    return console.log(`stats=${o.stats}`);
  }
  const logFile = flag('--log');
  if (logFile) {
    let rows = []; try { rows = JSON.parse(readFileSync(logFile, 'utf8')); } catch { }
    if (process.env.RUNNER_TEMP) writeFileSync(`${process.env.RUNNER_TEMP}/transcript.jsonl`, transcriptFile(rows));
    return console.log(logText(rows, process.env.PRIVATE === 'true'));
  }
  const gate = flag('--gate');
  if (gate) {
    const g = JSON.parse(readFileSync(gate, 'utf8')), r = archive({ repo: g.repository, run: g.run, attempt: g.attempt, stage: 'gate', at: g.at, gate: scrub(g), isPrivate: true, to: 'serio-ngo/lifecycle-runs' }, io);
    if (!r.ok) { console.log(`::error::${r.note}`); process.exit(1); }
    return console.log('archived');
  }
  let ev = {}; try { ev = evalOf(flag('--eval')); } catch { }
  const repo = flag('--repo') || repoOf(), [number, file] = process.argv.slice(2);
  if (process.argv[3] === '--note') {
    const [stage, ...text] = process.argv.slice(4);
    if (!['spec-review', 'write-tests', 'deliver', 'pr-loop'].includes(stage)) { console.error('usage: publish.mjs <number> --note <spec-review|write-tests|deliver|pr-loop> <text>'); process.exit(1); }
    if (process.env.SERIO_UNATTENDED === '1') return console.log('Not posted: the workflow posts the note of an unattended run.');
    return say(text.join(' '), number, stage);
  }
  const failed = flag('--failed');
  if (failed) { say(ev.note, number); return park(repo, number, `the ${failed} run did not finish: ${runLink()}.${why(ev.reason)}`); }
  if (process.argv.includes('--archive')) {
    const e = process.env, drop = (id) => { const token = e.GH_TOKEN; e.GH_TOKEN = e.RUN_TOKEN; try { send('DELETE', `repos/${repo}/actions/artifacts/${id}`, {}); } finally { e.GH_TOKEN = token; } };
    const r = existsSync(e.TRANSCRIPT) ? archive({ repo, run: e.GITHUB_RUN_ID, attempt: e.GITHUB_RUN_ATTEMPT, stage: e.STAGE, at: new Date().toISOString(), transcript: readFileSync(e.TRANSCRIPT, 'utf8'), evaluation: ev, artifact: e.ARTIFACT, isPrivate: e.PRIVATE === 'true', to: 'serio-ngo/lifecycle-runs' }, { ...io, drop }) : { ok: false, note: 'The run archive failed: the transcript did not reach the publish job.' };
    if (!r.ok) mkdirSync(dirname(flag('--eval')), { recursive: true }), writeFileSync(flag('--eval'),JSON.stringify({ ...ev, note: `${r.note} ${ev.note || ''}`.trim() }));
    if (!r.ok) { console.log(`::error::${r.note}`); process.exit(1); }
    return console.log('archived');
  }
  if (process.argv.includes('--pushed')) return pushed({ repo, number, stage: process.env.STAGE, before: process.env.BEFORE_SHA, spec: process.env.SPEC_SHA, pushedSha: process.env.PUSHED_SHA, note: ev.note, reason: ev.reason });
  let out = null;
  try { out = scrub(ev.structured ?? JSON.parse(file ? readFileSync(file, 'utf8') : process.env.STRUCTURED_OUTPUT)); } catch { }
  const issue = one(`repos/${repo}/issues/${number}`), body = comment(out, process.env.SPEC_SHA || specSha(issue), '', issue.body || '');
  const branch = body && out.held?.length ? one(`repos/${repo}`).default_branch : '';
  const lost = branch ? uncited(out.held, one(`repos/${repo}/git/trees/${branch}?recursive=1`).tree.map((t) => t.path), (p) => raw(`repos/${repo}/contents/${p}?ref=${branch}`)) : [];
  const reason = body ? lost.length && `held lines missing on ${branch}: ${tidy(lost.join(', '))}` : refusal(out, '', issue.body || '');
  if (reason) { park(repo, number, `the spec review returned no valid result (${reason}): ${runLink()}`); process.exit(1); }
  posted({ repo, number, body });
  say(ev.note || out.note, number, 'spec-review');
  console.log(body);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) (process.argv.includes('--self-test') ? selfTest : main)();
