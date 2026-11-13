#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { PLUGIN, REPO, codexRoles, manifest, markdown, pluginVersion, readJson, walk } from './generate.mjs';

const CONFIG_DIR = process.env.SERIO_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
const CODEX_AGENTS = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'agents');
const RULE_LISTS = ['deny', 'ask', 'allow'];
const TEXT = /\.(md|mjs|json|jsonc|ya?ml)$/;

const marketplace = readJson('.claude-plugin', 'marketplace.json');
const PLUGIN_NAME = marketplace.plugins[0].name;

const fail = (message) => {
  console.error(`serio: ${message}`);
  process.exit(1);
};

const rows = [];
const row = (label, value) => rows.push([label, String(value)]);
const report = () => {
  const width = Math.max(...rows.map(([label]) => label.length));
  console.log(rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join('\n'));
  rows.length = 0;
};

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { args._.push(arg); continue; }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { args[key] = true; continue; }
    args[key] = argv[++i];
  }
  return args;
}

const readJsonFile = (file, fallback) => {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    return fail(`cannot read ${file}`);
  }
  try {
    const text = readFileSync(file, 'utf8');
    return text.trim() === '' ? fallback ?? {} : JSON.parse(text);
  } catch (error) {
    return fail(`failed to parse ${file} as valid JSON: ${error.message}`);
  }
};

const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

function merge(target, patch) {
  const merged = { ...target, ...patch };
  if (patch.permissions) {
    merged.permissions = { ...target.permissions, ...patch.permissions };
    for (const key of RULE_LISTS) {
      if (patch.permissions[key]) {
        merged.permissions[key] = [...new Set([...(target.permissions?.[key] ?? []), ...patch.permissions[key]])];
      }
    }
  }
  return merged;
}

function sync(args) {
  const target = path.resolve(args.target || path.join(CONFIG_DIR, 'settings.json'));
  const before = readJsonFile(target, {});
  const baseline = readJson('.claude', 'settings.json').permissions;
  const after = merge(before, { permissions: baseline });
  if (!args.dryRun) writeJson(target, after);
  const counts = RULE_LISTS
    .map((key) => `${key}+=${(after.permissions?.[key] ?? []).filter((r) => !(before.permissions?.[key] ?? []).includes(r)).length}`)
    .concat(['deny', 'ask'].map((key) => `${key}-=0`));
  row('settings', `${target} ${counts.join(' ')}${args.dryRun ? ' DRY RUN' : ''}`);
  return after;
}

const registryKey = () => `${PLUGIN_NAME}@${marketplace.name}`;
const hostOf = (args) => {
  const host = args.host || 'claude';
  if (!['claude', 'codex'].includes(host)) fail('host must be claude or codex');
  return host;
};

function install(args = {}, remove = false) {
  const host = hostOf(args);
  const roles = host === 'codex' ? codexRoles() : [];
  const ownership = path.join(CODEX_AGENTS, '.serio-focus.json');
  if (roles.length && lstatSync(ownership, { throwIfNoEntry: false })?.isFile() === false) fail(`role collision: ${ownership}`);
  const digests = roles.length ? readJsonFile(ownership, {}) : {};
  if (!digests || typeof digests !== 'object' || Array.isArray(digests)) fail(`invalid role ownership: ${ownership}`);
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  for (const role of roles) {
    const file = path.join(CODEX_AGENTS, role.file);
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isFile()) fail(`role collision: ${file}`);
    const text = readFileSync(file, 'utf8');
    if (digests[role.file] ? digest(text) !== digests[role.file] : text !== role.text && text !== role.legacy) fail(`role collision: ${file}`);
  }
  const native = path.join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  const executable = host === 'claude' ? process.env.CLAUDE_CODE_EXECPATH || (existsSync(native) ? native : 'claude') : 'codex';
  const commands = remove ? [[ 'plugin', host === 'claude' ? 'uninstall' : 'remove', registryKey() ]] : host === 'claude'
    ? [['plugin', 'marketplace', 'add', REPO], ['plugin', 'install', registryKey(), '--scope', 'user']]
    : [['plugin', 'marketplace', 'add', REPO], ['plugin', 'add', registryKey(), '--json']];
  for (const command of commands) {
    const run = spawnSync(executable, command, { encoding: 'utf8' });
    if (run.error || run.status !== 0) fail(run.error?.message || run.stderr || run.stdout || 'plugin installation failed');
  }
  if (host === 'codex') {
    mkdirSync(CODEX_AGENTS, { recursive: true });
    for (const role of roles) {
      if (remove) rmSync(path.join(CODEX_AGENTS, role.file), { force: true });
      else writeFileSync(path.join(CODEX_AGENTS, role.file), role.text, 'utf8');
    }
    if (remove) rmSync(ownership, { force: true });
    else writeJson(ownership, Object.fromEntries(roles.map((role) => [role.file, digest(role.text)])));
  }
  row('plugin', host + (remove ? ' removed' : ' installed') + ' through native plugin commands');
}

