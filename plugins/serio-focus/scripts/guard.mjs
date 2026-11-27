#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WRITERS = /^(?:Write|Edit|MultiEdit|NotebookEdit)$/;
const CHOICE = { Agent: ['model', 'effort'], spawn_agent: ['model', 'reasoning_effort'], Workflow: [] };
const scriptOf = (input) => { try { return input.script ?? (input.scriptPath == null ? '' : readFileSync(input.scriptPath, 'utf8')); } catch { return 'agent('; } };
const code = (src) => String(src).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, (hit, quote) => (quote ? '""' : ' '));

function optionKeys(src, from) {
  let depth = 1;
  let arg = 0;
  let own = '';
  for (let i = from; i < src.length && depth; i += 1) {
    if ('([{'.includes(src[i])) depth += 1;
    else if (')]}'.includes(src[i])) depth -= 1;
    else if (src[i] === ',' && depth === 1) arg += 1;
    else if (arg === 1 && depth === 2) own += src[i];
  }
  return own.split(',').map((entry) => entry.split(':')[0].trim());
}

function bareFlow(input) {
  const src = code(scriptOf(input));
  return [...src.matchAll(/\bagent\s*\(/g)].some((hit) => {
    const keys = optionKeys(src, hit.index + hit[0].length);
    return !keys.includes('model') || !keys.includes('effort');
  });
}

const MAIL = /(?:^|[_-])(?:gmail|outlook|email|mail)(?:[_-]|$)/i;
const VERB = /(?:^|[_-])(?:send|reply|forward)(?:[_-]|$)/i;
const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: {
  hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason,
} }));

const SHELL = /^(?:Bash|PowerShell)$/;
const OUTWARD = /\bgh\s+(?:(?:issue|pr)\s+(?:create|edit|comment|review|close)|release\s+(?:create|edit)|api)\b|\bgit\s+(?:commit|tag)\b/;
const SPAN = 8;
const COMMAND = /^\s*(?:[$>]\s*)?(?:gh|git|npm|npx|node|cd|pwsh|powershell|wrangler|claude)\b.*$/gm;
const words = (text) => String(text).replace(/\S*[\\/]\S*/g, ' ').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) || [];
const spans = (text) => { const w = words(text); return w.slice(0, Math.max(0, w.length - SPAN + 1)).map((_, i) => w.slice(i, i + SPAN).join(' ')); };

function chat(file) {
  let lines = [];
  try { lines = readFileSync(file, 'utf8').split('\n'); } catch { return []; }
  return lines.flatMap((line) => {
    let row; try { row = JSON.parse(line); } catch { return []; }
    const queued = row?.type === 'attachment' && row.attachment?.type === 'queued_command' && row.attachment.commandMode === 'prompt' && (!row.attachment.origin || row.attachment.origin.kind === 'human');
    if (!queued && (row?.type !== 'user' || row.isMeta || row.isCompactSummary)) return [];
    const content = queued ? row.attachment.prompt : row.message?.content;
    const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((part) => part?.type === 'text').map((part) => part.text) : [];
    return parts.map((text) => String(text).replace(/<(?!pasted_content)([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/```[\s\S]*?```/g, ' ').replace(COMMAND, ' '));
  });
}

function sent(tool, input, cwd) {
  if (!SHELL.test(tool)) return JSON.stringify(input);
  const command = String(input.command || '');
  if (!OUTWARD.test(command)) return '';
  const files = [...command.matchAll(/(?:--body-file|--notes-file|--input|--file|-F|<)[\s=]+(?:"([^"]+)"|'([^']+)'|([^\s;|&)<]+))|=@([^\s;|&)'"]+)/g)].map((hit) => hit.slice(1).find(Boolean));
  const dirs = [cwd || '.', ...[...command.matchAll(/\b(?:cd|Set-Location)\s+(?:"([^"]+)"|'([^']+)'|([^\s;|&)]+))/g)].map((hit) => hit.slice(1).find(Boolean).replace(/^\/([a-z])\//i, '$1:/'))];
  const read = (file) => dirs.reduce((found, dir) => { if (found) return found; try { return readFileSync(path.resolve(cwd || '.', dir, file), 'utf8'); } catch { return ''; } }, '');
  return [command, ...files.map(read)].join('\n');
}

function quote(payload, tool, input) {
  if (process.env.GITHUB_ACTIONS === 'true' || !(SHELL.test(tool) || /^mcp__.+__act$/.test(tool))) return;
  const out = sent(tool, input, payload.cwd);
  if (!out) return;
  const said = new Set(chat(payload.transcript_path).flatMap(spans));
  const hit = spans(out).find((span) => said.has(span));
  if (hit) return `CHAT QUOTE: this ${tool} call sends words the owner typed in chat ("${hit}"). The chat never leaves the chat: restate it in your own words`;
}

function judge(payload) {
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  const leak = quote(payload, tool, input);
  if (leak) return leak;
  if (WRITERS.test(tool)) {
    if (process.env.SERIO_ORCHESTRATE === '1' && !payload.agent_id) return 'ORCHESTRATE: the main session plans and dispatches. Send this edit to the tester or coder agent';
    return;
  }
  const missing = (CHOICE[tool] || []).filter((key) => !String(input[key] ?? '').trim());
  if (tool === 'Workflow' && bareFlow(input)) missing.push('model', 'effort');
  if (missing.length) return `MODEL CHOICE: name ${missing.join(' and ')} in the subagent call`;
  if (tool.startsWith('mcp__') && MAIL.test(tool) && VERB.test(tool)) return `OUTWARD: "${tool}" sends email`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raw = readFileSync(0, 'utf8');
  let payload = null;
  try { payload = JSON.parse(raw); } catch {
    if (/"tool_name"\s*:\s*"[^"]+"/.test(raw)) deny('BLOCKED: tool payload could not be parsed');
  }
  if (payload && typeof payload === 'object') {
    const reason = judge(payload);
    if (reason) deny(reason);
  }
}
