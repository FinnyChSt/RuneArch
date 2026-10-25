import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Consume @flowcanvas/shared from its TS source for instant HMR
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    port: 5173,
    // The e2e tests (e2e/) point the proxy at their own API
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000' },
  },
});
