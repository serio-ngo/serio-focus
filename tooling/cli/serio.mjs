#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { writeFigures } from './figures.mjs';
import { PLUGIN, REPO, manifest, markdown, pluginVersion, policyFor, readJson, walk, writeBlock } from './generate.mjs';

const CONFIG_DIR = process.env.SERIO_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
const RULE_LISTS = ['deny', 'ask', 'allow'];
const TEXT = /\.(md|mjs|json|jsonc|ya?ml|cff)$/;

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
  const args = { _: [], without: [], unlock: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { args._.push(arg); continue; }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { args[key] = true; continue; }
    args[key] = argv[++i];
  }
  for (const key of ['without', 'unlock']) {
    if (typeof args[key] === 'string') {
      args[key] = args[key].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else if (args[key] === true) args[key] = [];
  }
  return args;
}

function readJsonFile(file, fallback) {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    return fail(`cannot read ${file}`);
  }
  try {
    const text = readFileSync(file, 'utf8');
    return text.trim() === '' ? fallback ?? {} : JSON.parse(text);
  } catch (error) {
    return fail(`${file} is not valid JSON: ${error.message}`);
  }
}

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
  for (const key of ['env', 'extraKnownMarketplaces', 'enabledPlugins']) {
    if (patch[key]) merged[key] = { ...target[key], ...patch[key] };
  }
  return merged;
}

function releaseLocks(settings, requested) {
  const bundles = readJson('tooling', 'settings', 'policy.json').unlock ?? {};
  const stale = Object.entries(bundles)
    .filter(([token]) => requested.includes(token))
    .flatMap(([, rules]) => rules);
  if (!stale.length || !settings.permissions?.deny) return settings;
  const deny = settings.permissions.deny.filter((rule) => !stale.includes(rule));
  return { ...settings, permissions: { ...settings.permissions, deny } };
}

function retire(settings) {
  const gone = readJson('tooling', 'settings', 'policy.json').retired ?? [];
  if (!gone.length || !settings.permissions?.deny) return settings;
  const deny = settings.permissions.deny.filter((rule) => !gone.includes(rule));
  return { ...settings, permissions: { ...settings.permissions, deny } };
}

function ensureAuditIgnored(root) {
  const file = path.join(root, '.gitignore');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (/^\s*audit\/\*?\s*$/m.test(current)) return;
  const head = current.replace(/\n*$/, '');
  writeFileSync(file, `${head}${head ? '\n\n' : ''}# serio-focus session ledger\naudit/\n`, 'utf8');
}

function sync(args) {
  const scope = args.scope || 'user';
  if (!['user', 'project'].includes(scope)) fail(`unknown scope "${scope}"`);
  const target = path.resolve(args.target
    || (scope === 'project' ? path.join(REPO, '.claude', 'settings.json') : path.join(CONFIG_DIR, 'settings.json')));
  const before = readJsonFile(target, {});
  let after = merge(before, policyFor(scope, args.without, undefined, args.unlock));
  after = releaseLocks(after, args.unlock ?? []);
  after = retire(after);
  after.env = { ...after.env };
  if ((args.unlock ?? []).includes('git')) after.env.SERIO_GIT_WRITE = '1';
  else delete after.env.SERIO_GIT_WRITE;
  for (const key of Object.keys(after.env)) if (key.startsWith('HANDOFF_')) delete after.env[key];
  if (Object.keys(after.env).length === 0) delete after.env;
  if (!args.dryRun) writeJson(target, after);
  if (scope === 'project' && !args.dryRun) {
    const dir = path.dirname(path.resolve(target));
    if (dir.endsWith(`${path.sep}.claude`)) ensureAuditIgnored(path.dirname(dir));
  }
  const counts = RULE_LISTS
    .map((key) => `${key}+=${(after.permissions?.[key] ?? []).filter((r) => !(before.permissions?.[key] ?? []).includes(r)).length}`);
  row(`settings (${scope})`, `${target} ${counts.join(' ')}${args.dryRun ? ' DRY RUN' : ''}`);
  return after;
}

