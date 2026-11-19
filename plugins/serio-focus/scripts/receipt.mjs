#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { append } from './audit.mjs';
import { trace } from './trace.mjs';
import { rootOf, sessionOf } from './lib/runtime.mjs';

const WRITERS = /^(?:Write|Edit|MultiEdit|NotebookEdit)$/;

export function receipt(payload) {
  const out = { project: String(payload.cwd || ''), branch: '', title: '', calls: 0, tokens: 0, files: [] };
  const pending = new Map();
  const ok = new Set();
  let lines = [];
  try { lines = readFileSync(payload.transcript_path, 'utf8').split(/\r?\n/); } catch { }
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    out.title = row?.customTitle || out.title;
    out.branch = row?.gitBranch || out.branch;
    for (const part of Array.isArray(row?.message?.content) ? row.message.content : []) {
      if (part?.type === 'tool_result') {
        if (!part.is_error) ok.add(part.tool_use_id);
        continue;
      }
      const file = WRITERS.test(part?.name) && (part.input?.file_path || part.input?.notebook_path);
      if (typeof file === 'string' && !pending.has(part.id)) pending.set(part.id, file);
    }
  }
  const t = trace(payload.transcript_path);
  out.calls = t.turns;
  out.tokens = Object.values(t.tokens).reduce((a, b) => a + b, 0);
  for (const [id, file] of pending) if (ok.has(id) && !out.files.includes(file)) out.files.push(file);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { }
  const result = receipt(payload);
  if (result.calls) append(rootOf(), { session: sessionOf(payload), actor: 'main', action: 'session', result });
}
