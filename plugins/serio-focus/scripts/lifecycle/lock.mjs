#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { all, flag, lockOf, one, owners, ownersOf, repoOf, specMarker, specSha, taskOf } from '../lib/lifecycle.mjs';

const LOCKED = /(^|\/)(tests?|__tests__|e2e)\/|[._-](test|spec)\.[^/]+$|(^|\/)test-[^/]+$|(^|\/)(playwright|vitest|jest)\.config\.[^/]+$/;

export function check({ pr, issue, comments, reviews, own, changed }) {
  const fail = (note) => ({ ok: false, locked: false, note });
  if (!taskOf(pr)) return { ok: true, locked: false, note: 'not a lifecycle pull request' };
  const mark = specMarker(comments, own);
  if (mark?.verdict !== 'ready' || !issue.labels.some((l) => l.name === 'spec-ok')) return fail('the spec has no ready review with spec-ok');
  if (mark.sha !== specSha(issue)) return fail('the spec changed after its review');
  const lock = lockOf(reviews, own);
  if (!lock) return pr.draft ? { ok: true, locked: false, note: 'not locked' } : fail('marked ready without a tests-ok review');
  const files = changed(lock);
  if (!files) return fail(`lock commit ${lock.slice(0, 7)} is not in the branch history`);
  const moved = files.filter((file) => LOCKED.test(file));
  return moved.length ? fail(`test paths changed after the lock: ${moved.join(', ')}`) : { ok: true, locked: true, note: `locked at ${lock.slice(0, 7)}` };
}

function selfTest() {
  const ada = { login: 'ada', type: 'User' }, app = { login: 'serio-agent[bot]', type: 'Bot' };
  const issue = { title: 'Sum', body: 'AC1', labels: [{ name: 'spec-ok' }] };
  const ready = { user: { login: 'github-actions[bot]', type: 'Bot' }, body: `<!-- spec-review v1 sha=${specSha(issue)} verdict=ready ac=1 -->` };
  const lock = (user = ada, commit_id = 'aaaaaaaa') => ({ user, body: 'tests-ok, thanks', commit_id });
  const repo = { full_name: 'o/r' }, head = { ref: 'agent/7-sum', repo };
  const base = { pr: { draft: false, head, base: { repo } }, issue, comments: [ready], reviews: [lock()], own: owners('* @ada\n'), changed: () => ['src/sum.mjs', 'package.json'] };
  const cases = [
    ['locked', {}, true, /^locked at aaaaaaa/],
    ['moved lock', { reviews: [lock(), lock(ada, 'bbbbbbbb')] }, true, /^locked at bbbbbbb/],
    ['test edited after the lock', { changed: () => ['tests/sum.test.mjs'] }, false, /tests\/sum\.test\.mjs/],
    ['other test layouts', { changed: () => ['test/a.mjs', 'src/__tests__/a.js', 'src/a_test.js', 'src/test-a.mjs', 'src/a-test.js'] }, false, /test\/a\.mjs, src\/__tests__\/a\.js, src\/a_test\.js, src\/test-a\.mjs, src\/a-test\.js/],
    ['source named like a test', { changed: () => ['src/contest.mjs', 'src/latest/a.mjs'] }, true, /^locked/],
    ['e2e, spec and config paths', { changed: () => ['e2e/a.js', 'src/a.spec.ts', 'playwright.config.mjs'] }, false, /e2e\/a\.js, src\/a\.spec\.ts, playwright\.config\.mjs/],
    ['bot review', { reviews: [lock(app)] }, false, /without a tests-ok/],
    ['stranger review', { reviews: [lock({ login: 'eve', type: 'User' })] }, false, /without a tests-ok/],
    ['draft', { pr: { draft: true, head, base: { repo } }, reviews: [] }, true, /^not locked$/],
    ['ready without a lock', { reviews: [] }, false, /without a tests-ok/],
    ['edited spec', { issue: { ...issue, body: 'AC1 and more' } }, false, /spec changed/],
    ['no spec-ok', { issue: { ...issue, labels: [] } }, false, /spec-ok/],
    ['rewritten history', { changed: () => null }, false, /not in the branch history/],
    ['other pull request', { pr: { draft: false, head: { ref: 'brand-sync', repo }, base: { repo } }, comments: [] }, true, /not a lifecycle/],
    ['fork pull request', { pr: { draft: false, head: { ref: 'agent/7-sum', repo: { full_name: 'x/r' } }, base: { repo } }, comments: [] }, true, /not a lifecycle/],
  ];
  for (const [title, over, ok, note] of cases) {
    const got = check({ ...base, ...over });
    assert.equal(got.ok, ok, title); assert.match(got.note, note, title);
  }
  console.log(`lock self-test: ${cases.length} checks passed`);
}

export function load(repo, number) {
  const pr = one(`repos/${repo}/pulls/${number}`), n = taskOf(pr);
  const changed = (lock) => {
    const diff = one(`repos/${repo}/compare/${lock}...${pr.head.sha}?per_page=1`), files = diff.files || [];
    if (!['ahead', 'identical'].includes(diff.status)) return null;
    return files.length >= 300 ? ['tests/ (300 or more files changed; the list is cut)'] : files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
  };
  return { pr, issue: n ? one(`repos/${repo}/issues/${n}`) : null, comments: n ? all(`repos/${repo}/issues/${n}/comments?per_page=100`) : [], reviews: all(`repos/${repo}/pulls/${number}/reviews?per_page=100`), own: ownersOf(repo), changed };
}

function main() {
  const got = check(load(flag('--repo') || repoOf(), process.argv[2]));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `locked=${got.locked}\nnote=${got.note.replace(/\s+/g, ' ')}\n`);
  console.log(`test lock: ${got.ok ? 'pass' : 'fail'} - ${got.note}`);
  process.exit(got.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) (process.argv.includes('--self-test') ? selfTest : main)();
