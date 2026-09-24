import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configDir, pluginRoot, stateDir } from './runtime.mjs';

const MODEL_TIERS = /\b(?:haiku|sonnet|opus|fable)\b/i;
const FRONTMATTER_MODEL = /^model:\s*['"]?([\w.-]+)/m;

const definitionPaths = (subagent, cwd) => {
  if (subagent.includes(':')) return [path.join(pluginRoot(), 'agents', `${subagent.split(':').pop()}.md`)];
  return [
    path.join(stateDir(cwd), 'agents', `${subagent}.md`),
    path.join(configDir(), 'agents', `${subagent}.md`),
  ];
};

export function declaredModel(subagent, cwd = process.cwd()) {
  if (!subagent) return null;
  for (const file of definitionPaths(String(subagent), cwd)) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const tier = (FRONTMATTER_MODEL.exec(text) || [])[1] || '';
    return MODEL_TIERS.test(tier) ? tier.toLowerCase() : null;
  }
  return null;
}
