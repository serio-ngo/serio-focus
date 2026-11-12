#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, flag, one, ownersOf, repoOf, runLink, send, specMarker, taskOf } from '../lib/lifecycle.mjs';

const text = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const cell = (s) => s.replace(/[|\r\n<>]/g, ' ').slice(0, 120);

export const cases = (xml) => [...xml.matchAll(/<testcase\b((?:[^>"]|"[^"]*")*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map(([, attrs, inner = '']) => ({
  name: text(/\bname="([^"]*)"/.exec(attrs)?.[1] || ''),
  result: /<(failure|error)\b/.test(inner) ? 'failed' : /<skipped\b/.test(inner) ? 'skipped' : 'passed',
}));

export function report({ issue, ac, tests, sha, lock = '', link = '' }) {
  const own = tests.filter((t) => t.name.startsWith(`#${issue} AC`)).map((t) => ({ ...t, name: t.name.slice(`#${issue} `.length) }));
  const rows = ac.map((n) => {
    const mine = own.filter((t) => new RegExp(`^AC${n}\\b`).test(t.name));
    const result = !mine.length ? 'missing' : mine.find((t) => t.result !== 'passed')?.result || 'passed';
    return { n, names: mine.map((t) => cell(t.name)).join('<br>') || '-', result };
  });
  const stray = own.filter((t) => !ac.includes(Number(/^AC(\d+)\b/.exec(t.name)?.[1]))).map((t) => cell(t.name));
  const ok = ac.length > 0 && rows.every((r) => r.result === 'passed') && !stray.length;
  const body = [
    `**Acceptance: ${ok ? 'pass' : 'fail'}** for \`${sha.slice(0, 7)}\`${lock ? ` · test lock: ${cell(lock)}` : ''}`, '',
    '| Criterion | Test | Result |', '|---|---|---|',
    ...rows.map((r) => `| AC${r.n} | ${r.names} | ${r.result} |`),
    ...(stray.length ? ['', `Tests without a criterion: ${stray.join('; ')}`] : []),
    ...(link ? ['', `Run and e2e traces: ${link}`] : []), '', `<!-- acceptance v1 sha=${sha} -->`,
  ].join('\n');
  return { ok, body };
}

function selfTest() {
  const junit = '<testsuites><testsuite><testcase name="#7 AC1: adds 2 and 3" time="0.1"/><testcase name="#6 AC3: an older task"><failure/></testcase><testcase name="#7 AC2: 2 => &quot;5&quot;" classname="e2e"><system-out>x</system-out></testcase></testsuite></testsuites>';
  const pass = report({ issue: 7, ac: [1, 2], tests: cases(junit), sha: 'abcdef123456' });
  assert.equal(pass.ok, true); assert.match(pass.body, /\| AC2 \| AC2: 2 = {2}"5" \| passed \|/); assert.match(pass.body, /<!-- acceptance v1 sha=abcdef123456 -->/);
  const run = (xml, ac = [1, 2]) => report({ issue: 7, ac, tests: cases(xml), sha: 'abcdef1' });
  const list = [
    ['missing criterion', run(junit, [1, 2, 3]), /\| AC3 \| - \| missing \|/],
    ['skipped test', run(junit.replace('<system-out>x</system-out>', '<skipped/>')), /\| AC2 \| .* \| skipped \|/],
    ['failed test', run(junit.replace('<system-out>x</system-out>', '<failure message="no">x</failure>')), /\| AC2 \| .* \| failed \|/],
    ['errored test', run(junit.replace('<system-out>x</system-out>', '<error>x</error>')), /\| AC2 \| .* \| failed \|/],
    ['one of two tests fails', run(`${junit}<testcase name="#7 AC1: again"><failure/></testcase>`), /\| AC1 \| .* \| failed \|/],
    ['test without a criterion', run(junit, [1]), /Tests without a criterion: AC2/],
    ['another task fills no row', run('<testcase name="#8 AC1: x"/><testcase name="AC1: x"/>', [1]), /\| AC1 \| - \| missing \|/],
    ['AC1 is not AC10', run('<testcase name="#7 AC10: x"/>', [1]), /\| AC1 \| - \| missing \|/],
    ['no criteria', run(junit, []), /Acceptance: fail/],
    ['no results', run(''), /\| AC1 \| - \| missing \|/],
  ];
  for (const [title, got, want] of list) { assert.equal(got.ok, false, title); assert.match(got.body, want, title); }
  console.log(`acceptance self-test: ${list.length + 3} checks passed`);
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.xml') ? [path.join(dir, e.name)] : []);

function main() {
  const repo = flag('--repo') || repoOf(), [number, dir] = process.argv.slice(2);
  const pr = one(`repos/${repo}/pulls/${number}`), n = taskOf(pr);
  if (!n) return console.log('acceptance: not a lifecycle pull request');
  const ac = specMarker(all(`repos/${repo}/issues/${n}/comments?per_page=100`), ownersOf(repo))?.ac || [];
  let files = [];
  try { files = walk(dir); } catch { }
  const got = report({ issue: n, ac, tests: files.flatMap((file) => cases(readFileSync(file, 'utf8'))), sha: pr.head.sha, lock: process.env.LOCK_NOTE, link: process.env.GITHUB_RUN_ID ? runLink() : '' });
  if (process.argv.includes('--post')) {
    const old = all(`repos/${repo}/issues/${number}/comments?per_page=100`).find((c) => c.user?.login === 'github-actions[bot]' && /<!-- acceptance v1 /.test(c.body || ''));
    if (old) send('PATCH', `repos/${repo}/issues/comments/${old.id}`, { body: got.body });
    else send('POST', `repos/${repo}/issues/${number}/comments`, { body: got.body });
  }
  console.log(got.body);
  process.exit(got.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) (process.argv.includes('--self-test') ? selfTest : main)();
