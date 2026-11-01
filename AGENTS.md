# AGENTS.md

Instructions for coding agents (Claude Code, Codex and others) and for people working on
GeoToon. Read this file before you change anything. `CLAUDE.md` imports it.

GeoToon turns an address into a walkable, cel-shaded 3D map. The API geocodes the address
with Photon, loads map data for a 2 km radius from Overture Maps into PostGIS once per
tile, and serves it to a Three.js client. The design, with the reason for each decision,
is [docs/designs/geotoon.md](docs/designs/geotoon.md). When you change behaviour, update
the design and the README in the same pull request.

## Repository layout

| Path | What it holds | May depend on |
| --- | --- | --- |
| `packages/core` | Domain and use cases (application services). No I/O, no framework. | itself only |
| `packages/contracts` | zod schemas for the HTTP API, shared by the API and the browser. | `zod` |
| `apps/api` | Fastify server: HTTP routes, adapters (PostGIS, Overture through DuckDB, Photon), composition root. | `core`, `contracts` |
| `apps/web` | Browser client: Three.js scene, walking controls, search UI. | `contracts`, `three`, `earcut` |
| `deploy/helm/geotoon` | Helm chart (app and PostgreSQL with PostGIS). | |
| `docker/` | App image. | |
| `fixtures/` | Recorded third-party data for offline tests (see `fixtures/NOTICE`). | |
| `scripts/` | Operational scripts, such as `verify-cache.sh`. | |

## Commands

Node 26 (`.nvmrc`) and Docker are required. `make help` lists every target.

| Command | Use it to |
| --- | --- |
| `make setup` | Install dependencies (`npm ci`). |
| `make typecheck` | Type-check every package. |
| `make lint` | Run ESLint (with SonarJS rules) and the architecture rules. |
| `make test` | Lint, then run every unit and integration test with coverage. Needs Docker. |
| `make build` | Build every package and the web client. |
| `make dev` | Run PostGIS, the API on :8080 and Vite on :5173. |
| `make sonar` | Run the SonarCloud scan locally (needs `SONAR_TOKEN`; run `make test` first). |
| `make lsp` | Install the TypeScript language server for Claude Code. |
| `make kind-up images kind-load deploy open` | Run the whole system on a local Kind cluster. |

Before you open a pull request, `make typecheck` and `make test` must pass.

## Clean Architecture

Dependencies point inwards: HTTP and adapters depend on use cases, use cases depend on the
domain, and the domain depends on nothing.

- **Domain** (`packages/core/src/<context>/domain`): entities, value objects and domain
  services that hold the rules (tile grid, tile coverage states, height rule, spawn
  point, scene assembly, attribution). Pure functions and plain data.
- **Application** (`packages/core/src/<context>/application`): use cases such as
  `RequestArea`, `IngestTiles`, `ReadScene` and `SuggestAddresses`. They talk to the
  outside only through **ports**, plain TypeScript interfaces in `ports.ts`.
- **Adapters** (`apps/api/src/adapters`): implement the ports with PostGIS, DuckDB,
  Photon and the system clock. Adapters never import HTTP code.
- **Delivery** (`apps/api/src/http`): Fastify routes that validate input with
  `packages/contracts` and call use cases.
- **Composition root** (`apps/api/src/composition-root.ts`): wires adapters into use
  cases by hand. There is no DI container.

`make lint` enforces these rules with dependency-cruiser (`.dependency-cruiser.cjs`); a
violation fails the build:

| Rule | Meaning |
| --- | --- |
| `core-is-pure` | `packages/core` imports nothing outside itself. |
| `domain-not-application` | Domain modules never import application modules. |
| `contexts-independent` | Geocoding and Cartography share only `packages/core/src/shared`. |
| `contracts-only-zod` | Wire schemas depend on `zod` only. |
| `web-allowed-dependencies` | The browser uses only the contracts, `three` and `earcut`. |
| `api-not-web` | The server never imports browser code. |
| `adapters-not-http` | Adapters do not know about routes. |
| `no-circular` | No import cycles. |

Do not weaken or delete a rule to make a change pass. Move the code to the right layer.

## Domain-Driven Design

