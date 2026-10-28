import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PLUGIN, REPO, writeBlock } from './generate.mjs';

const INK = '#24292f';
const MUTED = '#57606a';
const HUE = { without: '#cf222e', with: '#0969da' };
const WASH = { without: '#ffebe9' };

const DEMO_OPEN = '<!-- serio-demo -->';
const DEMO_CLOSE = '<!-- /serio-demo -->';

const FONT = "system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const DOCS = (name) => path.join(REPO, 'docs', name);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" fill="${o.fill ?? INK}" font-size="${o.size ?? 12}"`
  + `${o.weight ? ` font-weight="${o.weight}"` : ''}`
  + `${o.cls ? ` class="${o.cls}"` : ''}>${esc(s)}</text>`;
const open = (w, h, label, family = FONT) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" font-family="${family}">`;
const file = (lines) => `${lines.join('\n')}\n`;

function wrap(line, max) {
  const out = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current && `${current} ${word}`.length > max) { out.push(current); current = word; } else current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out;
}

function probe() {
  const root = mkdtempSync(path.join(tmpdir(), 'serio-figure-'));
  const git = (...args) => spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q');
  mkdirSync(path.join(root, 'src', 'old-widget'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'old-widget', 'index.js'), 'export {};\n');
  git('add', '.');
  git('commit', '-qm', 'widget');

  const fire = (command) => {
    const run = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'guard.mjs')], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'demo', cwd: root, tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, SERIO_OS_DIR: root },
    });
    let decision = '';
    let reason = '';
    try {
      const out = JSON.parse(run.stdout || '').hookSpecificOutput || {};
      decision = out.permissionDecision || '';
      reason = out.permissionDecisionReason || '';
    } catch { }
    if (run.status !== 0) throw new Error(`guard exited ${run.status}: ${run.stderr}`);
    return { decision, verdict: reason };
  };

  const steps = [
    ['architect · plan: 2 tasks, each with its check'],
    ['tester · red: widget test fails as expected'],
    ['coder · Bash · rm -rf src/old-widget', ''],
    ['reviewer · verdict ready'],
    ['Bash · git push -u origin feat/drop-widget', 'deny'],
    ['Bash · rm -rf ~/notes', 'deny'],
  ].map(([label, want]) => {
    if (want === undefined) return { label };
    const { decision, verdict } = fire(label.split(' · ').at(-1));
    if (decision !== want) throw new Error(`demo row "${label}" got "${decision}", expected "${want}"`);
    return decision ? { label, verdict } : { label: `${label} ✓` };
  });
  const answer = [
    'Shipped: old widget removed, PR open.',
    '- src/old-widget deleted — tracked, git can restore it',
    '- push stopped once — runs only on your exact request',
    'Next: say "rm -rf ~/notes" to allow it — outside the repo, no undo.',
  ];
  const holds = readdirSync(path.join(root, 'audit')).reduce((n, name) => n + readFileSync(path.join(root, 'audit', name), 'utf8').trim().split('\n').length, 0);
  const receipt = `SERIO FOCUS · ${holds} hold${holds === 1 ? '' : 's'} written to the audit log`;
  rmSync(root, { recursive: true, force: true });
  return { steps, answer, receipt };
}

function demoSvg({ steps, answer, receipt } = probe()) {
  const WRAP = 100; const CH = 8.2;
  const FADE_IN = 0.3; const HOLD = 5; const FADE_OUT = 1; const BLANK = 0.5;
  const TYPE_AT = 0.8; const TYPE_LEN = 1.4;
  const prompt = '> /serio-focus:deliver drop the old widget and ship it';
  const rows = [{ text: '$ claude', fill: MUTED }, { text: prompt, typed: true, weight: 600, fill: INK }];
  for (const step of steps) {
    rows.push({ text: `⏺  ${step.label}`, fill: INK, weight: 600 });
    if (!step.verdict) continue;
    wrap(`?  ${step.verdict}`, WRAP)
      .forEach((line, i) => rows.push({ text: i ? `   ${line}` : line, fill: HUE.without, wash: i === 0 ? WASH.without : null, bar: i === 0 }));
  }
  answer.forEach((line, i) => rows.push({
    text: line.startsWith('-') ? `   ${line}` : line,
    fill: /^Next:/.test(line) ? HUE.with : INK,
    weight: i === 0 || /^Next:|^Step /.test(line) ? 600 : undefined,
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
  const alt = `serio-focus session: ${steps.map((s) => (s.verdict ? `${s.label} → ${s.verdict}` : s.label)).join(' · ')} · ${receipt}`;
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
  const demo = demoSvg();
  writeFileSync(DOCS('demo.svg'), demo.svg, 'utf8');
  out.push('wrote docs/demo.svg');
  out.push(writeBlock(path.join(REPO, 'README.md'), DEMO_OPEN, DEMO_CLOSE, [
    `<img src="docs/demo.svg" width="${demo.width}" alt="${esc(demo.alt)}">`,
  ]));
  return out;
}
