import { defineConfig } from 'vitest/config';

// base './' so the built site works from any sub-path, e.g. GitHub Pages project sites.
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
