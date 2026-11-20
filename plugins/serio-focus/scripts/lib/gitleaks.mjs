import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const VERSION = '8.30.1';
const SHA256 = {
  [`gitleaks_${VERSION}_linux_x64.tar.gz`]: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  [`gitleaks_${VERSION}_windows_x64.zip`]: 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
  [`gitleaks_${VERSION}_darwin_arm64.tar.gz`]: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  [`gitleaks_${VERSION}_darwin_x64.tar.gz`]: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
};
export const verified = (name, buffer) => SHA256[name] === createHash('sha256').update(buffer).digest('hex');

export function scan(dir) {
  const os = { win32: 'windows', darwin: 'darwin' }[platform()] || platform(), name = `gitleaks_${VERSION}_${os}_${arch()}.${os === 'windows' ? 'zip' : 'tar.gz'}`;
  if (!SHA256[name]) throw new Error(`no gitleaks ${VERSION} for ${os} ${arch()}`);
  const cache = join(tmpdir(), `serio-gitleaks-${VERSION}`), file = join(cache, name), get = () => writeFileSync(file, execFileSync('curl', ['-fsSL', `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${name}`], { maxBuffer: 64e6 }));
  mkdirSync(cache, { recursive: true });
  if (!existsSync(file) || !verified(name, readFileSync(file))) get();
  const buf = readFileSync(file), bin = mkdtempSync(join(tmpdir(), 'serio-gitleaks-'));
  try {
    if (!verified(name, buf)) throw new Error(`${name} does not match its checksum`);
    writeFileSync(join(bin, name), buf);
    execFileSync(os === 'windows' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar', ['-xf', join(bin, name), '-C', bin]);
    const out = execFileSync(join(bin, os === 'windows' ? 'gitleaks.exe' : 'gitleaks'), ['dir', dir, '--no-banner', '--report-format', 'json', '--report-path', '-', '--exit-code', '0'], { encoding: 'utf8', maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'pipe'] });
    return [...new Set(JSON.parse(out.slice(out.indexOf('[')) || '[]').map((f) => basename(f.File)))];
  } finally { rmSync(bin, { recursive: true, force: true }); }
}
