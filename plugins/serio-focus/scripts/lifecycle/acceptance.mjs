#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCKED } from './lock.mjs';
import { all, flag, one, ownersOf, raw, repoOf, runLink, send, specComment, specOf, taskOf } from '../lib/lifecycle.mjs';

const text = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const cell = (s) => s.replace(/[|\r\n<>]/g, ' ').slice(0, 120);
const CONFIG = /^\.github\/|(^|\/)(?:CODEOWNERS|package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|\.[^/]*rc(?:\.[a-z]+)?|[^/]*\.config\.[^/]+)$|(^|\/)\.husky\//;
const GATE = new RegExp(`${CONFIG.source}|(^|\\/)scripts?\\/`);
const production = (f) => !LOCKED.test(f) && !CONFIG.test(f) && !/\.md$/i.test(f);

const LOAD = /Failed to load url|Cannot find module|ERR_MODULE_NOT_FOUND|does not provide an export named/;

export const cases = (xml) => [...xml.matchAll(/<testcase\b((?:[^>"]|"[^"]*")*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map(([, attrs, inner = '']) => ({
  name: text(/\bname="([^"]*)"/.exec(attrs)?.[1] || ''),
  result: /<(failure|error)\b/.test(inner) ? LOAD.test(inner) ? 'load error' : 'failed' : /<skipped\b/.test(inner) ? 'skipped' : 'passed',
}));

const mapping = (body) => new Map([...String(body || '').matchAll(/^\| AC(\d+) \| .* \| (?:unit|e2e) \| `([^`]+)` \|$/gm)].map(([, n, test]) => [Number(n), test]));

const APP = (f) => production(f) && /(^|\/)(src|app)\//.test(f) && !/(^|\/)(src|app)\/(.+\/)?content\//.test(f) && !/\.(mdx|json|css|scss)$/i.test(f);
const root = (f) => /^(?:.*?\/)?(?:src|app)\//.exec(f)[0];
const NAMESPACE = /(^|\.)(w3\.org|schema\.org|sitemaps\.org|schemas\.android\.com)$/;
const strings = (text) => [...text.matchAll(/["'`}](\/\w[^\s,"'`$?#)]*)(?=["'`$?#)])|(https?:\/\/([^\s"'`\/$?#)]+))/g)].flatMap(([, p, o, host]) => p ? /\.\w+$/.test(p.split('/').at(-1)) ? [] : [`/${p.split('/').filter(Boolean).slice(0, 2).join('/')}`] : NAMESPACE.test(host) ? [] : [o]);
const routes = (repeats) => repeats.length ? [`Routes in two or more files: ${repeats.map(([s, fs]) => `\`${cell(s)}\` in ${fs.map((f) => `\`${cell(f)}\``).join(', ')}`).join('; ')}`] : [];

const outcome = (tests, name) => {
  const mine = name ? tests.filter((t) => t.name === name) : [];
  return !mine.length ? 'missing' : mine.find((t) => t.result !== 'passed')?.result || 'passed';
};

export function report({ review = '', tests, sha, lock = '', link = '', files = [], size = '', free = [], skipped = [], fails = [], without, repeats = [] }) {
  const spec = specOf(review), ac = spec?.ac || [], map = mapping(review);
  const rows = ac.map((n) => ({ n, name: map.get(n) ? cell(map.get(n)) : '-', result: outcome(tests, map.get(n)) }));
  const kept = without ? ac.filter((n) => outcome(without, map.get(n)) === 'passed') : [];
  const notes = [...fails, ...kept.length ? [`Passes without the change: ${kept.map((n) => `AC${n}`).join(', ')}`] : [], ...routes(repeats)];
  const ok = (ac.length > 0 || spec?.verdict === 'ready') && rows.every((r) => r.result === 'passed') && !notes.length;
  const body = [
    `**Acceptance: ${ok ? 'pass' : 'fail'}** for \`${sha.slice(0, 7)}\`${lock ? ` · test lock: ${cell(lock)}` : ''}`, '',
    ...(rows.length ? ['| Criterion | Test | Result |', '|---|---|---|'] : ['No criteria: the review names review checks only.']),
    ...rows.map((r) => `| AC${r.n} | ${r.name} | ${r.result} |`),
    ...notes.flatMap((l) => ['', l]),
    ...(size || files.length ? ['', `Changed: ${size} · gate files: ${files.filter((f) => GATE.test(f)).map((f) => `\`${cell(f)}\``).join(', ') || 'none'}`] : []),
    ...(free.length ? ['', `Changes no test needs: ${free.map((f) => `\`${cell(f)}\``).join(', ')}`] : []),
    ...(skipped.length ? ['', `Not reverted in time: ${skipped.map((f) => `\`${cell(f)}\``).join(', ')}`] : []),
    ...(link ? ['', `Run and e2e traces: ${link}`] : []), '', `<!-- acceptance v1 sha=${sha} -->`,
  ].join('\n');
  return { ok, body };
}

function selfTest() {
  const spec = (rows, ac) => `${rows}\n\n<!-- spec-review v1 sha=abcdef123456 verdict=ready ac=${ac} -->`;
  const junit = '<testsuites><testsuite><testcase name="sum adds two numbers" time="0.1"/><testcase name="Add shows 2 =&gt; &quot;5&quot;" classname="e2e"><system-out>x</system-out></testcase></testsuite></testsuites>';
  const review = spec('| AC1 | Given 2 \\| 3, When x | unit | `sum adds two numbers` |\n| AC2 | Given a | e2e | `Add shows 2 => "5"` |', '1,2');
  const pass = report({ review, tests: cases(junit), sha: 'abcdef123456' });
  assert.equal(pass.ok, true); assert.match(pass.body, /\| AC1 \| sum adds two numbers \| passed \|\n\| AC2 \| Add shows 2 = {2}"5" \| passed \|/);  const changed = (files) => report({ review, tests: cases(junit), sha: 'abcdef1', size: '+3 −1 in 2 files', files }).body;
  assert.match(changed(['src/a.mjs', '.github/workflows/ci.yml', 'scripts/x.sh']), /\nChanged: \+3 −1 in 2 files · gate files: `\.github\/workflows\/ci\.yml`, `scripts\/x\.sh`\n/);
  assert.match(changed(['CODEOWNERS', '.eslintrc.json', '.husky/pre-commit', 'tsconfig.json', 'yarn.lock']), /gate files: `CODEOWNERS`, `\.eslintrc\.json`, `\.husky\/pre-commit`, `tsconfig\.json`, `yarn\.lock`\n/);
  assert.doesNotMatch(changed(['scripts/x\n| AC1 | forged | passed |']), /\n\| AC1 \| forged/);
  const list = [
    ['AC1 is not AC10', report({ review: spec('| AC10 | t | unit | `x` |', '1'), tests: cases('<testcase name="x"/>'), sha: 'a' }), /\| AC1 \| - \| missing \|/],
    ['no criteria without a ready review', report({ review: spec('', '').replace('verdict=ready', 'verdict=questions'), tests: cases(junit), sha: 'a' }), /Acceptance: fail/],
    ['no review', report({ tests: cases(junit), sha: 'a' }), /Acceptance: fail/],
  ];
  assert.equal(report({ review: spec('', ''), tests: [], sha: 'a' }).ok, true, 'a ready review with no criteria passes: the task changes no behaviour a test can reach');
  for (const [title, got, want] of list) { assert.equal(got.ok, false, title); assert.match(got.body, want, title); }
  const repo = mkdtempSync(path.join(tmpdir(), 'rev-')), git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  git('init'); mkdirSync(path.join(repo, 'src')); writeFileSync(path.join(repo, 'src/a.mjs'), '1'); writeFileSync(path.join(repo, 'src/b.mjs'), '1');
  git('add', '.'); git('commit', '-m', 'b'); const BASE = git('rev-parse', 'HEAD').stdout.trim();
  writeFileSync(path.join(repo, 'src/a.mjs'), '2'); writeFileSync(path.join(repo, 'src/b.mjs'), '2'); git('commit', '-am', 'h');
  const UNIT = `node -e "require('fs').writeFileSync('junit/unit.xml','<testsuites/>')"`;
  spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--revert'], { cwd: repo, env: { ...process.env, BASE, UNIT, E2E: '' } });
  assert.equal(existsSync(path.join(repo, 'revert/0/unit.xml')), true, 'rerun recreates junit');
  rmSync(path.join(repo, 'revert'), { recursive: true, force: true });
  spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--revert'], { cwd: repo, env: { ...process.env, BASE, UNIT: 'sleep 5', E2E: '', REVERT_BUDGET_MS: '500' } });
  assert.equal(readFileSync(path.join(repo, 'revert/skipped'), 'utf8'), 'src/a.mjs\nsrc/b.mjs\n', 'skipped lists files');
  assert.deepEqual(['a', 'b'].map((n) => readFileSync(path.join(repo, `src/${n}.mjs`), 'utf8')), ['2', '2'], 'head restored');
  const late = report({ review, tests: cases(junit), sha: 'abcdef1', skipped: ['src/a.mjs', 'src/b.mjs'] });
  assert.match(late.body, /\nNot reverted in time: `src\/a\.mjs`, `src\/b\.mjs`\n/); assert.equal(late.ok, true);
  rmSync(path.join(repo, 'revert'), { recursive: true, force: true }); mkdirSync(path.join(repo, 'src/content/impact'), { recursive: true });
  writeFileSync(path.join(repo, 'src/b.astro'), '<a href="/about"></a><a href="/en/"></a><a href="/api/game/start"></a><a href="https://github.com/serio-ngo"></a><img src="/img/x.png"><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  writeFileSync(path.join(repo, 'src/content/impact/x.json'), '{"source":"https://www.gov.pl/a"}');
  mkdirSync(path.join(repo, 'src/data')); writeFileSync(path.join(repo, 'src/data/x.json'), '{"repo":"https://github.com/y"}'); writeFileSync(path.join(repo, 'src/s.scss'), '/* https://github.com */');
  for (const f of ['c', 'd']) writeFileSync(path.join(repo, `src/${f}.astro`), '<a href="/contact"></a>');
  for (const d of ['backend/app', 'frontend/src']) mkdirSync(path.join(repo, d), { recursive: true });
  writeFileSync(path.join(repo, 'backend/app/b.py'), 'API = "/api/v1/x"\nOLD = "/api/v2/x"');
  git('add', '.'); git('commit', '-m', 'r'); const ROUTED = git('rev-parse', 'HEAD').stdout.trim();
  writeFileSync(path.join(repo, 'src/a.ts'), "['/about', '/en', 'https://www.gov.pl/b', '/api/game/result', '/solo', '/img/x.png', 'http://www.w3.org/2000/svg', 'https://github.com/x']");
  writeFileSync(path.join(repo, 'src/c.astro'), '<a class="x" href="/contact"></a>');
  writeFileSync(path.join(repo, 'frontend/src/a.ts'), "fetch('/api/v1/y')"); writeFileSync(path.join(repo, 'backend/app/d.py'), 'NEW = "/api/v2/y"');
  git('add', '.'); git('commit', '-m', 'a');
  spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--revert'], { cwd: repo, env: { ...process.env, BASE: ROUTED, UNIT: '', E2E: '' } });
  const line = `Routes in two or more files: \`/api/v2\` in \`backend/app/b.py\`, \`backend/app/d.py\`; ${['/about', '/en', '/api/game', 'https://github.com'].map((s) => `\`${s}\` in \`src/a.ts\`, \`src/b.astro\``).join('; ')}`;
  const routed = report({ review, tests: cases(junit), sha: 'a', repeats: JSON.parse(readFileSync(path.join(repo, 'revert/routes.json'), 'utf8')) });
  assert.equal(routed.ok, false, 'a repeated route fails'); assert.ok(routed.body.split('\n').includes(line), routed.body);
  const plain = accept({ repo: 'o/r', number: 1, revert: path.join(repo, 'revert') }, { one: () => ({ head: { ref: 'fix/x', repo: { full_name: 'o/r' } }, base: { repo: { full_name: 'o/r' } } }), all: () => [] });
  assert.deepEqual([plain.ok, plain.body.split('\n').at(-1)], [false, line], 'a pull request outside the lifecycle fails on a repeated route');
  const gh = { one: () => ({ head: { ref: 'fix/x', sha: 'h', repo: { full_name: 'o/r' } }, base: { repo: { full_name: 'o/r' } } }), all: () => [] };
  assert.equal(record({ repo: 'o/r', number: 1, lock: 'success', note: 'n', revert: path.join(repo, 'revert') }, gh).acceptance, plain.body, 'the gate record holds the posted report');
  assert.deepEqual(strings("'/about' `/en/` '/a/ b' '/c, d' s.replace(/'/gu, '')"), ['/about', '/en'], 'a path ends at its closing quote: text or a regex flag before a space or comma is none');
  rmSync(repo, { recursive: true, force: true });
  console.log(`acceptance self-test: ${list.length + 16} checks passed`);
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.xml') ? [path.join(dir, e.name)] : []);

const limits = (files, review) => {
  const k = specOf(review)?.ac.length || 0, named = [...mapping(review).values()];
  const tests = files.filter((f) => LOCKED.test(f.filename) && !CONFIG.test(f.filename) && !/^\.(claude|agents)\//.test(f.filename));
  const found = tests.flatMap((f) => String(f.patch || '').split('\n').flatMap((l) => { const m = /^\+\s*(?:(?:it|test)\(\s*(['"`])(.*?)\1|(?:async\s+)?def\s+(test_\w+))/.exec(l); return m ? [m[2] ?? m[3]] : []; }));
  const lost = [...new Set(found.filter((c) => !named.some((t) => t === c || t.split(' › ').at(-1) === c)))];
  const added = tests.reduce((sum, f) => sum + (f.additions || 0), 0);
  return [
    ...found.length && !files.some((f) => production(f.filename)) ? ['Tests only: the pull request adds test cases and changes no production file'] : [],
    ...lost.length ? [`Test cases no criterion names: ${lost.map((c) => `\`${cell(c)}\``).join(', ')}`] : [],
    ...found.length > k ? [`More test cases than criteria: ${found.length} for ${k}`] : [],
    ...added > 40 * k ? [`More than 40 added test lines per criterion: ${added} for ${k}`] : [],
  ];
};

export function accept({ repo, number, dir, tested, lock, link, post, revert }, io = { one, all, send, raw }) {
  const pr = io.one(`repos/${repo}/pulls/${number}`), n = taskOf(pr);
  const list = io.all(`repos/${repo}/pulls/${number}/files?per_page=100`);
  const repeats = revert && existsSync(path.join(revert, 'routes.json')) ? JSON.parse(readFileSync(path.join(revert, 'routes.json'), 'utf8')) : [];
  if (!n) { const fails = [...limits(list, ''), ...routes(repeats)]; return { ok: !fails.length, body: ['acceptance: not a lifecycle pull request', ...fails].join('\n') }; }
  if (tested && tested !== pr.head.sha) return { ok: true, body: 'acceptance: a newer head exists; the run for it writes the report' };
  const own = ownersOf(repo, io.raw);
  const review = specComment(io.all(`repos/${repo}/issues/${n}/comments?per_page=100`), own)?.body;
  let xml = [];
  try { xml = walk(dir); } catch { }
  const files = list.map((f) => f.filename), size = `+${pr.additions} −${pr.deletions} in ${pr.changed_files} files`;
  const read = (d) => walk(d).flatMap((file) => cases(readFileSync(file, 'utf8')));
  const dirs = !revert || !existsSync(revert) ? [] : readdirSync(revert).sort(), skip = path.join(revert || '', 'skipped');
  const skipped = dirs.includes('skipped') ? readFileSync(skip, 'utf8').split('\n').filter(Boolean) : [];
  const free = dirs.filter((d) => /^\d+$/.test(d)).filter((d) => report({ review, tests: read(path.join(revert, d)), sha: pr.head.sha }).ok).map((d) => readFileSync(path.join(revert, d, 'file'), 'utf8').trim());
  const head = xml.flatMap((file) => cases(readFileSync(file, 'utf8')));
  const without = dirs.includes('all') ? read(path.join(revert, 'all')) : files.some(production) ? undefined : head;
  const got = report({ review, tests: head, sha: pr.head.sha, lock, link, files, size, free, skipped, fails: limits(list, review), without, repeats });
  if (post) {
    const old = io.all(`repos/${repo}/issues/${number}/comments?per_page=100`).find((c) => c.user?.login === 'github-actions[bot]' && /<!-- acceptance v1 /.test(c.body || ''));
    if (old) io.send('PATCH', `repos/${repo}/issues/comments/${old.id}`, { body: got.body });
    else io.send('POST', `repos/${repo}/issues/${number}/comments`, { body: got.body });
  }
  return got;
}

export function record({ repo, number, dir, tested, lock, note, verifier, run, attempt, jobs, revert }, io = { one, all, raw }) {
  const pr = io.one(`repos/${repo}/pulls/${number}`), ok = lock === 'success';
  const body = !ok ? null : accept({ repo, number, dir, tested, lock: note, link: '', post: false, revert }, { ...io, send: () => { } }).body;
  let xml = [];
  try { xml = walk(dir); } catch { }
  return {
    repository: repo, pr: Number(number), run, attempt, at: new Date().toISOString(), head_sha: pr.head.sha, tested_sha: tested, reported_sha: /<!-- acceptance v1 sha=(\S+) -->/.exec(body || '')?.[1] || null, verifier,
    lock: `test lock: ${ok ? 'pass' : 'fail'} - ${note}`, acceptance: body, cases: xml.flatMap((file) => cases(readFileSync(file, 'utf8'))), jobs,
  };
}

function revertRuns() {
  const { BASE, UNIT, E2E } = process.env, git = (...a) => spawnSync('git', a, { encoding: 'utf8' });
  const base = git('merge-base', 'HEAD', BASE).stdout.trim();
  const changed = git('diff', '--name-only', '--no-renames', '--diff-filter=AM', base, 'HEAD').stdout.split('\n').filter((f) => f && production(f));
  const end = Date.now() + Number(process.env.REVERT_BUDGET_MS || 12 * 60 * 1000), skipped = new Set();
  const app = git('ls-files').stdout.split('\n').filter((f) => f && APP(f)), held = new Map(app.map((f) => { try { return [f, new Set(strings(readFileSync(f, 'utf8')))]; } catch { return [f, new Set()]; } }));
  const added = new Set(changed.filter(APP).flatMap((f) => {
    const diff = git('diff', '-U0', base, 'HEAD', '--', f).stdout.split('\n'), side = (c) => strings(diff.filter((l) => l[0] === c && !l.startsWith(c.repeat(3))).join('\n')), gone = new Set(side('-'));
    return side('+').filter((s) => !gone.has(s)).map((s) => `${root(f)}\n${s}`);
  }));
  const repeats = [...added].map((k) => k.split('\n')).map(([r, s]) => [s, app.filter((f) => root(f) === r && held.get(f).has(s))]).filter(([, fs]) => fs.length > 1);
  if (repeats.length) { mkdirSync('revert', { recursive: true }); writeFileSync(path.join('revert', 'routes.json'), JSON.stringify(repeats)); }
  const attempt = (name, paths) => {
    if (Date.now() >= end) return paths.forEach((f) => skipped.add(f));
    for (const file of paths) if (git('cat-file', '-e', `${base}:${file}`).status) rmSync(file, { force: true }); else git('checkout', base, '--', file);
    rmSync('junit', { recursive: true, force: true });
    mkdirSync('junit');
    const cut = [UNIT, E2E].filter(Boolean).map((cmd) => spawnSync('bash', ['-c', cmd], { stdio: 'inherit', timeout: Math.max(1, end - Date.now()) }).error).some(Boolean);
    const out = path.join('revert', name);
    if (cut) paths.forEach((f) => skipped.add(f));
    else {
      mkdirSync(out, { recursive: true });
      for (const x of readdirSync('junit').filter((n) => n.endsWith('.xml'))) renameSync(path.join('junit', x), path.join(out, x));
      writeFileSync(path.join(out, 'file'), paths.join('\n'));
    }
    git('checkout', 'HEAD', '--', ...paths);
  };
  if (changed.length) attempt('all', changed);
  changed.forEach((file, i) => attempt(String(i), [file]));
  if (skipped.size) { mkdirSync('revert', { recursive: true }); writeFileSync(path.join('revert', 'skipped'), [...skipped].map((f) => `${f}\n`).join('')); }
}

function main() {
  if (process.argv.includes('--revert')) return revertRuns();
  const [number, dir] = process.argv.slice(2), repo = flag('--repo') || repoOf(), file = flag('--record');
  if (file) {
    const { env } = process;
    return writeFileSync(file, JSON.stringify(record({ repo, number, dir, tested: env.TESTED_SHA || '', lock: env.LOCK, note: env.LOCK_NOTE, verifier: env.VERIFIER, run: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT), jobs: { tests: env.TESTS }, revert: env.REVERT }, { one, all, raw })));
  }
  const { ok, body } = accept({ repo, number, dir, tested: process.env.TESTED_SHA || '', lock: process.env.LOCK_NOTE, link: process.env.GITHUB_RUN_ID ? runLink() : '', post: process.argv.includes('--post'), revert: process.env.REVERT });
  console.log(body);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) (process.argv.includes('--self-test') ? selfTest : main)();
