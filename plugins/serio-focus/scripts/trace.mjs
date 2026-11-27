#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = { input: 'input_tokens', output: 'output_tokens', cacheRead: 'cache_read_input_tokens', cacheWrite: 'cache_creation_input_tokens' };
const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const add = (to, from) => { for (const k in from) to[k] = (to[k] || 0) + from[k]; };

function read(file) {
  const out = { turns: 0, durationMs: 0, calls: {}, tokens: zero(), models: [], errors: [], denied: [], repeats: [] };
  const failed = [], refused = new Set(), turns = new Set(), uses = new Map(), counts = new Map(), stamps = [];
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
        if (row.toolDenialKind) { out.denied.push({ tool, input: input.slice(0, 200) }); refused.add(part.tool_use_id); }
        else failed.push([part.tool_use_id, { tool, input: input.slice(0, 200) }]);
      }
    }
    if (row?.type === 'result') for (const d of Array.isArray(row.permission_denials) ? row.permission_denials : []) {
      if (refused.has(d?.tool_use_id)) continue;
      refused.add(d?.tool_use_id);
      out.denied.push({ tool: d?.tool_name, input: JSON.stringify(d?.tool_input ?? null).slice(0, 200) });
    }
  }
  out.errors = failed.filter(([id]) => !refused.has(id)).map(([, e]) => e);
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
    for (const k of ['errors', 'denied', 'repeats']) out[k].push(...a[k]);
  }
  return { ...out, totals };
}

function selfTest() {
  const dir = mkdtempSync(path.join(tmpdir(), 'trace-')), file = path.join(dir, 't.jsonl'), ls = { command: 'ls' };
  try {
    writeFileSync(file, [
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'x1', name: 'Bash', input: ls }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x1', is_error: true, content: 'Permission for this action was denied' }] } },
      { type: 'result', permission_denials: [{ tool_name: 'Bash', tool_input: ls, tool_use_id: 'x1' }] },
    ].map((r) => JSON.stringify(r)).join('\n'));
    const got = trace(file);
    assert.deepEqual([got.errors, got.denied], [[], [{ tool: 'Bash', input: JSON.stringify(ls) }]], 'a refusal listed in permission_denials is a denial, not an error');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log('trace self-test: 1 check passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.argv.includes('--self-test') ? selfTest() : console.log(JSON.stringify(trace(process.argv[2])));
