import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // The date logic is only meaningful in the timezone it will actually run in.
    env: { TZ: 'Europe/London' },
  },
});
