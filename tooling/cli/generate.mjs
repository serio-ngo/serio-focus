import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (frontmatter || fence || FENCE.test(line)) {
      if (frontmatter) { if (i > 0 && line === '---') frontmatter = false; }
      else if (FENCE.test(line)) fence = !fence;
      out.push(line);
      continue;
    }
    const previous = out.at(-1) ?? '';
    const next = lines[i + 1];
    if (!line.trim() && out.length && !previous.trim()) continue;
    const heading = HEADING.test(line);
    const list = LIST_ITEM.test(line);
    if (previous.trim() && (heading || (list && !LIST_ITEM.test(previous) && !/^\s+\S/.test(previous)))) out.push('');
    out.push(line.trim() ? line : '');
    if ((heading && next !== undefined && next.trim())
      || (list && !(next !== undefined && (LIST_ITEM.test(next) || /^\s+\S/.test(next) || !next.trim())))) out.push('');
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

const documents = (root, folder, pattern) => {
  const dir = path.join(root, 'plugins', 'serio-focus', folder);
  return walk(dir).filter((file) => pattern.test(file)).map((file) => {
    const [, head = '', body = ''] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n')) || [];
    const field = (key) => (new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(head) || [])[1] || '';
    return { dir: path.dirname(file), name: field('name'), description: field('description'), tools: field('tools'), manual: field('disable-model-invocation') === 'true', body: body.trim() };
  }).sort((a, b) => (a.name < b.name ? -1 : 1));
};

export const skills = (root = REPO) => documents(root, 'skills', /(?:^|\/)SKILL\.md$/);
export const agents = (root = REPO) => documents(root, 'agents', /\.md$/);

export const startupChars = (root = REPO) => card().length
  + [...skills(root), ...agents(root)].filter((doc) => !doc.manual).reduce((n, doc) => n + doc.name.length + doc.description.length, 0);

export const codexRoles = (root = REPO) => agents(root).map((agent) => {
  const head = `name = "serio-${agent.name}"\ndescription = ${JSON.stringify(agent.description)}\n`;
  const body = `developer_instructions = '''\n${agent.body}\n'''\n`;
  return { file: `serio-${agent.name}.toml`, text: head + body,
    legacy: head + (/\b(?:Edit|Write)\b/.test(agent.tools) ? '' : 'sandbox_mode = "read-only"\n') + body };
});

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
