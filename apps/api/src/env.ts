import { existsSync } from 'node:fs';

/** Loads apps/api/.env when present; real environment variables take precedence. */
export function loadEnv(path = '.env') {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see apps/api/.env.example)`);
  return value;
}
