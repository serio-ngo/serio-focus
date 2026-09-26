#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { SPAWN_TOOLS } from '../../plugins/serio-focus/scripts/guard.mjs';
import { writeFigures } from './figures.mjs';
import { PLUGIN, REPO, REPLY_CLOSE, REPLY_OPEN, manifest, markdown, opencodeAgents, pluginVersion, policyFor, readJson, replyBody, walk, writeBlock } from './generate.mjs';

const CONFIG_DIR = process.env.SERIO_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
const BANNED = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
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

const originRepo = () => {
  const url = spawnSync('git', ['-C', REPO, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout || '';
  return (/[:/]([^/:]+\/[^/]+?)(?:\.git)?\s*$/.exec(url) || [])[1];
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

function refuseMeteredAuth(settings) {
  const offenders = [
    ...BANNED.filter((key) => key in (settings.env ?? {})).map((key) => `env.${key}`),
    ...('apiKeyHelper' in settings ? ['apiKeyHelper'] : []),
  ];
  if (offenders.length) fail(`refusing to write — ${offenders.join(', ')} outranks subscription login. Nothing was written.`);
}

function installation() {
  const repo = originRepo();
  const patch = {
    env: { SERIO_OS_DIR: REPO, FORCE_AUTOUPDATE_PLUGINS: '1' },
    enabledPlugins: { [`${PLUGIN_NAME}@${marketplace.name}`]: true },
  };
  if (repo) patch.extraKnownMarketplaces = { [marketplace.name]: { source: { source: 'github', repo }, autoUpdate: true } };
  return patch;
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
  if (scope === 'user') after = merge(after, installation());
  after = releaseLocks(after, args.unlock ?? []);
  after = retire(after);
  after.env = { ...after.env };
  if ((args.unlock ?? []).includes('git')) after.env.SERIO_GIT_WRITE = '1';
  else delete after.env.SERIO_GIT_WRITE;
  for (const key of Object.keys(after.env)) if (key.startsWith('HANDOFF_')) delete after.env[key];
  if (Object.keys(after.env).length === 0) delete after.env;
  refuseMeteredAuth(after);
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

const registryPath = () => path.join(CONFIG_DIR, 'plugins', 'installed_plugins.json');
const registryKey = () => `${PLUGIN_NAME}@${marketplace.name}`;

function install() {
  const file = registryPath();
  const registry = readJsonFile(file, {});
  const key = registryKey();
  const entry = registry.plugins?.[key]?.[0];
  if (entry && !('gitCommitSha' in entry)) {
    delete registry.plugins[key];
    writeJson(file, registry);
    row('unpinned', `${key} manual entry removed`);
  }
  const claude = (...rest) => spawnSync(process.env.CLAUDE_CODE_EXECPATH || 'claude', ['plugin', ...rest], { encoding: 'utf8' });
  const known = marketplace.name in readJsonFile(path.join(CONFIG_DIR, 'plugins', 'known_marketplaces.json'), {});
  claude('marketplace', ...(known ? ['update', marketplace.name] : ['add', originRepo()]));
  const run = claude(entry?.gitCommitSha ? 'update' : 'install', key, '--scope', 'user');
  if (run.status !== 0) process.exitCode = 1;
  row('plugin', `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').pop() || 'claude not found');
}

function syncReply() {
  const file = opencodeAgents();
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${REPLY_OPEN}\n${REPLY_CLOSE}\n`, 'utf8');
  }
  const current = readFileSync(file, 'utf8');
  if (!current.includes(REPLY_OPEN) || !current.includes(REPLY_CLOSE)) {
    writeFileSync(file, `${current.replace(/\n+$/, '')}\n\n${REPLY_OPEN}\n${REPLY_CLOSE}\n`, 'utf8');
  }
  row('reply', writeBlock(file, REPLY_OPEN, REPLY_CLOSE, replyBody().split('\n')));
}

function normalise() {
  const files = walk(REPO)
    .filter((file) => TEXT.test(file))
    .filter((file) => !/(?:^|\/)(?:\.git|\.claude|node_modules|audit)\//.test(file));
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
  writeFileSync(path.join(REPO, 'docs', 'MANIFEST.md'), manifest(), 'utf8');
  row('figures', `${figures.length} file(s)`);
  row('formatted', `${touched} file(s)`);
}

function check() {
  const diff = spawnSync('git', ['diff', '--exit-code'], { cwd: REPO, stdio: 'inherit' });
  if (diff.status !== 0) fail('generated artefacts are stale — review the diff, then commit it');
}

const BLOCKED = 2;
const held = (run) => run.status === BLOCKED
  || (() => { try { return ['ask', 'deny'].includes(JSON.parse(run.stdout || '').hookSpecificOutput?.permissionDecision); } catch { return false; } })();
function doctor() {
  const settings = readJsonFile(path.join(CONFIG_DIR, 'settings.json'), {});
  const key = registryKey();
  const checks = [];
  const check = (question, ok, detail = '') => {
    checks.push(ok);
    console.log(`  ${ok ? 'yes' : 'NO '}  ${question}${detail ? ` — ${detail}` : ''}`);
    return ok;
  };

  check('the plugin is enabled', settings.enabledPlugins?.[key] === true);
  check('login is restricted to the subscription', settings.forceLoginMethod === 'claudeai');
  check('the marketplace is registered', settings.extraKnownMarketplaces?.[marketplace.name]?.source?.repo === originRepo());
  check('plugin auto-update survives DISABLE_AUTOUPDATER', settings.env?.FORCE_AUTOUPDATE_PLUGINS === '1'
    && settings.extraKnownMarketplaces?.[marketplace.name]?.autoUpdate === true);
  const pinned = readJsonFile(registryPath(), {}).plugins?.[key]?.[0];
  check('the marketplace install is this checkout', Boolean(pinned?.gitCommitSha) && pinned.version === pluginVersion(),
    `installed ${pinned?.version ?? 'nothing'}, checkout ${pluginVersion()}`);

  const probe = mkdtempSync(path.join(tmpdir(), 'serio-doctor-'));
  const at = (dir, script, payload, env) => spawnSync(process.execPath, [path.join(dir, 'scripts', script)], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, SERIO_OS_DIR: probe, ...env },
  });
  const session = () => `doctor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pre = (tool_name, tool_input) => ({ hook_event_name: 'PreToolUse', session_id: session(), cwd: probe, tool_name, tool_input });
  const fire = (payload, env) => at(PLUGIN, 'guard.mjs', payload, env);
  const shell = (command, env) => fire(pre('Bash', { command }), env);

  const open = settings.env?.SERIO_GIT_WRITE === '1';
  const shut = ['Bash(git commit *)', 'Bash(git push *)']
    .every((rule) => (settings.permissions?.deny ?? []).includes(rule));
  check('the git gate holds commit and push, nothing else git',
    shut === !open
    && ['git commit -m x', 'git push origin main'].every((c) => held(shell(c, { SERIO_GIT_WRITE: '0' })))
    && ['git status', 'git stash push -m wip', 'git merge main'].every((c) => !held(shell(c, { SERIO_GIT_WRITE: '0' }))),
    'deny rules, SERIO_GIT_WRITE and the live guard must agree');
  check('the checkout guard blocks recursive deletes and git wipes',
    ['rm -rf docs', 'git clean -fdx', 'git reset --hard HEAD~1'].every((c) => held(shell(c))),
    'rm -r, clean -fdx, reset --hard');
  const routed = (run) => { try { return JSON.parse(run.stdout).hookSpecificOutput.updatedInput.model === 'sonnet'; } catch { return false; } };
  const lean = (run) => { try { return JSON.parse(run.stdout).hookSpecificOutput.updatedInput.subagent_type === 'serio-focus:worker'; } catch { return false; } };
  check('the checkout guard routes dispatch by tier',
    SPAWN_TOOLS.every((tool) => routed(fire(pre(tool, { model: 'opus', prompt: 'review the diff' }))))
    && routed(fire(pre('Agent', { prompt: 'audit the repo' })))
    && lean(fire(pre('Agent', { prompt: 'audit the repo' })))
    && lean(fire(pre('Agent', { model: 'sonnet', prompt: 'review the diff' }))),
    'opus and unnamed routed to sonnet, typeless runs as serio-focus:worker');
  check('the checkout card prints', spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'card.mjs')], { encoding: 'utf8' }).stdout.trim().length > 0);

  // Every check above spawns the scripts here. Only the ledger proves Claude Code spawns them.
  const month = new Date().toISOString().slice(0, 7);
  const ledger = path.join(process.env.SERIO_OS_DIR || REPO, 'audit', `${month}.jsonl`);
  const since = existsSync(ledger) ? Date.now() - statSync(ledger).mtimeMs : Infinity;
  check('Claude Code itself fired a hook here within a day',
    since < 24 * 60 * 60 * 1000,
    existsSync(ledger) ? `${Math.round(since / 3600000)}h since the last receipt` : 'no receipt yet — start a session and rerun');

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
  const failing = (cwd) => [...new Set([...spawnSync(process.execPath, ['--test', '--test-reporter=tap', suite], { cwd, encoding: 'utf8' })
    .stdout.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((hit) => hit[1]))];
  const box = mkdtempSync(path.join(tmpdir(), 'serio-prove-'));
  let head = [];
  let tree = [];
  try {
    spawnSync('git', ['-C', REPO, 'archive', '--format=tar', '-o', path.join(box, 'head.tar'), 'HEAD']);
    spawnSync('tar', ['-xf', 'head.tar'], { cwd: box });
    copyFileSync(path.join(REPO, suite), path.join(box, suite));
    head = failing(box);
    tree = failing(REPO);
  } finally { rmSync(box, { recursive: true, force: true }); }
  row('fails on HEAD', head.join(' · ') || 'nothing — no case proves the change');
  row('fails on tree', tree.join(' · ') || 'nothing');
  report();
  if (!head.length || tree.length) process.exitCode = 1;
}

function setup(args) {
  install();
  sync(args);
  if (args.project) sync({ ...args, scope: 'project', target: args.project });
  upkeep();
  syncReply();
  report();
  console.log('Cowork: paste this into Settings > Cowork > Global instructions:');
  console.log(replyBody());
  console.log('');
  const { failed } = doctor();
  console.log('');
  console.log(failed
    ? '  Restart Claude Code, then run: npm run doctor'
    : '  Ready. Restart Claude Code so the session card loads.');
}

const args = parse(process.argv.slice(2));
const command = ['sync', 'install', 'upkeep', 'doctor', 'release', 'setup', 'prove'].includes(args._[0])
  ? args._.shift()
  : 'setup';

if (command === 'setup') await setup(args);
else if (command === 'sync') { sync(args); report(); }
else if (command === 'install') { install(); report(); }
else if (command === 'upkeep') { upkeep(); if (args.install) install(); report(); if (args.check) check(); }
else if (command === 'doctor') process.exit(doctor().failed ? 1 : 0);
else if (command === 'release') release(args);
else if (command === 'prove') prove();
