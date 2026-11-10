#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { all, fixMarkers, issueOf, lockOf, lockReview, one, owners, ownersOf, owns, park, person, send, specMarker, specSha, testsOk } from '../lib/lifecycle.mjs';

const CAPS = { 'spec-review': [15, 10], 'write-tests': [40, 20], deliver: [80, 40], 'pr-loop': [30, 15] };

export function route(name, ev, s) {
  const stop = (why) => ({ stop: why });
  const run = (stage, issue, extra = {}) => {
    const login = s.issue(issue).assignees?.[0]?.login;
    return login ? { stage, issue, assignee: login, ...extra } : stop('the issue has no assignee');
  };
  if (!s.guarded) return stop('the default branch has no ruleset that restricts updates');
  if (name === 'issues' && ev.action === 'labeled') {
    const n = ev.issue.number;
    if (!person(ev.sender) || ev.issue.pull_request) return stop('label is not from a person on an issue');
    if (ev.label?.name === 'spec-review') return run('spec-review', n, { spec: specSha(s.issue(n)) });
    if (ev.label?.name !== 'spec-ok') return stop('label is not routed');
    const mark = specMarker(s.comments(n), s.own);
    if (mark?.verdict !== 'ready' || mark.sha !== specSha(s.issue(n))) return stop('no ready spec review of the current issue text');
    return run('write-tests', n);
  }
  if (name === 'pull_request_review' && ev.action === 'submitted') {
    const pr = ev.pull_request, n = issueOf(pr.head.ref);
    if (!n || pr.head.repo?.full_name !== s.repo || pr.state !== 'open') return stop('not an open lifecycle pull request');
    if (!owns(ev.review.user, s.own)) return stop('review is not from a code owner');
    const at = { pr: pr.number, ref: pr.head.ref, sha: pr.head.sha };
    if (testsOk(ev.review.body)) return ev.review.commit_id === pr.head.sha ? run('deliver', n, at) : stop('tests-ok is not on the current head');
    if (ev.review.state !== 'changes_requested') return stop('review is not routed');
    return run(lockOf(s.reviews(pr.number), s.own) ? 'pr-loop' : 'write-tests', n, at);
  }
  if (name === 'workflow_run' && ev.action === 'completed') {
    const w = ev.workflow_run;
    if (w.conclusion !== 'failure') return stop('CI did not fail');
    if (w.head_repository?.full_name !== s.repo || !issueOf(w.head_branch)) return stop('not a lifecycle branch of this repository');
    const pr = s.pulls(w.head_branch).find((p) => p.head.sha === w.head_sha);
    if (!pr) return stop('stale head or no open pull request');
    const lock = lockReview(s.reviews(pr.number), s.own);
    if (!lock) return stop('no test lock yet');
    if (fixMarkers(s.comments(pr.number)).some((f) => f.run === w.id && f.attempt === w.run_attempt)) return stop('duplicate CI event');
    const red = new Set(s.failures(w).filter((f) => f.created_at > lock.submitted_at).map((f) => f.id)).add(w.id);
    if (red.size > 2) return { park: pr.number, stop: `CI failed after 2 fix runs: ${w.html_url}` };
    return run('pr-loop', issueOf(pr.head.ref), { pr: pr.number, ref: pr.head.ref, sha: pr.head.sha, bot: true, marker: `<!-- fix-ci v1 run=${w.id} attempt=${w.run_attempt} sha=${w.head_sha} -->` });
  }
  return stop('event is not routed');
}

