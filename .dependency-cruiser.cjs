/**
 * Architecture rules (design goal G9). Each one fails `make lint` and `make test`.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'core-is-pure',
      comment: 'The domain and application layer does no I/O and uses no framework.',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: { pathNot: '^packages/core/src' },
    },
    {
      name: 'domain-not-application',
      comment: 'Domain code holds the rules; it never depends on the use cases that call it.',
      severity: 'error',
      from: { path: '^packages/core/src/[^/]+/domain/' },
      to: { path: '^packages/core/src/[^/]+/application/' },
    },
    {
      name: 'contexts-independent',
      comment: 'Geocoding and Cartography share only packages/core/src/shared.',
      severity: 'error',
      from: { path: '^packages/core/src/(geocoding|cartography)/' },
      to: { path: '^packages/core/src/(geocoding|cartography)/', pathNot: '^packages/core/src/$1/' },
    },
    {
      name: 'contracts-only-zod',
      comment: 'Wire schemas depend on zod and nothing else.',
      severity: 'error',
      from: { path: '^packages/contracts/src' },
      to: { pathNot: ['^packages/contracts/src', '(^|/)node_modules/zod/'] },
    },
    {
      name: 'web-allowed-dependencies',
      comment: 'The browser client may use the contracts, three and earcut only.',
      severity: 'error',
      from: { path: '^apps/web/src' },
      to: {
        pathNot: [
          '^apps/web/src',
          '^packages/contracts/src',
          '(^|/)node_modules/(three|earcut|zod)/',
        ],
      },
    },
    {
      name: 'api-not-web',
      comment: 'The server never imports browser code.',
      severity: 'error',
      from: { path: '^apps/api' },
      to: { path: '^apps/web' },
    },
    {
      name: 'adapters-not-http',
      comment: 'Adapters implement ports; they do not know about HTTP routes.',
      severity: 'error',
      from: { path: '^apps/api/src/adapters' },
      to: { path: '^apps/api/src/http' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|test|scripts)/|\\.config\\.ts$' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      conditionNames: ['@geotoon/source', 'import', 'types', 'default'],
      exportsFields: ['exports'],
      extensions: ['.ts', '.js'],
    },
  },
};
