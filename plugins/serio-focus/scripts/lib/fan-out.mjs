import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { Blocked } from './blocked.mjs';
import { rootOf, sessionOf, waveDir } from './runtime.mjs';

const positive = (raw, fallback) => {
  const n = Math.floor(Number(raw));
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const waveCap = () => positive(process.env.SERIO_MAX_PER_WAVE, 3);
const waveWindow = () => positive(process.env.SERIO_WAVE_MS, 60000);

function claimSlot(dir, bucket, cap) {
  try { mkdirSync(dir, { recursive: true }); } catch { return 1; }
  for (let n = 1; n <= cap; n += 1) {
    try {
      closeSync(openSync(path.join(dir, `${bucket}-${n}`), 'wx'));
      return n;
    } catch { }
  }
  return cap + 1;
}

export function fanOutCap(payload) {
  const cap = waveCap();
  const slot = claimSlot(waveDir(rootOf(payload), sessionOf(payload)), Math.floor(Date.now() / waveWindow()), cap);
  if (slot > cap) throw new Blocked(`FAN-OUT CAP: subagent ${slot} held. Next: wait one wave`);
}
