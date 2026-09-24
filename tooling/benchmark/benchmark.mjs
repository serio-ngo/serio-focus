#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { homedir } from 'node:os';
import { MODES } from './baselines.mjs';
import { BYTE_COUNTERS, COUNTERS } from '../../plugins/serio-focus/scripts/lib/ledger.mjs';
import { heldCount, kept, keptPct } from '../../plugins/serio-focus/scripts/lib/stats.mjs';
import { usage } from '../../plugins/serio-focus/scripts/lib/transcript.mjs';
import { compact, num, tok } from '../cli/format.mjs';
import { inventory, writeBlock } from '../cli/generate.mjs';

const flags = { write: false, eval: false, compare: false, latency: false, replay: false };
let REPO = process.cwd();
const REPOS = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--write') flags.write = true;
  else if (argv[i] === '--eval') flags.eval = true;
  else if (argv[i] === '--compare') flags.compare = true;
  else if (argv[i] === '--latency') flags.latency = true;
  else if (argv[i] === '--replay') flags.replay = true;
  else if (!argv[i].startsWith('--')) REPOS.push(path.resolve(argv[i]));
}
if (!REPOS.length) REPOS.push(REPO);
REPO = REPOS[0];

const share = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const rate = (a, t) => (t ? `${a}/${t} (${Math.round((a / t) * 100)}%)` : 'n/a');
const percent = (a, t) => (t ? Math.round((a / t) * 100) : 0);
const taxOf = (inv) => ({
  card: Math.round(inv.cardChars / 4),
  skills: Math.round(inv.skillChars / 4),
  agents: Math.round(inv.agentChars / 4),
  total: Math.round(inv.contextChars / 4),
});
const row = (label, value, extra = '') => console.log(`  ${label.padEnd(36)}${String(value).padStart(11)}${extra && `   ${extra}`}`);
const rule = (name, fired, effect) => console.log(`  ${name.padEnd(22)}${num(fired).padStart(6)}   ${effect}`);
const OWN = 'plugins/serio-focus/scripts/guard.mjs';
const ORIGINS = ['spec', 'probe', 'regression'];

