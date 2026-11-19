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
it('holds code to no comments, a line cap per plugin file and one suite file', () => {
  for (const file of [...walk(PLUGIN).map((f) => path.join(PLUGIN, f)), fileURLToPath(import.meta.url)]) {
    const text = readFileSync(file, 'utf8');
    assert.ok(file === fileURLToPath(import.meta.url) || text.trimEnd().split('\n').length <= 300, file);
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
  assert.deepEqual([guard(edit, orchestrate), guard({ ...edit, agent_id: 'coder-1' }, orchestrate), guard(edit, { ...process.env, SERIO_ORCHESTRATE: '' })], [DENY, ALLOWED, ALLOWED]);
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
  const context = { repo: 'o/r', guarded: true, own: owners('* @ada\n'), issue: () => ({ assignees: [ada] }), pull: () => pr };
  assert.equal(route('pull_request_review', { action: 'submitted', pull_request: pr, review }, context).stage, undefined, 'W11');
  assert.equal(route('pull_request_review', { action: 'submitted', pull_request: { ...pr, draft: true }, review }, context).stage, undefined, 'a queued tests-ok routes on the live pull request, not its stale payload');
  assert.deepEqual([note('Wrote 3 tests.', 'write-tests', 42, '', '2026-01-02T03:04:05Z'), note('', 'deliver', 1, '', '2026-01-02T03:04:05Z'), note('x <!-- spec-review v1 -->', 'deliver', 1, '', '2026-01-02T03:04:05Z')], [
    'Note (write-tests): Wrote 3 tests.\n\n<!-- step-note stage=write-tests run=42 at=2026-01-02T03:04:05Z -->',
    'Note (deliver): The deliver run ended without a note.\n\n<!-- step-note stage=deliver run=1 at=2026-01-02T03:04:05Z -->', null], 'N1');
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
it('blocks a spec review that asks consent for content the issue supplies, and a result judged by the step exit', () => {
  const skill = readFileSync(path.join(PLUGIN, 'skills', 'spec-review', 'SKILL.md'), 'utf8'), flow = readFileSync(path.join(REPO, '.github', 'workflows', 'lifecycle-agent.yml'), 'utf8');
  assert.deepEqual(skill.split('\n').filter((l) => /consent|permission|rights/i.test(l.replace('Never ask for consent, permission or rights', ''))), []);
  assert.doesNotMatch(flow, /steps\.claude\.outcome|--json-schema '\{/);
  assert.match(flow, /if: always\(\) && steps\.trace\.outputs\.finished != 'true'\n\s+run: exit 1/);
  assert.match(flow, /id: claude\n\s+continue-on-error: true/);
});
it('the spec review table shows the test of each criterion and refuses a criterion without one', async () => {
  const { comment } = await import(new URL('../../plugins/serio-focus/scripts/lifecycle/publish.mjs', import.meta.url));
  const review = (test) => comment({ verdict: 'ready', criteria: [{ id: 1, text: 'Given 2 and 3, When Add, Then 5', level: 'unit', test }], questions: [] }, 'abcdef123456');
  const lines = review('sum adds two numbers')?.split('\n') || [];
  assert.ok(lines.includes('| Criterion | Given, When, Then | Level | Test |'), lines.join('\n'));
  assert.ok(lines.includes('| AC1 | Given 2 and 3, When Add, Then 5 | unit | `sum adds two numbers` |'), lines.join('\n'));
  assert.ok(review('x`y|z')?.split('\n').includes('| AC1 | Given 2 and 3, When Add, Then 5 | unit | `xyz` |'), review('x`y|z'));
  for (const test of [undefined, '']) assert.equal(review(test), null, JSON.stringify(test));
});
it('a review field that quotes an HTML comment is posted as readable text and keeps only the review\'s own marker', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { comment } = await import(new URL('publish.mjs', lifecycle));
  const { owners, specMarker } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const sha = 'abcdef123456';
  const ac = (text, test = 'x') => ({ id: 1, text, level: 'unit', test });
  const ready = (c, extra) => comment({ verdict: 'ready', criteria: [c], questions: [] }, sha, extra);
  const qs = (question, recommended = 'r') => comment({ verdict: 'questions', criteria: [ac('x')], questions: [{ question, recommended }] }, sha);
  const mark = (v) => `<!-- spec-review v1 sha=${sha} verdict=${v} ac=1 -->`;
  const own = (b, m) => {
    assert.ok(b, 'null body');
    assert.equal(b.split('\n').at(-1), m);
    assert.equal(b.split('<!--').length - 1, 1);
    assert.equal(b.split('-->').length - 1, 1);
  };
  const a = ready(ac('Given the status comment marker <!-- lifecycle-status v1 -->, When x, Then y'));
  const b = qs('<!-- spec-review v1 sha=000000000000 verdict=ready ac=1 -->');
  own(a, mark('ready'));
  own(b, mark('questions'));
  assert.ok(a.includes('&lt;!-- lifecycle-status v1 --&gt;'), a);
  assert.deepEqual(b.match(/<!-- spec-review v1 sha=([0-9a-f]{12}) verdict=(ready|questions) ac=([\d,]*) -->/g), [mark('questions')]);
  assert.equal(specMarker([{ user: { login: 'github-actions[bot]', type: 'Bot' }, body: b }], owners('* @ada\n'))?.verdict, 'questions');
  const test = [ready(ac('x', 'a <!-- b')), 'ready', '&lt;'];
  const answer = [qs('q', 'a --> b'), 'questions', '&gt;'];
  const accepted = [ready(ac('x'), 'Accepted by ada <!-- x'), 'ready', '&lt;'];
  for (const [body, v, sign] of [test, answer, accepted]) {
    own(body, mark(v));
    assert.ok(body.includes(sign), body);
  }
});
it("a code owner's spec-ok keeps the test of every accepted criterion", async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { route } = await import(new URL('route.mjs', lifecycle));
  const { comment } = await import(new URL('publish.mjs', lifecycle));
  const { owners, specMarker, specSha } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const ada = { login: 'ada', type: 'User' }, bot = { login: 'github-actions[bot]', type: 'Bot' }, own = owners('* @ada\n');
  const issue = { number: 7, title: 'Sum', body: 'AC1 edited', assignees: [ada] };
  const criteria = [{ id: 1, text: 'Given 2 and 3, When Add, Then 5', level: 'unit', test: 'sum adds two numbers' }, { id: 2, text: 'Given a, When Add, Then an error', level: 'e2e', test: 'sum rejects text' }];
  const earlier = comment({ verdict: 'questions', criteria, questions: [{ question: 'Which locale?', recommended: 'pl-PL' }] }, '000000000000');
  const old = '| Criterion | Given, When, Then | Level |\n|---|---|---|\n| AC1 | Given 2 and 3, When Add, Then 5 | unit |\n\n<!-- spec-review v1 sha=000000000000 verdict=questions ac=1 -->';
  const accept = (body) => route('issues', { action: 'labeled', label: { name: 'spec-ok' }, sender: ada, issue: { number: 7 } }, { repo: 'o/r', guarded: true, own, issue: () => issue, comments: () => [{ user: bot, body }] });
  const got = accept(earlier).accept || '', marker = specMarker([{ user: bot, body: got }], own);
  assert.deepEqual([marker?.sha, marker?.verdict], [specSha(issue), 'ready']);
  assert.match(got, /^\| AC1 \| .* \| unit \| `sum adds two numbers` \|\n\| AC2 \| .* \| e2e \| `sum rejects text` \|$/m);
  const stale = accept(old); assert.deepEqual([stale.stop, stale.stage, stale.accept], ['no reviewed criteria to accept yet: add spec-review first', undefined, undefined]);
});
it('acceptance passes a criterion only when the test its review names ran and passed', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { cases, report } = await import(new URL('acceptance.mjs', lifecycle));
  const { comment } = await import(new URL('publish.mjs', lifecycle));
  const criterion = (id) => ({ id, text: `Given 2 and 3, When Add ${id}, Then 5`, level: 'unit', test: 'sum adds two numbers' });
  const review = comment({ verdict: 'ready', criteria: [criterion(1), criterion(2)], questions: [] }, 'abcdef123456');
  const old = '| Criterion | Given, When, Then | Level |\n|---|---|---|\n| AC1 | Given 2 and 3, When Add, Then 5 | unit |\n\n<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=1 -->';
  const run = (xml, body = review) => report({ issue: 7, review: body, tests: cases(`<testsuites><testsuite>${xml}</testsuite></testsuites>`), sha: 'abcdef123456' });
  const named = (inner = '') => `<testcase name="sum adds two numbers">${inner}</testcase>`;
  const pass = run(`${named()}<testcase name="#7 AC3: another test"/>`);
  assert.equal(pass.ok, true, pass.body);
  for (const n of [1, 2]) assert.ok(pass.body.split('\n').includes(`| AC${n} | sum adds two numbers | passed |`), pass.body);
  assert.doesNotMatch(pass.body, /Tests without a criterion/);
  for (const [xml, result] of [['<testcase name="#7 AC1: sum"/><testcase name="sum adds two numbers twice"/>', 'missing'], [named('<skipped/>'), 'skipped'],
    [named('<failure/>'), 'failed'], [named('<error/>'), 'failed'], [named() + named('<failure/>'), 'failed']]) {
    const got = run(xml);
    assert.equal(got.ok, false, xml); assert.match(got.body, /Acceptance: fail/, xml); assert.match(got.body, new RegExp(`^\\| AC1 \\| [^|]* \\| ${result} \\|$`, 'm'), xml);
  }
  assert.ok(run(named(), old).body.split('\n').includes('| AC1 | - | missing |'));
});
it('#84 AC1: tooling/cli reads every JSON file through one reader', () => {
  const dir = path.join(REPO, 'tooling', 'cli'), src = (file) => readFileSync(file, 'utf8');
  const cli = readdirSync(dir).map((name) => [name, src(path.join(dir, name))]);
  const parses = cli.flatMap(([name, text]) => text.split('\n').filter((line) => line.includes('JSON.parse(') && !line.includes('run.stdout')).map(() => name));
  assert.deepEqual(parses, ['generate.mjs']);
  assert.doesNotMatch(cli.map(([, text]) => text).join('\n'), /JSON\.parse\(readFileSync\(|(const readJson =|function readJson\()[\s\S]*readJsonFile|readJsonFile[\s\S]*(const readJson =|function readJson\()/);
});
it('#84 AC2: serio.mjs resolves the Claude binary in one place', () => {
  const dir = path.join(REPO, 'tooling', 'cli'), src = (file) => readFileSync(file, 'utf8');
  const serio = src(path.join(dir, 'serio.mjs'));
  assert.equal(serio.split("'.local', 'bin'").length - 1, 1);
});
it('#84 AC3: only runtime.mjs reads the plugin version', () => {
  const dir = path.join(REPO, 'tooling', 'cli'), src = (file) => readFileSync(file, 'utf8');
  const tooling = ['tooling', 'plugins'].flatMap((d) => walk(path.join(REPO, d)).map((f) => path.join(REPO, d, f))).filter((file) => file !== fileURLToPath(import.meta.url));
  assert.deepEqual(tooling.filter((file) => /\.(mjs|js)$/.test(file) && src(file).includes('pluginVersion')), []);
  for (const name of ['serio.mjs', 'generate.mjs']) assert.match(src(path.join(dir, name)), /import \{[^}]*\bversion\b[^}]*\} from '[^']*runtime\.mjs'/);
});
it('#84 AC4: statusBody is private to lifecycle.mjs', () => {
  const life = readFileSync(path.join(PLUGIN, 'scripts', 'lib', 'lifecycle.mjs'), 'utf8');
  assert.doesNotMatch(life, /export (const|function) statusBody|export \{[^}]*\bstatusBody\b/);
  assert.match(life, /statusBody\(/);
});
it('the gate tests the pull request head and hands that commit to the acceptance report', () => {
  const flow = readFileSync(path.join(REPO, '.github', 'workflows', 'lifecycle-gate.yml'), 'utf8');
  const job = (name) => flow.split(/^  (?=[a-z]+:\n)/m).find((part) => part.startsWith(`${name}:`)).split('\n').map((line) => line.trim());
  const head = 'github.event.pull_request.head.sha';
  const tests = job('tests'), start = tests.findIndex((line) => line.includes('actions/checkout@'));
  const next = tests.findIndex((line, i) => i > start && line.startsWith('- ')), step = tests.slice(start, next < 0 ? undefined : next);
  assert.ok(step.some((line) => line.startsWith('ref:') && line.includes(head)), step.join('\n'));
  const control = job('control'), env = control.slice(0, control.indexOf('steps:'));
  assert.ok(env.some((line) => line.startsWith('TESTED_SHA:') && line.includes(head)), env.join('\n'));
});
it('acceptance reports on the commit the tests ran on', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { accept, cases, report } = await import(new URL('acceptance.mjs', lifecycle));
  const { comment } = await import(new URL('publish.mjs', lifecycle));
  const bot = { login: 'github-actions[bot]', type: 'Bot' }, repo = { full_name: 'o/r' };
  const tested = 'abc1234'.padEnd(40, '0'), current = 'def5678'.padEnd(40, '0');
  const criteria = [{ id: 1, text: 'Given 2 and 3, When Add, Then 5', level: 'unit', test: 'sum adds two numbers' }];
  const review = { user: bot, created_at: 't', updated_at: 't', body: comment({ verdict: 'ready', criteria, questions: [] }, 'abcdef123456') };
  const xml = '<testsuites><testsuite><testcase name="sum adds two numbers"/></testsuite></testsuites>';
  const dir = mkdtempSync(path.join(tmpdir(), 'accept-'));
  boxes.push(dir);
  writeFileSync(path.join(dir, 'unit.xml'), xml);
  const own = { tests: cases(xml), files: ['src/sum.mjs'], size: '+3 −1 in 1 files', lock: 'locked', link: '' };
  const want = (sha) => report({ review: review.body, sha, ...own }).body;
  const run = async (head, sha, comments = []) => {
    const sent = [];
    const pr = { number: 9, additions: 3, deletions: 1, changed_files: 1, head: { sha: head, ref: 'agent/7-sum', repo }, base: { repo } };
    const all = (url) => url.includes('/files') ? [{ filename: 'src/sum.mjs' }] : [review, ...comments];
    const io = { one: () => pr, all, raw: () => '', send: (...call) => { sent.push(call); } };
    await accept({ repo: 'o/r', number: 9, dir, tested: sha, lock: 'locked', link: '', post: true }, io);
    return sent;
  };
  const posted = await run(tested, tested);
  assert.deepEqual(posted.map((call) => call[0]), ['POST']);
  assert.equal(posted[0][2].body, want(tested));
  assert.ok(posted[0][2].body.includes(`sha=${tested}`), posted[0][2].body);
  const edited = await run(tested, tested, [{ id: 5, user: bot, body: '**Acceptance: fail** for `1111111`\n\n<!-- acceptance v1 sha=1111111 -->' }]);
  assert.deepEqual(edited.map((call) => call[0]), ['PATCH']);
  assert.ok(edited[0][1].endsWith('/5'), edited[0][1]);
  assert.equal(edited[0][2].body, want(tested));
  const latest = await run(current, '');
  assert.equal(latest[0][2].body, want(current));
});
it('acceptance leaves the report to the run of a newer head', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { accept } = await import(new URL('acceptance.mjs', lifecycle));
  const { comment } = await import(new URL('publish.mjs', lifecycle));
  const bot = { login: 'github-actions[bot]', type: 'Bot' }, repo = { full_name: 'o/r' }, sent = [];
  const criteria = [{ id: 1, text: 'Given 2 and 3, When Add, Then 5', level: 'unit', test: 'sum adds two numbers' }];
  const review = { user: bot, created_at: 't', updated_at: 't', body: comment({ verdict: 'ready', criteria, questions: [] }, 'abcdef123456') };
  const pr = { number: 9, head: { sha: 'def5678'.padEnd(40, '0'), ref: 'agent/7-sum', repo }, base: { repo } };
  const dir = mkdtempSync(path.join(tmpdir(), 'accept-'));
  boxes.push(dir);
  const io = { one: () => pr, all: () => [review], raw: () => '', send: (...call) => { sent.push(call); } };
  const got = await accept({ repo: 'o/r', number: 9, dir, tested: 'abc1234'.padEnd(40, '0'), lock: 'locked', link: '', post: true }, io);
  assert.deepEqual(sent, []);
  assert.deepEqual(got, { ok: true, body: 'acceptance: a newer head exists; the run for it writes the report' });
});
it('status edits the newest status comment by the bot or a code owner in place', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lib/', import.meta.url);
  const { status } = await import(new URL('lifecycle.mjs', lifecycle));
  const ada = { login: 'ada', type: 'User' }, bot = { login: 'github-actions[bot]', type: 'Bot' };
  const mark = (id, user) => ({ id, user, body: '<!-- lifecycle-status v1 -->\n**Status**\nNow: x\n**Log**\n- Old' });
  const run = (comments) => {
    const sent = [];
    status('o/r', 7, { now: 'Done', line: 'Wrote it.' }, { all: () => comments, send: (...call) => { sent.push(call); }, raw: () => '* @ada\n' });
    return sent;
  };
  const one = run([{ id: 1, user: ada, body: 'hi' }, mark(5, ada)]);
  assert.equal(one.length, 1);
  assert.equal(one[0][0], 'PATCH');
  assert.equal(one[0][1], 'repos/o/r/issues/comments/5');
  assert.ok(one[0][2].body.split('**Log**\n')[1].endsWith('- Wrote it.'));
  const later = run([mark(5, bot), mark(6, ada)]);
  assert.deepEqual(later.map((c) => c.slice(0, 2)), [['PATCH', 'repos/o/r/issues/comments/6']]);
  const reversed = run([mark(5, ada), mark(6, bot)]);
  assert.deepEqual(reversed.map((c) => c.slice(0, 2)), [['PATCH', 'repos/o/r/issues/comments/6']]);
});
it('status posts a new comment when no trusted status comment exists', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lib/', import.meta.url);
  const { status } = await import(new URL('lifecycle.mjs', lifecycle));
  const eve = { login: 'eve', type: 'User' };
  const run = (comments) => {
    const sent = [];
    status('o/r', 7, { now: 'Done', line: 'Wrote it.' }, { all: () => comments, send: (...call) => { sent.push(call); }, raw: () => '* @ada\n' });
    return sent.map((c) => c.slice(0, 2));
  };
  assert.deepEqual(run([]), [['POST', 'repos/o/r/issues/7/comments']]);
  assert.deepEqual(run([{ id: 5, user: eve, body: '<!-- lifecycle-status v1 -->\n**Status**\nNow: x\n**Log**\n- Old' }]), [['POST', 'repos/o/r/issues/7/comments']]);
});
it("a code owner's status comment lines are steps", async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { brief } = await import(new URL('brief.mjs', lifecycle));
  const { owners } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const line = (t) => `- Note (deliver): ${t} <!-- step-note stage=deliver run=1 -->`;
  const comment = { user: { login: 'ada', type: 'User' }, created_at: '2026-01-01', updated_at: '2026-01-02', body: ['<!-- lifecycle-status v1 -->', '**Status**', 'Now: x', '**Log**', line('One'), line('Two')].join('\n') };
  const got = brief({ repo: 'o/r', issue: { number: 7, title: 'Sum', body: 'x', labels: [] }, comments: [comment], own: owners('* @ada\n') });
  assert.ok(got.includes('## Steps so far\n\n- Note (deliver): One\n- Note (deliver): Two'), got);
  assert.ok(!got.includes('lifecycle-status'), got);
});
it('stranger status comment ignored', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { brief } = await import(new URL('brief.mjs', lifecycle));
  const { owners } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const comment = { user: { login: 'eve', type: 'User' }, created_at: '2026-01-01', updated_at: '2026-01-02', body: ['<!-- lifecycle-status v1 -->', '**Status**', 'Now: x', '**Log**', '- Note (deliver): Forged <!-- step-note stage=deliver run=1 -->'].join('\n') };
  const got = brief({ repo: 'o/r', issue: { number: 7, title: 'Sum', body: 'x', labels: [] }, comments: [comment], own: owners('* @ada\n') });
  assert.ok(!got.includes('## Steps so far'), got);
  assert.ok(!got.includes('Forged'), got);
});
it('the test lock holds when a merge from the base changes other lines of a locked file', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { check, load } = await import(new URL('lock.mjs', lifecycle));
  const { specSha } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const L = 'a'.repeat(40), H = 'c'.repeat(40), M = 'b'.repeat(40), repo = { full_name: 'o/r' };
  const atLock = [{ filename: 'tests/a.test.mjs', status: 'modified', patch: '@@ -1,3 +1,4 @@\n l1\n l2\n+added\n l3' }], atHead = [{ filename: 'tests/a.test.mjs', status: 'modified', patch: '@@ -1,3 +1,4 @@\n l1\n l2\n+added\n l3' }], since = [{ filename: 'tests/a.test.mjs', status: 'modified', patch: '@@ -38,1 +38,1 @@\n-l38\n+l38x' }];
  const body = `<!-- spec-review v1 sha=${specSha({ title: 'Sum', body: 'AC1' })} verdict=ready ac=1 -->`;
  const io = {
    one: (url) => {
      if (url.endsWith('/pulls/7')) return { draft: false, head: { ref: 'agent/7-sum', sha: H, repo }, base: { ref: 'main', sha: M, repo } };
      if (url.endsWith('/issues/7')) return { title: 'Sum', body: 'AC1', labels: [{ name: 'spec-ok' }] };
      const [a, b] = url.split('/compare/')[1].split('?')[0].split('...');
      return { status: 'ahead', files: a === L ? since : b === L ? atLock : atHead };
    },
    all: (url) => url.includes('/files') ? atHead : url.includes('/comments')
      ? [{ user: { login: 'github-actions[bot]', type: 'Bot' }, created_at: 't', updated_at: 't', body }]
      : [{ user: { login: 'ada', type: 'User' }, body: 'tests-ok', commit_id: L, state: 'APPROVED' }],
    raw: (url) => url.endsWith('.github/CODEOWNERS') ? '* @ada\n' : '',
  };
  const got = check(load('o/r', 7, io));
  assert.equal(got.ok, true); assert.equal(got.note, `locked at ${L.slice(0, 7)}`);
});
it('the test lock fails when the pull request changes its own lines in a locked file after the lock', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { check, load } = await import(new URL('lock.mjs', lifecycle));
  const { specSha } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const L = 'a'.repeat(40), H = 'c'.repeat(40), M = 'b'.repeat(40), repo = { full_name: 'o/r' };
  const atLock = [{ filename: 'tests/a.test.mjs', status: 'modified', patch: '@@ -1,3 +1,4 @@\n l1\n l2\n+added\n l3' }], atHead = [{ filename: 'tests/a.test.mjs', status: 'modified', patch: '@@ -1,3 +1,4 @@\n l1\n l2\n+edited\n l3' }], since = [{ filename: 'tests/a.test.mjs', status: 'modified', patch: '@@ -3,1 +3,1 @@\n-added\n+edited' }];
  const body = `<!-- spec-review v1 sha=${specSha({ title: 'Sum', body: 'AC1' })} verdict=ready ac=1 -->`;
  const io = {
    one: (url) => {
      if (url.endsWith('/pulls/7')) return { draft: false, head: { ref: 'agent/7-sum', sha: H, repo }, base: { ref: 'main', sha: M, repo } };
      if (url.endsWith('/issues/7')) return { title: 'Sum', body: 'AC1', labels: [{ name: 'spec-ok' }] };
      const [a, b] = url.split('/compare/')[1].split('?')[0].split('...');
      return { status: 'ahead', files: a === L ? since : b === L ? atLock : atHead };
    },
    all: (url) => url.includes('/files') ? atHead : url.includes('/comments')
      ? [{ user: { login: 'github-actions[bot]', type: 'Bot' }, created_at: 't', updated_at: 't', body }]
      : [{ user: { login: 'ada', type: 'User' }, body: 'tests-ok', commit_id: L, state: 'APPROVED' }],
    raw: (url) => url.endsWith('.github/CODEOWNERS') ? '* @ada\n' : '',
  };
  const got = check(load('o/r', 7, io));
  assert.equal(got.ok, false); assert.equal(got.note, 'locked paths changed after the lock: tests/a.test.mjs');
});
it('the test lock holds when a merge from the base adds a locked file', async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { check, load } = await import(new URL('lock.mjs', lifecycle));
  const { specSha } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const L = 'a'.repeat(40), H = 'c'.repeat(40), M = 'b'.repeat(40), repo = { full_name: 'o/r' };
  const atLock = [{ filename: 'tests/a.test.mjs', status: 'modified', patch: '@@ -1,3 +1,4 @@\n l1\n l2\n+added\n l3' }], atHead = [{ filename: 'tests/a.test.mjs', status: 'modified', patch: '@@ -1,3 +1,4 @@\n l1\n l2\n+added\n l3' }], since = [{ filename: 'tests/b.test.mjs', status: 'added', patch: '@@ -0,0 +1 @@\n+b' }];
  const body = `<!-- spec-review v1 sha=${specSha({ title: 'Sum', body: 'AC1' })} verdict=ready ac=1 -->`;
  const io = {
    one: (url) => {
      if (url.endsWith('/pulls/7')) return { draft: false, head: { ref: 'agent/7-sum', sha: H, repo }, base: { ref: 'main', sha: M, repo } };
      if (url.endsWith('/issues/7')) return { title: 'Sum', body: 'AC1', labels: [{ name: 'spec-ok' }] };
      const [a, b] = url.split('/compare/')[1].split('?')[0].split('...');
      return { status: 'ahead', files: a === L ? since : b === L ? atLock : atHead };
    },
    all: (url) => url.includes('/files') ? atHead : url.includes('/comments')
      ? [{ user: { login: 'github-actions[bot]', type: 'Bot' }, created_at: 't', updated_at: 't', body }]
      : [{ user: { login: 'ada', type: 'User' }, body: 'tests-ok', commit_id: L, state: 'APPROVED' }],
    raw: (url) => url.endsWith('.github/CODEOWNERS') ? '* @ada\n' : '',
  };
  const got = check(load('o/r', 7, io));
  assert.equal(got.ok, true); assert.equal(got.note, `locked at ${L.slice(0, 7)}`);
});
it("the test lock fails when a locked file's change has no line diff to compare", async () => {
  const lifecycle = new URL('../../plugins/serio-focus/scripts/lifecycle/', import.meta.url);
  const { check, load } = await import(new URL('lock.mjs', lifecycle));
  const { specSha } = await import(new URL('../lib/lifecycle.mjs', lifecycle));
  const L = 'a'.repeat(40), H = 'c'.repeat(40), M = 'b'.repeat(40), repo = { full_name: 'o/r' };
  const atLock = [{ filename: 'tests/logo.bin', status: 'added' }], atHead = [{ filename: 'tests/logo.bin', status: 'added' }], since = [{ filename: 'tests/logo.bin', status: 'modified' }];
  const body = `<!-- spec-review v1 sha=${specSha({ title: 'Sum', body: 'AC1' })} verdict=ready ac=1 -->`;
  const io = {
    one: (url) => {
      if (url.endsWith('/pulls/7')) return { draft: false, head: { ref: 'agent/7-sum', sha: H, repo }, base: { ref: 'main', sha: M, repo } };
      if (url.endsWith('/issues/7')) return { title: 'Sum', body: 'AC1', labels: [{ name: 'spec-ok' }] };
      const [a, b] = url.split('/compare/')[1].split('?')[0].split('...');
      return { status: 'ahead', files: a === L ? since : b === L ? atLock : atHead };
    },
    all: (url) => url.includes('/files') ? atHead : url.includes('/comments')
      ? [{ user: { login: 'github-actions[bot]', type: 'Bot' }, created_at: 't', updated_at: 't', body }]
      : [{ user: { login: 'ada', type: 'User' }, body: 'tests-ok', commit_id: L, state: 'APPROVED' }],
    raw: (url) => url.endsWith('.github/CODEOWNERS') ? '* @ada\n' : '',
  };
  const got = check(load('o/r', 7, io));
  assert.equal(got.ok, false); assert.equal(got.note, 'locked paths changed after the lock: tests/logo.bin');
});
it('trace counts each assistant message once with its tool calls, tokens, duration and models', async () => {
  const { trace } = await import(new URL('../../plugins/serio-focus/scripts/trace.mjs', import.meta.url));
  const row = (id, at, name, input, usage) => ({ type: 'assistant', timestamp: at, message: { id, model: 'm1', content: [{ type: 'tool_use', id: `${id}${name}`, name, input }], usage } });
  const second = { input_tokens: 20, output_tokens: 6, cache_read_input_tokens: 0, cache_creation_input_tokens: 7 };
  const file = path.join(sandbox('trace-'), 't.jsonl');
  writeFileSync(file, [
    row('a', '2026-01-01T10:00:00.000Z', 'Read', { file_path: 'a' }, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }),
    row('b', '2026-01-01T10:00:01.000Z', 'Grep', { pattern: 'p' }, second),
    row('b', '2026-01-01T10:00:01.500Z', 'Read', { file_path: 'b' }, second),
  ].map((r) => JSON.stringify(r)).join('\nnot json\n'));
  const got = trace(file);
  assert.equal(got.turns, 2);
  assert.deepEqual(got.calls, { Read: 2, Grep: 1 });
  assert.deepEqual(got.tokens, { input: 30, output: 11, cacheRead: 100, cacheWrite: 7 });
  assert.equal(got.durationMs, 1500);
  assert.deepEqual(got.models, ['m1']);
});
it('trace lists failed, denied and repeated calls once each with the start of their input', async () => {
  const { trace } = await import(new URL('../../plugins/serio-focus/scripts/trace.mjs', import.meta.url));
  const dir = sandbox('trace-'), bash = { command: 'false' }, write = { file_path: 'w', content: 'y'.repeat(220) };
  assert.equal(JSON.stringify(write).length, 250);
  const call = (id, name, input) => ({ type: 'assistant', message: { id: `m${id}`, content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id, extra, error) => ({ type: 'user', ...extra, message: { content: [{ type: 'tool_result', tool_use_id: id, ...(error && { is_error: true }), content: 'x' }] } });
  const file = path.join(dir, 't.jsonl');
  writeFileSync(file, [call('1', 'Bash', bash), result('1', {}, true), call('2', 'Write', write),
    result('2', { toolDenialKind: 'user', permissionDecision: { decision: 'reject' } }, true),
    call('3', 'Read', { file_path: 'a' }), result('3', {}), call('4', 'Read', { file_path: 'a' }), result('4', {})]
    .map((r) => JSON.stringify(r)).join('\n'));
  const got = trace(file);
  assert.deepEqual(got.errors, [{ tool: 'Bash', input: JSON.stringify(bash) }]);
  assert.deepEqual(got.denied, [{ tool: 'Write', input: JSON.stringify(write).slice(0, 200) }]);
  assert.deepEqual(got.repeats, [{ tool: 'Read', input: '{"file_path":"a"}', times: 2 }]);
  const empty = path.join(dir, 'empty.jsonl');
  writeFileSync(empty, '');
  const none = trace(empty);
  assert.equal(none.turns, 0);
  assert.deepEqual([none.errors, none.denied, none.repeats], [[], [], []]);
});
it('trace adds the agents a transcript started and sums them into totals', async () => {
  const { trace } = await import(new URL('../../plugins/serio-focus/scripts/trace.mjs', import.meta.url));
  const dir = sandbox('trace-'), usage = (n) => ({ input_tokens: n, output_tokens: n + 1, cache_read_input_tokens: n + 2, cache_creation_input_tokens: n + 3 });
  const agent = (name, tool, n, meta) => {
    writeFileSync(path.join(dir, `agent-${name}.jsonl`), JSON.stringify({ type: 'assistant', message: { id: name, model: 'x', content: [{ type: 'tool_use', id: name, name: tool, input: {} }], usage: usage(n) } }));
    if (meta) writeFileSync(path.join(dir, `agent-${name}.meta.json`), JSON.stringify(meta));
  };
  agent('a', 'Read', 1);
  agent('b', 'Grep', 10, { agentType: 'reviewer', model: 'mb', parentAgentId: 'a' });
  agent('c', 'Read', 100, { agentType: 'tester', model: 'mc', parentAgentId: 'a' });
  agent('d', 'Bash', 1000, { agentType: 'coder', model: 'md', parentAgentId: 'z' });
  const got = trace(path.join(dir, 'agent-a.jsonl'));
  const tokens = (n) => ({ input: n, output: n + 1, cacheRead: n + 2, cacheWrite: n + 3 });
  assert.deepEqual([...got.agents].sort((x, y) => x.type.localeCompare(y.type)), [
    { type: 'reviewer', model: 'mb', turns: 1, calls: { Grep: 1 }, tokens: tokens(10) },
    { type: 'tester', model: 'mc', turns: 1, calls: { Read: 1 }, tokens: tokens(100) }]);
  assert.deepEqual(got.totals, { turns: 3, calls: { Read: 2, Grep: 1 }, tokens: { input: 111, output: 114, cacheRead: 117, cacheWrite: 120 } });
  const alone = sandbox('trace-');
  writeFileSync(path.join(alone, 'agent-a.jsonl'), readFileSync(path.join(dir, 'agent-a.jsonl')));
  assert.deepEqual(trace(path.join(alone, 'agent-a.jsonl')).agents, []);
});
it('the brief keeps the whole spec text', async () => {
  const { brief } = await import(new URL('../../plugins/serio-focus/scripts/lifecycle/brief.mjs', import.meta.url));
  const { owners } = await import(new URL('../../plugins/serio-focus/scripts/lib/lifecycle.mjs', import.meta.url));
  const body = 'x'.repeat(9000);
  assert.ok(brief({ repo: 'o/r', issue: { number: 7, title: 'Sum', body, labels: [] }, comments: [], own: owners('* @ada\n') }).includes(body));
});
it("upkeep check leaves the lifecycle's local records alone", () => {
  const repo = sandbox('records-');
  cpSync(REPO, repo, { recursive: true, filter: (file) => !/(?:^|[/\\])(?:\.git|\.claude|node_modules|audit|\.lifecycle)(?:[/\\]|$)/.test(file) });
  const upkeep = (...args) => spawnSync(process.execPath, [path.join(repo, 'tooling', 'cli', 'serio.mjs'), 'upkeep', ...args], { encoding: 'utf8' });
  assert.equal(upkeep().status, ALLOWED);
  const record = path.join(repo, '.lifecycle', 'runs', 'x.md');
  mkdirSync(path.dirname(record), { recursive: true });
  writeFileSync(record, 'a  \n  \n');
  const result = upkeep('--check');
  assert.equal(result.status, ALLOWED, result.stderr);
  assert.equal(readFileSync(record, 'utf8'), 'a  \n  \n');
});
