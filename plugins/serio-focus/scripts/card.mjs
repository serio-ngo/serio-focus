#!/usr/bin/env node
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waveCap } from './lib/fan-out.mjs';
import { rootOf, stateDir, version } from './lib/runtime.mjs';

const STALE = [[/^\.wave-/, 864e5]];

export const card = () => `Serio Focus ${version()}. Reply for an ADHD reader: result in line one. Then what you did, one bullet each, five at most, each with a short why. Short active sentences; bold the key term. No preamble, recap, filler, hedging or chatter between routine tool calls. Keep code, paths, numbers and errors exact. When the user must act, give one recommended action with its exact command. Ask one question at a time, with your recommended answer. Write warnings and irreversible steps as full sentences, consequence first. Required closing lines stay last. Guard: deletes git cannot restore ask first; at most ${waveCap()} subagents start per wave.`;

function sweep(dir) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    const age = (STALE.find(([rx]) => rx.test(name)) || [])[1];
    try { if (age && Date.now() - statSync(path.join(dir, name)).mtimeMs > age) rmSync(path.join(dir, name), { recursive: true, force: true }); } catch { }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { }
  sweep(stateDir(rootOf(payload)));
  process.stdout.write(`${card()}\n`);
}