const corpus = () => readFileSync(path.join(REPO, 'tooling', 'corpus', 'guard-corpus.jsonl'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

const payloadFor = (c, probe) => JSON.stringify({
  hook_event_name: 'PreToolUse',
  session_id: `eval-${String(c.id).replace(/[^A-Za-z0-9_-]/g, '')}`,
  cwd: probe,
  tool_name: c.tool,
  tool_input: c.input || {},
});

const wilson = (x, total) => {
  if (!total) return [0, 0];
  const z = 1.96;
  const p = x / total;
  const d = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt(((p * (1 - p) + (z * z) / (4 * total)) / total));
  return [Math.max(0, Math.floor(((centre - margin) / d) * 100)), Math.min(100, Math.ceil(((centre + margin) / d) * 100))];
};
const ci = ([lo, hi]) => `${lo}–${hi}%`;

function score(cmd, cases) {
  const probe = mkdtempSync(path.join(tmpdir(), 'serio-eval-'));
  const env = {
    ...process.env,
    SERIO_OS_DIR: probe,
    POLICY_FILE: path.join(REPO, 'tooling', 'settings', 'policy.json'),
  };
  const isHeld = (run) => {
    if (run.status === 2) return true;
    try { return ['ask', 'deny'].includes(JSON.parse(run.stdout || '').hookSpecificOutput?.permissionDecision); }
    catch { return false; }
  };
  const rows = cases.map((c) => {
    const run = spawnSync(cmd[0], cmd.slice(1), { input: payloadFor(c, probe), encoding: 'utf8', env });
    return { ...c, blocked: isHeld(run) };
  });
  const held = rows.filter((r) => !r.known_gap);
  const gaps = rows.filter((r) => r.known_gap);
  const n = (want, blocked) => held.filter((r) => r.want === want && r.blocked === blocked).length;
  const tp = n('block', true);
  const fn = n('block', false);
  const fp = n('allow', true);
  const tn = n('allow', false);
  const originStats = Object.fromEntries(ORIGINS.map((origin) => {
    const h = held.filter((r) => r.origin === origin);
    const hit = (want, blocked) => h.filter((r) => r.want === want && r.blocked === blocked).length;
    return [origin, { tp: hit('block', true), fn: hit('block', false), fp: hit('allow', true), tn: hit('allow', false) }];
  }));
  return {
    cases: rows.length,
    tp,
    fn,
    fp,
    tn,
    recall: percent(tp, tp + fn),
    precision: percent(tp, tp + fp),
    fpRate: percent(fp, fp + tn),
    f1: tp ? Number(((2 * tp) / (2 * tp + fp + fn)).toFixed(2)) : 0,
    recallCI: wilson(tp, tp + fn),
    fpRateCI: wilson(fp, fp + tn),
    originStats,
    gapsCaught: gaps.filter((r) => r.blocked).length,
    gapsTotal: gaps.length,
    misses: held.filter((r) => r.blocked !== (r.want === 'block')),
    gaps,
    origins: Object.fromEntries(ORIGINS.map((origin) => [origin, held.filter((r) => r.origin === origin).length])),
  };
}

const provenance = (origins) => `${origins.spec} of ${ORIGINS.reduce((sum, key) => sum + origins[key], 0)} scored `
  + `cases are \`spec\` (rule-derived), ${origins.probe} \`probe\`, ${origins.regression} \`regression\`; `
  + 'recall here is a regression check, not a detection rate.';

function mergeScores(root, patch) {
  const file = path.join(root, 'tooling', 'results', 'scores.json');
  let current = {};
  try { current = JSON.parse(readFileSync(file, 'utf8')); } catch { current = {}; }
  const next = { ...current, ...patch };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log('  wrote tooling/results/scores.json');
}

const ownCmd = () => (process.env.SERIO_EVAL_GUARD
  ? process.env.SERIO_EVAL_GUARD.split(/\s+/)
  : [process.execPath, path.join(REPO, OWN)]);

function latency(cases = 90) {
  const cmd = ownCmd();
  const probe = mkdtempSync(path.join(tmpdir(), 'serio-lat-'));
  const env = { ...process.env, SERIO_OS_DIR: probe };
  const shapes = [
    { id: 'lat-allow', tool: 'Bash', input: { command: 'git status' } },
    { id: 'lat-block', tool: 'Bash', input: { command: 'git commit -m x' } },
    { id: 'lat-mcp', tool: 'mcp__gmail__get_thread', input: { id: '1' } },
  ];
  const times = [];
  for (let i = 0; i < cases; i += 1) {
    const shape = shapes[i % shapes.length];
    const start = process.hrtime.bigint();
    spawnSync(cmd[0], cmd.slice(1), { input: payloadFor({ ...shape, id: `${shape.id}-${i}` }, probe), encoding: 'utf8', env });
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  times.sort((a, b) => a - b);
  const at = (f) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * f))]);
  return { samples: times.length, medianMs: at(0.5), p95Ms: at(0.95) };
}

function evalBlock(result, label) {
  return [
    `Run ${new Date().toISOString().slice(0, 10)} · ${result.cases} cases · guard \`${label}\` · ask = held.`, '',
    '| Metric | Value |', '|---|---|',
    `| Recall | ${rate(result.tp, result.tp + result.fn)} |`,
    `| Precision | ${rate(result.tp, result.tp + result.fp)} |`,
    `| False-positive rate | ${rate(result.fp, result.fp + result.tn)} |`,
    `| F1 | ${result.f1.toFixed(2)} |`,
    `| Recall 95% CI (Wilson) | ${ci(result.recallCI)} — n=${result.tp + result.fn} |`,
    `| FP-rate 95% CI (Wilson) | ${ci(result.fpRateCI)} — n=${result.fp + result.tn} |`,
    `| Recall by origin | ${ORIGINS.map((o) => `${o} ${rate(result.originStats[o].tp, result.originStats[o].tp + result.originStats[o].fn)}`).join(' · ')} |`,
    `| Known bypasses caught | ${rate(result.gapsCaught, result.gapsTotal)} |`, '',
    `Confusion: TP ${result.tp} · FN ${result.fn} · FP ${result.fp} · TN ${result.tn}. Bypasses scored apart.`, '',
    ...result.misses.map((m) => `- Miss \`${m.id}\`: got ${m.blocked ? 'block' : 'allow'}, want ${m.want}.`),
    ...result.gaps.map((m) => `- \`${m.id}\` ${m.blocked ? 'caught' : 'open'} — ${m.note}.`),
    '', provenance(result.origins),
  ];
}

