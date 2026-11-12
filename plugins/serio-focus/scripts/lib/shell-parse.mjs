const REDIRECT_AMP = (prev, next) => /[<>]/.test(prev || '') || next === '>';
const SHELL_PREFIX = /^(?:(?:sudo|env|eval|command|exec|builtin|nohup|time|nice|stdbuf|xargs|if|then|else|elif|while|until|do)\b(?:\s+-\S+)*\s+|[!{(]\s*|(?:\w+=(?:"[^"]*"|'[^']*'|[^\s'"])*\s+)+)/i;
const SHELL_QUOTED = /^(['"])([\s\S]*)\1$/;
const REDIRECT = /^&?\d*[<>]{1,2}&?$/;
const REDIRECTED = /^&?\d*[<>]/;
const HEREDOC = /^([^\n]*?)(?<!<)<<(?!<)-?[ \t]*(['"]?)\\?([\w.-]+)\2([^\n]*)\n(?:([\s\S]*?)\n)??[ \t]*\3[ \t]*$/gm;
const RUNS_BODY = /\b(?:bash|sh|zsh|dash|ksh|pwsh|powershell|cmd|ssh|eval|source)\b/i;

export const bodiless = (command) => command.replace(HEREDOC, (hit, head, quote, word, tail, body = '') =>
  `${head}<<${word}${tail}\n${RUNS_BODY.test(head + tail) ? body.replace(/['"]/g, '') : `: ${body.replace(/[\s;&|'"`$]+/g, ' ')}`}`);

export function segments(command, shell = 'Bash') {
  const out = [];
  const outer = [];
  let buffer = '';
  let quote = null;
  const bash = /^(?:bash|sh|zsh|dash|ksh)$/i.test(shell);
  const cut = () => { out.push(buffer); buffer = ''; };
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (bash && char === '\\' && quote !== "'") { buffer += command.slice(i, i + 2); i += 1; continue; }
    if (quote !== "'" && char === '`') {
      if (!bash) return null;
      cut();
      if (outer.at(-1)?.tick) quote = outer.pop().quote; else { outer.push({ quote, open: 0, tick: true }); quote = null; }
      continue;
    }
    if (quote !== "'" && char === '$' && command[i + 1] === '(') { cut(); outer.push({ quote, open: 0 }); quote = null; i += 1; continue; }
    if (quote) {
      if (char === quote) quote = null;
      buffer += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; buffer += char; continue; }
    const frame = outer.at(-1);
    if (frame && !frame.tick && char === '(') frame.open += 1;
    if (frame && !frame.tick && char === ')') { if (frame.open) frame.open -= 1; else { cut(); quote = outer.pop().quote; continue; } }
    if (char === '&' && REDIRECT_AMP(command[i - 1], command[i + 1])) { buffer += char; continue; }
    if (';\n&|'.includes(char)) { out.push(buffer); buffer = ''; continue; }
    buffer += char;
  }
  out.push(buffer);
  return out.map((part) => part.trim()).filter(Boolean);
}

export function unwrap(segment) {
  let out = String(segment).trim();
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(SHELL_PREFIX, '').trim().replace(SHELL_QUOTED, '$2').trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

function shellWords(segment) {
  const out = [];
  let buffer = '';
  let quote = null;
  let open = false;
  for (const char of String(segment)) {
    if (quote) {
      if (char === quote) quote = null; else buffer += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; open = true; continue; }
    if (/\s/.test(char)) { if (open || buffer) out.push(buffer); buffer = ''; open = false; continue; }
    buffer += char;
  }
  if (open || buffer) out.push(buffer);
  return out;
}

export const strip = (token) => token.replace(/^['"]|['"]$/g, '');

export function tokens(segment) {
  const out = [];
  const raw = shellWords(segment).filter(Boolean);
  for (let i = 0; i < raw.length; i += 1) {
    if (REDIRECT.test(raw[i])) i += 1;
    else if (!REDIRECTED.test(raw[i])) out.push(raw[i]);
  }
  return out;
}
