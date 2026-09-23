import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { deniedSubagentRx } from './dispatch.mjs';

const WRITERS = /^(?:Write|Edit|MultiEdit|NotebookEdit)$/;

export function scan(file) {
  const out = { fresh: 0, cacheRead: 0, turns: 0, top: false, writes: [] };
  let lines = [];
  try { lines = readFileSync(file, 'utf8').split(/\r?\n/); } catch { return out; }
  const top = deniedSubagentRx();
  const seen = new Set();
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const message = entry?.type === 'assistant' ? entry.message : null;
    if (!message) continue;
    for (const part of Array.isArray(message.content) ? message.content : []) {
      const target = WRITERS.test(part.name) && (part.input?.file_path || part.input?.notebook_path);
      if (typeof target === 'string') out.writes.push(target);
    }
    const u = message.usage;
    if (!u || seen.has(message.id)) continue;
    if (message.id) seen.add(message.id);
    out.turns += 1;
    out.fresh += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
    out.cacheRead += u.cache_read_input_tokens || 0;
    out.top ||= top.test(String(message.model || ''));
  }
  return out;
}

export function usage(file) {
  const { fresh, cacheRead, turns } = scan(file);
  return { fresh, cacheRead, turns };
}

const norm = (value) => path.resolve(value).replace(/\\/g, '/').toLowerCase();
const inside = (file, root) => norm(file) === norm(root) || norm(file).startsWith(`${norm(root)}/`);

export function sessionSpend(file, project) {
  if (!file || !existsSync(file)) return null;
  const dir = path.join(file.replace(/\.jsonl$/i, ''), 'subagents');
  let names = [];
  try { names = readdirSync(dir, { recursive: true }).map(String).filter((name) => /agent-[^\\/]*\.jsonl$/.test(name)); } catch { }
  const agents = names.map((name) => scan(path.join(dir, name)));
  const all = [scan(file), ...agents];
  const writes = [...new Set(all.flatMap((s) => s.writes))];
  return {
    fresh: all.reduce((sum, s) => sum + s.fresh, 0),
    cacheRead: all.reduce((sum, s) => sum + s.cacheRead, 0),
    agents: agents.length,
    topAgents: agents.filter((s) => s.top).length,
    edits: writes.filter((w) => inside(w, project)).length,
    outside: writes.filter((w) => !inside(w, project)),
  };
}
