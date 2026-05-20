import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    // E2E tests share a process and a database; running them sequentially
    // avoids cross-file user-table contention until we add per-test schemas.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src'),
      '@common': resolve(__dirname, '../../src/common'),
      '@config': resolve(__dirname, '../../src/config'),
      '@infrastructure': resolve(__dirname, '../../src/infrastructure'),
      '@modules': resolve(__dirname, '../../src/modules'),
    },
  },
  plugins: [
    // NestJS needs decorator metadata for DI to work; vitest's default
    // esbuild transform drops it. SWC preserves it (also faster).
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
});
