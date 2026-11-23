#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { version } from './lib/runtime.mjs';

export const card = () => `Serio Focus ${version()}. Reply for a neurodivergent reader: result in line one. Then what you did, one bullet each, five at most, each with a short why. Short active sentences; bold the key term. No preamble, recap, filler, hedging or chatter between routine tool calls. Keep code, paths, numbers and errors exact. Say what each issue, task, pull request or decision is in a few words; never point to it by a number or a code alone. Claim done only with fresh check output. When the user must act, give one recommended action with its exact command. Ask one question at a time, with your recommended answer. Write warnings and irreversible steps as full sentences, consequence first. Required closing lines stay last. Guard: every subagent call names model and effort; email sends are denied.`;

const RULE = "Backlog first: finish or reject each item above before new work. An item that waits only for a person does not block. Never change a branch, worktree or file that a running session uses.";
const cap = (all) => all.length > 10 ? [...all.slice(0, 10), `- and ${all.length - 10} more`] : all;

export const backlog = (cwd = process.cwd()) => {
  const g = (...args) => { const run = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 3000 }); return run.status === 0 ? run.stdout.trim() : null; };
  if (g('rev-parse', '--git-dir') === null) return '';
  const lines = (...args) => (g(...args) ?? '').split('\n').filter(Boolean);
  const main = (g('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD') ?? '').replace(/^origin\//, '') || ['main', 'master'].find((x) => g('rev-parse', '--verify', '--quiet', `refs/heads/${x}`) !== null);
  const current = g('branch', '--show-current'), dirty = Boolean(g('status', '--porcelain')), top = path.resolve(g('rev-parse', '--show-toplevel') ?? cwd);
  const others = (g('worktree', 'list', '--porcelain') ?? '').split('\n\n').filter(Boolean).map((b) => ({ dir: /^worktree (.*)/m.exec(b)?.[1], branch: /^branch refs\/heads\/(.*)/m.exec(b)?.[1] }));
  const used = new Set(others.filter((w) => path.resolve(w.dir) !== top).map((w) => w.branch));
  const todo = lines('for-each-ref', '--sort=committerdate', '--format=%(refname:short)|%(upstream:short)|%(upstream:track)', 'refs/heads').map((l) => l.split('|')).filter(([b]) => b !== main && !used.has(b) && !(dirty && b === current)).sort(([a], [b]) => (b === current) - (a === current));
  const branches = main || !todo.length ? [] : ['- default branch unknown: run git remote set-head origin --auto'], end = Date.now() + 4000;
  let seen = main ? 0 : todo.length;
  for (; seen < todo.length && branches.length < 10 && Date.now() < end; seen++) {
    const [b, up, track] = todo[seen], files = g('diff', '--name-only', `${main}...${b}`);
    if (files !== null && (!files || g('diff', '--quiet', main, b, '--', ...files.split('\n')) !== null)) { if (b !== current) branches.push(`- ${b}: delete: merged`); }
    else branches.push(`- ${b}: ${!up || /gone|ahead/.test(track) ? 'push and ' : ''}open a pull request unless one is open`);
  }
  if (seen < todo.length) branches.push(`- and ${todo.length - seen} more branches to check`);
  const items = [...(dirty ? [`- ${current || 'HEAD'}: ${!current || current === main ? 'commit to a new branch and open a pull request' : `commit and push to ${current}`}`] : []), ...branches,
    ...cap(others.slice(1).filter((w) => path.resolve(w.dir) !== top).map((w) => `- ${w.dir}: remove when no session uses it`)),
    ...cap(lines('stash', 'list', '--format=%gs').reverse().map((m) => `- ${m}: apply to its branch or drop`))];
  return items.length ? ['Backlog:', ...items, RULE].join('\n') : 'Backlog: clear';
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const block = backlog();
  process.stdout.write(`${card()}\n${block && `${block}\n`}`);
}