function compareBlock(own, baselines) {
  const line = (name, s) => `| ${name} | ${s.recall}% | ${s.fpRate}% | ${s.f1.toFixed(2)} |`;
  return [
    `| Guard | Caught | Wrongly blocked | F1 |`, '|---|---|---|---|',
    ...Object.entries(baselines).map(([mode, s]) => line(MODES[mode], s)),
    line('**serio-focus**', own),
    '',
    `${own.cases} cases, ${new Date().toISOString().slice(0, 10)}; the comparators are mechanism baselines in `
    + '`tooling/benchmark/baselines.mjs`, not vendor code.',
    '', provenance(own.origins),
  ];
}

function run() {
  const cases = corpus();
  const label = process.env.SERIO_EVAL_GUARD || OWN;
  const own = score(ownCmd(), cases);

  const baselines = {};
  if (flags.compare) {
    for (const mode of Object.keys(MODES)) {
      baselines[mode] = score([process.execPath, path.join(REPO, 'tooling', 'benchmark', 'baselines.mjs'), mode], cases);
    }
  }
  const lat = flags.latency || flags.compare ? latency() : null;
  const tax = taxOf(inventory(REPO));

  console.log(`\n${evalBlock(own, label).join('\n')}\n`);
  if (flags.compare) console.log(`${compareBlock(own, baselines).join('\n')}\n`);
  console.log('  context tax — what the plugin itself costs the window');
  row('session card', `~${compact(tax.card)}`, 'tok   always in context');
  row('skill descriptions', `~${compact(tax.skills)}`, 'tok   always in context');
  row('agent descriptions', `~${compact(tax.agents)}`, 'tok   always in context');
  row('total footprint', `~${compact(tax.total)}`, 'tok   chars / 4, an estimate');
  if (lat) console.log(`  spawn ${lat.medianMs} ms median, ${lat.p95Ms} ms p95 over ${lat.samples} calls — machine-specific, not published\n`);

  if (flags.write) {
    console.log(`  ${writeBlock(path.join(REPO, 'docs', 'BENCHMARK.md'), '<!-- eval-results -->', '<!-- /eval-results -->', evalBlock(own, label))}`);
    if (flags.compare) {
      console.log(`  ${writeBlock(path.join(REPO, 'docs', 'BENCHMARK.md'), '<!-- guard-scores -->', '<!-- /guard-scores -->', compareBlock(own, baselines))}`);
      const inv = inventory(REPO);
      mergeScores(REPO, {
        generated: new Date().toISOString().slice(0, 10),
        version: JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')).version,
        cases: own.cases,
        taxTokens: tax.total,
        recall: own.recall,
        precision: own.precision,
        fpRate: own.fpRate,
        f1: own.f1,
        recallCI: own.recallCI,
        fpRateCI: own.fpRateCI,
        originRecall: Object.fromEntries(ORIGINS.map((o) => [o, percent(own.originStats[o].tp, own.originStats[o].tp + own.originStats[o].fn)])),
        confusion: { tp: own.tp, fn: own.fn, fp: own.fp, tn: own.tn },
        bypassesOpen: own.gapsTotal - own.gapsCaught,
        bypassesTotal: own.gapsTotal,
        origins: own.origins,
        logicLines: inv.logicLines,
        contextTokens: tax.total,
        dependencies: inv.dependencies,
        baselines: Object.fromEntries(Object.entries(baselines)
          .map(([mode, s]) => [mode, { recall: s.recall, fpRate: s.fpRate, f1: s.f1 }])),
      });
    }
  }
  return own.misses.length ? 1 : 0;
}

if (flags.eval || flags.compare || flags.latency) process.exit(run());

const transcriptDir = (root) => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'),
  'projects', root.replace(/[^A-Za-z0-9]/g, '-'));

const REPLAY_TOOLS = new Set(['Read', 'Bash']);
const REPLAY_RULES = [
  [/is unchanged and already in context/, 're-read dedup'],
  [/whole-file limit/, 'whole-file cap'],
  [/FAN-OUT CAP/, 'fan-out cap'],
  [/DISPATCH BUDGET/, 'dispatch budget'],
  [/stays manual/, 'git and delete lock'],
];

