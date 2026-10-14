#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { append } from './audit.mjs';
import { rootOf, sessionOf } from './lib/runtime.mjs';

const WRITERS = /^(?:Write|Edit|MultiEdit|NotebookEdit)$/;

export function receipt(payload) {
  const out = { project: String(payload.cwd || ''), branch: '', title: '', calls: 0, tokens: 0, files: [] };
  const seen = new Set();
  let lines = [];
  try { lines = readFileSync(payload.transcript_path, 'utf8').split(/\r?\n/); } catch { }
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    out.title = row?.customTitle || out.title;
    out.branch = row?.gitBranch || out.branch;
    for (const part of Array.isArray(row?.message?.content) ? row.message.content : []) {
      const file = WRITERS.test(part.name) && (part.input?.file_path || part.input?.notebook_path);
      if (typeof file === 'string' && !out.files.includes(file)) out.files.push(file);
    }
    const usage = row?.type === 'assistant' && row.message?.usage;
    if (!usage || seen.has(row.message.id)) continue;
    seen.add(row.message.id);
    out.calls += 1;
    out.tokens += (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { }
  append(rootOf(payload), { session: sessionOf(payload), actor: 'main', action: 'session', result: receipt(payload) });
}
