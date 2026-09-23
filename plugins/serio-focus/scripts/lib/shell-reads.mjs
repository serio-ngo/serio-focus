import { PIPE, pipelines, strip, tokens, unwrap } from './shell-parse.mjs';

const WHOLE_FILE_CMD = /^(?:cat|bat|more|less|type|gc|get-content)$/i;
const SLICE_CMD = /^(?:head|tail)$/i;
const SED_QUIET = /^(?:-[a-z]*n[a-z]*|--quiet|--silent)$/i;
const SED_RANGE = /^(\d+)(?:,(\d+|\$))?p$/;

const INTERPRETER_READ = /^(?:python[\d.]*|node|deno|bun|ruby|perl|php)\b[^\n]*\s--?(?:c|e|eval)\b[\s\S]*(?:\bopen\s*\(|readFile|read_text|readlines|File\.read|IO\.read|file_get_contents|\bslurp\b)/i;
const GIT_SHOW_FILE = /^git\b[^\n]*\b(?:show\s+\S*:\S+|cat-file\s+-p\b)/i;

function headTail(words) {
  const spec = { lines: 10 };
  const files = [];
  const count = (value, key) => {
    if (value === undefined || !/^\+?\d+$/.test(value)) return;
    delete spec.lines;
    delete spec.bytes;
    delete spec.from;
    if (value.startsWith('+')) spec.from = Math.max(0, Number(value.slice(1)) - 1);
    else spec[key] = Number(value);
  };
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    let hit = /^(?:-n|--lines=?)(\+?\d+)?$/.exec(word);
    if (hit) { count(hit[1] ?? words[++i], 'lines'); continue; }
    hit = /^(?:-c|--bytes=?)(\d+)?$/.exec(word);
    if (hit) { count(hit[1] ?? words[++i], 'bytes'); continue; }
    hit = /^-(\d+)$/.exec(word);
    if (hit) { count(hit[1], 'lines'); continue; }
    if (word.startsWith('-')) continue;
    files.push(strip(word));
  }
  return files.map((file) => ({ file, ...spec }));
}

function sedSlice(words) {
  if (!words.some((word, i) => i > 0 && SED_QUIET.test(word))) return [];
  let range = null;
  const files = [];
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    if (/^(?:-e|--expression)$/.test(word)) { range = range || SED_RANGE.exec(strip(words[++i] || '')); continue; }
    if (word.startsWith('-')) continue;
    const hit = range ? null : SED_RANGE.exec(strip(word));
    if (hit) range = hit;
    else files.push(strip(word));
  }
  if (!range || files.length !== 1) return [];
  const from = Number(range[1]) - 1;
  const lines = range[2] === undefined ? 1 : range[2] === '$' ? undefined : Math.max(0, Number(range[2]) - from);
  return [{ file: files[0], from, lines }];
}

function readsInSegment(segment) {
  if (INTERPRETER_READ.test(segment) || GIT_SHOW_FILE.test(segment)) return [{ unjudged: true }];
  const words = tokens(segment);
  const cmd = (words[0] || '').toLowerCase();
  if (WHOLE_FILE_CMD.test(cmd)) {
    const files = words.slice(1).filter((word) => !word.startsWith('-'));
    return files.map((raw) => ({ file: strip(raw), whole: true }));
  }
  if (SLICE_CMD.test(cmd)) return headTail(words);
  if (cmd === 'sed') return sedSlice(words);
  return [];
}

export function shellReads(command) {
  const out = [];
  for (const chunk of pipelines(command)) {
    if (chunk.includes('`') || chunk.includes('$(')) continue;
    const piped = PIPE.test(chunk);
    const segment = unwrap(chunk.split('|')[0].trim());
    for (const read of readsInSegment(segment)) out.push({ ...read, piped });
  }
  return out;
}
