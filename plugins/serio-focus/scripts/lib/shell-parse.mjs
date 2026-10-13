const REDIRECT_AMP = (prev, next) => /[<>]/.test(prev || '') || next === '>';
const SHELL_PREFIX = /^(?:(?:sudo|env|eval|command|exec|builtin|nohup|time|nice|stdbuf|xargs|if|then|else|elif|while|until|do)\b(?:\s+-\S+)*\s+|[!{(]\s*|(?:\w+=(?:"[^"]*"|'[^']*'|[^\s'"])*\s+)+)/i;
const SHELL_QUOTED = /^(['"])([\s\S]*)\1$/;
const REDIRECT = /^&?\d*[<>]{1,2}&?$/;
const REDIRECTED = /^&?\d*[<>]/;
const HEREDOC = /^([^\n]*?)(?<!<)<<(?!<)-?[ \t]*(['"]?)\\?([\w.-]+)\2([^\n]*)\n(?:([\s\S]*?)\n)??[ \t]*\3[ \t]*$/gm;
const RUNS_BODY = /\b(?:bash|sh|zsh|dash|ksh|pwsh|powershell|cmd|ssh|eval|source)\b/i;

export const bodiless = (command) => command.replace(HEREDOC, (hit, head, quote, word, tail, body = '') =>
  `${head}<<${word}${tail}\n${RUNS_BODY.test(head + tail) ? body.replace(/['"]/g, '') : `: ${body.replace(/[\s;&|'"`$]+/g, ' ')}`}`);

export function segments(command) {
  const out = [];
  let buffer = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      if (char === quote && command[i - 1] !== '\\') quote = null;
      buffer += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; buffer += char; continue; }
    if (char === '&' && REDIRECT_AMP(command[i - 1], command[i + 1])) { buffer += char; continue; }
    if (';\n&|`'.includes(char)) { out.push(buffer); buffer = ''; continue; }
    if (char === '$' && command[i + 1] === '(') { out.push(buffer); buffer = ''; i += 1; continue; }
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
