import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { load } from '../../plugins/serio-focus/scripts/lib/ledger.mjs';
import { compact, sessionLine } from '../../plugins/serio-focus/scripts/lib/stats.mjs';
import { BIG_FILE_BYTES, MAX_PER_WAVE, stallHold } from '../../plugins/serio-focus/scripts/lib/limits.mjs';
import { PLUGIN, REPO, readJson, writeBlock } from './generate.mjs';

const INK = '#24292f';
const MUTED = '#57606a';
const HUE = { without: '#cf222e', with: '#0969da' };
const WASH = { without: '#ffebe9', with: '#ddf4ff' };
const DEMO_AGENTS = 100;
const DEMO_FILE_BYTES = 35 * 1024;
const DEMO_LINE_BYTES = 64;

const DEMO_OPEN = '<!-- serio-demo -->';
const DEMO_CLOSE = '<!-- /serio-demo -->';

const FONT = "system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const DOCS = (name) => path.join(REPO, 'docs', name);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const width = (s, size) => s.length * size * 0.7;

const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" fill="${o.fill ?? INK}" font-size="${o.size ?? 12}"`
  + `${o.weight ? ` font-weight="${o.weight}"` : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.family ? ` font-family="${o.family}"` : ''}`
  + `${o.cls ? ` class="${o.cls}"` : ''}>${esc(s)}</text>`;
const open = (w, h, label, family = FONT) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" font-family="${family}">`;
const file = (lines) => `${lines.join('\n')}\n`;


function tiles(scores = readJson('tooling', 'results', 'scores.json')) {
  return {
    stops: [
      [String(MAX_PER_WAVE), 'subagents per wave'],
      [`${Math.round(BIG_FILE_BYTES / 1024)} KB`, 'whole-file read cap'],
      ['commit · push', 'git writes held to final state'],
      [`${compact(stallHold())} tok`, 'dispatch held, no repo change'],
    ],
    wins: [
      [`${scores.keptPct}%`, 'read volume kept out'],
      [`${scores.recall}%`, 'corpus recall'],
      [`${scores.fpRate}%`, 'false positives'],
    ],
    cost: [
      [`${scores.contextTokens} tok`, 'context footprint'],
      ['Cowork', 'hooks do not fire'],
      ['OpenCode', 'subagents bypass the guard'],
    ],
  };
}

function tileRow(items) {
  const W = 720; const H = 92; const gap = 16;
  const w = (W - gap * (items.length - 1)) / items.length;
  const alt = items.map(([value, label]) => `${value} ${label}`).join('; ');
  return file([
    open(W, H, alt),
    ...items.flatMap(([value, label], i) => {
      const x = i * (w + gap);
      return [
        `<rect x="${x + 0.5}" y="0.5" width="${w - 1}" height="${H - 1}" rx="8" fill="#ffffff" stroke="#d0d7de"/>`,
        `<rect x="${x + 16}" y="22" width="3" height="48" rx="1.5" fill="${HUE.with}"/>`,
        text(x + 30, 50, value, { size: 26, weight: 700 }),
        text(x + 30, 71, label, { size: 12 }),
      ];
    }),
    '</svg>',
  ]);
}

function wrap(line, max) {
  const out = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current && `${current} ${word}`.length > max) { out.push(current); current = word; } else current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out;
}

