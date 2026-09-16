import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { REPO } from './generate.mjs';

export const bridgeFile = () => path.join(REPO, '.opencode', 'plugin', 'serio-focus.ts');

export const userConfigFile = () => {
  const dir = path.join(homedir(), '.config', 'opencode');
  const jsonc = path.join(dir, 'opencode.jsonc');
  return existsSync(jsonc) ? jsonc : path.join(dir, 'opencode.json');
};

export function stripJsonComments(text) {
  let out = '';
  let instr = false;
  let esc = false;
  let line = false;
  let block = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (instr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') instr = false;
      continue;
    }
    if (line) {
      if (c === '\n') { line = false; out += c; }
      continue;
    }
    if (block) {
      if (c === '*' && next === '/') { block = false; i += 1; }
      else if (c === '\n') out += c;
      continue;
    }
    if (c === '"') { instr = true; out += c; continue; }
    if (c === '/' && next === '/') { line = true; i += 1; continue; }
    if (c === '/' && next === '*') { block = true; i += 1; continue; }
    out += c;
  }
  return out;
}

export function readOpencodeConfig(file) {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  if (text.trim() === '') return {};
  const clean = file.endsWith('.jsonc') ? stripJsonComments(text) : text;
  try {
    const parsed = JSON.parse(clean);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('top level must be an object');
    return parsed;
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
}

export function withBridge(config, bridge) {
  const plugins = Array.isArray(config.plugin) ? [...config.plugin] : [];
  if (plugins.includes(bridge)) return { config, added: false };
  plugins.push(bridge);
  return { config: { ...config, plugin: plugins }, added: true };
}
