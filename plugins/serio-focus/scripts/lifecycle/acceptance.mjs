#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, flag, one, ownersOf, raw, repoOf, runLink, send, specComment, specOf, taskOf } from '../lib/lifecycle.mjs';

const text = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const cell = (s) => s.replace(/[|\r\n<>]/g, ' ').slice(0, 120);
const GATE = /^\.github\/|(^|\/)(?:CODEOWNERS|package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|\.[^/]*rc(?:\.[a-z]+)?|[^/]*\.config\.[^/]+)$|(^|\/)(?:scripts?|\.husky)\//;

export const cases = (xml) => [...xml.matchAll(/<testcase\b((?:[^>"]|"[^"]*")*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map(([, attrs, inner = '']) => ({
  name: text(/\bname="([^"]*)"/.exec(attrs)?.[1] || ''),
  result: /<(failure|error)\b/.test(inner) ? 'failed' : /<skipped\b/.test(inner) ? 'skipped' : 'passed',
}));

const mapping = (body) => new Map([...String(body || '').matchAll(/^\| AC(\d+) \| .* \| (?:unit|e2e) \| `([^`]+)` \|$/gm)].map(([, n, test]) => [Number(n), test]));

export function report({ review = '', tests, sha, lock = '', link = '', files = [], size = '' }) {
  const ac = specOf(review)?.ac || [], map = mapping(review);
  const rows = ac.map((n) => {
    const name = map.get(n), mine = name ? tests.filter((t) => t.name === name) : [];
    const result = !mine.length ? 'missing' : mine.find((t) => t.result !== 'passed')?.result || 'passed';
    return { n, name: name ? cell(name) : '-', result };
  });
  const ok = ac.length > 0 && rows.every((r) => r.result === 'passed');
  const body = [
    `**Acceptance: ${ok ? 'pass' : 'fail'}** for \`${sha.slice(0, 7)}\`${lock ? ` · test lock: ${cell(lock)}` : ''}`, '',
    '| Criterion | Test | Result |', '|---|---|---|',
    ...rows.map((r) => `| AC${r.n} | ${r.name} | ${r.result} |`),
    ...(size || files.length ? ['', `Changed: ${size} · gate files: ${files.filter((f) => GATE.test(f)).map((f) => `\`${cell(f)}\``).join(', ') || 'none'}`] : []),
    ...(link ? ['', `Run and e2e traces: ${link}`] : []), '', `<!-- acceptance v1 sha=${sha} -->`,
  ].join('\n');
  return { ok, body };
}

function selfTest() {
  const spec = (rows, ac) => `${rows}\n\n<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=${ac} -->`;
  const junit = '<testsuites><testsuite><testcase name="sum adds two numbers" time="0.1"/><testcase name="Add shows 2 =&gt; &quot;5&quot;" classname="e2e"><system-out>x</system-out></testcase></testsuite></testsuites>';
  const review = spec('| AC1 | Given 2 \\| 3, When x | unit | `sum adds two numbers` |\n| AC2 | Given a | e2e | `Add shows 2 => "5"` |', '1,2');
  const pass = report({ review, tests: cases(junit), sha: 'abcdef123456' });
  assert.equal(pass.ok, true); assert.match(pass.body, /\| AC1 \| sum adds two numbers \| passed \|\n\| AC2 \| Add shows 2 = {2}"5" \| passed \|/); assert.match(pass.body, /<!-- acceptance v1 sha=abcdef123456 -->/);
  const changed = (files) => report({ review, tests: cases(junit), sha: 'abcdef1', size: '+3 −1 in 2 files', files }).body;
  assert.match(changed(['src/a.mjs', '.github/workflows/ci.yml', 'scripts/x.sh']), /\nChanged: \+3 −1 in 2 files · gate files: `\.github\/workflows\/ci\.yml`, `scripts\/x\.sh`\n/);
  assert.match(changed(['src/a.mjs', 'src/describe.mjs']), /gate files: none\n/);
  assert.match(changed(['CODEOWNERS', '.eslintrc.json', '.husky/pre-commit', 'tsconfig.json', 'yarn.lock']), /gate files: `CODEOWNERS`, `\.eslintrc\.json`, `\.husky\/pre-commit`, `tsconfig\.json`, `yarn\.lock`\n/);
  assert.doesNotMatch(changed(['scripts/x\n| AC1 | forged | passed |']), /\n\| AC1 \| forged/);
  const list = [
    ['AC1 is not AC10', report({ review: spec('| AC10 | t | unit | `x` |', '1'), tests: cases('<testcase name="x"/>'), sha: 'a' }), /\| AC1 \| - \| missing \|/],
    ['no criteria', report({ review: spec('', ''), tests: cases(junit), sha: 'a' }), /Acceptance: fail/],
    ['no review', report({ tests: cases(junit), sha: 'a' }), /Acceptance: fail/],
  ];
  for (const [title, got, want] of list) { assert.equal(got.ok, false, title); assert.match(got.body, want, title); }
  console.log(`acceptance self-test: ${list.length + 7} checks passed`);
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.xml') ? [path.join(dir, e.name)] : []);

export function accept({ repo, number, dir, tested, lock, link, post }, io = { one, all, send, raw }) {
  const pr = io.one(`repos/${repo}/pulls/${number}`), n = taskOf(pr);
  if (!n) return { ok: true, body: 'acceptance: not a lifecycle pull request' };
  if (tested && tested !== pr.head.sha) return { ok: true, body: 'acceptance: a newer head exists; the run for it writes the report' };
  const own = ownersOf(repo, io.raw);
  const review = specComment(io.all(`repos/${repo}/issues/${n}/comments?per_page=100`), own)?.body;
  let xml = [];
  try { xml = walk(dir); } catch { }
  const files = io.all(`repos/${repo}/pulls/${number}/files?per_page=100`).map((f) => f.filename), size = `+${pr.additions} −${pr.deletions} in ${pr.changed_files} files`;
  const got = report({ review, tests: xml.flatMap((file) => cases(readFileSync(file, 'utf8'))), sha: pr.head.sha, lock, link, files, size });
  if (post) {
    const old = io.all(`repos/${repo}/issues/${number}/comments?per_page=100`).find((c) => c.user?.login === 'github-actions[bot]' && /<!-- acceptance v1 /.test(c.body || ''));
    if (old) io.send('PATCH', `repos/${repo}/issues/comments/${old.id}`, { body: got.body });
    else io.send('POST', `repos/${repo}/issues/${number}/comments`, { body: got.body });
  }
  return got;
}

export function record({ repo, number, dir, tested, lock, note, verifier, run, attempt, jobs }, io = { one, all, raw }) {
  const pr = io.one(`repos/${repo}/pulls/${number}`), ok = lock === 'success';
  const body = !ok ? null : accept({ repo, number, dir, tested, lock: note, link: '', post: false }, { ...io, send: () => { } }).body;
  let xml = [];
  try { xml = walk(dir); } catch { }
  return {
    repository: repo, pr: Number(number), run, attempt, at: new Date().toISOString(), head_sha: pr.head.sha, tested_sha: tested, reported_sha: /<!-- acceptance v1 sha=(\S+) -->/.exec(body || '')?.[1] || null, verifier,
    lock: `test lock: ${ok ? 'pass' : 'fail'} - ${note}`, acceptance: body, cases: xml.flatMap((file) => cases(readFileSync(file, 'utf8'))), jobs,
  };
}

function main() {
  const [number, dir] = process.argv.slice(2), repo = flag('--repo') || repoOf(), file = flag('--record');
  if (file) {
    const { env } = process;
    return writeFileSync(file, JSON.stringify(record({ repo, number, dir, tested: env.TESTED_SHA || '', lock: env.LOCK, note: env.LOCK_NOTE, verifier: env.VERIFIER, run: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT), jobs: { tests: env.TESTS } }, { one, all, raw })));
  }
  const { ok, body } = accept({ repo, number, dir, tested: process.env.TESTED_SHA || '', lock: process.env.LOCK_NOTE, link: process.env.GITHUB_RUN_ID ? runLink() : '', post: process.argv.includes('--post') });
  console.log(body);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) (process.argv.includes('--self-test') ? selfTest : main)();
