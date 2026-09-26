import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
process.env.SERIO_CONFIG_DIR = sandbox('config-');
const fire = (file, payload, env = { ...process.env, SERIO_OS_DIR: box }) => {
  const run = spawnSync(process.execPath, [file], { input: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}), encoding: 'utf8', env });
  return /"permissionDecision":"deny"/.test(run.stdout) ? ASK : run.status;
};

const guard = (payload, env) => fire(script('guard.mjs'), payload, env);
const at = (session, payload) => guard({ cwd: box, session_id: session, ...payload },
  { ...process.env, SERIO_OS_DIR: box });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const ask = (payload, env) => {
  const run = spawnSync(process.execPath, [script('guard.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8', env: env ?? { ...process.env, SERIO_OS_DIR: box },
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
  'if true; then git push origin main; fi',
], bash);

it('reopens commit and push while SERIO_GIT_WRITE is 1', () => {
  const open = (command) => guard({ cwd: box, session_id: 'git-open', tool_name: 'Bash', tool_input: { command } },
    { ...process.env, SERIO_OS_DIR: box, SERIO_GIT_WRITE: '1' });
  for (const command of ['git commit -m x', 'git push origin main']) {
    assert.equal(open(command), ALLOWED, command);
  }
});

it('allows git reads, local branch work and scratch deletes, in the guard and in the settings policy', () => {
  const policy = JSON.parse(readFileSync(new URL('../settings/policy.json', import.meta.url), 'utf8'));
  const denied = [...policy.deny, ...Object.values(policy.unlock).flat()].map((rule) => /^Bash\((.*)\)$/.exec(rule)?.[1]).filter(Boolean)
    .map((glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
  for (const command of ['git status', 'git log --oneline', 'git diff --stat', 'git fetch origin',
    'git checkout main', 'git stash push -m wip', 'git branch feat/x', 'git merge main',
    'git push --dry-run origin main', 'git branch -a', 'git branch --show-current', 'git tag -l', 'git stash list',
    'git checkout -- src/a.ts', 'D="$TEMP/probe"; rm -rf "$D"', 'rm -rf "$TMPDIR/probe"', 'cd /tmp && rm -rf probe', 'rm -rf .wrangler/state/v3/kv dist-serio-org 2>/dev/null',
    '$b = Join-Path ([System.IO.Path]::GetTempPath()) "x"; Remove-Item -Recurse -Force $b']) {
    assert.equal(at('git-ok', { tool_name: 'Bash', tool_input: { command } }), ALLOWED, command);
    if (/^git (?!merge|push)/.test(command)) assert(!denied.some((rx) => rx.test(command)), `settings deny ${command}`);
  }
});

blocks('blocks recursive deletes and git wipes', [
  'rm -rf docs',
  'rm -rf /',
  'ri -r docs',
  'Remove-Item -Recurse -Force docs',
  'git clean -fdx',
  'git reset --hard HEAD~1',
  'rm -rf tmp/../src',
  'rm -rf "$D"; D=/tmp',
  'D=/tmp; D=/home; rm -rf "$D"',
  'true && D=/tmp; rm -rf "$D"',
  'test $D = /tmp || rm -rf $D',
  'D=/tmp; for D in /home; do rm -rf "$D"; done',
  'for d in a; do rm -rf docs; done',
], bash);

describe('dispatch budget', () => {
  const spawn = (tool_input, tool_name = 'Agent') => at('dp', { tool_name, tool_input });
  const held = (session, tool_input, tool_name = 'Agent') => ask({ cwd: box, session_id: session, tool_name, tool_input });
  const routed = (session, tool_input, tool_name = 'Agent') => JSON.parse(spawnSync(process.execPath, [script('guard.mjs')], { encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: box },
    input: JSON.stringify({ cwd: box, session_id: session, tool_name, tool_input }) }).stdout).hookSpecificOutput.updatedInput ?? {};

  it('routes a dispatch with no model or a denied tier from the agent definition to sonnet, one with no type to the worker, and blocks an unknown tier', () => {
    const bare = routed('dp-route', { prompt: 'x' });
    assert.deepEqual([bare.model, bare.subagent_type], ['sonnet', 'serio-focus:worker']);
    assert.match(routed('dp-lean', { script: "await agent('x', { model: 'haiku' })" }, 'Workflow').script ?? '', /agentType: 'serio-focus:worker', model: 'haiku'/);
    const mixed = routed('dp-lean2', { script: "await agent('a', { model: 'haiku', agentType: 'general-purpose' }); await agent('b', { model: 'haiku', schema: { type: 'object' } })" }, 'Workflow').script ?? '';
    assert.equal((mixed.match(/serio-focus:worker/g) || []).length, 1);
    assert.match(mixed, /agent\('b'[^)]*agentType: 'serio-focus:worker'/);
    assert.match(readFileSync(path.join(PLUGIN, 'agents', 'worker.md'), 'utf8'), /^name: worker$/m);
    assert.equal(held('dp', { prompt: 'x', model: 'best-available' }), ASK);
    mkdirSync(path.join(box, '.claude', 'agents'), { recursive: true });
    writeFileSync(path.join(box, '.claude', 'agents', 'pricey.md'), '---\nname: pricey\nmodel: opus\n---\n');
    const named = (tool_input) => at('dp-agents', { tool_name: 'Agent', tool_input });
    assert.equal(routed('dp-agents', { prompt: 'x', subagent_type: 'pricey' }).model, 'sonnet');
    assert.equal(named({ prompt: 'x', subagent_type: 'serio-focus:scout' }), ALLOWED);
    assert.equal(held('dp', { script: "// AGENTS: 2\nawait agent('a', { model: 'haiku' }); await agent('b')" }, 'Workflow'), ASK);
    const saved = path.join(box, 'saved-workflow.js');
    writeFileSync(saved, "await agent('x')");
    assert.equal(held('dp', { scriptPath: saved }, 'Workflow'), ASK);
    assert.equal(held('dp', { scriptPath: path.join(box, 'missing-workflow.js') }, 'Workflow'), ASK);
    const row = readFileSync(path.join(box, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse).pop();
    assert.deepEqual(Object.keys(row), ['ts', 'v', 'session', 'actor', 'agent', 'call', 'action', 'target', 'rule', 'result']);
    assert.doesNotMatch(row.result, new RegExp(`^(?:blocked: )?${row.rule}`));
  });
  it('routes opus without a QUALITY flag to sonnet, and blocks thinking a deliverable did not earn', () => {
    assert.equal(routed('dp-opus', { prompt: 'scan the repo', model: 'opus' }).model, 'sonnet');
    const state = JSON.parse(readFileSync(path.join(box, '.claude', '.session-dp-opus.json'), 'utf8'));
    assert.equal(state.saved.redirects, 1);
    assert.equal(state.tiers.opus, 1);
    assert.match(routed('dp-wf', { script: "await agent('x', { model: 'opus' })" }, 'Workflow').script ?? '', /model: 'sonnet'/);
    assert.equal(at('dp-high', { tool_name: 'Workflow', tool_input: { script: "await agent('x', { model: 'sonnet', effort: 'high' })" } }), ALLOWED);
    assert.equal(held('dp', { prompt: 'ultrathink about the schema', model: 'sonnet' }), ASK);
    assert.equal(held('dp', { script: "await agent('x', { model: 'sonnet', effort: 'xhigh' })" }, 'Workflow'), ASK);
    assert.equal(held('dp', { script: "await agent('x', { model: 'sonnet', effort: max ] })" }, 'Workflow'), ASK);
    assert.equal(held('dp', { prompt: 'review the diff, effort: xhigh', model: 'sonnet' }), ASK);
    assert.equal(held('dp', { prompt: 'review this, effort: high, effort: max', model: 'sonnet' }), ASK);
    assert.doesNotMatch(spawnSync(process.execPath, [script('guard.mjs')], { encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: box },
      input: JSON.stringify({ cwd: box, session_id: 'dp', tool_name: 'Agent', tool_input: { prompt: 'review the diff, effort: high', model: 'sonnet' } }) }).stdout, /deny/);
    assert.equal(spawn({ script: 'agent("find where opus is configured", { model: "haiku" })' }, 'Workflow'), ALLOWED);
  });
  it('blocks a workflow that fans out through a map or loop without its agent count, and caps the count it states', () => {
    assert.equal(held('dp', { script: "await Promise.all(rows.map((r) => agent('x', { model: 'sonnet' })))" }, 'Workflow'), ASK);
    assert.equal(at('dp-static', { tool_name: 'Workflow', tool_input: { script: "await parallel([() => agent('a', { model: 'haiku' }), () => agent('b', { model: 'haiku' })])" } }), ALLOWED);
    const both = spawnSync(process.execPath, [script('guard.mjs')], { encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: box },
      input: JSON.stringify({ cwd: box, session_id: 'dp', tool_name: 'Workflow', tool_input: { script: 'await parallel(rows.map((r) => () => agent(r)))' } }) });
    assert.match(JSON.parse(both.stdout).hookSpecificOutput.permissionDecisionReason, /naming no model.*; .*AGENTS: 3/);
    assert.equal(held('dp', { script: "// AGENTS: 30\nawait parallel(rows.map((r) => () => agent(r, { model: 'haiku' })))" }, 'Workflow'), ASK);
    const wide = spawnSync(process.execPath, [script('guard.mjs')], { encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: box },
      input: JSON.stringify({ cwd: box, session_id: 'dp-wide', tool_name: 'Workflow', tool_input: { script: "// AGENTS: 4\nawait parallel(rows.map((r) => () => agent(r, { model: 'haiku' })))" } }) });
    assert.match(JSON.parse(wide.stdout).hookSpecificOutput.permissionDecisionReason, /AGENTS: 3\+1/);
    assert.equal(spawn({ prompt: 'the wave a denied workflow claimed is free again', model: 'haiku' }), ALLOWED);
  });
  it('holds dispatch and web after the stall budget with no repo change', () => {
    const repo = sandbox('stall-');
    spawnSync('git', ['init', '-q', repo]);
    const env = { ...process.env, SERIO_OS_DIR: box, CLAUDE_PROJECT_DIR: repo, SERIO_STALL_HOLD: '1000000', SERIO_STALL_WARN: '500000' };
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
    input: JSON.stringify({ cwd: box, session_id: session, ...payload }), encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: box },
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
  it('blocks a re-read of the same unchanged bytes, and only bytes an earlier call delivered', () => {
    writeFileSync(probe, 'small');
    at('bq', { tool_name: 'Read', tool_input: { file_path: probe } });
    assert.equal(ask({ cwd: box, session_id: 'bq', tool_name: 'Read', tool_input: { file_path: probe } }), ASK);
    const sh = (command) => at('bq', { tool_name: 'Bash', tool_input: { command } });
    mkdirSync(path.join(box, 'other'), { recursive: true });
    writeFileSync(path.join(box, 'other', 'probe.txt'), 'other');
    const wide = [1, 2].map((n) => path.join(box, `wide-${n}.txt`));
    wide.forEach((file) => writeFileSync(file, 'x'.repeat(20000)));
    for (const command of ['cd other && cat probe.txt', 'echo x >> probe.txt; cat probe.txt', `cat ${wide.join(' ')} probe.txt`]) assert.equal(sh(command), ALLOWED, command);
    const log = path.join(sandbox('denied-'), 's.jsonl');
    writeFileSync(log, `${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'Permission to use Bash has been denied.', is_error: true, tool_use_id: 'td' }] } })}\n`);
    const denied = (tool_use_id) => guard({ cwd: box, session_id: 'bq-denied', transcript_path: log, tool_use_id, tool_name: 'Read', tool_input: { file_path: probe } });
    denied('td');
    assert.equal(denied('te'), ALLOWED);
    const sub = (agent_id) => ({ agent_type: 'workflow-subagent', agent_id, tool_name: 'Read', tool_input: { file_path: probe } });
    run('bq-sub', sub('a1'));
    assert.equal(run('bq-sub', sub('a2')).stdout, '', 'a sibling subagent never read these bytes');
    assert.equal(ask({ cwd: box, session_id: 'bq-sub', ...sub('a1') }), ASK);
  });
  it('books every read from parallel subagents', async () => {
    const reads = Array.from({ length: 24 }, (_, n) => path.join(box, `par-${n}.txt`));
    reads.forEach((file) => writeFileSync(file, 'x'.repeat(100)));
    await Promise.all(reads.map((file, n) => new Promise((done) => {
      const child = spawn(process.execPath, [script('guard.mjs')], { env: { ...process.env, SERIO_OS_DIR: box } });
      child.on('close', done);
      child.stdin.end(JSON.stringify({ cwd: box, session_id: 'par', agent_type: 'workflow-subagent', agent_id: `p${n}`, tool_name: 'Read', tool_input: { file_path: file } }));
    })));
    assert.equal(state('par').saved.offload, 2400);
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
    assert.equal(ask({ cwd: box, session_id: 'web', ...web }, { ...process.env, SERIO_OS_DIR: box, SERIO_WEB_CAP: '2' }), ASK);
  });
});

describe('session receipt', () => {
  const GATE = script('verify.mjs');
  const run = (session, payload) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ cwd: box, session_id: session, ...payload }), encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: box },
  });

  const hook = (file, payload) => spawnSync(process.execPath, [file], {
    input: JSON.stringify({ cwd: box, ...payload }), encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: box, CLAUDE_PROJECT_DIR: '' },
  });
  const transcript = (content) => {
    const file = path.join(sandbox('scratch-'), 'session.jsonl');
    const row = JSON.stringify({ type: 'assistant', perTurnEffort: 'xhigh', message: { id: 'm1', model: 'opus', usage: { input_tokens: 600000, output_tokens: 1000, output_tokens_details: { thinking_tokens: 400 } }, content } });
    const denied = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Permission to use Bash with command git branch -a has been denied.' }] } });
    writeFileSync(file, `${row}\n${row}\n${denied}\n`);
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
    assert.match(first.stdout, /SERIO FOCUS · \d+ tok kept out · 1 guard action"/);
    const rows = (session) => readFileSync(path.join(box, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.session === session);
    const receipt = rows('rc-a').pop();
    assert.equal(receipt.action, 'session');
    assert(Object.values(receipt.target).every(Boolean), JSON.stringify(receipt.target));
    at('rc-b', { tool_name: 'Read', tool_input: { file_path: file } });
    ask({ cwd: box, session_id: 'rc-b', tool_name: 'Read', tool_input: { file_path: file } });
    const edited = transcript([{ type: 'tool_use', name: 'Edit', input: { file_path: file } }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git branch -a' } }]);
    const claim = hook(GATE, { session_id: 'rc-b', transcript_path: edited, last_assistant_message: 'All done, it works now.' });
    assert.equal(claim.status, ALLOWED);
    assert.match(claim.stdout, /SERIO FOCUS · \d+ tok kept out \(0% of main context\) · 1 guard action"/);
    const [deniedRow, sessionRow] = rows('rc-b').slice(-2);
    assert.deepEqual([deniedRow.rule, deniedRow.target, deniedRow.call], ['SETTINGS DENY', 'git branch -a', 't1']);
    assert.deepEqual([sessionRow.result.effort, sessionRow.result.thinking, sessionRow.result.edits, sessionRow.result.denied], [{ xhigh: 1 }, 400, 1, 1]);
    at('rc-sub', { agent_type: 'workflow-subagent', agent_id: 's1', tool_name: 'Read', tool_input: { file_path: file } });
    assert.equal(run('rc-sub', {}).stdout, '', 'a subagent read is not a guard action');
    assert.doesNotMatch(claim.stdout, /VERIFY GATE|stood down|done claimed|nothing run|spent|cached|top tier|repo edits|~/i);
  });
  it('copies files written outside the repo when a turn dies on a limit', () => {
    const draft = path.join(sandbox('draft-'), 'session-draft.md');
    writeFileSync(draft, 'plan');
    hook(script('rescue.mjs'), { session_id: 'dead', transcript_path: transcript([{ type: 'tool_use', name: 'Write', input: { file_path: draft } }]) });
    assert.equal(readFileSync(path.join(box, '.claude', 'rescue', 'dead', '1-session-draft.md'), 'utf8'), 'plan');
    assert.match(hook(script('card.mjs'), { source: 'startup' }).stdout, /RESCUE 1 session\(s\) ended on an API error/);
  });
  it('notes a near usage limit once per window and actor, learned from the last limit hit', () => {
    const config = sandbox('limit-');
    const now = Date.now();
    const reset = Math.floor((now - 36e5) / 1000) * 1000;
    const row = (at, extra) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), ...extra });
    mkdirSync(path.join(config, 'projects', 'p'), { recursive: true });
    writeFileSync(path.join(config, 'projects', 'p', 's.jsonl'), [row(reset - 72e5, { message: { id: 'a', usage: { input_tokens: 1000 } } }),
      row(reset - 36e5, { isApiErrorMessage: true, quotaLimits: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: reset / 1000 } }),
      row(now - 6e5, { message: { id: 'b', usage: { input_tokens: 850 } } }), ''].join('\n'));
    const env = { ...process.env, SERIO_OS_DIR: sandbox('limit-os-'), SERIO_CONFIG_DIR: config };
    const note = (extra) => spawnSync(process.execPath, [script('guard.mjs')], { encoding: 'utf8', env,
      input: JSON.stringify({ cwd: box, session_id: 'lim', tool_name: 'Bash', tool_input: { command: 'ls' }, ...extra }) }).stdout;
    assert.match(note({}), /LIMIT NEAR: 85% of the five_hour usage window.*document all work/);
    assert.equal(note({}), '');
    assert.match(note({ agent_id: 'w1', agent_type: 'workflow-subagent' }), /return your findings now/);
  });
});
