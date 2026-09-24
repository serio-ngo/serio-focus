import { KEPT, fold } from './ledger.mjs';

const tok = (bytes) => Math.round(Number(bytes || 0) / 4);
const num = (value) => Number(value || 0).toLocaleString('en-US');
export const compact = (value) => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M`
  : value >= 10000 ? `${(value / 1000).toFixed(1)}k` : num(value));

export const kept = (t) => KEPT.reduce((sum, key) => sum + Number(t[key] || 0), 0);
const volume = (t) => kept(t) + Number(t.read || 0);
export const keptPct = (t) => (volume(t) ? Math.round((kept(t) / volume(t)) * 100) : 0);

const HELD = ['rewrites', 'rereads', 'slices', 'agentsCapped', 'redirects'];
export const heldCount = (s) => HELD.reduce((sum, key) => sum + Number(s[key] || 0), 0)
  + Math.max(0, Number(s.blocked || 0) - Number(s.redirects || 0) - Number(s.waves || 0));

export function sessionLine(state, stalled = 0, context = 0) {
  const s = fold(state.session, state.saved);
  const held = heldCount(s);
  const parts = [];
  if (kept(s)) parts.push(`${compact(tok(kept(s)))} tok kept out${context ? ` (${Math.round((tok(kept(s)) / context) * 100)}% of main context)` : ''}`);
  if (held) parts.push(`${num(held)} guard action${held === 1 ? '' : 's'}`);
  if (stalled) parts.push(`${compact(stalled)} tok since the last repo change`);
  return parts.length ? `SERIO FOCUS · ${parts.join(' · ')}` : '';
}
