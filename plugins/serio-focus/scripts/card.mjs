#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, projectOf, rootOf, save, sessionOf, sweep } from './lib/ledger.mjs';
import { BIG_FILE_BYTES, MAX_PER_WAVE, stallHold } from './lib/limits.mjs';
import { compact } from './lib/stats.mjs';
import { stall } from './lib/transcript.mjs';
import { rescued } from './rescue.mjs';

const { version } = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));

const FREEING = new Set(['compact', 'clear']);
function forgetReads(payload) {
  if (!FREEING.has(String(payload.source || ''))) return false;
  const root = rootOf(payload);
  const session = sessionOf(payload);
  const state = load(root, session);
  if (!Object.keys(state.reads).length) return false;
  state.reads = {};
  save(root, session, state);
  return true;
}

export function card(project) {
  const saved = project ? rescued(project).length : 0;
  const hold = stallHold();
  return `Serio Focus ${version} — session card
CAPS  ${MAX_PER_WAVE} subagents per wave · reads over ${BIG_FILE_BYTES / 1024}KB trimmed or held${hold ? ` · dispatch and web held after ${compact(hold)} tok with no repo change` : ''} · git commit and push stay manual
SHAPE the focus output style shapes every reply${saved ? `\nRESCUE ${saved} session(s) ended on an API error. Next: read .claude/rescue/` : ''}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { }

  forgetReads(payload);
  stall(payload);
  sweep(rootOf(payload));
  process.stdout.write(`${card(projectOf(payload))}\n`);
  process.exit(0);
}
