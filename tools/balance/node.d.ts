// The little of Node the balance tools and vite.config.ts use (the project has no @types/node).
declare module 'node:fs' {
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
  export function readFileSync(path: string, enc: 'utf8'): string;
}
declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };
declare module 'node:child_process' {
  export function execSync(cmd: string, opts?: { stdio?: unknown[] }): { toString(): string };
}