// every demo verdict is this guard's own deny reason or rewrite reason, captured live —
// except the last row, which quotes the focus output style verbatim
function probe() {
  const root = mkdtempSync(path.join(tmpdir(), 'serio-figure-'));
  const big = path.join(root, 'src', 'big.js');
  mkdirSync(path.dirname(big), { recursive: true });
  writeFileSync(big, `${'x'.repeat(DEMO_LINE_BYTES - 1)}\n`.repeat(DEMO_FILE_BYTES / DEMO_LINE_BYTES), 'utf8');

  const fire = (tool_name, tool_input, { session = 'demo', agent_type } = {}) => {
    const run = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'guard.mjs')], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: session, cwd: root, tool_name, tool_input, agent_type }),
      encoding: 'utf8',
      env: { ...process.env, SERIO_OS_DIR: root, SERIO_GIT_WRITE: '0' },
    });
    let decision = '';
    let reason = '';
    try {
      const out = JSON.parse(run.stdout || '').hookSpecificOutput || {};
      decision = out.permissionDecision || '';
      reason = out.permissionDecisionReason || '';
    } catch { /* a plain allow carries no stdout */ }
    if (run.status === 2 || decision === 'deny' || decision === 'ask') return { blocked: true, verdict: reason || run.stderr.trim() };
    if (run.status !== 0) throw new Error(`guard exited ${run.status}: ${run.stderr}`);
    return { blocked: false, verdict: reason };
  };

  const steps = [
    [`Workflow · ${DEMO_AGENTS} agents`, 'Workflow', { script: `// AGENTS: ${DEMO_AGENTS}\nawait parallel(mods.map((m) => () => agent(m, { model: 'haiku' })))` }],
    ['Read src/big.js · 35 KB', 'Read', { file_path: big }],
    ['Bash · `git commit -m "wip"`', 'Bash', { command: 'git commit -m "wip"' }],
  ].map(([label, tool, input]) => ({ label, ...fire(tool, input) }));
  const answer = [
    'Audit docs — fix 3 links',
    '- fixed 3 anchors · docs/BENCHMARK.md:12',
    '- held git commit to final state · listed exact command',
    'Next: run npm run upkeep',
    'Step 2 of 5',
  ];

  const receipt = sessionLine(load(root, 'demo'));
  rmSync(root, { recursive: true, force: true });
  return { steps, answer, receipt };
}

