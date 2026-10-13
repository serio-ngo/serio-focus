import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { card } from '../../plugins/serio-focus/scripts/card.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PLUGIN = path.join(REPO, 'plugins', 'serio-focus');

export const read = (...parts) => readFileSync(path.join(REPO, ...parts), 'utf8');
export const readJson = (...parts) => JSON.parse(read(...parts));
export const pluginVersion = (dir = PLUGIN) => JSON.parse(readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).version;

export const walk = (dir, base = '') => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [])
  .flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path.join(dir, entry.name), rel) : [rel];
  });

const SCOPES = {
  user: ({ deny, ask }) => ({ permissions: { deny, ask } }),
  project: ({ deny }) => ({ permissions: { deny } }),
};

export function policyFor(scope, without = [], policy = readJson('tooling', 'settings', 'policy.json')) {
  const drop = (rules) => without.length
    ? rules.filter((rule) => !without.some((token) => rule.toLowerCase().includes(token)))
    : rules;
  return SCOPES[scope]({ deny: drop(policy.deny), ask: drop(policy.ask) });
}

export const table = (header, rows) => [
  `| ${header.join(' | ')} |`,
  `|${header.map(() => '---').join('|')}|`,
  ...rows,
].join('\n');

const cell = (value) => String(value).replace(/\|/g, '\\|');

const HEADING = /^#{1,6}\s/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const FENCE = /^\s*(?:```|~~~)/;

export function markdown(text) {
  const lines = text.split('\n');
  const out = [];
  let fence = false;
  let frontmatter = lines[0] === '---';

  const blankBefore = () => {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
  };
  const continues = (i) => {
    const next = lines[i + 1];
    return next !== undefined && (LIST_ITEM.test(next) || /^\s+\S/.test(next) || next.trim() === '');
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (frontmatter) {
      out.push(line);
      if (i > 0 && line === '---') frontmatter = false;
      continue;
    }
    if (FENCE.test(line)) { fence = !fence; out.push(line); continue; }
    if (fence) { out.push(line); continue; }

    if (line.trim() === '') {
      if (out.length && out[out.length - 1].trim() === '') continue;
      out.push('');
      continue;
    }
    if (HEADING.test(line)) {
      blankBefore();
      out.push(line);
      if (lines[i + 1] !== undefined && lines[i + 1].trim() !== '') out.push('');
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const previous = out[out.length - 1] ?? '';
      if (previous.trim() !== '' && !LIST_ITEM.test(previous) && !/^\s+\S/.test(previous)) blankBefore();
      out.push(line);
      if (!continues(i)) out.push('');
      continue;
    }
    out.push(line);
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

export function writeBlock(file, open, close, lines) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return `no file at ${file}`; }
  const all = text.split('\n');
  const a = all.indexOf(open);
  const z = all.indexOf(close);
  if (a < 0 || z < a) return `no markers in ${file}`;
  let next = `${[...all.slice(0, a + 1), ...lines, ...all.slice(z)].join('\n').replace(/\n+$/, '')}\n`;
  if (file.endsWith('.md')) next = markdown(next.replace(/\r\n/g, '\n'));
  writeFileSync(file, next, 'utf8');
  return `refreshed ${path.basename(file)}`;
}

const documents = (root, folder, pattern) => {
  const dir = path.join(root, 'plugins', 'serio-focus', folder);
  return walk(dir).filter((file) => pattern.test(file)).map((file) => {
    const [, head = '', body = ''] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n')) || [];
    const field = (key) => (new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(head) || [])[1] || '';
    return { dir: path.dirname(file), name: field('name'), description: field('description'), tools: field('tools'), body: body.trim() };
  }).sort((a, b) => (a.name < b.name ? -1 : 1));
};

export const skills = (root = REPO) => documents(root, 'skills', /(?:^|\/)SKILL\.md$/);
export const agents = (root = REPO) => documents(root, 'agents', /\.md$/);

export const startupChars = (root = REPO) => card().length
  + [...skills(root), ...agents(root)].reduce((n, doc) => n + doc.name.length + doc.description.length, 0);

export const codexRoles = (root = REPO) => agents(root).map((agent) => ({
  file: `serio-${agent.name}.toml`,
  text: [`name = "serio-${agent.name}"`, `description = ${JSON.stringify(agent.description)}`,
    ...(/\b(?:Edit|Write)\b/.test(agent.tools) ? [] : ['sandbox_mode = "read-only"']),
    `developer_instructions = '''\n${agent.body}\n'''`, ''].join('\n'),
}));