- **Bounded contexts.** Geocoding (address suggestions) and Cartography (tiles,
  coverage, features, heights, scenes). Code shared by both lives in
  `packages/core/src/shared` (`GeoPoint`, `DomainError`, `Clock`).
- **Ubiquitous language.** Use the words of the README glossary and the design in code,
  tests and messages: area, tile, tile coverage, feature, layer, scene, spawn point,
  `sourceCalls`. Do not invent synonyms.
- **Tactical patterns only where a rule exists.** Tile coverage is an entity with
  explicit state transitions; `GeoPoint` and `TileKey` are value objects that reject
  bad input; the tile grid and height rule are domain services. There are no domain
  events, command bus or generic repository, and new code should not add them
  without a design change.
- **Errors.** Domain and application code raise `DomainError` with a stable code. The
  HTTP layer maps codes to problem responses; adapters translate their own failures
  into port-level errors.
- **External formats stay at the edge.** Photon GeoJSON and Overture rows are mapped
  into domain types inside the adapters and never reach the domain or the client.

## SonarCloud quality gate

The project is [marcelomiyake_geotoon on SonarCloud](https://sonarcloud.io/project/overview?id=marcelomiyake_geotoon).
CI runs the scan on every pull request and on `main`, and the **SonarCloud Code Analysis**
check must pass before a pull request can merge.

- Keep the project at **zero issues** (bugs, vulnerabilities, code smells) and **zero
  security hotspots to review**, and keep the quality gate green. Fix every new issue
  in the same pull request.
- Do not hide issues: no `// NOSONAR`, no new `sonar.exclusions` or
  `sonar.coverage.exclusions`, no rule deactivation, and no "won't fix" marks unless
  the owner agrees.
- Keep coverage on new code at or above the gate (the project is above 90%). Add tests
  with every behaviour change.
- ESLint runs `eslint-plugin-sonarjs`, so most SonarCloud rules fail `make lint` first.
  To check before pushing, run `make test` and then `make sonar`.

## Tests

- `make test` runs Vitest projects: `core`, `contracts`, `api-unit`, `api-integration`
  (PostGIS through Testcontainers) and `web` (scene geometry).
- Tests run offline. Adapters are tested against recorded fixtures in `fixtures/`;
  never call Overture or Photon from a test.
- Put tests next to their package in `test/` and name them `*.spec.ts`.
- Code that only draws with WebGL or wires the DOM is excluded from coverage (the list is
  in `vitest.config.ts` and `sonar-project.properties`). Keep logic out of those files
  so it can be tested.

## Commits and pull requests

- `main` is protected: every change goes through a pull request, and the
  `build-test-analyse` and **SonarCloud Code Analysis** checks must pass.
- Work in small steps: one branch per change, one or a few commits per step, then a
  pull request, green CI and a merge commit (`Merge pull request #N: <title>`).
- Write commit messages in [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
  form: `feat(web): ...`, `fix(api): ...`, `docs: ...`, `test(core): ...`,
  `build: ...`, `ci: ...`, `chore: ...`. Explain the reason in the body.
- Commits made by agents end with these footers, following the
  [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) that
  planned the project:

  ```text
  EGM-Stage: implement
  EGM-Agent: elephant (main session, <what drove the change>)
  ```

- Never commit secrets. The repository is public. `SONAR_TOKEN` lives only in the
  environment and in GitHub Actions secrets.

## Code intelligence (LSP)

`.claude/settings.json` enables Anthropic's `typescript-lsp` plugin, which gives Claude
Code type errors after each edit and symbol navigation (definitions, references, call
hierarchy). It starts `typescript-language-server`, which you install once with
`make lsp`. The server uses the workspace TypeScript, and each package's
`tsconfig.json` resolves workspace packages to their sources (`@geotoon/source`
condition), so navigation crosses package boundaries. Prefer the LSP tool to text
search when you look for a symbol's definition or uses.

## Data and attribution

Map data is not under the MIT licence. Keep the attribution the app shows
(`packages/core/src/cartography/domain/attribution.ts`) in line with the sources present
in the data, and keep `fixtures/NOTICE` current when you record new fixtures.
