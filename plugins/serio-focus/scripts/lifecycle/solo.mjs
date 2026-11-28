#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { all, issueOf, one, ownersOf, owns, raw, repoOf, robot, send, specSha, status } from '../lib/lifecycle.mjs';

const STAGES = ['red', 'locked', 'reviewed', 'verified'];
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const criteriaSha = (body) => sha(String(body || '').match(/^\s*AC\d+\b.*$/gm)?.join('\n') || '');
const ALLOWED = ['repository', 'issue', 'pr', 'spec_sha', 'base_sha', 'head_sha', 'lock_sha', 'stage', 'verifier', 'run', 'attempt', 'outcome'];
const git = (...args) => spawnSync('git', args, { stdio: 'inherit' });

export const io = {
  one, all, send, raw,
  push: (ref) => git('push', 'origin', ref),
  start: (stage, head, task) => {
    const r = launch(stage === 'red' ? 'test' : 'worker', { ...task, stage, head }, process.env, io);
    if (r.error || r.status !== 0) throw r.error || new Error(`solo: worker exited ${r.status}`);
  },
  spawn: spawnSync,
};

export const launch = (role, task, env, run = io) => {
  const prompt = role === 'test' ? `/serio-focus:write-tests ${task.issue}` : `/serio-focus:deliver task issue #${task.issue} stage ${task.stage}`;
  return run.spawn('claude', ['-p', prompt], { env: { HOME: env.HOME, PATH: env.PATH } });
};

export const publicRecord = (raw) => ({
  ...Object.fromEntries(ALLOWED.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]])),
  ...(raw.criteria && { criteria: raw.criteria.map(({ ac, test, result }) => ({ ac, test, result })) }),
});

export const start = ({ repo, issue, owner }, run = io) => {
  if (!ownersOf(repo, run.raw).has(String(owner).toLowerCase())) throw new Error(`solo: ${owner} is not a code owner`);
  const task = run.one(`repos/${repo}/issues/${issue}`), base_sha = run.one(`repos/${repo}/commits/HEAD`).sha;
  const auth = { repo, issue, owner, spec_sha: specSha(task), criteria_sha: criteriaSha(task.body), base_sha, branch: `agent/${issue}-${String(task.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` };
  run.send('POST', `repos/${repo}/issues/${issue}/comments`, { body: `<!-- solo v1 spec=${auth.spec_sha} criteria=${auth.criteria_sha} base=${base_sha} owner=${owner} -->` });
  return auth;
};

export const gate = (c, t, run = io) => {
  const rows = (c.criteria || []).map(({ ac, test }) => {
    const ts = (c.tests || []).filter((x) => x.name === test);
    return { ac, test, result: ts.length ? ts.find((x) => x.result !== 'passed')?.result || 'passed' : 'missing' };
  });
  const has = (r) => rows.some((x) => x.result === r);
  const code = [
    ['actor', c.actor !== t.owner], ['head', c.reviewed !== t.head], ['lock', c.lock !== t.lock],
    ['source', c.source !== t.app || c.verifier !== t.verifier], ['missing', !rows.length || has('missing')], ['skipped', has('skipped')],
    ['failed', rows.some((x) => x.result !== 'passed')], ['superseded', c.run !== t.run],
  ].find(([, bad]) => bad)?.[0];
  if (code) return { ok: false, line: `verification: reject — ${code}`, record: null };
  return { ok: true, line: 'verification: pass', record: { stage: 'verified', head_sha: t.head, lock_sha: t.lock, verifier: t.verifier, run: c.run, attempt: c.attempt, criteria: rows } };
};

export const advance = (auth, criteria, events, trusted) => {
  const records = [{ stage: 'spec', repository: auth.repo, issue: auth.issue, spec_sha: auth.spec_sha, base_sha: auth.base_sha }];
  let red;
  for (const e of events) {
    if (e.stage !== STAGES[records.length - 1]) break;
    if (e.stage === 'red') { red = e.sha; records.push({ stage: 'red', head_sha: e.sha }); continue; }
    if (e.stage === 'locked' && red && e.sha === red) { records.push({ stage: 'locked', lock_sha: e.sha }); continue; }
    if (e.stage === 'reviewed' && e.head === trusted.head) { records.push({ stage: 'reviewed', head_sha: e.head }); continue; }
    if (e.stage === 'verified') {
      const g = gate({ criteria, actor: e.actor, reviewed: trusted.head, lock: red, source: e.source, verifier: e.verifier, run: e.run, attempt: e.attempt, tests: e.tests }, { ...trusted, lock: red });
      if (g.ok) records.push(g.record);
    }
    break;
  }
  return { records };
};

export const confine = (auth, run) => {
  const { repo, issue, pr } = auth, ok = [`POST repos/${repo}/issues/${issue}/comments`, `POST repos/${repo}/issues/${pr}/comments`, `PATCH repos/${repo}/pulls/${pr}`];
  return {
    one: run.one, all: run.all, raw: run.raw,
    send: (method, path, body) => {
      if (!ok.includes(`${method} ${path}`)) throw new Error(`solo: publisher refused ${method} ${path}`);
      return run.send(method, path, body);
    },
    push: (ref) => {
      if (ref !== auth.branch) throw new Error(`solo: publisher refused push ${ref}`);
      return run.push(ref);
    },
  };
};

