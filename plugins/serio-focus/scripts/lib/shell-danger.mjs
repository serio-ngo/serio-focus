import { gitWriteAllowed } from './limits.mjs';
import { segments, unwrap } from './shell-parse.mjs';

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

const DISPOSABLE = /(?:^|[/\\])(?:node_modules|dist|build|out|coverage|target|vendor|tmp|temp|scratchpad|\.next|\.nuxt|\.turbo|\.cache|\.venv|\.pytest_cache|__pycache__)(?:[/\\]|$)|\.(?:log|tmp|pyc|o|class|tsbuildinfo)$/i;

function onlyDisposable(segment) {
  const operands = segment.split(/\s+/).slice(1)
    .filter((token) => !/^-|^\/[A-Za-z]$|^\d+$/.test(token))
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return operands.length > 0 && operands.every((token) => DISPOSABLE.test(token));
}

const NO_OP_FLAG = /(?:^|\s)(?:--help|--version|--dry-run|--dryrun|-WhatIf)(?:[=\s]|$)/i;

const SHELLS = /^(?:sudo\s+)?(?:bash|sh|zsh|dash|ksh|pwsh|powershell|cmd)\b/i;
const SHELL_INNER = /(?:^|\s)(?:-{1,2}(?:command|[a-z]*c)|\/(?:command|c))\s+(['"])([\s\S]*)\1\s*$/i;
const SHELL_INNER_BARE = /(?:^|\s)(?:-{1,2}(?:command|[a-z]*c)|\/(?:command|c))\s+()(?!['"])([\s\S]+)$/i;

function innerCommand(segment) {
  return (SHELL_INNER.exec(segment) || SHELL_INNER_BARE.exec(segment) || [])[2];
}

export function judgeShell(command, depth = 0) {
  if (gitWriteAllowed()) return null;
  for (const segment of segments(command).map(unwrap)) {
    if (NO_OP_FLAG.test(segment.replace(/'[^']*'|"[^"]*"/g, ' '))) continue;
    for (const rx of COMMIT_OR_PUSH) {
      if (rx.test(segment)) return `"${segment.slice(0, 80)}" commit and push stays manual — draft the exact command and list it in the final state, do not run it`;
    }
    for (const rx of GIT_WIPE) {
      if (rx.test(segment)) return `"${segment.slice(0, 80)}" git wipe stays manual — draft the exact command and list it in the final state, do not run it`;
    }
    if ((RM_RECURSIVE.test(segment) || REMOVE_ITEM_RECURSE.test(segment)) && !onlyDisposable(segment)) {
      return `"${segment.slice(0, 80)}" recursive delete stays manual — draft the exact command and list it in the final state, do not run it`;
    }
    if (depth < 2 && SHELLS.test(segment)) {
      const inner = innerCommand(segment);
      const verdict = inner && judgeShell(inner, depth + 1);
      if (verdict) return verdict;
    }
  }
  return null;
}
