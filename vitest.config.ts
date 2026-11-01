import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Workspace packages resolve to their TypeScript sources, so tests need no prior build.
const SOURCE_CONDITION = '@geotoon/source';

export default defineConfig({
  resolve: { conditions: [SOURCE_CONDITION, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [SOURCE_CONDITION, ...defaultServerConditions] } },
  test: {
    environment: 'node',
    restoreMocks: true,
    projects: [
      { extends: true, test: { name: 'core', include: ['packages/core/test/**/*.spec.ts'] } },
      {
        extends: true,
        test: { name: 'contracts', include: ['packages/contracts/test/**/*.spec.ts'] },
      },
      { extends: true, test: { name: 'api-unit', include: ['apps/api/test/unit/**/*.spec.ts'] } },
      {
        extends: true,
        test: {
          name: 'api-integration',
          include: ['apps/api/test/integration/**/*.spec.ts'],
          // Each file starts its own PostGIS container; running them one at a time keeps
          // memory use predictable on a laptop.
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
      // Only the pure modules of the browser client are tested; they need no DOM.
      { extends: true, test: { name: 'web', include: ['apps/web/test/**/*.spec.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      // Same list and reasons as sonar.coverage.exclusions in sonar-project.properties.
      exclude: [
        'apps/web/src/render/**', // draws to WebGL; checked in the browser, not in Node
        'apps/web/src/main.ts', // browser entry point: DOM and WebGL wiring only
        'apps/web/src/ui/search-box.ts', // DOM widget; its logic lives in search-logic.ts
        'apps/web/src/ui/overlays.ts', // DOM-only views
        'apps/api/src/main.ts', // process entry point: signals and startup wiring
        '**/index.ts', // re-exports only
      ],
    },
  },
});