function selfTest() {
  const user = (login, type = 'User') => ({ login, type });
  const ada = user('ada'), app = user('serio-agent[bot]', 'Bot'), actions = user('github-actions[bot]', 'Bot');
  const issue = { number: 7, title: 'Sum', body: 'AC1', assignees: [ada] };
  const sha = specSha(issue);
  const ready = { user: actions, body: `<!-- spec-review v1 sha=${sha} verdict=ready ac=1 -->` };
  const lock = { user: ada, body: 'tests-ok', commit_id: 'h1', state: 'COMMENTED', submitted_at: '2026-01-02' };
  const fail = (id, created_at = '2026-01-03') => ({ id, created_at });
  const fix = (run) => ({ user: actions, body: `<!-- fix-ci v1 run=${run} attempt=1 sha=abc -->` });
  const pr = { number: 9, state: 'open', head: { ref: 'agent/7-sum', sha: 'h1', repo: { full_name: 'o/r' } } };
  const state = (over = {}) => ({ repo: 'o/r', guarded: true, failures: () => [], own: owners('* @ada\n'), issue: () => issue, comments: () => [ready], reviews: () => [lock], pulls: () => [pr], ...over });
  const label = (name, sender = ada) => ({ action: 'labeled', label: { name }, sender, issue: { number: 7 } });
  const review = (body, state_, who = ada, commit = 'h1') => ({ action: 'submitted', pull_request: pr, review: { user: who, body, state: state_, commit_id: commit } });
  const ci = (over = {}) => ({ action: 'completed', workflow_run: { id: 5, run_attempt: 1, conclusion: 'failure', head_branch: 'agent/7-sum', head_sha: 'h1', head_repository: { full_name: 'o/r' }, html_url: 'u', ...over } });
  const cases = [
    ['spec-review label', 'issues', label('spec-review'), state(), 'spec-review'],
    ['spec-ok label', 'issues', label('spec-ok'), state(), 'write-tests'],
    ['label from a bot', 'issues', label('spec-ok', app), state(), undefined],
    ['spec-ok without a review', 'issues', label('spec-ok'), state({ comments: () => [] }), undefined],
    ['spec-ok after an edit', 'issues', label('spec-ok'), state({ issue: () => ({ ...issue, body: 'AC1 edited' }) }), undefined],
    ['spec-ok with a forged marker', 'issues', label('spec-ok'), state({ comments: () => [{ ...ready, user: app }] }), undefined],
    ['no assignee', 'issues', label('spec-review'), state({ issue: () => ({ ...issue, assignees: [] }) }), undefined],
    ['tests-ok review', 'pull_request_review', review('tests-ok', 'commented'), state(), 'deliver'],
    ['tests-ok on an old head', 'pull_request_review', review('tests-ok', 'commented', ada, 'h0'), state(), undefined],
    ['tests-ok from a bot', 'pull_request_review', review('tests-ok', 'approved', app), state(), undefined],
    ['tests-ok from a stranger', 'pull_request_review', review('tests-ok', 'commented', user('eve')), state(), undefined],
    ['changes before the lock', 'pull_request_review', review('fix AC1', 'changes_requested'), state({ reviews: () => [] }), 'write-tests'],
    ['changes after the lock', 'pull_request_review', review('fix AC1', 'changes_requested'), state(), 'pr-loop'],
    ['plain comment review', 'pull_request_review', review('nice', 'commented'), state(), undefined],
    ['red CI', 'workflow_run', ci(), state(), 'pr-loop'],
    ['green CI', 'workflow_run', ci({ conclusion: 'success' }), state(), undefined],
    ['stale head', 'workflow_run', ci({ head_sha: 'h0' }), state(), undefined],
    ['fork run', 'workflow_run', ci({ head_repository: { full_name: 'x/r' } }), state(), undefined],
    ['other branch', 'workflow_run', ci({ head_branch: 'main' }), state(), undefined],
    ['red CI before the lock', 'workflow_run', ci(), state({ reviews: () => [] }), undefined],
    ['duplicate run', 'workflow_run', ci(), state({ comments: () => [fix(5)] }), undefined],
    ['second red CI', 'workflow_run', ci(), state({ failures: () => [fail(4), fail(5)] }), 'pr-loop'],
    ['red CI from before the lock', 'workflow_run', ci(), state({ failures: () => [fail(2, '2026-01-01'), fail(3, '2026-01-01'), fail(5)] }), 'pr-loop'],
    ['third red CI', 'workflow_run', ci(), state({ failures: () => [fail(3), fail(4), fail(5)] }), undefined],
    ['no ruleset', 'issues', label('spec-review'), state({ guarded: false }), undefined],
    ['edited marker', 'issues', label('spec-ok'), state({ comments: () => [{ ...ready, created_at: 'a', updated_at: 'b' }] }), undefined],
    ['unknown event', 'push', {}, state(), undefined],
  ];
  for (const [title, name, ev, s, want] of cases) assert.equal(route(name, ev, s).stage, want, title);
  const red = route('workflow_run', ci(), state());
  assert.equal(red.bot, true); assert.match(red.marker, /fix-ci v1 run=5 attempt=1 sha=h1/);
  assert.equal(route('workflow_run', ci(), state({ failures: () => [fail(3), fail(4), fail(5)] })).park, 9);
  console.log(`route self-test: ${cases.length + 3} checks passed`);
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY, seen = new Map(), ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let guarded = false;
  try { guarded = all(`repos/${repo}/rules/branches/${ev.repository.default_branch}?per_page=100`).some((rule) => rule.type === 'update'); } catch { }
  const s = {
    repo, guarded, own: ownersOf(repo),
    failures: (w) => all(`repos/${repo}/actions/workflows/${w.workflow_id}/runs?branch=${w.head_branch}&status=failure&per_page=100`).flatMap((page) => page.workflow_runs),
    issue: (n) => seen.get(n) || seen.set(n, one(`repos/${repo}/issues/${n}`)).get(n),
    comments: (n) => all(`repos/${repo}/issues/${n}/comments?per_page=100`),
    reviews: (n) => all(`repos/${repo}/pulls/${n}/reviews?per_page=100`),
    pulls: (branch) => all(`repos/${repo}/pulls?state=open&head=${repo.split('/')[0]}:${branch}`),
  };
  const r = route(process.env.GITHUB_EVENT_NAME, ev, s);
  if (r.park) park(repo, r.park, r.stop);
  if (r.marker) send('POST', `repos/${repo}/issues/${r.pr}/comments`, { body: r.marker });
  const [turns, timeout] = CAPS[r.stage] || [0, 1];
  const out = { stage: r.stage || '', issue: r.issue || '', pr: r.pr || '', ref: r.ref || '', sha: r.sha || '', spec: r.spec || '', assignee: r.assignee || '', secret: r.assignee ? `CLAUDE_TOKEN_${r.assignee.toUpperCase().replace(/[^A-Z0-9]/g, '_')}` : '', bot: r.bot || '', turns, timeout };
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''));
  console.log(r.stage ? `stage ${r.stage} for issue ${r.issue}` : `stop: ${r.stop}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) (process.argv.includes('--self-test') ? selfTest : main)();
