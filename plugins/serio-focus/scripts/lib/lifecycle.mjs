import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const call = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', input, maxBuffer: 64e6, stdio: ['pipe', 'pipe', 'pipe'] });
export const one = (path) => JSON.parse(call([path]));
export const all = (path) => JSON.parse(call([path, '--paginate', '--slurp'])).flat();
export const send = (method, path, body) => JSON.parse(call([path, '-X', method, '--input', '-'], JSON.stringify(body)) || 'null');
export const raw = (path) => { try { return call([path, '-H', 'Accept: application/vnd.github.raw']); } catch { return ''; } };

export const repoOf = () => process.env.GITHUB_REPOSITORY
  || execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' }).trim();
export const flag = (name) => { const i = process.argv.indexOf(name); return i < 0 ? '' : process.argv[i + 1] || ''; };

export const person = (user) => user?.type === 'User';
export const owners = (text) => new Set([...String(text || '').replace(/#.*$/gm, '').split('\n').filter((line) => /^\s*\*\s/.test(line)).join('\n').matchAll(/(?<=\s)@([A-Za-z0-9-]+)(?![A-Za-z0-9/-])/g)].map((m) => m[1].toLowerCase()));
export const ownersOf = (repo) => owners(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'].map((file) => raw(`repos/${repo}/contents/${file}`)).find(Boolean));
export const owns = (user, own) => person(user) && own.has(user.login.toLowerCase());
export const robot = (user) => user?.login === 'github-actions[bot]' && user.type === 'Bot';

export const specSha = (issue) => createHash('sha256').update(`${issue.title}\n${String(issue.body || '').replace(/\r\n/g, '\n')}`).digest('hex').slice(0, 12);
const SPEC = /<!-- spec-review v1 sha=([0-9a-f]{12}) verdict=(ready|questions) ac=([\d,]*) -->/;
export const specComment = (comments, own, marker = SPEC) => comments.filter((c) => (robot(c.user) || owns(c.user, own)) && c.created_at === c.updated_at && marker.test(c.body || '')).at(-1);
export const specOf = (body) => {
  const m = SPEC.exec(body || '');
  return m ? { sha: m[1], verdict: m[2], ac: m[3].split(',').filter(Boolean).map(Number) } : undefined;
};
export const specMarker = (comments, own) => specOf(specComment(comments, own)?.body);
export const fixMarkers = (comments) => comments.filter((c) => robot(c.user))
  .map((c) => /<!-- fix-ci v1 run=(\d+) attempt=(\d+) sha=[0-9a-f]+ -->/.exec(c.body || '')).filter(Boolean)
  .map(([, run, attempt]) => ({ run: Number(run), attempt: Number(attempt) }));
export const testsOk = (body) => /^tests-ok\b/.test(String(body || '').trim());
export const lockReview = (reviews, own) => reviews.filter((r) => owns(r.user, own) && testsOk(r.body) && r.state !== 'CHANGES_REQUESTED').at(-1);
export const lockOf = (reviews, own) => lockReview(reviews, own)?.commit_id;
export const issueOf = (ref) => Number(/^agent\/(\d+)-[a-z0-9-]+$/.exec(ref || '')?.[1]) || 0;
export const taskOf = (pr) => pr.head.repo?.full_name === pr.base.repo.full_name ? issueOf(pr.head.ref) : 0;

const STATUS = '<!-- lifecycle-status v1 -->', flat = (s) => String(s).replace(/\s+/g, ' ').trim();
const routed = (l) => /<!-- step-note stage=route /.test(l);
const trim = (lines) => { const gone = new Set(lines.map((_, i) => i).sort((a, b) => routed(lines[b]) - routed(lines[a]) || a - b).slice(0, Math.max(0, lines.length - 20))); return lines.filter((_, i) => !gone.has(i)); };
export const statusLog = (body) => String(body || '').split('**Log**\n')[1]?.split('\n').filter((l) => l.startsWith('- ')) || [];
export const isStatus = (c) => robot(c.user) && String(c.body || '').includes(STATUS);
const statusBody = (previous, { now, next, line }) => [
  [STATUS, '**Status**', `Now: ${flat(now)}`, ...(next ? [`Next: ${flat(next)}`] : [])].join('\n\n'),
  `**Log**\n${trim([...statusLog(previous), ...(line ? [`- ${flat(line)}`] : [])]).join('\n')}`,
].join('\n\n');
export const status = (repo, target, update, io = { all, send }) => {
  const found = io.all(`repos/${repo}/issues/${target}/comments?per_page=100`).findLast(isStatus), body = statusBody(found?.body, update);
  return found ? io.send('PATCH', `repos/${repo}/issues/comments/${found.id}`, { body }) : io.send('POST', `repos/${repo}/issues/${target}/comments`, { body });
};
export const park = (repo, number, why) => {
  send('POST', `repos/${repo}/issues/${number}/labels`, { labels: ['needs-human'] });
  status(repo, number, { now: why, next: 'a person reads the run log, then continues or closes the task', line: `**needs-human**: ${why} <!-- park at=${new Date().toISOString().replace(/\.\d+Z$/, 'Z')} -->` });
};
export const runLink = () => process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : 'local run';