const sources = () => walk(REPO)
    .filter((file) => TEXT.test(file) || file.endsWith('.svg'))
    .filter((file) => !/(?:^|\/)(?:\.git|\.claude|node_modules|audit)\//.test(file));

function upkeep(args = {}) {
  const pending = new Map(sources().map((file) => [file, readFileSync(path.join(REPO, file), 'utf8')]));
  const json = (file, value) => pending.set(file, `${JSON.stringify(value, null, 2)}\n`);
  const plugin = readJson('plugins', 'serio-focus', '.claude-plugin', 'plugin.json');
  json('package.json', { ...readJson('package.json'), description: plugin.description });
  json('.claude-plugin/marketplace.json', { ...marketplace, description: plugin.description,
    plugins: marketplace.plugins.map((entry) => entry.name === plugin.name ? { ...entry, description: plugin.description } : entry) });
  json('plugins/serio-focus/.codex-plugin/plugin.json', {
    name: plugin.name, version: plugin.version, description: plugin.description, skills: './skills/', hooks: './hooks/hooks.json',
    interface: { displayName: plugin.displayName, developerName: plugin.author.name, category: 'Productivity' },
  });
  json('.agents/plugins/marketplace.json', {
    name: marketplace.name, interface: { displayName: 'Serio Focus' },
    plugins: marketplace.plugins.map((plugin) => ({ name: plugin.name,
      source: { source: 'local', path: plugin.source }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity' })),
  });
  pending.set('docs/MANIFEST.md', manifest());
  let touched = 0;
  for (const [file, before] of pending) {
    if (!TEXT.test(file)) continue;
    const clean = before.replace(/\r\n/g, '\n');
    const after = file.endsWith('.md') ? markdown(clean) : `${clean.replace(/[ \t]+$/gm, '').replace(/\n+$/, '')}\n`;
    if (after !== before) touched += 1;
    pending.set(file, after);
  }
  row('formatted', `${touched} file(s)`);
  const changed = [...pending].filter(([file, text]) => !existsSync(path.join(REPO, file)) || readFileSync(path.join(REPO, file), 'utf8') !== text);
  if (args.check && changed.length) { report(); fail(`generated artefacts are stale: ${changed.map(([file]) => file).join(', ')}`); }
  for (const [file, text] of changed) {
    mkdirSync(path.dirname(path.join(REPO, file)), { recursive: true });
    writeFileSync(path.join(REPO, file), text, 'utf8');
  }
}

const held = (run) => { try { return JSON.parse(run.stdout || '').hookSpecificOutput?.permissionDecision === 'deny'; } catch { return false; } };
function doctor(args = {}) {
  const host = hostOf(args);
  const key = registryKey();
  const checks = [];
  const check = (question, ok, detail = '') => {
    checks.push(ok);
    console.log(`  ${ok ? 'yes' : 'NO '}  ${question}${detail ? ` — ${detail}` : ''}`);
    return ok;
  };

  if (host === 'claude') {
    const native = path.join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
    const claude = process.env.CLAUDE_CODE_EXECPATH || (existsSync(native) ? native : 'claude');
    const run = spawnSync(claude, ['plugin', 'list', '--json'], { encoding: 'utf8' });
    let installed = [];
    try { installed = JSON.parse(run.stdout); } catch { }
    check('native Claude installation is current and enabled', installed.some((plugin) => plugin.id === key && plugin.enabled && (plugin.folderVersion || plugin.version) === pluginVersion()));
    check('plugin and marketplace pass strict validation', [PLUGIN, REPO].every((dir) => spawnSync(claude, ['plugin', 'validate', '--strict', dir]).status === 0));
  } else {
    const run = spawnSync('codex', ['plugin', 'list', '--marketplace', marketplace.name, '--json'], { encoding: 'utf8' });
    let installed = [];
    try { installed = JSON.parse(run.stdout).installed; } catch { }
    check('native Codex installation is current and enabled', installed.some((plugin) => plugin.pluginId === key && plugin.enabled && plugin.version === pluginVersion()));
    check('Codex role agents are current', codexRoles().every((role) => existsSync(path.join(CODEX_AGENTS, role.file)) && readFileSync(path.join(CODEX_AGENTS, role.file), 'utf8') === role.text));
  }

  check('node resolves through the shell', spawnSync('node', ['--version'], { shell: true }).status === 0, 'hooks call bare node');

  const probe = mkdtempSync(path.join(tmpdir(), 'serio-doctor-'));
  const at = (dir, script, payload) => spawnSync(process.execPath, [path.join(dir, 'scripts', script)], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, SERIO_OS_DIR: probe },
  });
  const session = () => `doctor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pre = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', session_id: session(), cwd: probe, tool_name, tool_input });
  const spawn = (tool_input) => held(at(PLUGIN, 'guard.mjs', pre('Agent', tool_input)));

  check('a subagent call without model and effort is held', spawn({ prompt: 'p' }) && !spawn({ prompt: 'p', model: 'm', effort: 'low' }),
    'deterministic script probe; native hook trust and invocation are separate');
  check('the checkout card prints', at(PLUGIN, 'card.mjs', {}).stdout.trim().length > 0);

  rmSync(probe, { recursive: true, force: true });

  const failed = checks.filter((ok) => !ok).length;
  console.log(`  ${checks.length - failed} of ${checks.length} yes`);
  return { failed };
}

function release(args) {
  const BUMPS = {
    major: ([a]) => [a + 1, 0, 0],
    minor: ([a, b]) => [a, b + 1, 0],
    patch: ([a, b, c]) => [a, b, c + 1],
  };
  const [first, ...rest] = args._;
  const bump = BUMPS[first] ? first : 'patch';
  const note = (BUMPS[first] ? rest : args._).join(' ').trim()
    || (spawnSync('git', ['-C', REPO, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).stdout || '').trim();
  if (!note) fail(`usage: npm run release [${Object.keys(BUMPS).join('|')}] "one-line note" — no note given and no commit to borrow one from`);
  if (spawnSync(process.execPath, ['--test'], { cwd: REPO, stdio: 'inherit' }).status !== 0) fail('the suite is red');

  const manifestPath = path.join(PLUGIN, '.claude-plugin', 'plugin.json');
  const plugin = readJsonFile(manifestPath);
  plugin.version = BUMPS[bump](plugin.version.split('.').map(Number)).join('.');
  writeJson(manifestPath, plugin);
  const pkgPath = path.join(REPO, 'package.json');
  const pkg = readJsonFile(pkgPath);
  pkg.version = plugin.version;
  writeJson(pkgPath, pkg);
  const changelog = path.join(REPO, 'CHANGELOG.md');
  const head = '# Changelog\n\n<!-- one row per version; `npm run release` updates -->\n\n| Version | Date | Change |\n|---|---|---|\n';
  const rows = existsSync(changelog)
    ? readFileSync(changelog, 'utf8').split('\n').filter((line) => /^\| \d/.test(line))
    : [];
  rows.unshift(`| ${plugin.version} | ${new Date().toISOString().slice(0, 10)} | ${note.replaceAll('|', '\\|')} |`);
  writeFileSync(changelog, `${head}${rows.join('\n')}\n`, 'utf8');
  upkeep();
  row('released', plugin.version);
  report();
}

function prove() {
  const suite = path.join('tooling', 'test', 'guard.test.mjs');
  const failing = (cwd) => {
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', suite], { cwd, encoding: 'utf8' });
    if (run.error || run.signal || (run.status !== 0 && !/failureType: 'testCodeFailure'/.test(run.stdout))) throw new Error('suite execution failed before behavioral proof');
    return { status: run.status, cases: [...new Set([...run.stdout.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((hit) => hit[1]))] };
  };
  const box = mkdtempSync(path.join(tmpdir(), 'serio-prove-'));
  let head;
  let tree;
  try {
    if (spawnSync('git', ['-C', REPO, 'archive', '--format=tar', '-o', path.join(box, 'head.tar'), 'HEAD']).status !== 0) throw new Error('cannot archive HEAD');
    if (spawnSync('tar', ['-xf', 'head.tar'], { cwd: box }).status !== 0) throw new Error('cannot unpack HEAD');
    copyFileSync(path.join(REPO, suite), path.join(box, suite));
    head = failing(box);
    tree = failing(REPO);
  } finally { rmSync(box, { recursive: true, force: true }); }
  row('fails on HEAD', head.cases.join(' · ') || 'nothing — no case proves the change');
  row('fails on tree', tree.cases.join(' · ') || 'nothing');
  report();
  if (head.status === 0 || !head.cases.length || tree.status !== 0 || tree.cases.length) process.exitCode = 1;
}

function setup(args) {
  install(args);
  report();
  console.log('Installed. Review and trust the hooks in the native host, then start a fresh session.');
}

const args = parse(process.argv.slice(2));
const command = args._.shift() || 'setup';
if (!['sync', 'install', 'uninstall', 'upkeep', 'doctor', 'release', 'setup', 'prove'].includes(command)) fail(`unknown command: ${command}`);

if (command === 'setup') await setup(args);
else if (command === 'sync') { sync(args); report(); }
else if (command === 'install') { install(args); report(); }
else if (command === 'uninstall') { install(args, true); report(); }
else if (command === 'upkeep') {
  upkeep(args);
  report();
}
else if (command === 'doctor') process.exit(doctor(args).failed ? 1 : 0);
else if (command === 'release') release(args);
else if (command === 'prove') prove();