function replay(root) {
  const dir = transcriptDir(root);
  const out = { sessions: 0, calls: 0, judged: 0, blocked: 0, rules: {}, kept: 0, admitted: 0, fresh: 0, cacheRead: 0 };
  if (!existsSync(dir)) return out;
  const guard = path.join(root, OWN);
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const session = name.replace(/\.jsonl$/, '');
    const probe = mkdtempSync(path.join(tmpdir(), 'serio-replay-'));
    const env = { ...process.env, SERIO_OS_DIR: probe, CLAUDE_PROJECT_DIR: root };
    let seen = false;
    for (const line of readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/)) {
      if (!line) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const u = entry.message?.usage;
      if (u) {
        out.fresh += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
        out.cacheRead += u.cache_read_input_tokens || 0;
      }
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part?.type !== 'tool_use') continue;
        seen = true;
        out.calls += 1;
        if (!REPLAY_TOOLS.has(part.name)) continue;
        out.judged += 1;
        const run = spawnSync(process.execPath, [guard], {
          encoding: 'utf8',
          env,
          input: JSON.stringify({
            hook_event_name: 'PreToolUse',
            session_id: session,
            cwd: root,
            agent_type: entry.isSidechain ? 'serio-focus:scout' : 'main',
            tool_name: part.name,
            tool_input: part.input || {},
          }),
        });
        let held = run.status === 2;
        let reason = '';
        try {
          const decided = JSON.parse(run.stdout || '').hookSpecificOutput || {};
          if (decided.permissionDecision === 'deny' || decided.permissionDecision === 'ask') {
            held = true;
            reason = decided.permissionDecisionReason || '';
          }
        } catch { /* a plain allow carries no stdout */ }
        if (!held) continue;
        out.blocked += 1;
        const rule = (REPLAY_RULES.find(([rx]) => rx.test(reason)) || [null, 'other'])[1];
        out.rules[rule] = (out.rules[rule] || 0) + 1;
      }
    }
    if (seen) out.sessions += 1;
    const ledger = path.join(probe, '.claude', `.session-${session}.json`);
    if (!existsSync(ledger)) continue;
    const { saved } = JSON.parse(readFileSync(ledger, 'utf8'));
    out.kept += kept(saved);
    out.admitted += saved.read || 0;
  }
  return out;
}

const BYTES = new Set([...BYTE_COUNTERS, 'read']);
const zeroT = () => ({ ...Object.fromEntries(COUNTERS.map((key) => [key, 0])), fresh: 0, cacheRead: 0, turns: 0 });

function collect(root) {
  const auditDir = path.join(root, 'audit');
  const ledgers = existsSync(auditDir)
    ? readdirSync(auditDir).filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name)).sort()
      .map((name) => path.join(auditDir, name))
    : [];

  const t = zeroT();
  const billed = {};

  for (const file of ledgers) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line) continue;
      let entry;
      let saved;
      let real;
      try {
        entry = JSON.parse(line);
        if (entry.action !== 'read-budget') continue;
        saved = JSON.parse(entry.target);
        real = JSON.parse(entry.result);
      } catch { continue; }
      t.turns += 1;
      for (const key of COUNTERS) t[key] += BYTES.has(key) ? tok(saved[key] || 0) : Number(saved[key] || 0);
      billed[entry.session] = real;
    }
  }
  for (const real of Object.values(billed)) {
    t.fresh += Number(real.fresh || 0);
    t.cacheRead += Number(real.cacheRead || 0);
  }

  const billing = t.fresh
    ? { fresh: t.fresh, cacheRead: t.cacheRead, sessions: 0 }
    : fromTranscripts(root);
  t.fresh = billing.fresh;
  t.cacheRead = billing.cacheRead;
  return { t, billing };
}

const parts = REPOS.map(collect);
const t = zeroT();
const billing = { fresh: 0, cacheRead: 0, sessions: 0 };
for (const part of parts) {
  for (const key of Object.keys(t)) t[key] += part.t[key];
  billing.fresh += part.billing.fresh;
  billing.cacheRead += part.billing.cacheRead;
  billing.sessions += part.billing.sessions;
}

function fromTranscripts(root) {
  const dir = transcriptDir(root);
  const out = { fresh: 0, cacheRead: 0, sessions: 0 };
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const one = usage(path.join(dir, name));
    if (!one.turns) continue;
    out.sessions += 1;
    out.fresh += one.fresh;
    out.cacheRead += one.cacheRead;
  }
  return out;
}

