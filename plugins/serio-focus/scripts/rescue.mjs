#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectOf, sessionOf } from './lib/ledger.mjs';
import { rescueDir } from './lib/runtime.mjs';
import { sessionSpend } from './lib/transcript.mjs';

export function rescued(project) {
  try { return readdirSync(rescueDir(project)).filter((name) => name !== '.gitignore'); } catch { return []; }
}

export function rescue(payload = {}) {
  const project = projectOf(payload);
  const files = sessionSpend(payload.transcript_path, project)?.outside || [];
  if (!files.length) return null;
  const dir = path.join(rescueDir(project), sessionOf(payload));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(rescueDir(project), '.gitignore'), '*\n');
  files.forEach((file, n) => {
    try { copyFileSync(file, path.join(dir, `${n + 1}-${path.basename(file)}`)); } catch { }
  });
  return dir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { rescue(JSON.parse(readFileSync(0, 'utf8'))); } catch { }
  process.exit(0);
}
