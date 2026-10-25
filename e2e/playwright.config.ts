import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests: the real web app and API against their own database (`<dev db>_e2e`, reset on
 * every run). Servers run on their own ports, so a running `pnpm dev` is not disturbed.
 * Needs Postgres up (`docker compose up -d`). Run with `pnpm e2e`.
 */

const API_PORT = 3100;
const WEB_PORT = 5174;

// The dev database (apps/api/.env) names the server; the tests use a sibling database
const apiEnv = new URL('../apps/api/.env', import.meta.url);
if (!process.env.DATABASE_URL && existsSync(apiEnv)) process.loadEnvFile(apiEnv);
const devUrl = process.env.DATABASE_URL ?? 'postgres://flowcanvas:flowcanvas@localhost:5432/flowcanvas';
const e2eUrl = new URL(process.env.E2E_DATABASE_URL ?? devUrl);
if (!process.env.E2E_DATABASE_URL) e2eUrl.pathname = `${new URL(devUrl).pathname}_e2e`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      // Fresh database, then the built API (Nest needs tsc's decorator metadata, which tsx doesn't emit)
      command: 'pnpm --filter api e2e:db && pnpm --filter api build && pnpm --filter api start',
      url: `http://localhost:${API_PORT}/api/health`,
      env: { DATABASE_URL: e2eUrl.href, ADMIN_DATABASE_URL: devUrl, PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
    },
    {
      command: `pnpm --filter web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
