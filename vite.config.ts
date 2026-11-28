import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/**
 * The version shown in the game: version.json's major.minor.patch.build, with the build digit auto-incremented by
 * the number of commits since version.json last changed (each new commit builds as the next number; rebuilding the
 * same commit gives the same version). Without git history it falls back to version.json as written.
 */
function gameVersion(): string {
  const { version } = JSON.parse(readFileSync('version.json', 'utf8')) as { version: string };
  const parts = version.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`version.json: "${version}" is not major.minor.patch.build`);
  try {
    const git = (cmd: string) => execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const since = git('log -1 --format=%H -- version.json');
    const builds = since ? Number(git(`rev-list --count ${since}..HEAD`)) : 0;
    parts[3] += builds;
  } catch {
    // Not a git checkout (or no history): use version.json as written.
  }
  return parts.join('.');
}

// `base: './'` makes every asset path relative, so the build works on
// GitHub Pages no matter what the repository is called.
export default defineConfig({
  base: './',
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion()),
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
