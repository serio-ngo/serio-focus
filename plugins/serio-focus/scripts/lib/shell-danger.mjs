import { gitWriteAllowed } from './limits.mjs';
import { segments, strip, unwrap } from './shell-parse.mjs';

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

const DISPOSABLE = /(?:^|[/\\]|\$\{?|\$env:|%)(?:node_modules|dist(?:-[\w.-]+)?|build|out|coverage|target|vendor|tmp|temp|tmpdir|scratchpad|\.next|\.nuxt|\.turbo|\.cache|\.wrangler|\.venv|\.pytest_cache|__pycache__)(?:[/\\}%]|$)|\.(?:log|tmp|pyc|o|class|tsbuildinfo)$|GetTempPath\(\)/i;
const ABSOLUTE = /^(?:[/\\~$%]|[A-Za-z]:)/;
const CD = /^(?:cd|pushd|Set-Location)\s+(\S.*)$/i;
const ASSIGNED = /(?:^|[;\n]\s*)(?:\$([A-Za-z_]\w*)\s*=\s*([^;\n]+)|(?:export\s+)?([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|]*)(?=\s*(?:[;&|\n]|$)))|\$\{?([A-Za-z_]\w*)\}?/g;
const REBOUND = /\b(?:for|foreach|read|select)\s+(?:-\w+\s+)*\(?\$?([A-Za-z_]\w*)/gi;

function expand(command) {
  const vars = {};
  const rebound = new Set([...command.matchAll(REBOUND)].map((hit) => hit[1]));
  return command.replace(ASSIGNED, (hit, ps, psValue, name, value, ref) => {
    if (ps || name) { vars[ps || name] = strip(String(psValue ?? value).trim()); return hit; }
    const known = rebound.has(ref) ? undefined : vars[ref];
    if (known === undefined) return hit;
    return DISPOSABLE.test(known) ? known.replace(/\s+/g, '') : known;
  });
}

function onlyDisposable(segment, dir) {
  const operands = segment.split(/\s+/).slice(1)
    .filter((token) => !/^-|^\/[A-Za-z]$|^\d+$|^\d*[<>]/.test(token))
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .map((token) => (dir && !ABSOLUTE.test(token) ? `${dir}/${token}` : token));
  return operands.length > 0 && operands.every((token) => !token.includes('..') && DISPOSABLE.test(token));
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
  let dir = '';
  for (const segment of segments(expand(command)).map(unwrap)) {
    const cd = strip((CD.exec(segment) || [])[1] || '');
    if (cd) dir = ABSOLUTE.test(cd) || !dir ? cd : `${dir}/${cd}`;
    if (NO_OP_FLAG.test(segment.replace(/'[^']*'|"[^"]*"/g, ' '))) continue;
    for (const rx of COMMIT_OR_PUSH) {
      if (rx.test(segment)) return `"${segment.slice(0, 80)}" commit and push stays manual — draft the exact command and list it in the final state, do not run it`;
    }
    for (const rx of GIT_WIPE) {
      if (rx.test(segment)) return `"${segment.slice(0, 80)}" git wipe stays manual — draft the exact command and list it in the final state, do not run it`;
    }
    if ((RM_RECURSIVE.test(segment) || REMOVE_ITEM_RECURSE.test(segment)) && !onlyDisposable(segment, dir)) {
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
