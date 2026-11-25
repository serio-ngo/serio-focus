#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check } from './lock.mjs';
import { comment, note } from './publish.mjs';
import { all, fixMarkers, isStatus, issueOf, lockOf, lockReview, one, owners, ownersOf, owns, park, person, robot, send, specComment, specMarker, status, specSha, testsOk } from '../lib/lifecycle.mjs';

const FOCUS = new URL(JSON.parse(readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url))).repository).pathname.slice(1);
const CAPS = { 'spec-review': [40, 10], 'write-tests': [80, 20], deliver: [160, 40], 'pr-loop': [60, 15] };

export function route(name, ev, s) {
  const stop = (why, tell) => ({ stop: why, tell });
  const run = (stage, issue, extra = {}) => {
    const tell = extra.bot ? undefined : extra.pr || issue, login = s.issue(issue).assignees?.[0]?.login;
    if (!s.guarded && !s.private) return stop('the default branch has no ruleset that restricts updates', tell);
    if (!s.own.size) return stop('CODEOWNERS names no person; team owners are not resolved', tell);
    if (!login) return stop('the issue has no assignee', tell);
    const named = (s.comments?.(issue) || []).filter((c) => owns(c.user, s.own)).map((c) => /^<!-- improve v1 focus=(\S+) -->\s*$/m.exec(c.body)?.[1]).filter(Boolean).pop();
    return { stage, issue, assignee: login, ...extra, focus: /^improve\/[a-z0-9-]+$/.test(named) && s.branch(named) ? named : '' };
  };
  const tests = (n, extra = {}) => {
    const wrote = s.comments(n).filter((c) => robot(c.user)).map((c) => /^<!-- write-tests v1 spec=([0-9a-f]{12}) -->$/.exec(c.body || '')?.[1]).filter(Boolean);
    if (!extra.pr && wrote.at(-1) === specSha(s.issue(n))) return stop('the tests were written for this spec text; edit the spec to write them again, or request changes on the draft', n);
    if (wrote.length > 1) return { park: n, stop: `the tests were written ${wrote.length} times. Decide: write them by hand with /serio-focus:write-tests ${n}, or close the task` };
    return run('write-tests', n, extra);
  };
  const idle = (pr) => s.comments(pr.number).some((c) => isStatus(c, s.own) && c.body.includes(`<!-- no-push v1 sha=${pr.head.sha} -->`));
  if (name === 'issues' && ev.action === 'labeled') {
    const n = ev.issue.number;
    if (!person(ev.sender) || ev.issue.pull_request) return stop('label is not from a person on an issue');
    if (ev.label?.name === 'spec-review') return run('spec-review', n, { spec: specSha(s.issue(n)) });
    if (ev.label?.name === 'tests-ok') {
      const draft = s.openPulls().find((p) => p.draft && issueOf(p.head.ref) === n);
      return stop(draft ? `tests-ok is a review on draft pull request #${draft.number}: Review changes, Comment, text tests-ok` : 'tests-ok needs the draft pull request from the tests run first', n);
    }
    if (ev.label?.name !== 'spec-ok') return stop('label is not routed');
    const mark = specMarker(s.comments(n), s.own);
    if (mark?.verdict !== 'ready' || mark.sha !== specSha(s.issue(n))) {
      const earlier = specComment(s.comments(n), s.own), has = /^\| AC\d+ \|/m.test(earlier?.body || '');
      if (!owns(ev.sender, s.own)) return stop(`no ready spec review of the current issue text; ${has ? 'a code owner can accept the reviewed criteria by adding spec-ok' : 'add spec-review first'}`, n);
      const criteria = [...(earlier?.body || '').matchAll(/^\| AC(\d+) \| (.*) \| (unit|e2e) \| `([^`]+)` \|$/gm)].map(([, id, text, level, test]) => ({ id: +id, text: text.replace(/\\\|/g, '|'), level, test }));
      const kept = /^Review checks: (.+)$/m.exec(earlier?.body || '')?.[1];
      const accept = comment({ verdict: 'ready', criteria, checks: kept ? [kept] : [] }, specSha(s.issue(n)), `Accepted by ${ev.sender.login} without a ready review; open questions stay on the earlier review.`, s.issue(n).body);
      return accept ? tests(n, { bypass: ev.sender.login, accept }) : stop('no reviewed criteria to accept yet: add spec-review first', n);
    }
    return tests(n);
  }
  if (name === 'pull_request_review' && ev.action === 'submitted') {
    const pr = s.pull(ev.pull_request.number), n = issueOf(pr.head.ref);
    if (!n || pr.head.repo?.full_name !== s.repo || pr.state !== 'open') return stop('not an open lifecycle pull request');
    if (!s.own.size && person(ev.review.user)) return stop('CODEOWNERS names no person; team owners are not resolved', pr.number);
    if (!owns(ev.review.user, s.own)) return stop('review is not from a code owner');
    const at = { pr: pr.number, ref: pr.head.ref, sha: pr.head.sha };
    if (testsOk(ev.review.body) && ev.review.state !== 'changes_requested') return !pr.draft ? stop('tests-ok on a ready pull request', pr.number) : ev.review.commit_id === pr.head.sha ? run('deliver', n, at) : stop('tests-ok is not on the current head', pr.number);
    if (ev.review.state !== 'changes_requested') return stop('review is not routed');
    if (!lockOf(s.reviews(pr.number), s.own)) return tests(n, at);
    return idle(pr) ? stop('a pr-loop run pushed nothing on this head: push a change, or run /serio-focus:pr-loop by hand', pr.number) : run('pr-loop', n, at);
  }
  if (name === 'workflow_run' && ev.action === 'completed') {
    const w = ev.workflow_run;
    if (w.conclusion !== 'failure') return stop('CI did not fail');
    if (w.head_repository?.full_name !== s.repo || !issueOf(w.head_branch)) return stop('not a lifecycle branch of this repository');
    const pr = s.pulls(w.head_branch).find((p) => p.head.sha === w.head_sha);
    if (!pr) return stop('stale head or no open pull request');
    const reviews = s.reviews(pr.number), lock = lockReview(reviews, s.own);
    if (!lock) return stop('no test lock yet');
    if (w.created_at < reviews.find((r) => owns(r.user, s.own) && testsOk(r.body)).submitted_at) return stop('CI started before the first test lock');
    if (fixMarkers(s.comments(pr.number)).some((f) => f.run === w.id && f.attempt === w.run_attempt)) return stop('duplicate CI event');
    if (idle(pr)) return stop('a pr-loop run pushed nothing on this head');
    const jobs = s.jobs?.(w) || [], job = (name) => jobs.find((j) => j.name.endsWith(name));
    if (job('tests')?.conclusion === 'success' && job('lock and acceptance')?.steps?.some((st) => st.name === 'Test lock' && st.conclusion === 'failure')) return stop(`tests pass and only the test lock fails; a person reads its "test lock:" line. Locked paths changed: review https://github.com/${s.repo}/compare/${lock.commit_id}...${pr.head.sha} and accept with a tests-ok review on the head. Any other cause: fix the spec review or spec-ok it names. Then gh run rerun ${w.id} --failed -R ${s.repo}`, pr.number);
    const red = new Set(s.failures(w).filter((f) => f.created_at > lock.submitted_at).map((f) => f.id)).add(w.id);
    if (red.size > 2) return { park: pr.number, stop: `CI failed after 2 fix runs: ${w.html_url}` };
    return run('pr-loop', issueOf(pr.head.ref), { pr: pr.number, ref: pr.head.ref, sha: pr.head.sha, bot: true, marker: `<!-- fix-ci v1 run=${w.id} attempt=${w.run_attempt} sha=${w.head_sha} -->` });
  }
  return stop('event is not routed');
}

function selfTest() {
  const user = (login, type = 'User') => ({ login, type });
  const ada = user('ada'), eve = user('eve'), app = user('serio-agent[bot]', 'Bot'), actions = user('github-actions[bot]', 'Bot');
  const issue = { number: 7, title: 'Sum', body: 'AC1', assignees: [ada] };
  const sha = specSha(issue);
  const ready = { user: actions, body: `<!-- spec-review v1 sha=${sha} verdict=ready ac=1 -->` };
  const earlier = { user: actions, body: comment({ verdict: 'questions', criteria: [{ id: 1, text: 'Given a | b, When x, Then y', level: 'unit', test: 'x gives y' }, { id: 2, text: 'Given 2, When Add, Then 3', level: 'e2e', test: 'Add shows the sum' }], questions: [{ question: 'Which locale?', recommended: 'pl-PL' }] }, '000000000000') };
  const lock = { user: ada, body: 'tests-ok', commit_id: 'h1', state: 'COMMENTED', submitted_at: '2026-01-02' };
  const fail = (id, created_at = '2026-01-03') => ({ id, created_at });
  const lockOnly = [{ name: 'gate / tests', conclusion: 'success' }, { name: 'gate / lock and acceptance', conclusion: 'failure', steps: [{ name: 'Test lock', conclusion: 'failure' }] }];
  const fix = (run) => ({ user: actions, body: `<!-- fix-ci v1 run=${run} attempt=1 sha=abc -->` });
  const wrote = (spec, who = actions) => ({ user: who, body: `<!-- write-tests v1 spec=${spec} -->` });
  const idle = (head) => ({ user: actions, body: `<!-- lifecycle-status v1 -->\n\n**Log**\n- **needs-human**: the run ended without a new push. <!-- no-push v1 sha=${head} --> <!-- park at=2026-01-03T00:00:00Z -->` });
  const edited = { ...issue, body: 'AC1 edited' }, readyEdited = { user: actions, body: `<!-- spec-review v1 sha=${specSha(edited)} verdict=ready ac=1 -->` };
  const pr = { number: 9, state: 'open', draft: true, head: { ref: 'agent/7-sum', sha: 'h1', repo: { full_name: 'o/r' } } };
  const state = (over = {}) => ({ repo: 'o/r', guarded: true, failures: () => [], own: owners('* @ada\n'), issue: () => issue, comments: () => [ready], reviews: () => [lock], pulls: () => [pr], openPulls: () => [pr], pull: () => pr, ...over });
  const label = (name, sender = ada) => ({ action: 'labeled', label: { name }, sender, issue: { number: 7 } });
  const review = (body, state_, who = ada, commit = 'h1') => ({ action: 'submitted', pull_request: pr, review: { user: who, body, state: state_, commit_id: commit } });
  const ci = (over = {}) => ({ action: 'completed', workflow_run: { id: 5, run_attempt: 1, conclusion: 'failure', head_branch: 'agent/7-sum', head_sha: 'h1', head_repository: { full_name: 'o/r' }, html_url: 'u', ...over } });
  const cases = [
    ['spec-review label', 'issues', label('spec-review'), state(), 'spec-review'],
    ['spec-ok label', 'issues', label('spec-ok'), state(), 'write-tests'],
    ['label from a bot', 'issues', label('spec-ok', app), state(), undefined],
    ['spec-ok without a review', 'issues', label('spec-ok'), state({ comments: () => [] }), undefined],
    ['spec-ok bypass accepting earlier criteria', 'issues', label('spec-ok'), state({ comments: () => [earlier] }), 'write-tests'],
    ['spec-ok bypass with a newer review without criteria', 'issues', label('spec-ok'), state({ comments: () => [earlier, { ...ready, body: '<!-- spec-review v1 sha=000000000000 verdict=questions ac= -->' }] }), undefined],
    ['spec-ok bypass by a non-owner', 'issues', label('spec-ok', eve), state({ comments: () => [earlier] }), undefined],
    ['spec-ok bypass with a forged review', 'issues', label('spec-ok'), state({ comments: () => [{ ...earlier, user: eve }] }), undefined],
    ['tests-ok issue label', 'issues', label('tests-ok'), state(), undefined],
    ['spec-ok after an edit', 'issues', label('spec-ok', eve), state({ issue: () => ({ ...issue, body: 'AC1 edited' }) }), undefined],
    ['spec-ok with a forged marker', 'issues', label('spec-ok', eve), state({ comments: () => [{ ...ready, user: app }] }), undefined],
    ['no assignee', 'issues', label('spec-review'), state({ issue: () => ({ ...issue, assignees: [] }) }), undefined],
    ['tests-ok review', 'pull_request_review', review('tests-ok', 'commented'), state(), 'deliver'],
    ['tests-ok on an old head', 'pull_request_review', review('tests-ok', 'commented', ada, 'h0'), state(), undefined],
    ['tests-ok from a bot', 'pull_request_review', review('tests-ok', 'approved', app), state(), undefined],
    ['tests-ok from a stranger', 'pull_request_review', review('tests-ok', 'commented', user('eve')), state(), undefined],
    ['changes before the lock', 'pull_request_review', review('fix AC1', 'changes_requested'), state({ reviews: () => [] }), 'write-tests'],
    ['changes after the lock', 'pull_request_review', review('fix AC1', 'changes_requested'), state(), 'pr-loop'],
    ['tests-ok on a ready pull request', 'pull_request_review', { ...review('tests-ok', 'commented'), pull_request: { ...pr, draft: false } }, state({ pull: () => ({ ...pr, draft: false }) }), undefined],
    ['change request that starts with tests-ok', 'pull_request_review', review('tests-ok but AC2 is wrong', 'changes_requested'), state(), 'pr-loop'],
    ['owner of one path only', 'pull_request_review', review('tests-ok', 'commented', user('eve')), state({ own: owners('* @ada\n/docs/ @eve\n') }), undefined],
    ['red CI', 'workflow_run', ci(), state(), 'pr-loop'],
    ['stale head', 'workflow_run', ci({ head_sha: 'h0' }), state(), undefined],
    ['fork run', 'workflow_run', ci({ head_repository: { full_name: 'x/r' } }), state(), undefined],
    ['other branch', 'workflow_run', ci({ head_branch: 'main' }), state(), undefined],
    ['red CI before the lock', 'workflow_run', ci(), state({ reviews: () => [] }), undefined],
    ['red CI that started before the lock', 'workflow_run', ci({ created_at: '2026-01-01' }), state(), undefined],
    ['duplicate run', 'workflow_run', ci(), state({ comments: () => [fix(5)] }), undefined],
    ['second red CI', 'workflow_run', ci(), state({ failures: () => [fail(4), fail(5)] }), 'pr-loop'],
    ['red CI from before the lock', 'workflow_run', ci(), state({ failures: () => [fail(2, '2026-01-01'), fail(3, '2026-01-01'), fail(5)] }), 'pr-loop'],
    ['third red CI', 'workflow_run', ci(), state({ failures: () => [fail(3), fail(4), fail(5)] }), undefined],
    ['red CI only on the test lock', 'workflow_run', ci(), state({ jobs: () => lockOnly }), undefined],
    ['red CI on tests and the test lock', 'workflow_run', ci(), state({ jobs: () => [{ ...lockOnly[0], conclusion: 'failure' }, lockOnly[1]] }), 'pr-loop'],
    ['team-only code owners', 'pull_request_review', review('tests-ok', 'commented'), state({ own: owners('* @o/team\n') }), undefined],
    ['edited marker', 'issues', label('spec-ok', eve), state({ comments: () => [{ ...ready, created_at: 'a', updated_at: 'b' }] }), undefined],
    ['spec-ok again on the spec the tests were written for', 'issues', label('spec-ok'), state({ comments: () => [ready, wrote(sha)] }), undefined],
    ['spec-ok after the spec changed', 'issues', label('spec-ok'), state({ issue: () => edited, comments: () => [readyEdited, wrote(sha)] }), 'write-tests'],
    ['spec-ok with a forged tests marker', 'issues', label('spec-ok'), state({ comments: () => [ready, wrote(sha, eve)] }), 'write-tests'],
    ['second rewrite', 'issues', label('spec-ok'), state({ issue: () => edited, comments: () => [readyEdited, wrote(sha), wrote('000000000000')] }), undefined],
    ['changes before the lock on the same spec', 'pull_request_review', review('fix AC1', 'changes_requested'), state({ reviews: () => [], comments: () => [ready, wrote(sha)] }), 'write-tests'],
    ['red CI after a pr-loop run pushed nothing on this head', 'workflow_run', ci(), state({ comments: () => [idle('h1')] }), undefined],
    ['changes after a pr-loop run pushed nothing on this head', 'pull_request_review', review('fix AC1', 'changes_requested'), state({ comments: () => [ready, idle('h1')] }), undefined],
    ['red CI on a new head after a pr-loop run pushed nothing', 'workflow_run', ci(), state({ comments: () => [idle('h0')] }), 'pr-loop'],
    ['forged no-push status', 'workflow_run', ci(), state({ comments: () => [{ ...idle('h1'), user: eve }] }), 'pr-loop'],
  ];
  for (const [title, name, ev, s, want] of cases) assert.equal(route(name, ev, s).stage, want, title);
  const tells = [
    ['no assignee', 'issues', label('spec-review'), state({ issue: () => ({ ...issue, assignees: [] }) }), 7],
    ['tests-ok on an old head', 'pull_request_review', review('tests-ok', 'commented', ada, 'h0'), state(), 9],
    ['label from a bot', 'issues', label('spec-ok', app), state(), undefined],
    ['red CI on a task without an assignee', 'workflow_run', ci(), state({ issue: () => ({ ...issue, assignees: [] }) }), undefined],
  ];
  for (const [title, name, ev, s, want] of tells) assert.equal(route(name, ev, s).tell, want, title);
  const bypass = route('issues', label('spec-ok'), state({ comments: () => [earlier] }));
  assert.equal(bypass.bypass, 'ada');
  assert.match(bypass.accept, /\n\| AC1 \| Given a \\\| b, When x, Then y \| unit \| `x gives y` \|\n/);
  assert.deepEqual(specMarker([{ user: actions, body: bypass.accept }], owners('* @ada\n')), { sha, verdict: 'ready', ac: [1, 2] });
  const posted = [{ user: actions, body: bypass.accept }], ok = (c) => check({ pr: { draft: false, head: pr.head, base: { repo: { full_name: 'o/r' } } }, issue: { ...issue, labels: [{ name: 'spec-ok' }] }, comments: c, reviews: [lock], own: owners('* @ada\n'), changed: () => ['src/a.mjs'] }).ok;
  assert.deepEqual([ok(posted), ok([earlier])], [true, false]);
  const red = route('workflow_run', ci(), state());
  assert.equal(red.bot, true); assert.match(red.marker, /fix-ci v1 run=5 attempt=1 sha=h1/);
  assert.equal(route('workflow_run', ci(), state({ failures: () => [fail(3), fail(4), fail(5)] })).park, 9);
  const parked = route('issues', label('spec-ok'), state({ issue: () => edited, comments: () => [readyEdited, wrote(sha), wrote('000000000000')] }));
  assert.deepEqual([parked.park, parked.stage], [7, undefined]); assert.match(parked.stop, /Decide: /);
  assert.equal(route('pull_request_review', review('fix AC1', 'changes_requested'), state({ comments: () => [ready, idle('h1')] })).tell, 9);
  const held = route('workflow_run', ci(), state({ jobs: () => lockOnly }));
  assert.deepEqual([held.tell, held.marker, held.park], [9, undefined, undefined]);
  assert.ok(held.stop.endsWith('https://github.com/o/r/compare/h1...h1 and accept with a tests-ok review on the head. Any other cause: fix the spec review or spec-ok it names. Then gh run rerun 5 --failed -R o/r'), held.stop);
  console.log(`route self-test: ${cases.length + tells.length + 14} checks passed`);
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY, seen = new Map(), ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let guarded = false;
  try { guarded = all(`repos/${repo}/rules/branches/${ev.repository.default_branch}?per_page=100`).some((rule) => rule.type === 'update'); } catch { }
  const s = {
    repo, guarded, private: ev.repository.private, own: ownersOf(repo),
    jobs: (w) => { try { return all(`repos/${repo}/actions/runs/${w.id}/attempts/${w.run_attempt}/jobs?per_page=100`).flatMap((page) => page.jobs); } catch { return []; } },
    failures: (w) => all(`repos/${repo}/actions/workflows/${w.workflow_id}/runs?branch=${w.head_branch}&status=failure&per_page=100`).flatMap((page) => page.workflow_runs),
    issue: (n) => seen.get(n) || seen.set(n, one(`repos/${repo}/issues/${n}`)).get(n),
    comments: (n) => all(`repos/${repo}/issues/${n}/comments?per_page=100`),
    reviews: (n) => all(`repos/${repo}/pulls/${n}/reviews?per_page=100`),
    pull: (n) => one(`repos/${repo}/pulls/${n}`),
    branch: (name) => { try { one(`repos/${FOCUS}/branches/${name}`); return true; } catch (e) { if (/404/.test(e.stderr)) return false; throw e; } },
    openPulls: () => all(`repos/${repo}/pulls?state=open&per_page=100`),
    pulls: (branch) => all(`repos/${repo}/pulls?state=open&head=${repo.split('/')[0]}:${branch}`),
  };
  const r = route(process.env.GITHUB_EVENT_NAME, ev, s);
  if (r.tell) try { status(repo, r.tell, { now: `Not started: ${r.stop}.`, line: note(`Not started: ${r.stop}.`, 'route', process.env.GITHUB_RUN_ID) }); } catch { }
  if (r.park) park(repo, r.park, r.stop);
  if (r.accept) {
    send('POST', `repos/${repo}/issues/${r.issue}/comments`, { body: r.accept });
    try { status(repo, r.issue, { now: `${r.bypass} bypassed the spec review and accepted the reviewed criteria.`, next: 'the tests run writes a draft pull request', line: note(`Bypass: ${r.bypass} accepted the reviewed criteria without a ready review`, 'bypass', process.env.GITHUB_RUN_ID) }); } catch { }
  }
  if (r.marker) send('POST', `repos/${repo}/issues/${r.pr}/comments`, { body: r.marker });
  const [turns, timeout] = CAPS[r.stage] || [0, 1];
  const out = { stage: r.stage || '', issue: r.issue || '', pr: r.pr || '', ref: r.ref || '', sha: r.sha || '', spec: r.spec || '', assignee: r.assignee || '', secret: r.assignee ? `CLAUDE_TOKEN_${r.assignee.toUpperCase().replace(/[^A-Z0-9]/g, '_')}` : '', bot: r.bot || '', bypass: r.bypass || '', focus: r.focus || '', turns, timeout };
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''));
  console.log(r.stage ? `stage ${r.stage} for issue ${r.issue}` : `stop: ${r.stop}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) (process.argv.includes('--self-test') ? selfTest : main)();