export const resume = ({ repo, number }, run = io) => {
  const pr = run.one(`repos/${repo}/pulls/${number}`), issue = issueOf(pr.head.ref), own = ownersOf(repo, run.raw);
  const comments = run.all(`repos/${repo}/issues/${number}/comments?per_page=100`).concat(run.all(`repos/${repo}/issues/${issue}/comments?per_page=100`)).filter((c) => robot(c.user) || owns(c.user, own));
  const marker = comments.map((c) => /<!-- solo v1 spec=(\S+) criteria=(\S+) base=\S+ owner=\S+ -->/.exec(c.body || '')).findLast(Boolean), task = run.one(`repos/${repo}/issues/${issue}`);
  if (!marker || marker[1] !== specSha(task) || marker[2] !== criteriaSha(task.body)) throw new Error(`solo: intent changed; run solo.mjs start ${issue} again`);
  const proofs = new Map(comments.flatMap((c) => [...(c.body || '').matchAll(/<!-- solo-proof stage=(\w+) sha=(\S+) run=(\S+) -->/g)]).filter((m) => m[1] === 'red' || m[1] === 'locked' || m[2] === pr.head.sha).map(([, stage, , link]) => [stage, link]));
  const stage = STAGES.find((s) => !proofs.has(s)), head = pr.head.sha, begun = `<!-- solo-start stage=${stage} head=${head} -->`;
  if (!stage || comments.some((c) => (c.body || '').includes(begun))) return { started: null, stage: stage || null };
  status(repo, number, { now: stage, next: `the worker — finish ${stage}, then run solo.mjs resume ${number}`, line: [...proofs].map(([s, link]) => `${s}: ${link}`).join(' · ') || 'no proof yet' }, run);
  run.start(stage, head, { repo, issue });
  run.send('POST', `repos/${repo}/issues/${number}/comments`, { body: begun });
  return { started: stage, stage };
};

function selfTest() {
  const bot = { login: 'github-actions[bot]', type: 'Bot' }, comments = [], starts = [], issue = { number: 7, title: 'Sum It', body: 'AC1 x', assignees: [] };
  const pr = { number: 9, head: { sha: 'c'.repeat(40), ref: 'agent/7-sum-it' } };
  const fake = { one: (p) => (/pulls/.test(p) ? pr : /commits/.test(p) ? { sha: 'a'.repeat(40) } : issue), all: () => comments, raw: () => '* @ada\n', send: (m, p, b) => comments.push({ user: bot, body: b.body }), push: () => 'pushed', start: (...a) => starts.push(a) };
  assert.throws(() => start({ repo: 'o/r', issue: 7, owner: 'eve' }, fake), /not a code owner/);
  assert.equal(start({ repo: 'o/r', issue: 7, owner: 'ada' }, fake).branch, 'agent/7-sum-it');
  comments.push({ user: bot, body: `<!-- solo-proof stage=red sha=${pr.head.sha} run=https://x/runs/1 -->` });
  assert.equal(resume({ repo: 'o/r', number: 9 }, fake).started, 'locked');
  assert.equal(resume({ repo: 'o/r', number: 9 }, fake).started, null);
  assert.equal(starts.length, 1);
  const t = { owner: 'ada', head: 'h', lock: 'l', app: 'app', verifier: 'v', run: 1 }, c = { criteria: [{ ac: 'AC1', test: 'x' }], actor: 'ada', reviewed: 'h', lock: 'l', source: 'app', verifier: 'v', run: 1, tests: [{ name: 'x', result: 'passed' }] };
  assert.equal(gate(c, t).ok, true);
  assert.equal(gate({ ...c, run: 0 }, t).line, 'verification: reject — superseded');
  assert.throws(() => confine({ repo: 'o/r', issue: 7, branch: 'b' }, fake).push('main'), /refused push main/);
  const ev = (stage, sha) => ({ stage, sha });
  assert.equal(advance({ repo: 'o/r', issue: 7 }, [], [ev('red', 'r'), ev('verified', 'r')], { head: 'h' }).records.length, 2);
  assert.equal(advance({ repo: 'o/r', issue: 7 }, [], [ev('red', 'r'), ev('red', 'r')], { head: 'h' }).records.length, 2);
  const cf = confine({ repo: 'o/r', issue: 7, branch: 'b' }, { ...fake, spawn: 1 });
  assert.deepEqual(Object.keys(cf).sort(), ['all', 'one', 'push', 'raw', 'send']);
  const seen = []; launch('worker', { issue: 7, stage: 'red' }, { HOME: 'h', PATH: 'p', GH_TOKEN: 'x' }, { spawn: (...a) => seen.push(a) });
  assert.deepEqual(seen[0][2], { env: { HOME: 'h', PATH: 'p' } });
  assert.deepEqual(publicRecord({ stage: 's', token: 't' }), { stage: 's' });
  console.log('solo self-test: 13 checks passed');
}

function main() {
  const [cmd, n] = process.argv.slice(2), repo = repoOf();
  if (cmd === 'start') console.log(JSON.stringify(start({ repo, issue: Number(n), owner: one('user').login })));
  else if (cmd === 'resume') console.log(JSON.stringify(resume({ repo, number: Number(n) })));
  else throw new Error('usage: solo.mjs start|resume <issue>');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { (process.argv.includes('--self-test') ? selfTest : main)(); } catch (e) { console.error(e.message); process.exit(1); }
}