export function score() {
  const box = mkdtempSync(path.join(tmpdir(), 'serio-score-'));
  spawnSync('git', ['init', '-q', box]);
  writeFileSync(path.join(box, '.gitignore'), 'node_modules/\n');
  for (const file of ['docs/a.md', 'src/a.ts', 'lib/a.js']) {
    mkdirSync(path.join(box, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(box, file), 'keep');
  }
  spawnSync('git', ['-C', box, 'add', 'lib/a.js']);
  spawnSync('git', ['-C', box, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture']);
  const rows = read('tooling', 'corpus', 'guard-corpus.jsonl').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .filter((c) => !c.known_gap).map((c) => {
      const run = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'guard.mjs')], {
      input: JSON.stringify({ session_id: `corpus-${c.id}`, cwd: box, tool_name: c.tool, tool_input: c.input || {} }), encoding: 'utf8',
      env: { ...process.env, SERIO_OS_DIR: box },
      });
      if (run.error || run.status !== 0) throw new Error(`guard execution failed: ${c.id}`);
      return { id: c.id, block: c.want === 'block', held: /"permissionDecision":"(?:ask|deny)"/.test(run.stdout) };
    });
  rmSync(box, { recursive: true, force: true });
  const n = (block, held) => rows.filter((row) => row.block === block && row.held === held).length;
  const pct = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);
  return {
    cases: rows.length,
    recall: pct(n(true, true), n(true, true) + n(true, false)),
    fpRate: pct(n(false, true), n(false, true) + n(false, false)),
    misses: rows.filter((row) => row.block !== row.held).map((row) => row.id),
  };
}

export function inventory(root = REPO) {
  const plugin = path.join(root, 'plugins', 'serio-focus');
  const scripts = walk(path.join(plugin, 'scripts')).filter((file) => file.endsWith('.mjs'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    skills: skills(root).length,
    agents: walk(path.join(plugin, 'agents')).filter((file) => file.endsWith('.md')).length,
    hookEvents: Object.keys(JSON.parse(readFileSync(path.join(plugin, 'hooks', 'hooks.json'), 'utf8')).hooks).length,
    scripts: scripts.length,
    lines: scripts.reduce((n, file) => n + readFileSync(path.join(plugin, 'scripts', file), 'utf8').trimEnd().split('\n').length, 0),
    dependencies: Object.keys(pkg.dependencies || {}).length,
    contextTokens: Math.round(startupChars(root) / 4),
  };
}

function hookRows() {
  return Object.entries(readJson('plugins', 'serio-focus', 'hooks', 'hooks.json').hooks)
    .flatMap(([event, entries]) => entries.flatMap((entry) => entry.hooks.map((handler) => {
      const script = (/scripts\/[a-z-]+\.mjs/.exec(handler.command) || [])[0];
      return `| \`${event}\` | \`${cell(entry.matcher || '*')}\` | \`${script}\` | Claude, Codex |`;
    })))
    .sort();
}

export function manifest() {
  const inv = inventory();
  return [
    '# Manifest',
    '',
    `<sub><b>Answers</b> · everything the plugin loads at version ${pluginVersion()} · generated, \`npm run upkeep\` rewrites it · <a href="../README.md">README</a></sub>`,
    '',
    '## Hooks', '',
    table(['Event', 'Matcher', 'Script', 'Native host'], hookRows()), '',
    '## Agents', '',
    table(['Agent', 'Tools', 'Description'], agents().map((agent) => `| \`${agent.name}\` | ${agent.tools} | ${cell(agent.description)} |`)), '',
    '## Skills', '',
    table(['Skill', 'Description'], skills().map((skill) => `| \`${skill.name}\` | ${cell(skill.description)} |`)), '',
    '## Inventory', '',
    table(['What ships', 'Count'], [
      `| Script lines | **${inv.lines}** across ${inv.scripts} files |`,
      `| Hook events | **${inv.hookEvents}** |`,
      `| Skills | **${inv.skills}** |`,
      `| Subagents | **${inv.agents}** |`,
      `| Startup context: card, agent and skill descriptions | **~${inv.contextTokens}** tokens |`,
      `| Third-party packages | **${inv.dependencies}** |`,
      '| Network calls, API keys, model calls | **0** |',
    ]), '',
  ].join('\n');
}
