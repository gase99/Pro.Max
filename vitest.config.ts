import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Explicit allowlist: node:test suites in tests/*.test.js must stay with
    // `node --test`, so only the Vitest suites are listed here.
    include: [
      'tests/optimizer.test.ts',
      'tests/cutmap.test.tsx',
      'tests/app-optimizer.test.tsx',
      'tests/import-export.test.js'
    ]
  }
});
