import { readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const configDir = () => process.env.SERIO_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
export const rootOf = (payload = {}) => process.env.SERIO_OS_DIR
  || process.env.SERIO_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
export const projectOf = (payload = {}) => process.env.SERIO_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
export const stateDir = (root) => path.join(root, '.claude');
export const ledgerPath = (root, session) => path.join(stateDir(root), `.session-${session}.json`);
export const waveDir = (root, session) => path.join(stateDir(root), `.wave-${session}`);
export const rescueDir = (project) => path.join(stateDir(project), 'rescue');
export const pluginRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const version = () => JSON.parse(readFileSync(path.join(pluginRoot(), '.claude-plugin', 'plugin.json'), 'utf8')).version;
