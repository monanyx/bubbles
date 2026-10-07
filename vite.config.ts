import { defineConfig } from 'vitest/config';
import { inlineBundle } from './build/inline-bundle.ts';

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    // Relative base so the build works on GitHub Pages sub-paths and from disk.
    base: './',
    build: {
      target: 'es2022',
      outDir: standalone ? 'dist-standalone' : 'dist',
      emptyOutDir: true,
    },
    plugins: standalone ? [inlineBundle()] : [],
    test: {
      environment: 'happy-dom',
      include: ['src/**/*.test.ts'],
      restoreMocks: true,
    },
  };
});
