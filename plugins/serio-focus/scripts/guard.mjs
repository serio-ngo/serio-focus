#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    const codex = row?.type === 'response_item' && row.payload?.type === 'message' && row.payload.role === 'user';
    if (!queued && !codex && (row?.type !== 'user' || row.isMeta || row.isCompactSummary)) return [];
    const content = queued ? row.attachment.prompt : codex ? row.payload.content : row.message?.content;
    const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((part) => /^(?:input_)?text$/.test(part?.type)).map((part) => part.text) : [];
    return parts.map((text) => String(text).replace(/<(?!pasted_content)([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/```[\s\S]*?```/g, ' ').replace(COMMAND, ' '));
  });
}

function sent(tool, input, cwd) {
  if (!SHELL.test(tool)) return JSON.stringify(input);
  const command = String(input.command || '');
  if (!OUTWARD.test(command)) return '';
  const files = [...command.matchAll(/(?:--body-file|--notes-file|--input|--file|-F|<|\bcat|Get-Content)[\s=]+(?:"([^"]+)"|'([^']+)'|([^\s;|&)<>]+))|=@([^\s;|&)'"]+)/g)].map((hit) => hit.slice(1).find(Boolean).replace(/^[\w.-]+=@/, ''));
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

function selfTest() {
  const ci = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = '';
  const box = mkdtempSync(path.join(tmpdir(), 'guard-')), file = path.join(box, 't.jsonl');
  const said = 'wywal te buzie z ludka, większe oczy trochę i ciemniejsze tło', moved = 'zrob dodatkowe issue na przeniesienie gry teraz do poludzku';
  writeFileSync(file, [{ type: 'user', message: { content: said } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'max cztery potwory na pokoj zawsze tutaj bez wyjatku teraz' }] } },
    { type: 'user', isMeta: true, message: { content: 'meta tekst ktory nie jest czatem wcale nigdy przenigdy juz' } },
    { type: 'user', message: { content: [{ type: 'text', text: '<system-reminder>reguly systemu ktore nie sa slowami wlasciciela nigdy tutaj</system-reminder>\n```\nnpm run verify and then commit the brand rules file here\n```\nsee https://github.com/serio-ngo/ops/issues/150' }] } },
    { type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', origin: { kind: 'human' }, prompt: moved } },
    { type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', origin: { kind: 'peer' }, prompt: 'raport innej sesji o scalaniu galezi dzisiaj po poludniu' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions\n\n<INSTRUCTIONS>zasady repozytorium ktore codex dokleja do kazdej rozmowy tutaj</INSTRUCTIONS>' }, { type: 'input_text', text: 'for now I want a simple solution with constant game levels' }] } }]
    .map((row) => JSON.stringify(row)).join('\n'));
  writeFileSync(path.join(box, 'body.md'), `> ${said}`);
  mkdirSync(path.join(box, 'other'));
  writeFileSync(path.join(box, 'other', 'issue.md'), moved);
  const run = (tool_name, tool_input) => quote({ cwd: box, transcript_path: file }, tool_name, tool_input);
  const denied = ['gh issue create -t x -b "Wywal te BUZIE z ludka, wieksze oczy troche i"', 'gh issue comment 1 --body-file body.md', 'git commit -F "body.md"',
    'cd other && gh issue create --body-file issue.md', 'gh issue comment 3 --body-file - < body.md', 'gh issue create --body "$(cat body.md)"',
    'gh pr comment 2 --body (Get-Content body.md -Raw)', 'cat body.md | gh issue create --body-file -', 'gh api repos/o/r/issues/1/comments -F body=@body.md','gh pr create -b "I want a simple solution with constant game levels"', 'gh issue edit 2 -b "> zrob dodatkowe issue na przeniesienie gry teraz do"'];
  for (const command of denied) assert.match(run('Bash', { command }) || '', /^CHAT QUOTE/, command);
  assert.match(run('mcp__serio-lifecycle__act', { body: 'wywal te buzie z ludka wieksze oczy troche' }) || '', /^CHAT QUOTE/);
  const allowed = ['gh issue create -t x -b "Remove the mouth; eyes slightly larger"', 'gh pr comment 4 -b "zasady repozytorium ktore codex dokleja do kazdej rozmowy tutaj"', 'cat > body.md <<\'EOF\'\nx\nEOF\ngh issue create -b "short"','echo wywal te buzie z ludka wieksze oczy troche',
    'gh pr comment 1 -b "max cztery potwory na pokoj zawsze tutaj bez wyjatku"', 'gh pr comment 1 -b "meta tekst ktory nie jest czatem wcale nigdy przenigdy"',
    'gh pr comment 1 -b "reguly systemu ktore nie sa slowami wlasciciela nigdy tutaj"', 'gh pr comment 1 -b "raport innej sesji o scalaniu galezi dzisiaj po poludniu"',
    'git commit -m "npm run verify and then commit the brand rules file here"', 'gh issue edit 2 -b "Related: https://github.com/serio-ngo/ops/issues/150"'];
  for (const command of allowed) assert.equal(run('PowerShell', { command }), undefined, command);
  assert.equal(run('Write', { content: said }), undefined);
  const hooks = JSON.parse(readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8')).hooks.PreToolUse.map((entry) => new RegExp(entry.matcher));
  for (const tool of ['Bash', 'PowerShell', 'mcp__serio-lifecycle__act']) assert.ok(hooks.some((re) => re.test(tool)), tool);
  assert.ok(!hooks.some((re) => re.test('mcp__serio-lifecycle__state')));
  process.env.GITHUB_ACTIONS = 'true';
  assert.equal(run('Bash', { command: `gh issue create -b "${said}"` }), undefined);
  process.env.GITHUB_ACTIONS = ci ?? '';
  rmSync(box, { recursive: true, force: true });
  console.log(`guard self-test: ${denied.length + allowed.length + 7} checks passed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) {
  try { selfTest(); } catch (e) { console.error(e.message); process.exit(1); }
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
