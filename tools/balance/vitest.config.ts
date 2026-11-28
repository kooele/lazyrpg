import { defineConfig } from 'vitest/config';

// Balance simulations only (npm run balance); kept out of npm test.
export default defineConfig({
  test: {
    include: ['tools/balance/**/*.sim.ts'],
    testTimeout: 24 * 3600 * 1000,
  },
});
