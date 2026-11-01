import { defaultClientConditions, defineConfig } from 'vite';

// The client bundles @geotoon/contracts from TypeScript source (no prior build needed).
export default defineConfig({
  resolve: {
    conditions: ['@geotoon/source', ...defaultClientConditions],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