function demoSvg({ steps, answer, receipt } = probe()) {
  const WRAP = 100; const CH = 8.2;
  const FADE_IN = 0.3; const HOLD = 5; const FADE_OUT = 1; const BLANK = 0.5;
  const TYPE_AT = 0.8; const TYPE_LEN = 1.4;
  const prompt = '> audit docs and hold the commit.';
  const rows = [{ text: '$ claude', fill: MUTED }, { text: prompt, typed: true, weight: 600, fill: INK }];
  for (const step of steps) {
    rows.push({ text: `⏺  ${step.label}`, fill: INK, weight: 600 });
    if (!step.verdict) continue;
    const hue = step.blocked ? HUE.without : HUE.with;
    const wash = step.blocked ? WASH.without : WASH.with;
    wrap(`${step.blocked ? '⨯' : '↻'}  ${step.verdict}`, WRAP)
      .forEach((line, i) => rows.push({ text: i ? `   ${line}` : line, fill: hue, wash: i === 0 ? wash : null, bar: i === 0 }));
  }
  rows.push({ text: '⏺  Answer · focus style', fill: INK, weight: 600 });
  answer.forEach((line, i) => rows.push({
    text: line.startsWith('-') ? `   ${line}` : line,
    fill: /^Next:/.test(line) ? HUE.with : INK,
    weight: i === 0 || /^Next:|^Step /.test(line) ? 600 : undefined,
    wash: i === 0 ? null : null,
    bar: false,
  }));
  receipt.split('\n').forEach((line, i) => rows.push({ text: line, fill: MUTED, weight: i ? undefined : 600, box: i === 0 }));

  const y0 = 60; const step = 24;
  const H = y0 + rows.length * step + 30;
  const W = Math.max(720, Math.ceil(Math.max(...rows.map((r) => r.text.length)) * CH) + 52);
  const body = [];
  let at = 0.2;
  rows.forEach((row, i) => {
    row.at = at;
    at += row.typed ? 1.8 : row.bar === undefined ? 0.5 : 0.35;
    const y = y0 + i * step;
    const cls = `row d${i}`;
    if (row.box) body.push(`<rect class="${cls}" x="14" y="${y - 17}" width="${W - 28}" height="${(rows.length - i) * step + 6}" rx="4" fill="none" stroke="#d0d7de"/>`);
    if (row.bar) {
      const span = rows.slice(i).findIndex((next, n) => n > 0 && next.bar !== false);
      const wash = row.wash ?? row.fill;
      body.push(`<rect class="${cls}" x="14" y="${y - 16}" width="${W - 28}" height="${(span < 0 ? rows.length - i : span) * step - 2}" rx="4" fill="${wash}" stroke="${row.fill}" stroke-opacity=".45"/>`);
    }
    if (row.typed) {
      body.push(`<clipPath id="t"><rect class="typed" x="22" y="${y - 14}" height="18"/></clipPath>`);
      body.push(`<g class="${cls}" clip-path="url(#t)">${text(22, y, row.text, { weight: row.weight, fill: row.fill })}</g>`);
    } else body.push(text(22, y, row.text, { weight: row.weight, fill: row.fill, cls }));
  });
  const last = rows.length - 1;
  // one shared loop: every row fades in on its cue, all rows fade out together,
  // the screen rests blank, then the loop restarts — a delay alone would not
  // resync, since CSS animation-delay applies only before the first iteration
  const loop = Math.ceil(at + HOLD + FADE_OUT + BLANK);
  const pct = (s) => Math.round((Math.min(Math.max(s, 0), loop) / loop) * 1000) / 10;
  const keys = rows.map((row, i) => {
    const vis = Math.min(row.at + FADE_IN, loop - FADE_OUT);
    return `@keyframes k${i}{0%{opacity:0;transform:translateY(4px)}${pct(row.at)}%{opacity:0;transform:translateY(4px)}`
      + `${pct(vis)}%{opacity:1;transform:translateY(0)}${pct(loop - FADE_OUT)}%{opacity:1;transform:translateY(0)}`
      + `${pct(loop - BLANK)}%{opacity:0}100%{opacity:0}}`;
  }).join('');
  const cues = rows.map((row, i) => `.d${i}{animation:k${i} ${loop}s infinite both}`).join('');
  const typeW = Math.ceil(prompt.length * CH);
  const alt = `serio-focus session: ${steps.map((s) => (s.verdict ? `${s.label} → ${s.verdict}` : `${s.label}, allowed`)).join(' · ')} · ${receipt}`;
  return { width: W, alt, svg: file([
    open(W, H, alt, MONO),
    '<style>',
    'text{font-size:13.5px;white-space:pre}',
    '.row{opacity:0}',
    keys,
    `@keyframes type{0%{width:0}${pct(TYPE_AT)}%{width:0}${pct(TYPE_AT + TYPE_LEN)}%{width:${typeW}px}100%{width:${typeW}px}}`,
    '@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}',
    `.typed{animation:type ${loop}s steps(${prompt.length}) infinite}`,
    '.cursor{animation:blink 1s steps(1) infinite}',
    cues,
    '</style>',
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="#ffffff" stroke="#d0d7de"/>`,
    `<path d="M0 34 H${W}" stroke="#d0d7de"/>`,
    text(22, 22, '— serio-focus session', { size: 11.5, fill: MUTED }),
    ...body,
    `<g class="row d${last}"><rect class="cursor" x="${22 + Math.ceil(rows[last].text.length * CH) + 6}" y="${y0 + last * step - 11}" width="7" height="13" fill="${HUE.with}"/></g>`,
    '</svg>',
  ]) };
}

export function writeFigures() {
  const out = [];
  for (const [name, items] of Object.entries(tiles())) {
    writeFileSync(DOCS(`tiles-${name}.svg`), tileRow(items), 'utf8');
    out.push(`wrote docs/tiles-${name}.svg`);
  }
  const demo = demoSvg();
  writeFileSync(DOCS('demo.svg'), demo.svg, 'utf8');
  out.push('wrote docs/demo.svg');
  out.push(writeBlock(path.join(REPO, 'README.md'), DEMO_OPEN, DEMO_CLOSE, [
    `<img src="docs/demo.svg" width="${demo.width}" alt="${esc(demo.alt)}">`,
  ]));
  return out;
}