const keptBytes = kept(t);
const readVolume = keptBytes + t.read;
const keptShare = keptPct(t);
const tax = taxOf(inventory(REPO));
const net = keptBytes - tax.total;
const resend = t.fresh ? t.cacheRead / t.fresh : 0;
const actions = heldCount(t);

console.log('\nserio-focus — context kept out of the main thread, all recorded ledger lines');
console.log(`  source: ${REPOS.length > 1 ? `${REPOS.length} repos` : 'audit/*.jsonl'}, ${t.turns} recorded ledger line(s)\n`);

row('read volume the session asked for', `~${compact(readVolume)}`, 'tok');
row('kept out', `~${compact(keptBytes)}`, `tok   ${keptShare}% of read volume`);
row('  re-read dedup', `~${compact(t.bytes)}`, 'tok   file was already in context, unchanged');
row('  whole-file cap', `~${compact(t.deferred)}`, 'tok   over 24KB, a slice or scout instead');
row('  trimmed', `~${compact(t.trimmed)}`, 'tok   cut from reads over 24KB');
row('admitted to the main thread', `~${compact(t.read)}`, `tok   ${100 - keptShare}% of read volume`);
row('read by subagents', `~${compact(t.offload)}`, 'tok   not counted as kept out');
console.log('  token counts above are file bytes / 4, an estimate, never billing');
console.log('\n  context tax — what the plugin itself costs the window');
row('session card', `~${compact(tax.card)}`, 'tok   always in context');
row('skill descriptions', `~${compact(tax.skills)}`, 'tok   always in context');
row('agent descriptions', `~${compact(tax.agents)}`, 'tok   always in context');
row('total footprint', `~${compact(tax.total)}`, 'tok   chars / 4, an estimate');
row('net kept out minus footprint', `~${compact(net)}`, 'tok   rot avoided less tax');

if (t.fresh) {
  console.log(`\n  real billing, measured${billing.sessions ? ` across ${billing.sessions} session transcript(s)` : ' from the ledger'}`);
  row('fresh tokens', num(t.fresh), 'tok   input + output + cache write');
  row('cache-read tokens', num(t.cacheRead), 'tok');
  row('context re-send ratio', `${resend.toFixed(1)}x`, 'cache mechanism, not the guard');
}

