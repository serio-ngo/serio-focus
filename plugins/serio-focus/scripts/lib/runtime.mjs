import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootOf = () => process.env.SERIO_OS_DIR || process.env.CLAUDE_PLUGIN_DATA
  || process.env.PLUGIN_DATA || path.join(homedir(), '.serio-focus');
export const sessionOf = (payload = {}) => String(payload.session_id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '');
export const stateDir = (root) => path.join(root, '.claude');
export const waveDir = (root, session) => path.join(stateDir(root), `.wave-${session}`);
export const version = () => JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
