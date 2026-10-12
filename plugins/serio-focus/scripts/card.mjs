#!/usr/bin/env node
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waveCap } from './lib/fan-out.mjs';
import { rootOf, stateDir, version } from './lib/runtime.mjs';

const STALE = [[/^\.wave-/, 864e5], [/^\.session-/, 30 * 864e5]];

export const card = () => `Serio Focus ${version()}: commit, push, git wipes and unsafe recursive deletes are held for the owner; at most ${waveCap()} direct subagents start per wave.`;

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