const registryKey = () => `${PLUGIN_NAME}@${marketplace.name}`;
const hostOf = (args) => {
  const host = args.host || 'codex';
  if (!['claude', 'codex'].includes(host)) fail('host must be claude or codex');
  return host;
};

function install(args = {}, remove = false) {
  const host = hostOf(args);
  const native = path.join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  const executable = host === 'claude' ? process.env.CLAUDE_CODE_EXECPATH || (existsSync(native) ? native : 'claude') : 'codex';
  const commands = remove ? [[ 'plugin', host === 'claude' ? 'uninstall' : 'remove', registryKey() ]] : host === 'claude'
    ? [['plugin', 'marketplace', 'add', REPO], ['plugin', 'install', registryKey(), '--scope', 'user']]
    : [['plugin', 'marketplace', 'add', REPO], ['plugin', 'add', registryKey(), '--json']];
  for (const command of commands) {
    const run = spawnSync(executable, command, { encoding: 'utf8' });
    if (run.error || run.status !== 0) fail(run.error?.message || run.stderr || run.stdout || 'plugin installation failed');
  }
  row('plugin', host + (remove ? ' removed' : ' installed') + ' through native plugin commands');
}

const sources = (figures = false) => walk(REPO)
    .filter((file) => TEXT.test(file) || (figures && file.endsWith('.svg')))
    .filter((file) => !/(?:^|\/)(?:\.git|\.claude|node_modules|audit)\//.test(file));

function normalise() {
  const files = sources();
  let touched = 0;
  for (const rel of files) {
    const file = path.join(REPO, rel);
    const before = readFileSync(file, 'utf8');
    let after = before.replace(/\r\n/g, '\n');
    if (rel.endsWith('.md')) after = markdown(after);
    else after = `${after.replace(/[ \t]+$/gm, '').replace(/\n+$/, '')}\n`;
    if (after !== before) { writeFileSync(file, after, 'utf8'); touched += 1; }
  }
  return touched;
}

function upkeep() {
  const figures = writeFigures();
  const touched = normalise();
  const plugin = readJson('plugins', 'serio-focus', '.claude-plugin', 'plugin.json');
  const hooks = readJson('plugins', 'serio-focus', 'hooks', 'hooks.json').hooks;
  writeJson(path.join(REPO, 'package.json'), { ...readJson('package.json'), description: plugin.description });
  writeJson(path.join(REPO, '.claude-plugin', 'marketplace.json'), { ...marketplace, description: plugin.description,
    plugins: marketplace.plugins.map((entry) => entry.name === plugin.name ? { ...entry, description: plugin.description } : entry) });
  writeBlock(path.join(REPO, 'README.md'), '<!-- serio-description -->', '<!-- /serio-description -->', [plugin.description]);
  writeJson(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), {
    name: plugin.name, version: plugin.version, description: plugin.description,
    hooks: { hooks: Object.fromEntries(Object.entries(hooks).filter(([event]) => event !== 'StopFailure')) },
  });
  writeJson(path.join(REPO, '.agents', 'plugins', 'marketplace.json'), {
    name: marketplace.name, interface: { displayName: 'Serio Focus' },
    plugins: marketplace.plugins.map((plugin) => ({ name: plugin.name,
      source: { source: 'local', path: plugin.source }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity' })),
  });
  writeFileSync(path.join(REPO, 'docs', 'MANIFEST.md'), manifest(), 'utf8');
  row('figures', `${figures.length} file(s)`);
  row('formatted', `${touched} file(s)`);
}

function check(before) {
  const changed = sources(true).filter((file) => before.get(file) !== readFileSync(path.join(REPO, file), 'utf8'));
  if (changed.length) fail(`generated artefacts are stale: ${changed.join(', ')}`);
}

const BLOCKED = 2;
const held = (run) => run.status === BLOCKED
  || (() => { try { return ['ask', 'deny'].includes(JSON.parse(run.stdout || '').hookSpecificOutput?.permissionDecision); } catch { return false; } })();
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
    const run = spawnSync(process.env.CLAUDE_CODE_EXECPATH || (existsSync(native) ? native : 'claude'), ['plugin', 'list', '--json'], { encoding: 'utf8' });
    let installed = [];
    try { installed = JSON.parse(run.stdout); } catch { }
    check('native Claude installation is current and enabled', installed.some((plugin) => plugin.id === key && plugin.enabled && (plugin.folderVersion || plugin.version) === pluginVersion()));
  } else {
    const run = spawnSync('codex', ['plugin', 'list', '--marketplace', marketplace.name, '--json'], { encoding: 'utf8' });
    let installed = [];
    try { installed = JSON.parse(run.stdout).installed; } catch { }
    check('native Codex installation is current and enabled', installed.some((plugin) => plugin.pluginId === key && plugin.enabled && plugin.version === pluginVersion()));
  }

  const probe = mkdtempSync(path.join(tmpdir(), 'serio-doctor-'));
  const at = (dir, script, payload, env) => spawnSync(process.execPath, [path.join(dir, 'scripts', script)], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, SERIO_OS_DIR: probe, ...env },
  });
  const session = () => `doctor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pre = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', session_id: session(), cwd: probe, tool_name, tool_input });
  const fire = (payload, env) => at(PLUGIN, 'guard.mjs', payload, env);
  const shell = (command, env) => fire(pre('Bash', { command }), env);

  check('the git gate holds commit and push, nothing else git',
    ['git commit -m x', 'git push origin main'].every((c) => held(shell(c, { SERIO_GIT_WRITE: '0' })))
    && ['git status', 'git stash push -m wip', 'git merge main'].every((c) => !held(shell(c, { SERIO_GIT_WRITE: '0' }))),
    'deterministic script probe; native hook trust and invocation are separate');
  check('the checkout guard blocks recursive deletes and git wipes',
    ['rm -rf docs', 'git clean -fdx', 'git reset --hard HEAD~1'].every((c) => held(shell(c))),
    'rm -r, clean -fdx, reset --hard');
  check('the checkout card prints', spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'card.mjs')], { encoding: 'utf8' }).stdout.trim().length > 0);

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
  writeFileSync(path.join(REPO, 'docs', 'MANIFEST.md'), manifest(), 'utf8');
  const pkgPath = path.join(REPO, 'package.json');
  const pkg = readJsonFile(pkgPath);
  pkg.version = plugin.version;
  writeJson(pkgPath, pkg);
  const changelog = path.join(REPO, 'CHANGELOG.md');
  const head = '# Changelog\n\n<!-- one row per version; `npm run release` updates -->\n\n| Version | Date | Change |\n|---|---|---|\n';
  const rows = existsSync(changelog)
    ? readFileSync(changelog, 'utf8').split('\n').filter((line) => /^\| \d/.test(line))
    : [];
  const date = args.date || new Date().toISOString().slice(0, 10);
  rows.unshift(`| ${plugin.version} | ${date} | ${note.replaceAll('|', '\\|')} |`);
  writeFileSync(changelog, `${head}${rows.join('\n')}\n`, 'utf8');
  writeFileSync(path.join(REPO, 'docs', 'MANIFEST.md'), manifest(), 'utf8');
  const bench = (...args) => spawnSync(process.execPath, [path.join(REPO, 'tooling', 'benchmark', 'benchmark.mjs'), REPO, ...args], { stdio: 'inherit' });
  bench('--eval', '--compare', '--write');
  bench('--write');
  row('released', plugin.version);
  row('figures', `${writeFigures().length} file(s)`);
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
  if (args.policy) sync(args);
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
  const before = args.check ? new Map(sources(true).map((file) => [file, readFileSync(path.join(REPO, file), 'utf8')])) : null;
  upkeep();
  if (args.install) install(args);
  report();
  if (args.check) check(before);
}
else if (command === 'doctor') process.exit(doctor(args).failed ? 1 : 0);
else if (command === 'release') release(args);
else if (command === 'prove') prove();
