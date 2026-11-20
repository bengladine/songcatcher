import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

function buildId() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

// Served from https://<user>.github.io/songcatcher/ on GitHub Pages.
// Relative base keeps it working under any sub-path (and locally).
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(`${buildId()} · ${new Date().toISOString().slice(0, 10)}`),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
