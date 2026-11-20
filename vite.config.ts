import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/songcatcher/ on GitHub Pages.
// Relative base keeps it working under any sub-path (and locally).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
