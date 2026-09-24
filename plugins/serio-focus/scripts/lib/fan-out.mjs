import { closeSync, mkdirSync, openSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { waveCap, waveWindow } from './limits.mjs';
import { bumpAll, rootOf, sessionOf } from './ledger.mjs';
import { waveDir } from './runtime.mjs';
import { Blocked } from './blocked.mjs';

function claimSlot(dir, bucket, cap) {
  try { mkdirSync(dir, { recursive: true }); } catch {
    try { rmSync(dir, { force: true, recursive: true }); mkdirSync(dir, { recursive: true }); } catch { return cap + 1; }
  }
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(`${bucket}-`)) rmSync(path.join(dir, name), { force: true });
    }
  } catch { }
  for (let n = 1; n <= cap + 1; n += 1) {
    try {
      closeSync(openSync(path.join(dir, `${bucket}-${n}`), 'wx'));
      if (n > cap) rmSync(path.join(dir, `${bucket}-${n}`), { force: true });
      return n;
    } catch { }
  }
  return cap + 1;
}

export function fanOutCap(payload, count = 1) {
  const cap = waveCap();
  const dir = waveDir(rootOf(payload), sessionOf(payload));
  const bucket = Math.floor(Date.now() / waveWindow());
  const claimed = [];

  for (let n = 0; n < count; n += 1) {
    const slot = claimSlot(dir, bucket, cap);
    if (slot <= cap) { claimed.push(slot); continue; }

    for (const held of claimed) {
      try { rmSync(path.join(dir, `${bucket}-${held}`), { force: true }); } catch { }
    }
    bumpAll(rootOf(payload), sessionOf(payload), { blocked: 1, waves: 1, agentsCapped: count });
    const waves = Array.from({ length: Math.ceil(count / cap) }, (_, n) => Math.min(cap, count - n * cap)).join('+');
    throw new Blocked(count > cap
      ? `FAN-OUT CAP: ${count} asked, ${cap} run. Next: run them as waves, // AGENTS: ${waves}\n`
      : `FAN-OUT CAP: ${count > 1 ? `${count} asked` : `subagent ${slot}`} held. Next: wait one wave\n`);
  }
}
