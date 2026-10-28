import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bodiless, segments, strip, tokens, unwrap } from './shell-parse.mjs';

const GIT = String.raw`^(?:\S*[/\\])?git(?:\.exe)?\b(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--\S+(?:[=\s]\S+)?))*\s+`;
const git = (tail) => new RegExp(GIT + tail, 'i');

const OUTWARD = new RegExp(`${GIT}(?:push|worktree\\s+add)\\b|^gh(?:\\.exe)?\\s+issue\\s+create\\b`, 'i');
const GIT_PREVIEW = /^git(?:\.exe)?\s+(?:(?:push|clean|reset)\s+--help|push\s+--dry-run(?:\s+[\w./:@+]+)*)\s*$/i;
const GIT_WIPE = git(String.raw`(?:clean\b[^\n]*\s(?:-[A-Za-z]*[fdx]|--force\b)|reset\b[^\n]*--hard\b)`);
const RM_RECURSIVE = /^(?:\S*[/\\])?rm(?:\.exe)?\b[^\n]*\s-(?:[A-Za-z]*[rR]|-recursive\b)/;
const REMOVE_ITEM_RECURSE = /^(?:(?:Remove-Item|ri|rm|rmdir|rd|del|erase)\b[^\n]*\s-r[a-z]*\b|(?:rmdir|rd|del|erase)\b[^\n]*\s\/s\b|(?:ri|rd)\b)/i;

const DISPOSABLE = /(?:^|\/)(?:node_modules|dist(?:-[\w.-]+)?|build|out|coverage|target|vendor|tmp|temp|\.next|\.nuxt|\.turbo|\.cache|\.wrangler|\.venv|\.pytest_cache|__pycache__)(?:\/|$)|\.(?:log|tmp|pyc|o|class|tsbuildinfo)$/;
const ABSOLUTE = /^(?:[/\\~$%]|[A-Za-z]:)/;
const CD = /^(?:cd|pushd|Set-Location)\s+(\S.*)$/i;
const drive = (token) => (process.platform === 'win32'
  ? token.replace(/^\/tmp(?=\/|$)/, () => tmpdir()).replace(/^\/([a-z])(?=\/|$)/i, (hit, letter) => `${letter.toUpperCase()}:`)
  : token);
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const existing = (file) => {
  let ancestor = file;
  while (!existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
  return ancestor;
};

function physical(file) {
  const ancestor = existing(file);
  try {
    const resolved = realpathSync.native(ancestor).replace(/^\\\\\?\\(UNC\\)?/, (hit, unc) => (unc ? '\\\\' : ''));
    return path.resolve(resolved, path.relative(ancestor, file));
  } catch { return null; }
}

function restorable(token, cwd) {
  if (/[$%*?`[{^(),]/.test(token) || /^~|[/\\]~(?:[/\\]|$)/.test(token)) return false;
  const real = physical(path.resolve(cwd, drive(token)));
  const root = physical(cwd);
  if (!real || !root || !path.relative(real, root) || inside(real, root) || /[/\\]\.git(?:[/\\]|$)/i.test(real)) return false;
  const dir = existing(path.dirname(real));
  const spec = path.relative(dir, real).split(path.sep).join('/');
  const status = spawnSync('git', ['--no-optional-locks', '--literal-pathspecs', '-C', dir, 'status', '--porcelain', '-z', '--ignored=matching', '--untracked-files=normal',
    '--', spec], { encoding: 'utf8' });
  const temp = physical(tmpdir());
  if (status.status !== 0) return Boolean(temp) && inside(temp, real);
  const flags = spawnSync('git', ['--literal-pathspecs', '-C', dir, 'ls-files', '-v', '-z', '--', spec], { encoding: 'utf8' });
  return flags.status === 0 && !/(?:^|\0)[a-zS]/.test(flags.stdout) && !existsSync(path.join(real, '.git')) && status.stdout.split('\0').filter(Boolean).every((entry) => entry.startsWith('!! ') && DISPOSABLE.test(entry.slice(3)));
}

function allRestorable(segment, dir, cwd) {
  if (dir && !existsSync(path.resolve(cwd, drive(dir)))) return false;
  let options = true;
  const operands = tokens(segment).slice(1)
    .filter((token) => {
      if (options && token === '--') { options = false; return false; }
      return !options || !(token.startsWith('-') || (/^(?:rd|rmdir|del|erase)\b/i.test(segment) && /^\/[sq]$/i.test(token)));
    })
    .map((token) => (dir && !ABSOLUTE.test(token) ? `${dir}/${token}` : token));
  return operands.length > 0 && operands.every((token) => restorable(token, cwd));
}

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
    if (GIT_PREVIEW.test(segment)) continue;
    if (OUTWARD.test(segment)) return `OUTWARD: "${segment.slice(0, 80)}" pushes, files an issue or opens a worktree`;
    if (GIT_WIPE.test(segment)) return `WIPE: "${segment.slice(0, 80)}" discards work git cannot restore`;
    if ((RM_RECURSIVE.test(segment) || REMOVE_ITEM_RECURSE.test(segment)) && !allRestorable(segment, dir, cwd)) {
      return `DELETE: "${segment.slice(0, 80)}" removes data git cannot restore`;
    }
    if (depth < 2 && SHELLS.test(segment)) {
      const inner = innerCommand(segment);
      const verdict = inner && judgeShell(inner, depth + 1, path.resolve(cwd, drive(dir)));
      if (verdict) return verdict;
    }
  }
  return null;
}
