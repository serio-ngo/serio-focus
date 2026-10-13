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
const ASK = 'deny';
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

const box = sandbox('guard-');
spawnSync('git', ['init', '-q', box]);
writeFileSync(path.join(box, '.gitignore'), 'node_modules/\ndist*/\n.wrangler/\n');
process.env.SERIO_WAVE_MS = String(864e5);
process.env.SERIO_SCRATCH_DIR = path.join(box, 'drafts');
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
  assert.match(run.stdout, /"permissionDecision":"deny"/, payload.tool_input?.command);
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
  const before = spawnSync(process.execPath, [cli, 'upkeep'], { encoding: 'utf8' });
  if (before.status !== 0) throw new Error(before.stderr || 'fixture generation failed');
  const description = JSON.parse(readFileSync(path.join(repo, 'plugins', 'serio-focus', '.claude-plugin', 'plugin.json'), 'utf8')).description;
  for (const file of ['docs/demo.svg', 'tooling/results/scores.json', 'plugins/serio-focus/.codex-plugin/plugin.json']) {
    const target = path.join(repo, file);
    const text = readFileSync(target, 'utf8');
    writeFileSync(target, text.includes(description) ? text.replaceAll(description, 'stale description') : `${text}\nstale\n`);
    const result = spawnSync(process.execPath, [cli, 'upkeep', '--check'], { encoding: 'utf8' });
    assert.notEqual(result.status, ALLOWED, file);
    assert.match(result.stderr, /generated artefacts are stale:/);
    assert(result.stderr.includes(file), result.stderr);
  }
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
  assert.deepEqual(roles.map((agent) => agent.name), ['architect', 'coder', 'reviewer']);
  for (const doc of [...roles, ...skills()]) assert.ok(doc.description.length > 0 && doc.description.length <= 300, doc.name);
  for (const skill of skills()) assert.equal(skill.name, skill.dir, skill.dir);
  for (const agent of roles) assert.equal(/\b(?:Edit|Write)\b/.test(agent.tools), agent.name === 'coder', agent.name);
  for (const [role, agent] of codexRoles().map((role, i) => [role, roles[i]])) {
    assert.match(role.text, new RegExp(`^name = "serio-${agent.name}"\\ndescription = ".+"\\n`));
    assert.equal(role.text.includes('sandbox_mode = "read-only"'), agent.name !== 'coder', agent.name);
    assert.ok(role.text.endsWith(`'''\n${agent.body}\n'''\n`) && !agent.body.includes("'''"), agent.name);
  }
  assert.ok(startupChars() < 1500, String(startupChars()));
  const hooks = JSON.parse(readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PreToolUse', 'SessionStart']);
});

it('corpus: every labelled case gets its verdict', async () => {
  const { score } = await import('../cli/generate.mjs');
  assert.deepEqual(score().misses, []);
});

blocks('blocks git commit and push', [
  'git commit -m x',
  'git commit --verify -m x',
  'git -C sub commit -m x',
  'git push origin main',
  'git push --force origin main',
  'git push --dry-run --no-dry-run origin main',
  'git push --repo --dry-run origin main',
  'git push -- origin --dry-run',
  'git commit -m --help',
  'git commit -m --dry-run',
  'git.exe push origin main',
  'sudo git push origin main',
  'git push origin main # --dry-run',
  'bash -c "git push origin main"',
  'powershell -Command "git commit -m x"',
  'if true; then git push origin main; fi',
  "cat >> CHANGELOG.md <<'EOF'\ndon't crash\nEOF\ngit push origin main",
  "bash <<'EOF'\n# don't\ngit push origin main\nEOF",
], bash);

