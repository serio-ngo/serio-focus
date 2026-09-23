import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPAWN_TOOLS } from '../../plugins/serio-focus/scripts/guard.mjs';

const ALLOWED = 0;
const ASK = 'deny';
const PLUGIN = fileURLToPath(new URL('../../plugins/serio-focus/', import.meta.url));
const script = (name) => path.join(PLUGIN, 'scripts', name);

const boxes = [];
const sandbox = (prefix) => {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  boxes.push(root);
  return root;
};
after(() => {
  for (const dir of boxes.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});

const box = sandbox('guard-');
const fire = (file, payload, env = { ...process.env, HANDOFF_OS_DIR: box }) => spawnSync(process.execPath, [file], {
  input: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}),
  encoding: 'utf8',
  env,
}).status;

const guard = (payload, env) => fire(script('guard.mjs'), payload, env);
const at = (session, payload) => guard({ cwd: box, session_id: session, ...payload },
  { ...process.env, HANDOFF_OS_DIR: box });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const ask = (payload, env) => {
  const run = spawnSync(process.execPath, [script('guard.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8', env: env ?? { ...process.env, HANDOFF_OS_DIR: box },
  });
  assert.equal(run.status, ALLOWED);
  return JSON.parse(run.stdout).hookSpecificOutput.permissionDecision;
};
const blocks = (label, cases, payload) => it(label, () => {
  for (const c of cases) assert.equal(ask(payload(c)), ASK, c);
});

blocks('blocks git commit and push', [
  'git commit -m x',
  'git commit --verify -m x',
  'git -C sub commit -m x',
  'git push origin main',
  'git push --force origin main',
  'bash -c "git push origin main"',
  'powershell -Command "git commit -m x"',
], bash);

it('reopens commit and push while HANDOFF_GIT_WRITE is 1', () => {
  const open = (command) => guard({ cwd: box, session_id: 'git-open', tool_name: 'Bash', tool_input: { command } },
    { ...process.env, HANDOFF_OS_DIR: box, HANDOFF_GIT_WRITE: '1' });
  for (const command of ['git commit -m x', 'git push origin main']) {
    assert.equal(open(command), ALLOWED, command);
  }
});

it('allows git reads and local branch work', () => {
  for (const command of ['git status', 'git log --oneline', 'git diff --stat', 'git fetch origin',
    'git checkout main', 'git stash push -m wip', 'git branch feat/x', 'git merge main',
    'git push --dry-run origin main']) {
    assert.equal(at('git-ok', { tool_name: 'Bash', tool_input: { command } }), ALLOWED, command);
  }
});

blocks('blocks recursive deletes and git wipes', [
  'rm -rf docs',
  'rm -rf /',
  'ri -r docs',
  'Remove-Item -Recurse -Force docs',
  'git clean -fdx',
  'git reset --hard HEAD~1',
], bash);

describe('dispatch budget', () => {
  const spawn = (tool_input, tool_name = 'Agent') => at('dp', { tool_name, tool_input });
  const held = (session, tool_input, tool_name = 'Agent') => ask({ cwd: box, session_id: session, tool_name, tool_input });

  it('blocks a dispatch that names no model, an unknown tier, and a denied tier from the agent definition', () => {
    assert.equal(held('dp', { prompt: 'x' }), ASK);
    assert.equal(held('dp', { prompt: 'x', model: 'best-available' }), ASK);
    mkdirSync(path.join(box, '.claude', 'agents'), { recursive: true });
    writeFileSync(path.join(box, '.claude', 'agents', 'pricey.md'), '---\nname: pricey\nmodel: opus\n---\n');
    const named = (tool_input) => at('dp-agents', { tool_name: 'Agent', tool_input });
    assert.equal(held('dp-agents', { prompt: 'x', subagent_type: 'pricey' }), ASK);
    assert.equal(named({ prompt: 'x', subagent_type: 'serio-focus:scout' }), ALLOWED);
    assert.equal(held('dp', { script: "// AGENTS: 2\nawait agent('a', { model: 'haiku' }); await agent('b')" }, 'Workflow'), ASK);
    const saved = path.join(box, 'saved-workflow.js');
    writeFileSync(saved, "await agent('x')");
    assert.equal(held('dp', { scriptPath: saved }, 'Workflow'), ASK);
    assert.equal(held('dp', { scriptPath: path.join(box, 'missing-workflow.js') }, 'Workflow'), ASK);  });
  it('blocks opus without a QUALITY flag, and thinking a deliverable did not earn', () => {
    assert.equal(held('dp', { prompt: 'scan the repo', model: 'opus' }), ASK);
    const state = JSON.parse(readFileSync(path.join(box, '.claude', '.session-dp.json'), 'utf8'));
    assert.equal(state.saved.redirects, 1);
    assert.equal(state.tiers.opus, 1);
    assert.equal(held('dp', { prompt: 'ultrathink about the schema', model: 'sonnet' }), ASK);
    assert.equal(held('dp', { script: "await agent('x', { model: 'sonnet', effort: 'xhigh' })" }, 'Workflow'), ASK);
    assert.equal(held('dp', { script: "await agent('x', { model: 'sonnet', effort: high ] })" }, 'Workflow'), ASK);
    assert.equal(spawn({ script: 'agent("find where opus is configured", { model: "haiku" })' }, 'Workflow'), ALLOWED);
  });
  it('blocks a workflow that never states its agent count, and caps the count it states', () => {
    assert.equal(held('dp', { script: "await Promise.all(rows.map((r) => agent('x', { model: 'sonnet' })))" }, 'Workflow'), ASK);
    const both = spawnSync(process.execPath, [script('guard.mjs')], { encoding: 'utf8', env: { ...process.env, HANDOFF_OS_DIR: box },
      input: JSON.stringify({ cwd: box, session_id: 'dp', tool_name: 'Workflow', tool_input: { script: 'await parallel(rows.map((r) => () => agent(r)))' } }) });
    assert.match(JSON.parse(both.stdout).hookSpecificOutput.permissionDecisionReason, /naming no model.*; .*AGENTS: 3/);
    assert.equal(held('dp', { script: "// AGENTS: 30\nawait parallel(rows.map((r) => () => agent(r, { model: 'haiku' })))" }, 'Workflow'), ASK);
    assert.equal(spawn({ prompt: 'the wave a denied workflow claimed is free again', model: 'haiku' }), ALLOWED);
  });
  it('holds dispatch and web after the stall budget with no repo change', () => {
    const repo = sandbox('stall-');
    spawnSync('git', ['init', '-q', repo]);
    const env = { ...process.env, HANDOFF_OS_DIR: box, CLAUDE_PROJECT_DIR: repo, HANDOFF_STALL_HOLD: '1000000', HANDOFF_STALL_WARN: '500000' };
    const payload = { cwd: repo, session_id: 'stall', transcript_path: path.join(sandbox('stall-log-'), 's.jsonl') };
    spawnSync(process.execPath, [script('card.mjs')], { input: JSON.stringify(payload), env });
    writeFileSync(payload.transcript_path, `${JSON.stringify({ type: 'assistant', message: { id: 'm1', usage: { input_tokens: 1100000 } } })}\n`);
    assert.equal(ask({ ...payload, tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }, env), ASK);
    const receipt = spawnSync(process.execPath, [script('verify.mjs')], { input: JSON.stringify(payload), encoding: 'utf8', env });
    assert.match(receipt.stdout, /1\.1M tok since the last repo change/);
  });
});

describe('fan-out cap', () => {
  const spawn = (session, tool_input, tool_name = 'Agent') => at(session, { tool_name, tool_input });
  const held = (session, tool_input, tool_name = 'Agent') => ask({ cwd: box, session_id: session, tool_name, tool_input });

  it('runs three agents per wave and holds the fourth', () => {
    for (let n = 0; n < 3; n += 1) assert.equal(spawn('wave', { prompt: `s${n}`, model: 'haiku' }), ALLOWED);
    assert.equal(held('wave', { prompt: 'fourth', model: 'haiku' }), ASK);
  });
  it('never routes Claude Code to-do tools into the wave', () => {
    const { matcher } = JSON.parse(readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse[0];
    for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskList']) assert.doesNotMatch(tool, new RegExp(matcher));
    for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskList']) assert(!SPAWN_TOOLS.includes(tool), tool);
  });
  it('lets a single workflow agent through', () => {
    assert.equal(spawn('narrow', { script: 'await agent("find where opus is configured", { model: "haiku" })' }, 'Workflow'), ALLOWED);
  });
});

describe('read and query budgets', () => {
  const probe = path.join(box, 'probe.txt');

  const run = (session, payload) => spawnSync(process.execPath, [script('guard.mjs')], {
    input: JSON.stringify({ cwd: box, session_id: session, ...payload }), encoding: 'utf8', env: { ...process.env, HANDOFF_OS_DIR: box },
  });
  const state = (session) => JSON.parse(readFileSync(path.join(box, '.claude', `.session-${session}.json`), 'utf8'));
  const rewritten = (result) => JSON.parse(result.stdout).hookSpecificOutput;

  it('rewrites a whole-file read over the 24KB limit to a line slice and books the trimmed bytes', () => {
    writeFileSync(probe, `${'x'.repeat(63)}\n`.repeat(400));
    const result = run('bq', { tool_name: 'Read', tool_input: { file_path: probe } });
    assert.equal(result.status, ALLOWED);
    const out = rewritten(result);
    assert.equal(out.permissionDecision, 'allow');
    assert.ok(out.updatedInput.limit > 0 && out.updatedInput.limit < 400, String(out.updatedInput.limit));
    assert.equal(out.updatedInput.file_path, probe);
    assert.equal(state('bq').saved.trimmed, 400 * 64 - out.updatedInput.limit * 64);
    assert.equal(state('bq').saved.rewrites, 1);
  });
  it('holds a shell whole-file read over the 24KB limit, spaced path included', () => {
    const big = `${'x'.repeat(70)}\n`.repeat(500);
    const plain = path.join(box, 'echoed.txt');
    writeFileSync(plain, big);
    const hold = (session, command) => ask({ cwd: box, session_id: session, tool_name: 'Bash', tool_input: { command } });
    assert.equal(hold('ec', `cat ${plain}`), ASK);
    assert.equal(hold('or', `cat ${plain} || echo fallback`), ASK);
    const dir = path.join(box, 'with space');
    mkdirSync(dir, { recursive: true });
    const spaced = path.join(dir, 'big file.txt');
    writeFileSync(spaced, big);
    assert.equal(hold('sp', `cat "${spaced}"`), ASK);
    assert.equal(state('sp').saved.slices, 1);
  });
  it('refuses an oversize read whose flag or redirect head -c cannot reproduce', () => {
    const flagged = path.join(box, 'flagged.txt');
    writeFileSync(flagged, `${'x'.repeat(70)}\n`.repeat(500));
    const hold = (session, command) => ask({ cwd: box, session_id: session, tool_name: 'Bash', tool_input: { command } });
    assert.equal(hold('fl', `cat -n ${flagged}`), ASK);
    assert.equal(hold('fl2', `cat ${flagged} 2>&1`), ASK);
    assert.equal(hold('fl3', `cat ${flagged} 1>&2`), ASK);
    const small = path.join(box, 'beside.txt');
    writeFileSync(small, 'beside');
    assert.equal(hold('fl4', `cat ${small}; cat -n ${flagged}`), ASK);
    assert.equal(at('fl4', { tool_name: 'Bash', tool_input: { command: `cat ${small}` } }), ALLOWED);
    assert.equal(state('fl4').saved.read, 6);
  });
  it('blocks a re-read of the same unchanged bytes', () => {
    writeFileSync(probe, 'small');
    at('bq', { tool_name: 'Read', tool_input: { file_path: probe } });
    assert.equal(ask({ cwd: box, session_id: 'bq', tool_name: 'Read', tool_input: { file_path: probe } }), ASK);
    const sub = (agent_id) => ({ agent_type: 'workflow-subagent', agent_id, tool_name: 'Read', tool_input: { file_path: probe } });
    run('bq-sub', sub('a1'));
    assert.equal(run('bq-sub', sub('a2')).stdout, '', 'a sibling subagent never read these bytes');
    assert.equal(ask({ cwd: box, session_id: 'bq-sub', ...sub('a1') }), ASK);
  });
  it('leaves an image read whole', () => {
    const png = path.join(box, 'shot.png');
    writeFileSync(png, `${'x'.repeat(63)}\n`.repeat(480));
    assert.equal(run('img', { tool_name: 'Read', tool_input: { file_path: png } }).stdout, '');
    assert.equal(at('img-sh', { tool_name: 'Bash', tool_input: { command: `cat ${png}` } }), ALLOWED);
  });
  it('holds a runaway subagent past its web call cap', () => {
    const web = { agent_type: 'workflow-subagent', agent_id: 'w1', tool_name: 'WebSearch', tool_input: { query: 'q' } };
    for (let n = 0; n < 2; n += 1) run('web', web);
    assert.equal(ask({ cwd: box, session_id: 'web', ...web }, { ...process.env, HANDOFF_OS_DIR: box, HANDOFF_WEB_CAP: '2' }), ASK);
  });
});

describe('session receipt', () => {
  const GATE = script('verify.mjs');
  const run = (session, payload) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ cwd: box, session_id: session, ...payload }), encoding: 'utf8', env: { ...process.env, HANDOFF_OS_DIR: box },
  });

  const hook = (file, payload) => spawnSync(process.execPath, [file], {
    input: JSON.stringify({ cwd: box, ...payload }), encoding: 'utf8', env: { ...process.env, HANDOFF_OS_DIR: box, CLAUDE_PROJECT_DIR: '' },
  });
  const transcript = (content) => {
    const file = path.join(sandbox('scratch-'), 'session.jsonl');
    const row = JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'opus', usage: { input_tokens: 600000, output_tokens: 1000 }, content } });
    writeFileSync(file, `${row}\n${row}\n`);
    return file;
  };

  it('stays silent with nothing to report', () => {
    const quiet = run('quiet', {});
    assert.equal(quiet.status, ALLOWED);
    assert.equal(quiet.stdout, '');
  });
  it('prints one receipt line after activity, never a gate', () => {
    const file = path.join(box, 'receipt.txt');
    writeFileSync(file, 'hello');
    at('rc-a', { tool_name: 'Read', tool_input: { file_path: file } });
    const quiet = run('rc-a', {});
    assert.equal(quiet.stdout, '', 'an allowed read is not a saving');
    ask({ cwd: box, session_id: 'rc-a', tool_name: 'Read', tool_input: { file_path: file } });
    const first = run('rc-a', {});
    assert.equal(first.status, ALLOWED);
    assert.match(first.stdout, /SERIO FOCUS · \d+ tok kept out \(\d+%\) · 1 guard action"/);
    at('rc-b', { tool_name: 'Read', tool_input: { file_path: file } });
    ask({ cwd: box, session_id: 'rc-b', tool_name: 'Read', tool_input: { file_path: file } });
    const edited = transcript([{ type: 'tool_use', name: 'Edit', input: { file_path: file } }]);
    const claim = hook(GATE, { session_id: 'rc-b', transcript_path: edited, last_assistant_message: 'All done, it works now.' });
    assert.equal(claim.status, ALLOWED);
    assert.match(claim.stdout, /SERIO FOCUS · \d+ tok kept out \(\d+%\) · 1 guard action"/);
    assert.doesNotMatch(claim.stdout, /VERIFY GATE|stood down|done claimed|nothing run|spent|cached|top tier|repo edits|~/i);
  });
  it('copies files written outside the repo when a turn dies on a limit', () => {
    const draft = path.join(sandbox('draft-'), 'session-draft.md');
    writeFileSync(draft, 'plan');
    hook(script('rescue.mjs'), { session_id: 'dead', transcript_path: transcript([{ type: 'tool_use', name: 'Write', input: { file_path: draft } }]) });
    assert.equal(readFileSync(path.join(box, '.claude', 'rescue', 'dead', '1-session-draft.md'), 'utf8'), 'plan');
    assert.match(hook(script('card.mjs'), { source: 'startup' }).stdout, /RESCUE 1 session\(s\) ended on an API error/);
  });
});
