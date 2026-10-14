import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPAWN_TOOLS } from '../../plugins/serio-focus/scripts/guard.mjs';
import { inventory } from '../cli/generate.mjs';

const ALLOWED = 0;
const ASK = 'ask';
const DENY = 'deny';
const PLUGIN = fileURLToPath(new URL('../../plugins/serio-focus/', import.meta.url));
const REPO = path.resolve(PLUGIN, '..', '..');
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

const outside = sandbox('outside-');
spawnSync('git', ['init', '-q', outside]);
mkdirSync(path.join(outside, 'data'));
writeFileSync(path.join(outside, 'data', 'a.txt'), 'keep');
const box = sandbox('guard-');
spawnSync('git', ['init', '-q', box]);
writeFileSync(path.join(box, '.gitignore'), 'node_modules/\ndist*/\n.wrangler/\n');
for (const file of ['lib/a.js', 'mod/a.js', 'dist/tracked.txt', 'docs/a.md', 'src/a.ts', 'child/notes/a.md', '123', '--valuable', 'dist-x/a.txt', 'hid/a.js']) {
  mkdirSync(path.dirname(path.join(box, file)), { recursive: true });
  writeFileSync(path.join(box, file), 'keep');
}
spawnSync('git', ['-C', box, 'add', '-f', 'lib', 'mod', 'hid', 'dist/tracked.txt']);
spawnSync('git', ['-C', box, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture']);
writeFileSync(path.join(box, 'mod', 'a.js'), 'changed');
spawnSync('git', ['-C', box, 'update-index', '--assume-unchanged', 'hid/a.js']);
writeFileSync(path.join(box, 'hid', 'a.js'), 'changed');
symlinkSync(path.join(outside, 'data'), path.join(box, 'dist', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
process.env.SERIO_WAVE_MS = String(864e5);
const fire = (file, payload, env = { ...process.env, SERIO_OS_DIR: box }) => {
  const run = spawnSync(process.execPath, [file], { input: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}), encoding: 'utf8', env });
  return /"permissionDecision":"(ask|deny)"/.exec(run.stdout)?.[1] ?? run.status;
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
  assert.match(run.stdout, /"permissionDecision":"(?:ask|deny)"/, payload.tool_input?.command);
  return JSON.parse(run.stdout).hookSpecificOutput.permissionDecision;
};
const blocks = (label, cases, payload) => it(label, () => {
  for (const c of cases) assert.equal(ask(payload(c)), ASK, c);
});

it('rejects stale generated artefacts and product descriptions', () => {
  const repo = sandbox('generation-');
  cpSync(REPO, repo, {
    recursive: true, filter: (file) => !/(?:^|[/\\])(?:\.git|\.claude|node_modules|audit)(?:[/\\]|$)/.test(file),
  });
  const cli = path.join(repo, 'tooling', 'cli', 'serio.mjs');
  assert.match(readFileSync(path.join(REPO, '.github', 'workflows', 'verify.yml'), 'utf8'), /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  const before = spawnSync(process.execPath, [cli, 'upkeep'], { encoding: 'utf8' });
  if (before.status !== 0) throw new Error(before.stderr || 'fixture generation failed');
  const description = JSON.parse(readFileSync(path.join(repo, 'plugins', 'serio-focus', '.claude-plugin', 'plugin.json'), 'utf8')).description;
  for (const file of ['docs/demo.svg', 'docs/MANIFEST.md', 'plugins/serio-focus/.codex-plugin/plugin.json']) {
    const target = path.join(repo, file);
    const text = readFileSync(target, 'utf8');
    writeFileSync(target, text.includes(description) ? text.replaceAll(description, 'stale description') : `${text}\nstale\n`);
    const result = spawnSync(process.execPath, [cli, 'upkeep', '--check'], { encoding: 'utf8' });
    assert.notEqual(result.status, ALLOWED, file);
    assert.match(result.stderr, /generated artefacts are stale:/);
    assert(result.stderr.includes(file), result.stderr);
  }
  writeFileSync(path.join(repo, 'plugins', 'serio-focus', 'scripts', 'guard.mjs'), 'process.exit(1);');
  const failed = spawnSync(process.execPath, [cli, 'upkeep'], { encoding: 'utf8' });
  assert.notEqual(failed.status, ALLOWED);
  assert.match(failed.stderr, /guard execution failed:/);
});

it('rejects zero inventory counts when skill and agent files exist', () => {
  const repo = sandbox('inventory-');
  cpSync(PLUGIN, path.join(repo, 'plugins', 'serio-focus'), { recursive: true });
  writeFileSync(path.join(repo, 'package.json'), '{}');
  const plugin = path.join(repo, 'plugins', 'serio-focus');
  mkdirSync(path.join(plugin, 'skills', 'probe'), { recursive: true });
  mkdirSync(path.join(plugin, 'agents'), { recursive: true });
  writeFileSync(path.join(plugin, 'skills', 'probe', 'SKILL.md'), '---\nname: probe\n---\n');
  writeFileSync(path.join(plugin, 'agents', 'probe.md'), '---\nname: probe\n---\n');
  const result = inventory(repo);
  assert.notEqual(result.skills, 0);
  assert.notEqual(result.agents, 0);
});

it('keeps startup context small and agents, skills and Codex roles well-formed', async () => {
  const { agents, codexRoles, skills, startupChars } = await import('../cli/generate.mjs');
  const roles = agents();
  assert.deepEqual(roles.map((agent) => agent.name), ['architect', 'coder', 'reviewer', 'tester']);
  for (const doc of [...roles, ...skills()]) assert.ok(doc.description.length > 0 && doc.description.length <= 300, doc.name);
  for (const skill of skills()) assert.equal(skill.name, skill.dir, skill.dir);
  for (const agent of roles) assert.equal(/\b(?:Edit|Write)\b/.test(agent.tools), ['coder', 'tester'].includes(agent.name), agent.name);
  for (const [role, agent] of codexRoles().map((role, i) => [role, roles[i]])) {
    assert.match(role.text, new RegExp(`^name = "serio-${agent.name}"\\ndescription = ".+"\\n`));
    assert.equal(role.text.includes('sandbox_mode = "read-only"'), ['architect', 'reviewer'].includes(agent.name), agent.name);
    assert.ok(role.text.endsWith(`'''\n${agent.body}\n'''\n`) && !agent.body.includes("'''"), agent.name);
  }
  assert.ok(startupChars() < 1950, String(startupChars()));
  const hooks = JSON.parse(readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PreToolUse', 'SessionStart', 'Stop']);
});

it('corpus: every labelled case gets its verdict', async () => {
  const { score } = await import('../cli/generate.mjs');
  assert.deepEqual(score().misses, []);
});

it('runs commit and push, audits every hold and every session receipt', () => {
  const run = (command) => guard({ cwd: box, session_id: 'git-open', ...bash(command) });
  for (const command of ['git commit -m x', 'git push origin main']) {
    assert.equal(run(command), ALLOWED, command);
  }
  assert.equal(run('rm -rf docs'), ASK);
  const rows = readFileSync(path.join(box, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(Object.entries(rows.at(-1)).filter(([key]) => ['session', 'action', 'target', 'rule', 'result'].includes(key)),
    [['session', 'git-open'], ['action', 'Bash'], ['rule', 'DELETE'], ['result', ASK]]);
  const codex = JSON.parse(spawnSync(process.execPath, [script('guard.mjs')], { input: JSON.stringify({ cwd: box, turn_id: 'turn-1', ...bash('rm -rf docs') }),
    encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: box } }).stdout).hookSpecificOutput;
  assert.equal(codex.permissionDecision, DENY);
  assert.match(codex.permissionDecisionReason, /Held: give the user the exact command/);
  const transcript = path.join(box, 'transcript.jsonl');
  writeFileSync(transcript, [{ customTitle: 'T', gitBranch: 'b' }, 'x', ...[1, 1].map(() => ({ type: 'assistant',
    message: { id: 'm', usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4 }, content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.js' } }] } }))]
    .map((row) => JSON.stringify(row)).join('\n'));
  assert.equal(fire(script('receipt.mjs'), { cwd: box, session_id: 'receipt', transcript_path: transcript }), 0);
  const receipt = readFileSync(path.join(box, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.deepEqual([receipt.session, receipt.action, receipt.result],
    ['receipt', 'session', { project: box, branch: 'b', title: 'T', calls: 1, tokens: 9, files: ['a.js'] }]);
  assert.equal(fire(script('receipt.mjs'), { cwd: box, session_id: 'codex', turn_id: 'turn-1', transcript_path: transcript }), 0);
  const codexReceipt = readFileSync(path.join(box, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.deepEqual([codexReceipt.session, codexReceipt.action, codexReceipt.result],
    ['codex', 'session', { project: box, branch: 'b', title: 'T', calls: 1, tokens: 9, files: ['a.js'] }]);
});

it('never persists shell secrets or descriptions in denial records', () => {
  const secret = 'private-token-123';
  ask({ cwd: box, session_id: 'private-command', agent_type: 'coder', agent_id: 'agent-1', tool_use_id: 'call-1',
    ...bash(`rm -rf ~/${secret}`) });
  const saved = readFileSync(path.join(box, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8');
  assert(!saved.includes(secret));
  const row = JSON.parse(saved.trim().split('\n').at(-1));
  assert.deepEqual([row.agent, row.call, row.actor, row.result], ['agent-1', 'call-1', 'coder', ASK]);
});

it('keeps denials observable when the audit directory cannot be written', () => {
  const root = sandbox('audit-failure-');
  writeFileSync(path.join(root, 'audit'), 'keep');
  const run = spawnSync(process.execPath, [script('guard.mjs')], { input: JSON.stringify(bash('rm -rf ~/private-token-123')),
    encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: root } });
  assert.match(run.stdout, /"permissionDecision":"ask"/);
  assert.match(run.stderr, /SERIO AUDIT: could not persist denial/);
  assert.equal(readFileSync(path.join(root, 'audit'), 'utf8'), 'keep');
});

it('audits malformed protected payload denials', () => {
  const root = sandbox('audit-malformed-');
  const run = spawnSync(process.execPath, [script('guard.mjs')], { input: '{"tool_name":"Bash",', encoding: 'utf8',
    env: { ...process.env, SERIO_OS_DIR: root } });
  assert.match(run.stdout, /"permissionDecision":"deny"/);
  const row = JSON.parse(readFileSync(path.join(root, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8'));
  assert.deepEqual([row.action, row.rule, row.result], ['Bash', 'BLOCKED', 'deny']);
});

it('allows git work and deletes git can restore, in the guard and in the settings policy', () => {
  const policy = JSON.parse(readFileSync(new URL('../settings/policy.json', import.meta.url), 'utf8'));
  const denied = policy.deny.map((rule) => /^Bash\((.*)\)$/.exec(rule)?.[1]).filter(Boolean)
    .map((glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
  const shellTemp = tmpdir().replace(/^([A-Za-z]):/, (hit, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, '/');
  const shellTempReal = realpathSync(tmpdir()).replace(/^([A-Za-z]):/, (hit, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, '/');
  for (const command of ['git status', 'git log --oneline', 'git diff --stat', 'git fetch origin',
    'git checkout main', 'git stash push -m wip', 'git branch feat/x', 'git merge main',
    'git push --dry-run origin main', 'git push --help', 'git branch -a', 'git branch --show-current', 'git tag -l', 'git stash list',
    'git commit -m x', 'git push origin main', 'git push --force origin main',
    'git checkout -- src/a.ts', 'rm -rf .wrangler/state/v3/kv dist-serio-org 2>/dev/null', 'rm -rf missing-dir',
    'rm -rf lib', 'rm -rf dist/tracked.txt', 'rm -rf node_modules >/dev/null',
    `rm -rf ${shellTemp}/serio-probe-x`,
    `rm -rf ${shellTempReal}/serio-probe-x`,
    `rm -rf ${shellTemp}/wave~1-still`,
    ...(process.platform === 'darwin' ? [] : ['rm -rf /tmp/serio-probe-x']),
    "cat > notes.md <<'EOF'\n| 2 | git push origin main |\nrm -rf src\nEOF"]) {
    assert.equal(at('git-ok', { tool_name: 'Bash', tool_input: { command } }), ALLOWED, command);
    if (/^git (?!push --force)/.test(command)) assert(!denied.some((rx) => rx.test(command)), `settings deny ${command}`);
  }
});

blocks('holds deletes and wipes git cannot restore', [
  'rm -rf /a node_modules',
  'rm -rf -- --valuable node_modules',
  'rm -rf 123 node_modules',
  'rm -rf docs',
  '(rm -rf docs)',
  'cd missing || rm -rf docs',
  'Remove-Item -Recurse docs,src',
  'rm -rf hid',
  'echo $(rm -rf docs)',
  'rm --recursive docs',
  'rm -rf -- docs --help',
  'rm -rf docs --dry-run',
  'Remove-Item -Recurse docs --dry-run',
  'rmdir /s /q docs',
  'git reset --hard -- --help',
  'git clean -fdx -- --dry-run',
  'rm -rf ~/docs',
  'rm -rf docs # --dry-run',
  'D="$TEMP/probe"; rm -rf "$D"',
  'B=$(mktemp -d); rm -rf "$B"',
  'rm -rf /',
  'rm -rf .',
  'rm -rf .git',
  'rm -rf mod',
  'ri -r docs',
  'Remove-Item -Recurse -Force docs',
  'Remove-Item -rec docs',
  'del /s /q docs',
  '/bin/rm -rf docs',
  '\\rm -rf docs',
  'env rm -rf docs',
  'powershell -Command "Remove-Item -Recurse docs"',
  "cat >> CHANGELOG.md <<'EOF'\ndon't crash\nEOF\nrm -rf docs",
  "bash <<'EOF'\n# don't\nrm -rf docs\nEOF",
  'cd child; bash -c "rm -rf notes"',
  'git clean -fdx',
  'git clean --force',
  'git reset --hard HEAD~1',
  'git.exe -C sub reset --hard HEAD~1',
  'rm -rf tmp/../src',
  'rm -rf dist/escape',
  'rm -rf {docs,src}',
  'rm -rf [d]ocs',
  'rm -rf ~root',
  ...(process.platform === 'linux' ? [] : ['rm -rf DOCS']),
  'rm -rf "$D"; D=/tmp',
  'D=/tmp; D=/home; rm -rf "$D"',
  'true && D=/tmp; rm -rf "$D"',
  'test $D = /tmp || rm -rf $D',
  'D=/tmp; for D in /home; do rm -rf "$D"; done',
  'for d in a; do rm -rf docs; done',
  'D="dist/ src"; rm -rf $D',
  'D="dist/ src"; rm -rf "$D"',
], (command) => ({ cwd: box, ...bash(command) }));

it('judges deletes through a symlinked cwd', () => {
  const link = path.join(sandbox('link-'), 'link');
  symlinkSync(box, link, process.platform === 'win32' ? 'junction' : 'dir');
  const run = (command) => guard({ cwd: link, session_id: 'link-cwd', ...bash(command) });
  assert.equal(run('rm -rf docs'), ASK);
  assert.equal(run('rm -rf dist-x'), ALLOWED);
});

it('gives the OpenCode bridge the same shell verdict', async () => {
  const { verdictFor } = await import('../../.opencode/bridge.mjs');
  process.env.SERIO_OS_DIR = box;
  assert.match(verdictFor('bash', { command: 'rm -rf docs' }, 'oc', box), /^DELETE: .*Held: give the user the exact command\.$/);
  assert.match(verdictFor('powershell', { command: 'Remove-Item -Recurse docs' }, 'oc', box), /^DELETE: /);
  assert.match(verdictFor('PowerShell', { command: 'git reset --hard' }, 'oc', box), /^WIPE: /);
  assert.equal(verdictFor('bash', { command: 'git status' }, 'oc', box), null);
  assert.equal(verdictFor('BASH', { command: 'git status' }, 'oc', box), null);
});

describe('fan-out cap', () => {
  const spawn = (session, tool_input, tool_name = 'Agent') => at(session, { tool_name, tool_input });
  const held = (session, tool_input, tool_name = 'Agent') => ask({ cwd: box, session_id: session, tool_name, tool_input });

  it('runs three agents per wave and holds the fourth', () => {
    for (let n = 0; n < 3; n += 1) assert.equal(spawn('wave', { prompt: `s${n}`, model: 'haiku' }), ALLOWED);
    assert.equal(held('wave', { prompt: 'fourth', model: 'haiku' }), DENY);
  });
  it('runs agents when the state path cannot be created, without deleting it', () => {
    const target = path.join(box, '.claude', '.wave-state-file');
    writeFileSync(target, 'keep');
    assert.equal(spawn('state-file', { prompt: 'probe' }), ALLOWED);
    assert.equal(readFileSync(target, 'utf8'), 'keep');
    assert.equal(guard({ session_id: 'file-root', tool_name: 'Agent', tool_input: { prompt: 'probe' } }, { ...process.env, SERIO_OS_DIR: target }), ALLOWED);
  });
  it('retains claims across wave boundaries without creating overflow slots', async () => {
    const { fanOutCap } = await import('../../plugins/serio-focus/scripts/lib/fan-out.mjs');
    const now = Date.now;
    const payload = { cwd: box, session_id: 'boundary' };
    const target = path.join(box, '.claude', '.wave-boundary');
    try {
      for (const bucket of [11, 12]) {
        Date.now = () => bucket * Number(process.env.SERIO_WAVE_MS);
        for (let n = 0; n < 3; n += 1) fanOutCap(payload);
        assert.throws(() => fanOutCap(payload), /FAN-OUT CAP/);
      }
      Date.now = () => 11 * Number(process.env.SERIO_WAVE_MS);
      assert.throws(() => fanOutCap(payload), /FAN-OUT CAP/);
      assert.equal(readdirSync(target).length, 6);
    } finally { Date.now = now; }
  });
  it('never rewrites explicit native agent choices or routes to-do tools into the wave', () => {
    const invalid = spawnSync(process.execPath, [path.join(REPO, 'tooling', 'cli', 'serio.mjs'), 'unknown-command'], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_EXECPATH: process.execPath },
    });
    assert.notEqual(invalid.status, ALLOWED);
    assert.match(invalid.stderr, /unknown command/);
    for (const tool_input of [{ model: 'best-available', subagent_type: 'Plan' }, { prompt: 'review', effort: 'max' }]) {
      const result = spawnSync(process.execPath, [script('guard.mjs')], { encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: box },
        input: JSON.stringify({ cwd: box, session_id: JSON.stringify(tool_input).replace(/\W/g, ''), tool_name: 'Agent', tool_input }) });
      assert.equal(result.status, ALLOWED);
      assert.equal(result.stdout, '');
    }

    const { matcher } = JSON.parse(readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse[0];
    for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskList', 'Workflow', 'Read']) assert.doesNotMatch(tool, new RegExp(matcher));
    for (const tool of ['TaskCreate', 'TaskUpdate', 'TaskList']) assert(!SPAWN_TOOLS.includes(tool), tool);
  });
});
