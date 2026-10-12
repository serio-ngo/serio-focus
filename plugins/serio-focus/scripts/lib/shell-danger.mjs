import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bodiless, segments, strip, tokens, unwrap } from './shell-parse.mjs';

const GIT = String.raw`^git\b(?:\s+(?:-[Cc]\s+\S+|--\S+(?:[=\s]\S+)?))*\s+`;
const git = (tail) => new RegExp(GIT + tail, 'i');

const COMMIT_OR_PUSH = [
  git(String.raw`commit\b`),
  git(String.raw`push\b`),
];

const GIT_WIPE = [
  git(String.raw`clean\b[^\n]*\s-[A-Za-z]*[fdx]`),
  git(String.raw`reset\b[^\n]*--hard\b`),
];

const RM_RECURSIVE = /^(?:rm)\b[^\n]*\s-[A-Za-z]*[rR]/;
const REMOVE_ITEM_RECURSE = /^(?:Remove-Item\b[^\n]*-(?:Recurse|R)(?:\b|$)|(?:ri|rd)\b)/i;

const DISPOSABLE = /(?:^|[/\\]|\$\{?|\$env:|%)(?:node_modules|dist(?:-[\w.-]+)?|build|out|coverage|target|vendor|tmp|temp|tmpdir|scratchpad|\.next|\.nuxt|\.turbo|\.cache|\.wrangler|\.venv|\.pytest_cache|__pycache__)(?:[/\\}%]|$)|\.(?:log|tmp|pyc|o|class|tsbuildinfo)$|GetTempPath\(\)|^\$\(mktemp\b/i;
const ABSOLUTE = /^(?:[/\\~$%]|[A-Za-z]:)/;
const CD = /^(?:cd|pushd|Set-Location)\s+(\S.*)$/i;
const drive = (token) => (process.platform === 'win32' ? token.replace(/^\/([a-z])(?=\/|$)/i, (hit, letter) => `${letter.toUpperCase()}:`) : token);
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

function physical(file) {
  let ancestor = file;
  while (!existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
  try { return path.resolve(realpathSync(ancestor), path.relative(ancestor, file)); } catch { return null; }
}

function safeTarget(token, cwd) {
  if (/[\$%~*?`]/.test(token) || token.includes('..')) return false;
  const target = path.resolve(cwd, drive(token));
  const real = physical(target);
  const root = physical(cwd);
  const temp = physical(tmpdir());
  if (!real || !root || /(?:^|[/\\])\.git(?:[/\\]|$)/.test(target)) return false;
  if (!inside(root, real)) {
    if (!temp || !inside(temp, real)) return false;
    const lexical = path.relative(cwd, target);
    if (!lexical.startsWith('..') && !path.isAbsolute(lexical)) return false;
    return true;
  }
  const relative = path.relative(root, real);
  const tracked = spawnSync('git', ['-C', cwd, 'ls-files', '-z', '--', relative], { encoding: 'utf8' });
  if (tracked.status !== 0 || tracked.stdout) return false;
  const scratch = process.env.SERIO_SCRATCH_DIR && path.resolve(cwd, process.env.SERIO_SCRATCH_DIR);
  if (scratch && inside(root, scratch) && (target === scratch || inside(scratch, target)) && (real === physical(scratch) || inside(physical(scratch), real))) return true;
  return DISPOSABLE.test(token) && spawnSync('git', ['-C', cwd, 'check-ignore', '-q', '--', `${relative}/`]).status === 0;
}

function onlyDisposable(segment, dir, cwd) {
  const operands = tokens(segment).slice(1)
    .filter((token) => !/^-|^\/[A-Za-z]$|^\d+$|^\d*[<>]/.test(token))
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .map((token) => (dir && !ABSOLUTE.test(token) ? `${dir}/${token}` : token));
  return operands.length > 0 && operands.every((token) => safeTarget(token, cwd));
}

const NO_OP_FLAG = /(?:^|\s)(?:--help|--version|--dry-run|--dryrun|-WhatIf)(?:[=\s]|$)/i;

const SHELLS = /^(?:sudo\s+)?(?:bash|sh|zsh|dash|ksh|pwsh|powershell|cmd)\b/i;
const SHELL_INNER = /(?:^|\s)(?:-{1,2}(?:command|[a-z]*c)|\/(?:command|c))\s+(['"])([\s\S]*)\1\s*$/i;
const SHELL_INNER_BARE = /(?:^|\s)(?:-{1,2}(?:command|[a-z]*c)|\/(?:command|c))\s+()(?!['"])([\s\S]+)$/i;

function innerCommand(segment) {
  return (SHELL_INNER.exec(segment) || SHELL_INNER_BARE.exec(segment) || [])[2];
}

export function judgeShell(command, depth = 0, cwd = process.cwd()) {
  let dir = '';
  for (const segment of segments(bodiless(command)).map(unwrap)) {
    const cd = strip((CD.exec(segment) || [])[1] || '');
    if (cd) dir = ABSOLUTE.test(cd) || !dir ? cd : `${dir}/${cd}`;
    if (NO_OP_FLAG.test(segment.replace(/'[^']*'|"[^"]*"/g, ' ').replace(/(?:^|\s)#.*$/, ''))) continue;
    for (const rx of COMMIT_OR_PUSH) {
      if (process.env.SERIO_GIT_WRITE !== '1' && rx.test(segment)) return `"${segment.slice(0, 80)}" commit and push stays manual — draft the exact command and list it in the final state, do not run it`;
    }
    for (const rx of GIT_WIPE) {
      if (rx.test(segment)) return `"${segment.slice(0, 80)}" git wipe stays manual — draft the exact command and list it in the final state, do not run it`;
    }
    if ((RM_RECURSIVE.test(segment) || REMOVE_ITEM_RECURSE.test(segment)) && !onlyDisposable(segment, dir, cwd)) {
      return `"${segment.slice(0, 80)}" recursive delete stays manual — use literal paths inside the temp dir or an ignored build dir, or list the exact command for the owner`;
    }
    if (depth < 2 && SHELLS.test(segment)) {
      const inner = innerCommand(segment);
      const verdict = inner && judgeShell(inner, depth + 1, cwd);
      if (verdict) return verdict;
    }
  }
  return null;
}
