#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = { input: 'input_tokens', output: 'output_tokens', cacheRead: 'cache_read_input_tokens', cacheWrite: 'cache_creation_input_tokens' };
const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const add = (to, from) => { for (const k in from) to[k] = (to[k] || 0) + from[k]; };

function read(file) {
  const out = { turns: 0, durationMs: 0, calls: {}, tokens: zero(), models: [], errors: [], denied: [], repeats: [] };
  const turns = new Set(), uses = new Map(), counts = new Map(), stamps = [];
  let lines = [];
  try { lines = readFileSync(file, 'utf8').split(/\r?\n/); } catch { }
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const at = Date.parse(row?.timestamp);
    if (!Number.isNaN(at)) stamps.push(at);
    const msg = row?.message;
    if (row?.type === 'assistant' && msg?.id && !turns.has(msg.id)) {
      turns.add(msg.id);
      for (const k in KINDS) out.tokens[k] += msg.usage?.[KINDS[k]] || 0;
      if (msg.model && !out.models.includes(msg.model)) out.models.push(msg.model);
    }
    for (const part of Array.isArray(msg?.content) ? msg.content : []) {
      if (part?.type === 'tool_use' && !uses.has(part.id)) {
        const input = JSON.stringify(part.input ?? null);
        uses.set(part.id, { tool: part.name, input });
        out.calls[part.name] = (out.calls[part.name] || 0) + 1;
        const key = `${part.name}\n${input}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      } else if (part?.type === 'tool_result' && part.is_error && uses.has(part.tool_use_id)) {
        const { tool, input } = uses.get(part.tool_use_id);
        (row.toolDenialKind ? out.denied : out.errors).push({ tool, input: input.slice(0, 200) });
      }
    }
  }
  out.turns = turns.size;
  if (stamps.length) out.durationMs = stamps[stamps.length - 1] - stamps[0];
  for (const [key, times] of counts) {
    const [tool, input] = key.split('\n');
    if (times > 1) out.repeats.push({ tool, input: input.slice(0, 200), times });
  }
  return out;
}

export function trace(file) {
  const out = { ...read(file), agents: [] };
  const totals = { turns: out.turns, calls: { ...out.calls }, tokens: { ...out.tokens } };
  const id = /^agent-(.+)\.jsonl$/.exec(path.basename(String(file)))?.[1];
  let names = [];
  try { if (id) names = readdirSync(path.dirname(file)).filter((n) => /^agent-.+\.meta\.json$/.test(n)); } catch { }
  for (const name of names) {
    let meta;
    try { meta = JSON.parse(readFileSync(path.join(path.dirname(file), name), 'utf8')); } catch { continue; }
    if (meta?.parentAgentId !== id) continue;
    const a = read(path.join(path.dirname(file), name.replace(/\.meta\.json$/, '.jsonl')));
    out.agents.push({ type: meta.agentType, model: meta.model, turns: a.turns, calls: a.calls, tokens: a.tokens });
    totals.turns += a.turns;
    add(totals.calls, a.calls);
    add(totals.tokens, a.tokens);
  }
  return { ...out, totals };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(trace(process.argv[2])));
