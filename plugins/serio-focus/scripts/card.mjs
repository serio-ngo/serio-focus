#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectOf, rootOf, sessionOf, sweep, update } from './lib/ledger.mjs';
import { BIG_FILE_BYTES, MAX_PER_WAVE, stallHold } from './lib/limits.mjs';
import { compact } from './lib/stats.mjs';
import { stall } from './lib/transcript.mjs';
import { rescued } from './rescue.mjs';

const { version } = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));

const FREEING = new Set(['compact', 'clear']);
function forgetReads(payload) {
  if (FREEING.has(String(payload.source || ''))) update(rootOf(payload), sessionOf(payload), (state) => { state.reads = {}; });
}

export function card(project) {
  const saved = project ? rescued(project).length : 0;
  const hold = stallHold();
  return `Serio Focus ${version} — session card
CAPS  ${MAX_PER_WAVE} subagents per wave · every agent() names a model · a workflow states // AGENTS: ${MAX_PER_WAVE}, or ${MAX_PER_WAVE}+1 for waves · reads over ${BIG_FILE_BYTES / 1024}KB trimmed or held${hold ? ` · dispatch and web held after ${compact(hold)} tok with no repo change` : ''} · git commit and push stay manual
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
