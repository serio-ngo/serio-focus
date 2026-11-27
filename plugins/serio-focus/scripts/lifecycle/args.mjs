#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WRITE = 'Read,Glob,Grep,Edit,Write,Agent,Skill,Bash';
const NOTE = 'End your last message with one line that starts with Note: and holds at most 2 sentences and 280 characters in plain words: what this step did, and the one thing the person must know.';
const READ = 'Read,Glob,Grep';
const schema = () => JSON.stringify(JSON.parse(readFileSync(new URL('../lib/spec-review.schema.json', import.meta.url), 'utf8')));

export function build({ stage, issue, pr, turns, model }) {
  const prompts = {
    'spec-review': `/serio-focus:spec-review ${issue}`,
    'write-tests': `/serio-focus:write-tests ${issue}`,
    deliver: `/serio-focus:deliver task issue #${issue} on pull request #${pr}`,
    'pr-loop': `/serio-focus:pr-loop ${pr}`,
  };
  if (!Object.hasOwn(prompts, stage)) throw new Error(`unknown stage: ${stage}`);
  const review = stage === 'spec-review';
  const extra = review ? `--tools "${READ}" --json-schema '${schema()}'` : `--append-system-prompt "${NOTE}"`;
  return { prompt: prompts[stage], args: `--max-turns ${turns} --model ${model} --allowedTools "${review ? READ : WRITE}" ${extra}` };
}

function selfTest() {
  const base = { issue: 7, pr: 9, turns: 30, model: 'm1' };
  const run = (stage) => build({ ...base, stage });
  const wt = run('write-tests');
  assert.equal(wt.prompt, '/serio-focus:write-tests 7');
  assert.equal(wt.args, `--max-turns 30 --model m1 --allowedTools "${WRITE}" --append-system-prompt "${NOTE}"`);
  const sr = run('spec-review');
  assert.equal(sr.prompt, '/serio-focus:spec-review 7');
  assert.ok(sr.args.includes('--allowedTools "Read,Glob,Grep"') && sr.args.includes('--tools "Read,Glob,Grep"'));
  const json = /--json-schema '(.*)'$/.exec(sr.args)[1];
  assert.deepEqual(JSON.parse(json), JSON.parse(readFileSync(new URL('../lib/spec-review.schema.json', import.meta.url), 'utf8')));
  assert.equal(run('deliver').prompt, '/serio-focus:deliver task issue #7 on pull request #9');
  assert.equal(run('pr-loop').prompt, '/serio-focus:pr-loop 9');
  assert.throws(() => run('nope'), /unknown stage/);
  console.log('args self-test: 7 checks passed');
}

function main() {
  const { STAGE, ISSUE, PR, TURNS, MODEL } = process.env;
  const { prompt, args } = build({ stage: STAGE, issue: ISSUE, pr: PR, turns: TURNS, model: MODEL });
  appendFileSync(process.env.GITHUB_OUTPUT, `prompt=${prompt}\nargs=${args}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { (process.argv.includes('--self-test') ? selfTest : main)(); } catch (e) { console.error(e.message); process.exit(1); }
}
