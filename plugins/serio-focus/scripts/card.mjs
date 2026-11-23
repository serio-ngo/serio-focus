#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { version } from './lib/runtime.mjs';

export const card = () => `Serio Focus ${version()}. Reply for a neurodivergent reader: result in line one. Then what you did, one bullet each, five at most, each with a short why. Short active sentences; bold the key term. No preamble, recap, filler, hedging or chatter between routine tool calls. Keep code, paths, numbers and errors exact. Say what each issue, task, pull request or decision is in a few words; never point to it by a number or a code alone. Claim done only with fresh check output. When the user must act, give one recommended action with its exact command. Ask one question at a time, with your recommended answer. Write warnings and irreversible steps as full sentences, consequence first. Required closing lines stay last. Guard: every subagent call names model and effort; email sends are denied.`;

const RULE = "Backlog first: finish or reject each item above before new work. An item that waits only for a person does not block. Never change a branch, worktree or file that a running session uses.";
const cap = (all) => all.length > 10 ? [...all.slice(0, 10), `- and ${all.length - 10} more`] : all;
const more = (nodes, total) => total > nodes.length ? [`- and ${total - nodes.length} more`] : [];
const ORDER = 'states: OPEN, first: 10, orderBy: {field: CREATED_AT, direction: ASC}';
const ISSUES = `issues(${ORDER}$LABEL) { totalCount nodes { title labels(first: 20) { nodes { name } } comments(last: 30) { nodes { body } } closedByPullRequestsReferences(includeClosedPrs: false) { totalCount } } }`;
const state = (i) => {
  const names = i.labels.nodes.map((l) => l.name), verdict = [...i.comments.nodes.map((c) => c.body).join('\n').matchAll(/<!-- spec-review v1\b[^>]*?\bverdict=(\w+)/g)].at(-1)?.[1];
  return names.includes('needs-human') ? 'needs-human' : i.closedByPullRequestsReferences.totalCount ? 'pull request open' : names.includes('spec-ok') ? 'spec-ok' : verdict === 'ready' ? 'review ready' : 'no review';
};
const action = (p) => {
  const rollup = p.commits.nodes[0]?.commit.statusCheckRollup?.state;
  return p.isDraft ? 'finish or close' : ['FAILURE', 'ERROR'].includes(rollup) || p.reviewDecision === 'CHANGES_REQUESTED' || p.reviewThreads.nodes.some((t) => !t.isResolved) ? 'pr-loop' : "waits for a person's merge";
};

const local = (cwd, env) => {
  const g = (...args) => { const run = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 3000 }); return run.status === 0 ? run.stdout.trim() : null; };
  const lines = (...args) => (g(...args) ?? '').split('\n').filter(Boolean);
  const main = (g('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD') ?? '').replace(/^origin\//, '') || 'main';
  const current = g('branch', '--show-current'), dirty = Boolean(g('status', '--porcelain'));
  const trees = lines('worktree', 'list', '--porcelain'), used = new Set(trees.filter((l) => l.startsWith('branch ')).map((l) => l.slice(18)));
  const branches = lines('for-each-ref', '--sort=committerdate', '--format=%(refname:short)|%(upstream:short)|%(upstream:track)', 'refs/heads').map((l) => l.split('|')).filter(([b]) => b !== main && !used.has(b)).map(([b, up, track]) => {
    const files = lines('diff', '--name-only', `${main}...${b}`);
    if (!files.length || g('diff', '--quiet', main, b, '--', ...files) !== null) return `- ${b}: delete: merged`;
    return up && !/gone|ahead/.test(track) ? '' : `- ${b}: push and open a pull request`;
  }).filter(Boolean);
  return [...(dirty && current ? [`- ${current}: commit and push to ${current}`] : []), ...cap(branches.filter((l) => !l.startsWith(`- ${current}:`))),
    ...cap(trees.filter((l) => l.startsWith('worktree ')).slice(1).map((l) => `- ${l.slice(9)}: remove when no session uses it`)),
    ...cap(lines('stash', 'list', '--format=%gs').reverse().map((m) => `- ${m}: apply to its branch or drop`))];
};

const remote = (cwd, env) => {
  const url = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, env, encoding: 'utf8', timeout: 3000 });
  if (url.status !== 0) return { why: 'no origin' };
  const [, owner, name] = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\s*$/.exec(url.stdout) ?? [];
  if (!owner) return { why: 'origin is not on GitHub' };
  const queue = /^([^/]+)\/([^/]+)$/.exec(env.SERIO_QUEUE ?? '');
  const at = (o, n) => `repository(owner: ${JSON.stringify(o)}, name: ${JSON.stringify(n)})`;
  const query = `{ ${at(owner, name)} {
    pullRequests(${ORDER}) { totalCount nodes { title isDraft reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } reviewThreads(first: 100) { nodes { isResolved } } } }
    ${ISSUES.replace('$LABEL', '')} }${queue ? ` queue: ${at(queue[1], queue[2])} { ${ISSUES.replace('$LABEL', `, labels: [${JSON.stringify(`app:${name}`)}]`)} }` : ''} }`;
  const run = spawnSync('gh', ['api', 'graphql', '-f', `query=${query}`], { cwd, env, encoding: 'utf8', timeout: 3000 });
  if (run.error) return { why: run.error.code === 'ENOENT' ? 'gh not found' : 'gh took longer than 3 seconds' };
  if (run.status !== 0) return { why: run.stderr.split('\n').find((l) => l.trim())?.trim() || `gh exited ${run.status}` };
  try {
    const { repository: r, queue: q } = JSON.parse(run.stdout).data;
    const list = (title, nodes, total, line) => [...nodes.map((n) => `- ${title(n)}: ${line(n)}`), ...more(nodes, total)];
    return { lines: [...list((p) => `pull request "${p.title}"`, r.pullRequests.nodes, r.pullRequests.totalCount, action), ...list((i) => `issue "${i.title}"`, r.issues.nodes, r.issues.totalCount, state),
      ...(q ? list((i) => `${queue[0]} issue "${i.title}"`, q.issues.nodes, q.issues.totalCount, state) : [])] };
  } catch (error) {
    return { why: error.message };
  }
};

export const backlog = (cwd = process.cwd(), env = process.env) => {
  if (spawnSync('git', ['rev-parse', '--git-dir'], { cwd, env, timeout: 3000 }).status !== 0) return '';
  const { lines = [], why } = remote(cwd, env), items = [...local(cwd, env), ...lines];
  return items.length || why ? ['Backlog:', ...items, ...(why ? [`Remote backlog unknown: ${why}`] : []), RULE].join('\n') : 'Backlog: clear';
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const block = backlog();
  process.stdout.write(`${card()}\n${block && `${block}\n`}`);
}
