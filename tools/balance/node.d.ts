// The little of Node the balance shards use (the project has no @types/node).
declare module 'node:fs' {
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
  export function readFileSync(path: string, enc: 'utf8'): string;
}
declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };
