import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DENY_SUBAGENT_DEFAULT } from './limits.mjs';
import { declaredModel } from './agent-model.mjs';
import { rootOf, sessionOf, update } from './ledger.mjs';

const MODEL_TIERS = /\b(?:haiku|sonnet|opus|fable)\b/i;
const MODEL_OPTION = /\bmodel\s*[:=]\s*['"`]?\s*(haiku|sonnet|opus|fable)\b/gi;
const QUALITY = /\bQUALITY:\s*(?:writing|creative|legal|security)\b/;
const REVIEW = /\b(?:review|audit)(?:s|ed|ing|er|ers|or|ors)?\b/i;
const THINK_ESCALATION = /\b(?:(?:ultrathink|megathink|think\s+(?:hard(?:er)?|deeply))\b|(?:reasoning[-_ ]?)?effort\s*[=:]\s*(['"`]?)(?:xhigh|max)\1(?=\s*(?:[,})\]]|$)))/gi;
const UNBOUNDED_FANOUT = /\b(?:parallel|pipeline|Promise\s*\.\s*all(?:Settled)?)\s*\(/;
const DYNAMIC_FANOUT = /\.\s*(?:flatMap|map|forEach)\s*\(|\b(?:for|while)\s*\(|\bArray\s*\.\s*from\s*\(/;
const FANOUT_BUDGET = /(?:^|\n)\s*\/\/\s*AGENTS:\s*(\d+(?:\s*\+\s*\d+)*)/;
const WORKFLOW_AGENT_CALL = /(?<![.\w$])agent\s*\(/g;
const WORKFLOW_TIER_OPTION = /\b(?:model|agentType)\b/g;
const SPAWN_TEXT = ['prompt', 'description', 'subagent_type', 'script', 'name', 'title'];
const MODEL_BEARING = ['Agent', 'Task'];

export function deniedSubagentRx(raw = DENY_SUBAGENT_DEFAULT) {
  const names = String(raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!names.length) return /(?!)/;
  const esc = names.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`\\b(?:${esc})\\b`, 'i');
}

const spawnText = (input) => SPAWN_TEXT.map((key) => input[key]).filter((value) => typeof value === 'string').join(' ');
const selectedTiers = (text) => [...String(text).matchAll(MODEL_OPTION)].map((hit) => hit[1].toLowerCase());
const deniedNow = () => deniedSubagentRx(process.env.SERIO_DENY_SUBAGENT_MODELS ?? DENY_SUBAGENT_DEFAULT);
const altOf = (denied) => ['sonnet', 'haiku'].find((tier) => !denied.test(tier));

function deniedVerdict(text, hit, denied) {
  const alt = altOf(denied);
  const next = alt ? `. Use ${alt}` : '';
  if (REVIEW.test(text)) return { reason: `blocked ${hit} review${next}`, tier: hit, alt };
  if (!QUALITY.test(text)) return { reason: `blocked ${hit} subagent${next}`, tier: hit, alt };
  return null;
}

export function reroute(raw, input, tool, { alt }) {
  if (!alt) return null;
  if (MODEL_BEARING.includes(tool) || raw.model) return { ...raw, model: alt };
  const denied = deniedNow();
  const script = String(input.script ?? '').replace(MODEL_OPTION, (hit, name) => (denied.test(name) ? hit.replace(name, alt) : hit));
  if (script === input.script) return null;
  const { scriptPath, ...rest } = raw;
  return { ...rest, script };
}

export function withScript(input, tool, cwd = '.') {
  if (tool !== 'Workflow' || typeof input.script === 'string' || typeof input.scriptPath !== 'string') return input;
  try { return { ...input, script: readFileSync(path.resolve(String(cwd), input.scriptPath), 'utf8') }; } catch { return { ...input, unreadable: true }; }
}

const count = (text, rx) => (code(text).match(rx) || []).length;

export function dispatchBudget(input, cwd, tool = 'Agent', denied = deniedNow()) {
  const named = String(input.model || '').trim();
  const text = spawnText(input);
  if (!named) {
    if (!MODEL_BEARING.includes(tool)) {
      const selected = selectedTiers(text).find((tier) => denied.test(tier));
      if (selected) return deniedVerdict(text, selected, denied);
      if (input.unreadable) return { reason: 'blocked a workflow whose scriptPath could not be read. Next: pass the script inline' };
      if (tool !== 'Workflow' || count(input.script, WORKFLOW_AGENT_CALL) <= count(input.script, WORKFLOW_TIER_OPTION)) return null;
      return { reason: "blocked a workflow agent() call naming no model — it inherits the session tier. Next: pass { model: 'haiku' } or { model: 'sonnet' } in every call" };
    }
    const declared = declaredModel(input.subagent_type, cwd);
    if (declared) {
      const hit = (declared.match(denied) || [])[0]?.toLowerCase();
      return hit ? deniedVerdict(text, hit, denied) : null;
    }
    return { reason: 'blocked a dispatch that names no model', alt: altOf(denied) };
  }
  if (!MODEL_TIERS.test(named)) return { reason: `blocked model "${named}" — not a tier` };

  const hit = (named.match(denied) || [])[0]?.toLowerCase();
  return hit ? deniedVerdict(text, hit, denied) : null;
}

function code(text) {
  return String(text ?? '')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const waves = (input) => ((String(input.script ?? '').match(FANOUT_BUDGET) || [])[1] || '').split('+').map(Number).filter(Boolean);

export function costBudget(input, tool) {
  const text = spawnText(input);
  if (QUALITY.test(text)) return null;
  const think = (text.match(THINK_ESCALATION) || [])[0];
  if (think) return { reason: `blocked "${think}"` };
  if (tool !== 'Workflow' || waves(input).length) return null;
  const fan = (code(input.script).match(UNBOUNDED_FANOUT) || [])[0];
  return fan && DYNAMIC_FANOUT.test(code(input.script)) ? { reason: `blocked a workflow fanning out through "${fan.trim()}" with no agent count. Next: add the line // AGENTS: 3, or // AGENTS: 3+1 for waves run one after another` } : null;
}

export function agentsRequested(input, tool) {
  if (tool !== 'Workflow') return { wave: 1, total: 1 };
  const declared = waves(input);
  const total = Math.max(1, declared.reduce((sum, n) => sum + n, 0) || (code(input.script).match(WORKFLOW_AGENT_CALL) || []).length);
  return { wave: declared.length ? Math.max(...declared) : total, total };
}

export const bookRedirect = (payload, tier) => update(rootOf(payload), sessionOf(payload), (state) => {
  state.saved.redirects += 1;
  state.tiers = { ...(state.tiers || {}), [tier]: ((state.tiers || {})[tier] || 0) + 1 };
});
