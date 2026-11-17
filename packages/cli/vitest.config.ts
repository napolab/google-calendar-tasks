import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    typecheck: { include: ['src/**/*.test-d.ts'] },
  },
});
