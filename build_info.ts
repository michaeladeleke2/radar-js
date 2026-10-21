// Build-time facts baked into the library and demo (Vite `define`), so every
// capture sidecar and benchmark result names the exact radar-js code that made
// it. In GitHub Actions the commit comes from GITHUB_SHA.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function git(cmd: string): string {
  try { return execSync(`git ${cmd}`, { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}

export function buildDefine(): Record<string, string> {
  const commit = (process.env.GITHUB_SHA || git('rev-parse HEAD') || 'unknown').slice(0, 12);
  const dirty = !process.env.GITHUB_SHA && git('status --porcelain --untracked-files=no') !== '';
  const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  return {
    __RADAR_JS_COMMIT__: JSON.stringify(commit),
    __RADAR_JS_DIRTY__: JSON.stringify(dirty),
    __RADAR_JS_VERSION__: JSON.stringify(version),
  };
}