const REPLAY_OPEN = '<!-- serio-replay -->';
const REPLAY_CLOSE = '<!-- /serio-replay -->';
if (flags.replay) {
  const rs = REPOS.map((root) => replay(root));
  const r = {
    sessions: 0, calls: 0, judged: 0, blocked: 0, rules: {}, kept: 0, admitted: 0, fresh: 0, cacheRead: 0,
  };
  for (const one of rs) {
    r.sessions += one.sessions; r.calls += one.calls; r.judged += one.judged; r.blocked += one.blocked;
    r.kept += one.kept; r.admitted += one.admitted; r.fresh += one.fresh; r.cacheRead += one.cacheRead;
    for (const [name, count] of Object.entries(one.rules)) r.rules[name] = (r.rules[name] || 0) + count;
  }
  const pct = (part) => share(part, r.judged);
  const rules = Object.entries(r.rules).sort((a, b) => b[1] - a[1]);
  const scope = REPOS.length > 1 ? ` across ${REPOS.length} repos` : '';
  console.log(`\n  trace replay — ${num(r.judged)} judged call(s) from ${r.sessions} real session(s)${scope}`);
  row('refused', num(r.blocked), `${pct(r.blocked)}% of judged calls`);
  for (const [rule, count] of rules) row(`  ${rule}`, num(count), `${pct(count)}%`);
  row('bytes kept out', `~${compact(tok(r.kept))}`, 'tok');
  row('bytes admitted', `~${compact(tok(r.admitted))}`, 'tok');
  if (flags.write) {
    console.log(`  ${writeBlock(path.join(REPO, 'docs', 'BENCHMARK.md'), REPLAY_OPEN, REPLAY_CLOSE, [
      `| The maintainer's ${num(r.sessions)} session${r.sessions === 1 ? '' : 's'}${scope} — run it on yours | Count | Share of judged |`,
      '|---|---|---|',
      `| Tool calls recorded | ${num(r.calls)} | — |`,
      `| Judged by the guard | ${num(r.judged)} | 100% |`,
      `| **Refused** | **${num(r.blocked)}** | **${pct(r.blocked)}%** |`,
      ...rules.map(([rule, count]) => `| — ${rule} | ${num(count)} | ${pct(count)}% |`),
      '',
      'Every `Read` and `Bash` call from this machine\'s Claude Code transcripts, re-fed '
      + 'to the guard in order, one sandbox per session. Open-loop: a refusal cannot change what the '
      + 'agent did next, so this is what the guard catches on that exact stream, not a counterfactual. '
      + 'Reproduce with `npm run benchmark:replay`.',
    ])}`);
  }
}

console.log('\n  guard actions');
rule('re-read dedup', t.rereads, 'a byte-identical file already in context');
rule('deferred to slice or scout', t.slices, 'over the 24KB whole-file cap');
rule('trimmed reads', t.rewrites, 'first 24KB admitted, rest kept out');
rule('subagent dispatch', t.agents, 'reading moved off the main thread');
rule('scout used', t.scouts, 'a lookup answered off-thread');
rule('runner used', t.runners, 'a verdict back, never the log');
rule('redirected to a cheaper tier', t.redirects, 'dispatch budget');
rule('capped waves', t.waves, 'fan-out cap');
rule('blocked', t.blocked, 'git and delete lock, dispatch budget, fan-out cap');
console.log();

const OPEN = '<!-- serio-stats -->';
const CLOSE = '<!-- /serio-stats -->';
const statsBlock = () => {
  if (!actions) return ['No ledger lines recorded yet. Method: docs/BENCHMARK.md.'];
  return [
    `| Measured over ${num(t.turns)} ledger lines | Tokens | Share |`,
    '|---|---|---|',
    `| Read volume the session asked for | ~${compact(readVolume)} | 100% |`,
    `| **Kept out** | **~${compact(keptBytes)}** | **${keptShare}%** |`,
    `| — re-read dedup | ~${compact(t.bytes)} | ${share(t.bytes, readVolume)}% |`,
    `| — whole-file cap | ~${compact(t.deferred)} | ${share(t.deferred, readVolume)}% |`,
    `| — trimmed | ~${compact(t.trimmed)} | ${share(t.trimmed, readVolume)}% |`,
    `| Admitted to the main thread | ~${compact(t.read)} | ${100 - keptShare}% |`,
    `| Read by subagents, not counted as kept out | ~${compact(t.offload)} | — |`,
    '',
    `| Context tax — the plugin's own footprint | Tokens |`,
    '|---|---|',
    `| Session card, always in context | ~${compact(tax.card)} |`,
    `| Skill descriptions, always in context | ~${compact(tax.skills)} |`,
    `| Agent descriptions, always in context | ~${compact(tax.agents)} |`,
    `| **Total footprint** | **~${compact(tax.total)}** |`,
    '| Per turn, on top of that | **0** |',
    `| **Net kept out minus footprint** | **~${compact(net)}** |`,
    '',
    ...(t.fresh ? [
      `| Measured billing${billing.sessions ? `, ${billing.sessions} session transcripts` : ''} | Tokens |`,
      '|---|---|',
      `| Fresh — input + output + cache write | ${num(t.fresh)} |`,
      `| Cache-read | ${num(t.cacheRead)} |`,
      `| **Context re-send ratio** | **${resend.toFixed(1)}×** — cache mechanism, not the guard |`,
      '',
    ] : []),
    `Guard actions: ${num(actions)}${t.scouts || t.runners ? ` (used ${num(t.scouts)} scout, ${num(t.runners)} runner)` : ''}. Token counts are file bytes / 4 from this repo's own local `
    + 'ledger, an estimate; the billing figures are measured. Method: [Billing](#billing--measured-not-estimated).',
  ];
};

if (flags.write) {
  console.log(`  ${writeBlock(path.join(REPO, 'docs', 'BENCHMARK.md'), OPEN, CLOSE, statsBlock())}`);
  mergeScores(REPO, {
    keptPct: keptShare,
    keptTokens: keptBytes,
    readVolumeTokens: readVolume,
    offloadTokens: t.offload,
    taxTokens: tax.total,
    repos: REPOS.length,
    resendRatio: Number(resend.toFixed(1)),
    ledgerTurns: t.turns,
  });
}
