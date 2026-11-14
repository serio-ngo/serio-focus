import { after, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from '../cli/generate.mjs';
const ALLOWED = 0, DENY = 'deny';
const PLUGIN = fileURLToPath(new URL('../../plugins/serio-focus/', import.meta.url));
const REPO = path.resolve(PLUGIN, '..', '..');
const script = (name) => path.join(PLUGIN, 'scripts', name);
const ledger = (root) => path.join(root, 'audit', `${new Date().toISOString().slice(0, 7)}.jsonl`);
const boxes = [];
const sandbox = (prefix) => {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  boxes.push(root); return root;
};
after(() => {
  for (const dir of boxes.splice(0)) try { rmSync(dir, { recursive: true, force: true }); } catch { }
});
const fire = (file, payload, env = process.env) => {
  const run = spawnSync(process.execPath, [file], { input: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}), encoding: 'utf8', env });
  return { code: run.status, out: run.stdout, deny: /"permissionDecision":"deny"/.test(run.stdout) ? DENY : run.status };
};
const guard = (payload, env) => fire(script('guard.mjs'), payload, env).deny;
const orchestrate = { ...process.env, SERIO_ORCHESTRATE: '1' };
const transcript = (dir) => {
  const file = path.join(dir, 'transcript.jsonl');
  const tool = (id, name) => ({ type: 'tool_use', id, name: 'Edit', input: { file_path: name } });
  writeFileSync(file, [{ customTitle: 'T', gitBranch: 'b' }, 'x', ...[1, 1].map(() => ({ type: 'assistant',
    message: { id: 'm', usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4 }, content: [tool('u1', 'a.js')] } })),
    { type: 'assistant', message: { id: 'm', content: [tool('u2', 'b.js')] } },
    { type: 'user', message: { id: 'r1', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'ok' }] } },
    { type: 'user', message: { id: 'r2', content: [{ type: 'tool_result', tool_use_id: 'u2', is_error: true, content: 'denied' }] } }]
    .map((row) => JSON.stringify(row)).join('\n'));
  return file;
};
it('rejects stale generated artefacts', () => {
  const repo = sandbox('generation-');
  cpSync(REPO, repo, {
    recursive: true, filter: (file) => !/(?:^|[/\\])(?:\.git|\.claude|node_modules|audit)(?:[/\\]|$)/.test(file),
  });
  const cli = path.join(repo, 'tooling', 'cli', 'serio.mjs');
  const upkeep = (...args) => spawnSync(process.execPath, [cli, 'upkeep', ...args], { encoding: 'utf8' });
  const before = upkeep();
  if (before.status !== 0) throw new Error(before.stderr || 'fixture generation failed');
  const description = JSON.parse(readFileSync(path.join(repo, 'plugins', 'serio-focus', '.claude-plugin', 'plugin.json'), 'utf8')).description;
  for (const file of ['docs/MANIFEST.md', 'plugins/serio-focus/.codex-plugin/plugin.json']) {
    const target = path.join(repo, file);
    const text = readFileSync(target, 'utf8');
    writeFileSync(target, text.includes(description) ? text.replaceAll(description, 'stale description') : `${text}\nstale\n`);
    const stale = new Map(walk(repo).map((file) => [file, [readFileSync(path.join(repo, file), 'utf8'), statSync(path.join(repo, file)).mtimeMs]]));
    const result = upkeep('--check');
    assert.notEqual(result.status, ALLOWED, file);
    assert.match(result.stderr, /generated artefacts are stale:/);
    assert(result.stderr.includes(file), result.stderr);
    for (const [file, before] of stale) assert.deepEqual([readFileSync(path.join(repo, file), 'utf8'), statSync(path.join(repo, file)).mtimeMs], before, file);
    assert.equal(upkeep().status, ALLOWED);
    assert.equal(upkeep('--check').status, ALLOWED);
  }
});
it('holds code to no comments, 300 lines per plugin file and one suite file of 300 lines', () => {
  for (const file of [...walk(PLUGIN).map((f) => path.join(PLUGIN, f)), fileURLToPath(import.meta.url)]) {
    const text = readFileSync(file, 'utf8');
    assert.ok(text.trimEnd().split('\n').length <= 300, file);
    if (file.endsWith('.mjs')) assert.doesNotMatch(text, /^\s*\/\//m, file);
  }
  assert.deepEqual(readdirSync(path.join(REPO, 'tooling', 'test')), ['guard.test.mjs']);
});
it('keeps startup context small and agents, skills and Codex roles well-formed', async () => {
  const { agents, codexRoles, skills, startupChars } = await import('../cli/generate.mjs');
  const roles = agents();
  assert.deepEqual(roles.map((agent) => agent.name), ['architect', 'coder', 'reviewer', 'tester']);
  for (const doc of [...roles, ...skills()]) assert.ok(doc.description.length > 0 && doc.description.length <= 300, doc.name);
  for (const skill of skills()) assert.equal(skill.name, skill.dir, skill.dir);
  for (const agent of roles) assert.equal(/\b(?:Edit|Write)\b/.test(agent.tools), ['coder', 'tester'].includes(agent.name), agent.name);
  for (const agent of roles) assert.equal(/\bBash\b/.test(agent.tools), agent.name !== 'architect', agent.name);
  for (const [role, agent] of codexRoles().map((role, i) => [role, roles[i]])) {
    assert.match(role.text, new RegExp(`^name = "serio-${agent.name}"\\ndescription = ".+"\\n`));
    assert.doesNotMatch(role.text, /^sandbox_mode\s*=/m, agent.name);
    assert.ok(role.text.endsWith(`'''\n${agent.body}\n'''\n`) && !agent.body.includes("'''"), agent.name);
  }
  assert.ok(startupChars() < 1950, String(startupChars()));
  const hooks = JSON.parse(readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PreToolUse', 'SessionStart', 'Stop']);
});
it('writes the session receipt', () => {
  const box = sandbox('guard-');
  const env = { ...process.env, SERIO_OS_DIR: box };
  assert.equal(fire(script('receipt.mjs'), { cwd: box, session_id: 'receipt', transcript_path: transcript(box) }, env).code, ALLOWED);
  const receipt = readFileSync(ledger(box), 'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.deepEqual([receipt.session, receipt.action, receipt.result],
    ['receipt', 'session', { project: box, branch: 'b', title: 'T', calls: 1, tokens: 9, files: ['a.js'] }]);
  const before = readFileSync(ledger(box), 'utf8');
  assert.equal(fire(script('receipt.mjs'), { cwd: box, session_id: 'empty', transcript_path: path.join(box, 'missing.jsonl') }, env).code, ALLOWED);
  assert.equal(readFileSync(ledger(box), 'utf8'), before);
});
it('keeps state out of the project when no state root is set', () => {
  const home = sandbox('home-'), project = sandbox('project-'), data = sandbox('plugin-data-');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of ['SERIO_OS_DIR', 'CLAUDE_PLUGIN_DATA', 'PLUGIN_DATA', 'CLAUDE_PROJECT_DIR']) delete env[key];
  const payload = { cwd: project, session_id: 'home-root', transcript_path: transcript(sandbox('transcript-')) };
  const run = (extra) => spawnSync(process.execPath, [script('receipt.mjs')], { cwd: project, encoding: 'utf8', env: { ...env, ...extra }, input: JSON.stringify(payload) });
  run();
  assert.deepEqual(readdirSync(project), []);
  assert.equal(readdirSync(path.join(home, '.serio-focus', 'audit')).length, 1);
  run({ PLUGIN_DATA: data });
  assert.deepEqual(readdirSync(project), []);
  assert.equal(readdirSync(path.join(data, 'audit')).length, 1);
});
it('sync preserves every user permission rule', () => {
  const target = path.join(sandbox('sync-'), 'settings.json');
  const original = { deny: ['Bash(git checkout *)', 'Bash(gh issue create *)', 'Bash(curl *)'], ask: ['Bash(gh issue create *)', 'mcp__x'], allow: ['Bash(git status)', 'mcp__gmail__create_draft'] };
  writeFileSync(target, JSON.stringify({ model: 'x', permissions: original }));
  const run = spawnSync(process.execPath, [path.join(REPO, 'tooling', 'cli', 'serio.mjs'), 'sync', '--target', target], { encoding: 'utf8' });
  assert.equal(run.status, ALLOWED, run.stderr);
  const { model, permissions } = JSON.parse(readFileSync(target, 'utf8')); assert.equal(model, 'x');
  for (const [key, rules] of Object.entries(original)) for (const rule of rules) assert(permissions[key].includes(rule), `${key}: ${rule}`);
});
it('preserves global role collisions before native installation or removal and upgrades owned roles', () => {
  const root = sandbox('roles-'), repo = path.join(root, 'repo'), home = path.join(root, 'home'), bin = path.join(root, 'bin'), log = path.join(root, 'calls'), preload = path.join(root, 'native.cjs');
  cpSync(REPO, repo, { recursive: true, filter: (file) => !/(?:^|[/\\])(?:\.git|\.claude|node_modules|audit)(?:[/\\]|$)/.test(file) });
  mkdirSync(path.join(home, 'agents'), { recursive: true }); mkdirSync(bin);
  copyFileSync(process.execPath, path.join(bin, process.platform === 'win32' ? 'codex.exe' : 'codex'));
  writeFileSync(preload, `if (/^codex(?:\\.exe)?$/i.test(require('node:path').basename(process.execPath))) { require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv) + '\\n'); process.exit(0); }`);
  const env = { ...process.env, CODEX_HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NODE_OPTIONS: `--require="${preload.replaceAll('\\', '/')}"` };
  const native = spawnSync('codex', ['fixture'], { encoding: 'utf8', env }); assert.equal(native.status, ALLOWED, native.stderr); assert(existsSync(log)); rmSync(log);
  const cli = (command) => spawnSync(process.execPath, [path.join(repo, 'tooling', 'cli', 'serio.mjs'), command, '--host', 'codex'], { encoding: 'utf8', env });
  const target = path.join(home, 'agents', 'serio-reviewer.toml'); writeFileSync(target, 'user role\n');
  for (const command of ['install', 'uninstall']) {
    const run = cli(command); assert.notEqual(run.status, ALLOWED, `${command} must refuse a role collision: ${run.stderr}`);
    assert.equal(readFileSync(target, 'utf8'), 'user role\n'); assert(!existsSync(log), `${command} called native host before collision validation`);
  }
  rmSync(target); assert.equal(cli('install').status, ALLOWED);
  let owned = readFileSync(target, 'utf8'); assert(owned.includes('developer_instructions'));
  assert.equal(cli('install').status, ALLOWED); assert.equal(readFileSync(target, 'utf8'), owned);
  const source = path.join(repo, 'plugins', 'serio-focus', 'agents', 'reviewer.md'); writeFileSync(source, `${readFileSync(source, 'utf8')}\n| Fixture | synthetic upgrade |\n`);
  assert.equal(cli('install').status, ALLOWED); owned = readFileSync(target, 'utf8'); assert(owned.includes('synthetic upgrade'));
  writeFileSync(target, `${owned}user edit\n`);
  for (const command of ['install', 'uninstall']) {
    const calls = readFileSync(log, 'utf8'); assert.notEqual(cli(command).status, ALLOWED, `${command} must preserve edited roles`);
    assert.equal(readFileSync(target, 'utf8'), `${owned}user edit\n`); assert.equal(readFileSync(log, 'utf8'), calls);
  }
});
it('keeps ordinary git work out of the committed settings denials', () => {
  const policy = JSON.parse(readFileSync(new URL('../../.claude/settings.json', import.meta.url), 'utf8'));
  const denied = (command) => policy.permissions.deny.map((rule) => /^Bash\((.*)\)$/.exec(rule)?.[1]).filter(Boolean)
    .some((glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(command));
  for (const command of ['git status', 'git commit -m x', 'git push origin main', 'git checkout main', 'git stash push -m wip']) assert(!denied(command), command);
  for (const command of ['git push --force origin feat', 'gh pr merge 1']) assert(denied(command), command);
});
it('denies a subagent call that does not name model and effort', () => {
  const box = sandbox('flow-');
  const flow = path.join(box, 'flow.js');
  writeFileSync(flow, "await agent('a', { model: 'm' })");
  const spawn = (tool_input) => fire(script('guard.mjs'), { tool_name: 'Agent', tool_input });
  assert.equal(spawn({ prompt: 'p', model: 'm' }).deny, DENY);
  const named = spawn({ prompt: 'p', model: 'm', effort: 'low' });
  assert.deepEqual([named.code, named.out], [ALLOWED, '']);
  for (const tool_input of [{ scriptPath: flow }, { scriptPath: path.join(box, 'none.js') }]) assert.equal(guard({ tool_name: 'Workflow', tool_input }), DENY, JSON.stringify(tool_input));
  assert.equal(guard({ tool_name: 'Workflow', tool_input: { name: 'review' } }), ALLOWED);
});
it('matches the hook to edit, spawn and mail-send tools only', () => {
  const { matcher } = JSON.parse(readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse[0];
  for (const tool of ['Edit', 'Agent', 'mcp__gmail__send_message', 'mcp__gmail__send_draft', 'mcp__s__slack_send_message']) assert.match(tool, new RegExp(matcher));
  for (const tool of ['Bash', 'PowerShell', 'Read', 'TaskCreate', 'EnterWorktree', 'mcp__gmail__create_draft', 'mcp__x__get_post']) assert.doesNotMatch(tool, new RegExp(matcher));
});
it('denies every mail send on every attempt and allows other connector sends', () => {
  for (const tool of ['mcp__gmail__send_message', 'mcp__gmail__send_draft', 'mcp__gmail__reply_email', 'mcp__gmail__forward_email', 'mcp__email__send_email', 'mcp__email__reply_email', 'mcp__email__forward_email', 'mcp__outlook__send_mail', 'mcp__outlook__reply_email', 'mcp__outlook__forward_email'])
    for (let n = 0; n < 3; n += 1) assert.equal(guard({ tool_name: tool, tool_input: { id: 'synthetic' } }), DENY, tool);
  for (const tool of ['mcp__slack__send_message', 'mcp__c__reply-to-comment']) assert.equal(guard({ tool_name: tool, tool_input: {} }), ALLOWED, tool);
});
it('denies main-session edits only when orchestrating', () => {
  const edit = { tool_name: 'Edit', tool_input: { file_path: 'a.js' } };
  assert.deepEqual([guard(edit, orchestrate), guard({ ...edit, agent_id: 'coder-1' }, orchestrate), guard(edit)], [DENY, ALLOWED, ALLOWED]);
});
it('denies a malformed payload that names a tool', () => {
  assert.equal(fire(script('guard.mjs'), '{"tool_name":"Agent",').deny, DENY);
});
it('keeps the route (W11) and note (N1) lifecycle rules', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { route } = await import(new URL('route.mjs', lifecycle));
  const { owners } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const { note } = await import(new URL('publish.mjs', lifecycle));
  const ada = { login: 'ada', type: 'User' };
  const pr = { number: 9, state: 'open', draft: false, head: { ref: 'agent/7-sum', sha: 'h1', repo: { full_name: 'o/r' } } };
  const review = { user: ada, body: 'tests-ok', state: 'commented', commit_id: 'h1' };
  const context = { repo: 'o/r', guarded: true, own: owners('* @ada\n'), issue: () => ({ assignees: [ada] }) };
  assert.equal(route('pull_request_review', { action: 'submitted', pull_request: pr, review }, context).stage, undefined, 'W11');
  assert.deepEqual([note('Wrote 3 tests.', 'write-tests', 42), note('', 'deliver', 1), note('x <!-- spec-review v1 -->', 'deliver', 1)], [
    'Note (write-tests): Wrote 3 tests.\n\n<!-- step-note stage=write-tests run=42 -->',
    'Note (deliver): The deliver run ended without a note.\n\n<!-- step-note stage=deliver run=1 -->', null], 'N1');
  const run = spawnSync(process.execPath, [script('lifecycle/publish.mjs'), '9', '--note', 'deliver', 'Done.', '--repo', 'o/r'], { encoding: 'utf8', env: { ...process.env, SERIO_UNATTENDED: '1', PATH: '', Path: '' } });
  assert.match(run.stdout, /^Not posted/, 'an unattended run posts its note once, through the workflow');
});
it('starts no fix for CI from before the lock and keeps route answers out of the brief', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { route } = await import(new URL('route.mjs', lifecycle));
  const { brief } = await import(new URL('brief.mjs', lifecycle));
  const { owners } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const ada = { login: 'ada', type: 'User' }, own = owners('* @ada\n');
  const pr = { number: 9, state: 'open', draft: true, head: { ref: 'agent/7-sum', sha: 'h1', repo: { full_name: 'o/r' } } };
  const lock = { user: ada, body: 'tests-ok', commit_id: 'h1', submitted_at: '2026-01-02' };
  const ci = (created_at) => ({ action: 'completed', workflow_run: { id: 5, run_attempt: 1, conclusion: 'failure', created_at, head_branch: 'agent/7-sum', head_sha: 'h1', head_repository: { full_name: 'o/r' } } });
  const context = (assignees) => ({ repo: 'o/r', guarded: true, own, issue: () => ({ assignees }), reviews: () => [lock, { ...lock, submitted_at: '2026-01-04' }], pulls: () => [pr], comments: () => [], failures: () => [] });
  assert.deepEqual([route('workflow_run', ci('2026-01-01'), context([ada])).stage, route('workflow_run', ci('2026-01-03'), context([ada])).stage, route('workflow_run', ci('2026-01-03'), context([])).tell], [undefined, 'pr-loop', undefined]);
  const answer = { user: { login: 'github-actions[bot]', type: 'Bot' }, body: 'Note (route): Not started: x.\n\n<!-- step-note stage=route run=1 -->' };
  assert.ok(!brief({ repo: 'o/r', issue: { number: 7, title: 'Sum', body: 'AC1' }, comments: [answer], own }).includes('Not started'));
});
it('keeps every write token out of the model job and runs on a private repository without a ruleset', async () => {
  const { route } = await import(new URL('../../plugins/serio-focus/scripts/lifecycle/route.mjs', import.meta.url));
  const { owners } = await import(new URL('../../plugins/serio-focus/scripts/lib/lifecycle.mjs', import.meta.url));
  const ada = { login: 'ada', type: 'User' }, label = { action: 'labeled', label: { name: 'spec-review' }, sender: ada, issue: { number: 7 } };
  const context = (over) => ({ repo: 'o/r', guarded: false, own: owners('* @ada\n'), issue: () => ({ title: 'Sum', body: 'AC1', assignees: [ada] }), ...over });
  assert.deepEqual([route('issues', label, context({ private: true })).stage, route('issues', label, context({})).stage], ['spec-review', undefined]);
  const flow = readFileSync(path.join(REPO, '.github', 'workflows', 'lifecycle-agent.yml'), 'utf8'), job = (name) => flow.split(/^  (?=[a-z]+:\n)/m).find((part) => part.startsWith(`${name}:`));
  assert.doesNotMatch(job('agent'), /AGENT_APP|steps\.app|contents: write|pull-requests: write|issues: write/);
  assert.match(job('publish'), /AGENT_APP_KEY[\s\S]+lifecycle\/push\.mjs/);
});
