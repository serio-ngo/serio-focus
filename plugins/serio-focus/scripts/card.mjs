#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectOf, rootOf, sessionOf, sweep, update } from './lib/ledger.mjs';
import { BIG_FILE_BYTES, waveCap } from './lib/limits.mjs';
import { NEAR } from './lib/quota.mjs';
import { version } from './lib/runtime.mjs';
import { stall } from './lib/transcript.mjs';
import { rescued } from './rescue.mjs';

const FREEING = new Set(['compact', 'clear']);
function forgetReads(payload) {
  if (FREEING.has(String(payload.source || ''))) update(rootOf(payload), sessionOf(payload), (state) => { state.reads = {}; });
}

export function card(project) {
  const saved = project ? rescued(project).length : 0;
  return `Serio Focus ${version()} — session card
CAPS ${waveCap()} direct agent calls per wave; ${BIG_FILE_BYTES / 1024}KB read budget; instruction files exempt; commit, push and unsafe deletes held.
${process.env.PLUGIN_ROOT ? 'SCOPE local native hooks; Claude quota inference and API-failure recovery are not supported here.' : `LIMIT usage note at ${NEAR}% after two observed limit hits; repository rules and native roles govern work.`}${saved && !process.env.PLUGIN_ROOT ? ` RESCUE ${saved} session(s) ended on an API error. Next: read .claude/rescue/` : ''}`;
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