it('reopens commit and push while SERIO_GIT_WRITE is 1, and audits every hold', () => {
  const open = (command) => guard({ cwd: box, session_id: 'git-open', tool_name: 'Bash', tool_input: { command } },
    { ...process.env, SERIO_OS_DIR: box, SERIO_GIT_WRITE: '1' });
  for (const command of ['git commit -m x', 'git push origin main']) {
    assert.equal(open(command), ALLOWED, command);
  }
  assert.equal(open('rm -rf docs'), ASK);
  const rows = readFileSync(path.join(box, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(Object.entries(rows.at(-1)).filter(([key]) => ['session', 'action', 'target', 'rule'].includes(key)),
    [['session', 'git-open'], ['action', 'Bash'], ['target', 'recursive delete'], ['rule', 'DELETE LOCK']]);
});

it('never persists shell secrets or descriptions in denial records', () => {
  const secret = 'private-token-123';
  ask({ cwd: box, session_id: 'private-command', agent_type: 'coder', agent_id: 'agent-1', tool_use_id: 'call-1',
    ...bash(`git push https://user:${secret}@example.test/repo`) });
  const saved = readFileSync(path.join(box, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8');
  assert(!saved.includes(secret));
  const row = JSON.parse(saved.trim().split('\n').at(-1));
  assert.deepEqual([row.agent, row.call, row.actor, row.result], ['agent-1', 'call-1', 'coder', 'deny']);
});

it('keeps denials observable when the audit directory cannot be written', () => {
  const root = sandbox('audit-failure-');
  writeFileSync(path.join(root, 'audit'), 'keep');
  const run = spawnSync(process.execPath, [script('guard.mjs')], { input: JSON.stringify(bash('git push origin main')),
    encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: root } });
  assert.match(run.stdout, /"permissionDecision":"deny"/);
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

it('allows git reads, local branch work and scratch deletes, in the guard and in the settings policy', () => {
  const policy = JSON.parse(readFileSync(new URL('../settings/policy.json', import.meta.url), 'utf8'));
  const denied = [...policy.deny, ...Object.values(policy.unlock).flat()].map((rule) => /^Bash\((.*)\)$/.exec(rule)?.[1]).filter(Boolean)
    .map((glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
  const shellTemp = tmpdir().replace(/^([A-Za-z]):/, (hit, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, '/');
  const shellTempReal = realpathSync(tmpdir()).replace(/^([A-Za-z]):/, (hit, drive) => `/${drive.toLowerCase()}`).replace(/\\/g, '/');
  for (const command of ['git status', 'git log --oneline', 'git diff --stat', 'git fetch origin',
    'git checkout main', 'git stash push -m wip', 'git branch feat/x', 'git merge main',
    'git push --dry-run origin main', 'git push --help', 'git branch -a', 'git branch --show-current', 'git tag -l', 'git stash list',
    'git checkout -- src/a.ts', 'rm -rf .wrangler/state/v3/kv dist-serio-org 2>/dev/null', 'rm -rf drafts/stills/x',
    `rm -rf ${shellTemp}/serio-probe-x`,
    `rm -rf ${shellTempReal}/serio-probe-x`,
    `rm -rf ${shellTemp}/wave~1-still`,
    "cat > notes.md <<'EOF'\n| 2 | git push origin main |\nrm -rf src\nEOF"]) {
    assert.equal(at('git-ok', { tool_name: 'Bash', tool_input: { command } }), ALLOWED, command);
    if (/^git (?!merge|push)/.test(command)) assert(!denied.some((rx) => rx.test(command)), `settings deny ${command}`);
  }
});

mkdirSync(path.join(box, 'dist'), { recursive: true });
writeFileSync(path.join(box, 'dist', 'tracked.txt'), 'keep');
spawnSync('git', ['-C', box, 'add', '-f', 'dist/tracked.txt']);
symlinkSync(sandbox('outside-'), path.join(box, 'dist', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

blocks('blocks recursive deletes and git wipes', [
  'rm -rf docs',
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
  'ri -r docs',
  'Remove-Item -Recurse -Force docs',
  'git clean -fdx',
  'git reset --hard HEAD~1',
  'rm -rf tmp/../src',
  'rm -rf dist/tracked.txt',
  'rm -rf dist/escape',
  'rm -rf "$D"; D=/tmp',
  'D=/tmp; D=/home; rm -rf "$D"',
  'true && D=/tmp; rm -rf "$D"',
  'test $D = /tmp || rm -rf $D',
  'D=/tmp; for D in /home; do rm -rf "$D"; done',
  'for d in a; do rm -rf docs; done',
  'D="dist/ src"; rm -rf $D',
  'D="dist/ src"; rm -rf "$D"',
], (command) => ({ cwd: box, ...bash(command) }));

it('blocks tracked deletes after changing cwd before a nested shell', () => {
  const child = path.join(box, 'child');
  mkdirSync(path.join(child, 'node_modules'), { recursive: true });
  writeFileSync(path.join(child, 'node_modules', 'tracked.txt'), 'keep');
  spawnSync('git', ['-C', box, 'add', '-f', 'child/node_modules/tracked.txt']);
  ask({ cwd: box, ...bash('cd child; bash -c "rm -rf node_modules"') });
});

it('blocks in-box deletes through a symlinked cwd', () => {
  const outer = sandbox('outer-');
  const inner = path.join(outer, 'inner');
  mkdirSync(inner, { recursive: true });
  const link = path.join(outer, 'link');
  symlinkSync(inner, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(guard({ cwd: link, session_id: 'link-cwd', tool_name: 'Bash', tool_input: { command: 'rm -rf docs' } },
    { ...process.env, SERIO_OS_DIR: outer }), ASK);
});

it('allows scratch deletes through a symlinked cwd', () => {
  const inner = path.join(box, 'inner');
  mkdirSync(inner, { recursive: true });
  const link = path.join(box, 'link');
  try { rmSync(link, { recursive: true, force: true }); } catch { }
  symlinkSync(inner, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(guard({ cwd: link, session_id: 'link-scratch', tool_name: 'Bash', tool_input: { command: 'rm -rf drafts/out/x' } },
    { ...process.env, SERIO_OS_DIR: box, SERIO_SCRATCH_DIR: path.join(link, 'drafts') }), ALLOWED);
});

it('gives the OpenCode bridge the same shell verdict', async () => {
  const { verdictFor } = await import('../../.opencode/bridge.mjs');
  process.env.SERIO_OS_DIR = box;
  assert.match(verdictFor('bash', { command: 'git push origin main' }, 'oc', box), /^GIT WRITE: /);
  assert.match(verdictFor('powershell', { command: 'git push origin main' }, 'oc', box), /^GIT WRITE: /);
  assert.match(verdictFor('PowerShell', { command: 'git commit -m x' }, 'oc', box), /^GIT WRITE: /);
  assert.equal(verdictFor('bash', { command: 'git status' }, 'oc', box), null);
  assert.equal(verdictFor('BASH', { command: 'git status' }, 'oc', box), null);
});

describe('fan-out cap', () => {
  const spawn = (session, tool_input, tool_name = 'Agent') => at(session, { tool_name, tool_input });
  const held = (session, tool_input, tool_name = 'Agent') => ask({ cwd: box, session_id: session, tool_name, tool_input });

  it('runs three agents per wave and holds the fourth', () => {
    for (let n = 0; n < 3; n += 1) assert.equal(spawn('wave', { prompt: `s${n}`, model: 'haiku' }), ALLOWED);
    assert.equal(held('wave', { prompt: 'fourth', model: 'haiku' }), ASK);
  });
  it('holds agents without deleting an occupied state path', () => {
    const target = path.join(box, '.claude', '.wave-state-file');
    writeFileSync(target, 'keep');
    assert.equal(held('state-file', { prompt: 'probe' }), ASK);
    assert.equal(readFileSync(target, 'utf8'), 'keep');
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
