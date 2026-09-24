export const BIG_FILE_BYTES = 24 * 1024;
export const BASH_OUTPUT_CAP = 30000;
export const MAX_PER_WAVE = 3;
const WAVE_MS = 60 * 1000;
export const DENY_SUBAGENT_DEFAULT = 'opus,fable';
const WEB_CALLS = 60;
const STALL_WARN = 500000;
const STALL_HOLD = 1200000;

const positive = (raw, fallback) => {
  const n = Math.floor(Number(raw));
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const waveCap = (raw = process.env.SERIO_MAX_PER_WAVE) => positive(raw, MAX_PER_WAVE);
export const waveWindow = (raw = process.env.SERIO_WAVE_MS) => positive(raw, WAVE_MS);
export const webCap = (raw = process.env.SERIO_WEB_CAP) => positive(raw, WEB_CALLS);
export const stallWarn = (raw = process.env.SERIO_STALL_WARN) => positive(raw, STALL_WARN);
export const stallHold = (raw = process.env.SERIO_STALL_HOLD) => (String(raw).trim() === '0' ? 0 : positive(raw, STALL_HOLD));
export const delegateOn = (raw = process.env.SERIO_DELEGATE ?? '1') => String(raw).trim() !== '0';
export const gitWriteAllowed = () => process.env.SERIO_GIT_WRITE === '1';
