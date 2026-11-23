#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, issueOf, one, raw, repoOf, send } from '../lib/lifecycle.mjs';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function target(ref, issue, open) {
  const name = String(ref || '').trim();
  if (issueOf(name) !== Number(issue)) throw new Error(`branch ${name || '(none)'} is not agent/${issue}-<slug>`);
  if (open && name !== open) throw new Error(`branch ${name} is not the pull request's branch ${open}`);
  return name;
}

export function push(remote, bundle, ref, dir) {
  execFileSync('git', ['clone', '-q', '--bare', '--filter=blob:none', remote, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  git(dir, '-c', 'fetch.fsckObjects=true', 'fetch', '-q', bundle, 'HEAD');
  git(dir, 'push', '-q', remote, `FETCH_HEAD:refs/heads/${ref}`);
  return git(dir, 'rev-parse', 'FETCH_HEAD');
}

function selfTest() {
  assert.equal(target('agent/7-sum\n', 7), 'agent/7-sum');
  for (const [title, ref, open] of [['default branch', 'main'], ['other issue', 'agent/8-sum'], ['ref path', 'refs/heads/main'], ['no branch', ''], ['second branch of the task', 'agent/7-other', 'agent/7-sum']]) assert.throws(() => target(ref, 7, open), title);
  const box = mkdtempSync(join(tmpdir(), 'serio-push-')), origin = join(box, 'origin.git'), work = join(box, 'work'), bundle = join(box, 'commits.bundle');
  const commit = (file, text) => { writeFileSync(join(work, file), text); git(work, 'add', '.'); git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file); return git(work, 'rev-parse', 'HEAD'); };
  try {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['clone', '-q', origin, work], { stdio: 'ignore' });
    const base = commit('a.txt', 'a'); git(work, 'push', '-q', 'origin', 'HEAD:main');
    git(work, 'checkout', '-q', '-b', 'agent/7-sum');
    const head = commit('b.txt', 'b'); git(work, 'bundle', 'create', '-q', bundle, `${base}..HEAD`);
    assert.equal(push(origin, bundle, 'agent/7-sum', join(box, 'one')), head);
    assert.deepEqual([git(origin, 'rev-parse', 'agent/7-sum'), git(origin, 'rev-parse', 'main')], [head, base], 'the branch moves, the default branch does not');
    git(work, 'reset', '-q', '--hard', base);
    commit('c.txt', 'c'); git(work, 'bundle', 'create', '-q', bundle, `${base}..HEAD`);
    assert.throws(() => push(origin, bundle, 'agent/7-sum', join(box, 'two')), 'a rewritten history is refused');
    assert.equal(git(origin, 'rev-parse', 'agent/7-sum'), head);
  } finally { rmSync(box, { recursive: true, force: true }); }
  const calls = [], io = (draft) => ({ all: () => [{ number: 9, draft, node_id: 'n' }], one: () => ({ title: 't', default_branch: 'main' }), send: (m, p) => { calls.push(p); return {}; }, push: () => { calls.push('push'); return 'h'; } });
  publish({ repo: 'o/r', ref: 'agent/7-sum', issue: 7, stage: 'deliver', body: 'b' }, io(true));
  assert.deepEqual(calls, ['graphql', 'push', 'repos/o/r/pulls/9'], 'deliver readies the draft before the push, so the gate of the push runs on a ready pull request');
  calls.length = 0; publish({ repo: 'o/r', ref: 'agent/7-sum', issue: 7, stage: 'write-tests', body: 'b' }, io(true));
  assert.deepEqual(calls, ['push', 'repos/o/r/pulls/9'], 'other stages leave the draft');
  calls.length = 0;
  assert.throws(() => publish({ repo: 'o/r', ref: 'agent/7-sum', issue: 7, stage: 'deliver', body: 'b' }, { ...io(true), send: (m, p, b) => { calls.push(b?.query?.match(/\{(\w+)\(/)?.[1] || p); return {}; }, push: () => { throw new Error('refused'); } }), /refused/);
  assert.deepEqual(calls, ['markPullRequestReadyForReview', 'convertPullRequestToDraft'], 'a failed push puts the pull request back to draft');
  console.log('push self-test: 13 checks passed');
}

export function publishCard({ repo, out, issue, ref, stage }, io = { one, all, send, raw }) {
  const card = join(out, 'pr.md');
  if (stage !== 'deliver' || !existsSync(card)) return;
  const pr = io.all(`repos/${repo}/pulls?state=open&head=${repo.split('/')[0]}:${ref}`)[0];
  if (!pr) return;
  io.send('PATCH', `repos/${repo}/pulls/${pr.number}`, { title: io.one(`repos/${repo}/issues/${issue}`).title, body: readFileSync(card, 'utf8').slice(0, 60000) });
  if (pr.draft) io.send('POST', 'graphql', { query: 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){clientMutationId}}', variables: { id: pr.node_id } });
}

export function publish({ repo, ref, issue, stage, body }, io) {
  let pr = io.all(`repos/${repo}/pulls?state=open&head=${repo.split('/')[0]}:${ref}`)[0];
  const ready = stage === 'deliver' && pr?.draft;
  if (ready) io.send('POST', 'graphql', { query: 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){clientMutationId}}', variables: { id: pr.node_id } });
  let head;
  try { head = io.push(ref); } catch (e) {
    if (ready) try { io.send('POST', 'graphql', { query: 'mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){clientMutationId}}', variables: { id: pr.node_id } }); } catch (c) { e.message += `; back to draft failed: ${c.message}`; }
    throw e;
  }
  const title = io.one(`repos/${repo}/issues/${issue}`).title;
  if (!pr) pr = io.send('POST', `repos/${repo}/pulls`, { title, head: ref, base: io.one(`repos/${repo}`).default_branch, body: body || `Fixes #${issue}`, draft: true });
  else if (body) io.send('PATCH', `repos/${repo}/pulls/${pr.number}`, { title, body });
  return { head, pr };
}

function main() {
  const { OUT, ISSUE, REF, STAGE, GH_TOKEN } = process.env, repo = repoOf(), bundle = join(OUT, 'commits.bundle'), card = join(OUT, 'pr.md');
  if (!existsSync(bundle)) { publishCard({ repo, out: OUT, issue: ISSUE, ref: REF, stage: STAGE }); return console.log('no new commit'); }
  const ref = target(readFileSync(join(OUT, 'ref'), 'utf8'), ISSUE, REF);
  const body = existsSync(card) ? readFileSync(card, 'utf8').slice(0, 60000) : undefined;
  const pushRef = (r) => push(`https://x-access-token:${GH_TOKEN}@github.com/${repo}.git`, bundle, r, mkdtempSync(join(tmpdir(), 'serio-push-')));
  const { head, pr } = publish({ repo, ref, issue: ISSUE, stage: STAGE, body }, { one, all, send, push: pushRef });
  console.log(`pushed ${head} to ${ref}, pull request #${pr.number}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) (process.argv.includes('--self-test') ? selfTest : main)();
