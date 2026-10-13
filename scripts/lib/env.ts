// Environment for pipeline scripts. Reads .env (Node >= 20.12 built-in loader) without overriding real env.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');

for (const f of ['.env.local', '.env']) {
  const p = resolve(ROOT, f);
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* ignore malformed optional env files */
    }
  }
}

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Не задана переменная окружения ${name}. См. .env.example и SETUP.md`);
  }
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2) as [string, string | undefined];
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) flags[k] = argv[++i]!;
      else flags[k] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

export const log = {
  step: (m: string) => console.log(`\n▸ ${m}`),
  ok: (m: string) => console.log(`  ✓ ${m}`),
  warn: (m: string) => console.log(`  ! ${m}`),
  fail: (m: string) => console.log(`  ✗ ${m}`),
  info: (m: string) => console.log(`    ${m}`),
};

import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
/** True when the module is the entry point (works under tsx and plain node). */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === metaUrl;
  } catch {
    return false;
  }
}
