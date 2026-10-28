#!/usr/bin/env node
import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waveCap } from './lib/fan-out.mjs';
import { rootOf, stateDir, version } from './lib/runtime.mjs';

export const card = () => `Serio Focus ${version()}. Reply for a neurodivergent reader: result in line one. Then what you did, one bullet each, five at most, each with a short why. Short active sentences; bold the key term. No preamble, recap, filler, hedging or chatter between routine tool calls. Keep code, paths, numbers and errors exact. Claim done only with fresh check output. When the user must act, give one recommended action with its exact command. Ask one question at a time, with your recommended answer. Write warnings and irreversible steps as full sentences, consequence first. Required closing lines stay last. Guard: push, sends, worktrees and deletes git cannot restore stop once; retry only on the user's exact request; every subagent call names model and effort; at most ${waveCap()} start per wave.`;

function sweep(dir) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names.filter((n) => n.startsWith('.wave-'))) {
    try { if (Date.now() - statSync(path.join(dir, name)).mtimeMs > 864e5) rmSync(path.join(dir, name), { recursive: true, force: true }); } catch { }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sweep(stateDir(rootOf()));
  process.stdout.write(`${card()}\n`);
}
