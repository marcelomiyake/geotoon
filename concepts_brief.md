# GeoToon: Walkable Cel-Shaded 3D Map Built from Open Map Data

* **Author:** Marcelo Miyake
* **Date:** 2026-11-01

## Overview

GeoToon lets a person type an address in a browser and then walk, at street
level, through a cel-shaded 3D model of the area within 1 km of that address.
Cel shading (toon shading) means lighting reduced to a few flat colour bands
plus dark outlines.

- **Address search:** Photon, komoot's open-source geocoder, suggests
  addresses as the user types.
- **Data:** building footprints come from Overture Maps. Streets, land use,
  parks, water and trees come from OpenStreetMap (OSM) through the public
  Overpass API.
- **Storage:** the API stores what it fetches in PostgreSQL with PostGIS, so
  a second request for the same area reads only from the database and does
  not call the sources again.
- **Rendering:** the browser raises the footprints into 3D blocks with
  Three.js and renders a first-person scene at 1.7 m eye height.
- **Packaging:** a TypeScript monorepo (Fastify API, Three.js client),
  shipped as Docker images and one Helm chart that runs on a fresh Kind
  cluster with PostgreSQL in a container.
- **Constraints:** Domain-Driven Design (DDD) and Clean Architecture; zero
  SonarCloud issues.

The user is the owner, running a proof of concept (PoC) at Av. Bolonha, 200,
Jaguaré, São Paulo (lat -23.5486, lon -46.7469). The repository currently
holds only an MIT LICENSE and a Rust `.gitignore` template; no code exists.

This brief combines six independent reviews of the concept. The input was
`/home/marcelomiyake/projects/geotoon/docs/egm/brainstorm_context.md`. The
reviewers found no objection to the rendering approach or to dropping Cesium
and Rust. The risk sits in how data is fetched and stored:

1. **Overpass.** Every new area depends on a public Overpass server whose
   operator asks automated users to run their own instance. The query the
   design will actually send is 1.6 to 2.5 times the area of the only query
   measured to succeed.
2. **Partial data.** "Store once, never refetch" has no rule for when a tile
   is complete. A partial or truncated fetch would be kept, and never
   repaired.
3. **First load.** The first load of a new area takes roughly 50 to 75 s.
   Two things are still undefined: the loading model (one long request, or a
   request followed by polling) and the browser-API contract.

## Analysis

### Reviewers and how findings were merged

| Lens | Brainstorm dimension | Status |
| --- | --- | --- |
| `egm-design` | Cost, quota and architecture bottlenecks | completed |
| `egm-codebase-details` | Observability and operational debugging | completed |
| `egm-zoom-out` | Simplicity, YAGNI and reuse | completed |
| `egm-comprehension` | End-user UX and developer ergonomics | completed |
| `egm-implementation-readiness` | Migration, compatibility and open decisions | completed |
| `egm-structural` | Long-term tech debt and maintainability | completed |

**How findings were merged.**
- Overlapping findings are merged into one entry.
- Each entry takes the highest severity any lens gave it. Where lenses
  disagreed on severity or on the fix, the split is stated.
- "(unverified)" marks an outside fact a reviewer stated with no source in the
  supplied material. Check these before relying on them.
- Figures marked "arithmetic" are calculations, not measurements.

**Terms used below.**
- **Tile:** a zoom-16 "slippy-map" tile, one cell of the Web Mercator grid
  that web maps use (2^16 × 2^16 cells worldwide). About 560 m wide at the
  PoC latitude.
- **Area:** a user request, meaning a point plus a radius.
- **Scene:** what the browser renders.
- **GERS id:** Overture's stable feature identifier.
- **`remark`:** the field Overpass uses to report runtime errors inside an
  otherwise normal response.

### Blocker

#### B1. Public Overpass is on the first-load path, and the planned query is larger than any query that has succeeded

- **Lenses:** `egm-design` and `egm-zoom-out` (Blocker). `egm-structural`,
  `egm-implementation-readiness` and `egm-comprehension` (Major).
- **Problem:**
  - **Fair use.** Every new area needs a public Overpass instance to answer.
    The main instance's error page says the endpoint is meant for
    human-operated tools and recommends a local instance for automated use.
  - **Only one size has worked.** A 1 km-radius circle (about 3.1 km²,
    including buildings) succeeded in 49 s. The 2 km circle (12.6 km²) failed
    on all four instances tried.
  - **The planned query is bigger.** Decision 5 does not query the circle. It
    queries the bounding box of the missing zoom-16 tiles. A 1 km circle
    spans 4 or 5 tiles per axis, depending on where it falls on the grid. The
    box is therefore 2.24 to 2.80 km per side (5.0 to 7.9 km²), which is 1.6
    to 2.5 times the measured area (arithmetic). Leaving out buildings
    shrinks the response by an amount that has not been measured.
  - **Stored tiles get refetched.** When the missing tiles are not next to
    each other, their bounding box also covers tiles already stored, and
    those are fetched again.
  - **Polygons may be missing.** The measured query counted only ways and
    nodes. Parks, land use and water mapped as multipolygon relations are
    either missing or need code to assemble their rings.
  - **No fallback.** If Overpass refuses during the demo, done criterion 1
    fails.
- **Requirement:**
  - Before the PRD, re-measure the exact query the design will send: the
    chosen query unit, no buildings, relations included, `out geom`. Run it
    at least 5 times at different times of day. Record runtime, bytes, HTTP
    status and any `remark`.
  - Choose one source strategy (Key Decision D1):
    - **(a) Overture themes.** Take streets, land use, water and land cover
      from Overture's OSM-derived `transportation` and `base` themes, read
      through the same DuckDB reader as buildings.
      - This removes the Overpass client, ring assembly and the fair-use
        conflict.
      - It changes the checklist wording "ingestion from OSM": the data is
        still OSM under ODbL, but distributed by Overture. Report it the same
        way as the Cesium decision.
      - Not yet measured: tree and park coverage in the PoC area, and query
        time per theme.
    - **(b) Hardened Overpass.**
      - Query per tile, or exactly the requested circle, and never a box that
        contains stored tiles.
      - Set explicit `[timeout:]` and `[maxsize:]`.
      - Allow one request in flight per deployment.
      - Keep an ordered list of endpoints to fall back to.
      - When Overpass fails, show buildings only, with the OSM layers marked
        pending.
    - **(c) One-time OSM extract.** Load a regional OSM extract once with
      `osm2pgsql`. This removes the runtime dependency but adds a heavy
      import to the Kind install.

#### B2. No tile state model: partial and truncated fetches are kept forever, and concurrent requests fetch twice

- **Lenses:** all six.
  - Completeness: Blocker from `egm-design`, `egm-codebase-details`,
    `egm-implementation-readiness`, `egm-structural` and `egm-comprehension`.
  - Concurrency: Blocker from `egm-implementation-readiness` and
    `egm-structural`; Major from `egm-design`, `egm-codebase-details` and
    `egm-comprehension`.
- **Problem:**
  - **Partial tiles.** Each tile has two sources with different failure
    rates, and the concept does not say what is stored when Overture succeeds
    and Overpass fails. If any stored row marks the tile as present, that
    tile has no streets or parks forever. Criterion 2 then guarantees it is
    never repaired.
  - **Truncated responses look like success.** Overpass can return HTTP 200
    with a `remark` such as "runtime error: Query timed out" and a truncated
    or empty element list. A parser that checks only the status stores this
    as complete.
  - **Empty tiles.** A tile with legitimately no features (a river, an empty
    lot) cannot be told apart from a failed one, so it would be refetched on
    every request.
  - **Interrupted writes.** A pod killed mid-write (OOM, failed liveness
    probe, `helm upgrade`) leaves half-written rows, or a tile stuck "in
    progress".
  - **Duplicate fetches.** A reload, a double Enter, a second tab or a second
    replica during a 50 s fetch starts a second Overture read and a second
    Overpass query for the same tiles. That is a refetch. It doubles load on
    a fair-use server and races on inserts. In-process locks do not cover
    several replicas.
- **Requirement:**
  - **State rows.** Keep one state row per (tile, source):
    - States: `missing`, then `fetching` (with a lease expiry), then
      `complete` or `failed` (with a retry-after time).
    - Each row also records attempt count, error class, feature count and
      timestamps.
    - A tile counts as stored only when every required source is `complete`.
  - **Empty and failed results.** A successful response with zero features is
    `complete` with count 0. Any Overpass `remark` that reports an error is
    `failed`, whatever the HTTP status.
  - **Atomic writes.** Write one (tile, source)'s features and its `complete`
    status in one transaction. Never hold a transaction open during a remote
    call.
  - **Retry only what failed.** Refetch only the failed source. The Overture
    read costs about 25 s at any size.
  - **Claims in PostgreSQL, not in memory:**
    - Claim with `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE status =
      'failed' OR lease_expires_at < now() RETURNING`, in sorted key order.
    - Requests that lose the claim wait for completion.
    - The completion write applies only if the worker still holds the lease.
    - The lease length is stated and longer than the worst-case fetch.
      Reviewers suggested 180 s.
  - **Shutdown.** On SIGTERM, mark held leases `failed`. Set
    `terminationGracePeriodSeconds` with the fetch time in mind: the default
    of 30 s is shorter than the measured 49 s Overpass call.
  - **Partial scenes.** Decide whether a partly complete tile is served with a
    flag or the request fails (D7).
  - **Test.** Include two concurrent requests in the criterion 2 test (B6).

#### B3. Storage model: features cross tile edges, and the tile key is undefined

- **Lenses:** `egm-implementation-readiness` and `egm-structural` (Blocker).
  `egm-design`, `egm-zoom-out` and `egm-comprehension` (Major).
- **Problem:**
  - **Features cross tile edges.** A bounding-box query returns whole
    features, including streets, rivers, parks and buildings that cross tile
    edges.
    - Stored once per tile, they are drawn twice: overlapping meshes and
      double collision.
    - Clipped at tile edges, they lose their original geometry and leave
      seams, which the ink outlines will draw.
  - **Zoom must stay fixed.** If the zoom level is a Helm value, or is not
    stored, changing it makes every stored row unreachable.
  - **Rule or grid changes force refetches.** If features carry a tile
    foreign key, or only derived values, then changing the grid or the height
    rule forces a refetch. Criterion 2 forbids that, and it becomes
    impossible once the Overture release is deleted (B9).
- **Requirement:**
  - **Store each feature once**, keyed by source and stable source ID
    (Overture GERS id; OSM type plus id), with idempotent upserts.
  - **Keep geometry whole:** unclipped, repaired at ingestion
    (`ST_MakeValid`), in one SRID. EPSG:4326 is recommended.
  - **Track coverage separately**, keyed by (zoom, x, y, source). This is the
    B2 state table.
  - **Read by location.** Read features with a spatial query on the requested
    circle, not by tile ID. The grid stays inside the server and does not
    appear in the API contract or the client.
  - **Fix the zoom.** Zoom 16 is a code constant, not a Helm value.
  - **Per-tile payloads (if chosen, D9).** Each feature belongs to exactly one
    tile, the one containing its representative point (`ST_PointOnSurface`).
    The client removes duplicates by ID.
  - `egm-zoom-out` questions the grid itself (D3).

#### B4. The first load takes roughly 50 to 75 s, and the loading model is undecided

- **Lenses:** `egm-codebase-details`, `egm-implementation-readiness` and
  `egm-comprehension` (Blocker). `egm-design`, `egm-structural` and
  `egm-zoom-out` (Major).
- **Problem:**
  - **Measured times.** Overture took 25 s. Overpass took 49 s on a smaller
    query than planned (B1).
    - Run one after the other, that is about 74 s; run in parallel, about
      50 s.
    - One instance gave no answer in 200 s.
    - The context's "25 to 50 s" assumes parallel fetches without saying so
      and leaves out insert time.
  - **Proxy timeouts.** Common proxy read timeouts are 60 s (the ingress-nginx
    default). With one long request, the browser gets a 504 while the API
    logs success. The retry is then fast because the tiles are now stored,
    which hides the cause.
  - **Lost work.** If the HTTP handler owns the fetch, a client disconnect can
    abort work that should have been stored.
  - **Late switch is costly.** Changing later from one synchronous call to a
    request followed by polling changes the contract, the client flow and the
    error handling all at once.
  - **Reviewers disagree on the model.**
    - Five lenses favour a request that returns immediately, followed by
      polling.
    - `egm-zoom-out` argues against a job system: it would be the largest
      code addition on the list, for one user path with no latency criterion.
      It prefers one synchronous endpoint that fetches both sources
      concurrently, with timeouts above the worst case.
- **Requirement:**
  - **Record the choice before coding (D2).** The option that answers both
    sides:
    - The area request returns `ready`, or `pending` with per-tile state,
      immediately.
    - The client polls the same resource every 1 to 2 s.
    - The B2 state table serves as the job state, so no queue, worker or
      Redis is needed.
    - Ingestion runs outside the request's lifetime and is idempotent, so a
      retry continues instead of restarting.
  - **Fetch in parallel.** Fetch Overture and Overpass at the same time.
  - **If the synchronous model is kept,** write down the timeout chain. Each
    source timeout is shorter than the API request timeout, which is shorter
    than the proxy timeout, which is shorter than the browser abort.
  - **Show progress:**
    - elapsed time;
    - which source is being waited on;
    - how many tiles are already stored;
    - a note that later visits are fast.

    Do not promise a duration until the B1 measurements exist.
  - **Record phase timings** (lookup, Overture, Overpass, write, read,
    serialize) in one log line per request and in a `Server-Timing` response
    header.

#### B5. No browser-API contract

- **Lenses:** `egm-comprehension` and `egm-implementation-readiness`
  (Blocker). `egm-structural` (Major).
- **Problem:** Nothing defines the endpoints, payload, status model, error
  schema, coordinate convention or versioning, so the client and server cannot
  be built or tested in parallel. There are three coordinate traps:
  - **Axis order.** Photon returns GeoJSON as [lon, lat]. Overpass `around`
    takes lat,lon. PostGIS `ST_MakePoint` takes lon,lat.
  - **Projection.** Zoom-16 tiles are Web Mercator, which at -23.5° latitude
    stretches lengths by about 9% (arithmetic: 1/cos 23.55°). A client that
    renders Mercator metres draws buildings, and sets walking speed, 9% off.
  - **Origin.** Tiles are shared by requests with different centres, so
    stored geometry cannot be relative to one request's centre.
- **Requirement:**
  - **Versioning.** An `/api/v1` prefix, a `contractVersion` field, and only
    additive changes within v1.
  - **One definition.** Define schemas once, in a shared `contracts` package
    (TypeBox or Zod). Fastify uses them for validation and serialization; the
    client uses them for types.
  - **Coordinates.** On the wire, use GeoJSON order (lon, lat, WGS84). The
    client converts to local metres around the chosen point, in float64
    before converting to float32. It does not use Mercator metres.
  - **Feature fields:**
    - Buildings: GERS id, footprint rings, `heightM`, `heightSource`
      (`measured | floors | estimated`), class.
    - Roads: OSM id, class, name, width.
    - Areas: kind.
    - Trees: points.
  - **Geocoding.** The geocoding endpoint returns the API's own suggestion
    type, never Photon's raw GeoJSON.
  - **Starting endpoint set** (from `egm-comprehension`):
    - `GET /api/v1/geocode`
    - `POST /api/v1/areas`: 200 when ready, 202 when pending
    - `GET /api/v1/areas/{id}`
    - optionally `GET /api/v1/tiles/16/{x}/{y}`
    - `/healthz` and `/readyz`

    Decide between one scene payload and per-tile payloads (D9).
  - **Errors.** Use one error envelope for every endpoint (M5).

#### B6. Done criterion 2 cannot be proven

- **Lenses:** `egm-codebase-details` (Blocker).
  `egm-implementation-readiness`, `egm-zoom-out` and `egm-comprehension`
  (Major).
- **Problem:**
  - **No record of reads.** Nothing records whether a request read stored
    tiles or called a source. A faster second request does not show that
    PostGIS was read, rather than an in-process cache or the browser's cache.
  - **DuckDB is invisible to HTTP counting.** Overture is read through
    DuckDB, not the app's HTTP client, so an HTTP interceptor would not count
    those calls.
  - **Geocoder drift.** If Photon returns a slightly different point,
    different tiles are fetched legitimately. That looks like a cache failure.
  - **Contract change.** Adding a hit/miss indicator later changes the
    contract.
- **Requirement:**
  - **Response fields.** The area response lists each covering tile with its
    origin (`stored | fetched | failed`) and gives a count of source calls
    per source.
  - **Count at the port.** Count source calls at the source port (the domain
    interface), so DuckDB and HTTP calls are counted the same way.
  - **Integration test.** Run against real PostGIS, with stub sources that
    fail if they are called during the second request. Include a case with
    two concurrent requests.
  - **Kind-level check** (for example `make verify-cache`):
    1. Call the area endpoint by lat/lon (no Photon).
    2. Point the source URLs at an unreachable host through a Helm value.
    3. Restart the API and PostgreSQL pods.
    4. Call again; it must still succeed.
  - **No hidden caches.** Have no in-process scene cache, and send
    `Cache-Control: no-store` on the area endpoint; otherwise report any such
    cache in the response. Per-tile endpoints may use ETags (N2), but the
    check must bypass the browser cache.

#### B7. Schema creation and migrations on a fresh `helm install` are undefined

- **Lenses:** `egm-implementation-readiness` (Blocker). `egm-structural`,
  `egm-comprehension` and `egm-zoom-out` (Major).
- **Problem:**
  - **Each obvious Helm option fails in its own way:**
    - A Helm `pre-install` hook runs before the in-chart PostgreSQL exists, so
      a fresh install hangs or fails.
    - A `post-install` hook combined with `--wait` can deadlock if API
      readiness depends on the schema. This is Helm 3 behaviour; it is
      unverified on Helm 4.3.
    - An init container in an API Deployment with several replicas runs
      migrations concurrently.
    - A plain (non-hook) Job makes `helm upgrade` fail whenever its template
      changes, because Job templates cannot be changed.
  - **Superuser needed.** `CREATE EXTENSION postgis` needs a superuser.
  - **No versioning.** Without versioned migrations, every schema change means
    dropping data, which forces refetching.
- **Requirement:**
  - **Pick the mechanism (D6).** The reviewers differ:
    - `egm-implementation-readiness` and `egm-structural`: versioned SQL
      migrations with node-pg-migrate or the Kysely/Drizzle migrator. Not
      Prisma, which has no native geometry type. They run in an init
      container in the API pod, using the same image; it waits for
      PostgreSQL and takes an advisory lock.
    - `egm-zoom-out`: no migration framework. Either mount the schema as a
      ConfigMap in `/docker-entrypoint-initdb.d`, or run idempotent SQL at
      API startup.
  - **Roles and PostGIS.** State which database role runs migrations and
    whether the app uses the same role. State whether PostGIS is enabled by
    the image's init script or by migration 0001.
  - **Version checks.**
    - Readiness fails until the expected schema version exists.
    - The API refuses to start if the database is behind its version.
    - It starts with a warning if the database is ahead, which is needed for
      rollback (M8).
  - **Packaging.** Copy the migration files into the image; `tsc` does not
    copy `.sql` files.

#### B8. A browser cannot reach the app on a fresh Kind cluster, and Kind cannot see local images

- **Lenses:** `egm-comprehension` (Blocker). `egm-zoom-out`,
  `egm-implementation-readiness` and `egm-structural` (Major).
  `egm-codebase-details` (Nit, on CORS).
- **Problem:**
  - **No route from the host.** Done criterion 3 says the app "loads in the
    browser". A default `kind create cluster` has no ingress controller and
    no host port mappings, and ClusterIP Services cannot be reached from the
    host.
  - **Ingress is not "helm install" alone.** An Ingress needs a controller
    installed first. ingress-nginx's 60 s default read timeout is shorter than
    the first load. Kubernetes SIG Network announced its retirement in late
    2025 (current status unverified).
  - **Two origins.** Separate web and API Services need two forwarded ports
    and CORS. CORS failures appear in the browser as opaque errors.
  - **Images.** Kind nodes cannot see images in the host's Docker daemon. An
    image tagged `latest` defaults to `imagePullPolicy: Always` and fails
    with `ErrImagePull`.
- **Requirement:**
  - **One origin.** Fastify serves the built client (`@fastify/static`). That
    gives one app image and one Service, plus the PostGIS image.
  - **Default access.** Use `kubectl port-forward svc/geotoon 8080:80`, which
    works on a default cluster, and print it in the chart's `NOTES.txt`.
    Optionally ship a `kind-config.yaml` with `extraPortMappings` and a
    NodePort values file. No ingress controller.
  - **Image tags.** Tag images with the git SHA and set
    `imagePullPolicy: IfNotPresent`.
  - **Getting images into the cluster.** Either publish them to a registry
    the cluster can pull from (public GHCR; `gh` is available) and make those
    the chart defaults, or document `kind load docker-image` as the one step
    before install.
  - **Acceptance command.** Document `helm install --wait --timeout 5m`.

#### B9. The pinned Overture release will be deleted from S3

- **Lenses:** `egm-structural` (Blocker). `egm-design`,
  `egm-implementation-readiness`, `egm-zoom-out` and `egm-comprehension`
  (Major).
- **Problem:**
  - **The release will disappear.** The S3 path names release
    `2026-10-21.0`, and Overture removes old releases after a period the
    context does not state. After removal, every new area fails on a fresh
    install, so criteria 1 and 3 hold only for weeks or months. Cached areas
    keep working, so the failure shows up late.
  - **Schema changes.** Overture's schema changes between releases (reviewers
    cite a bbox field rename; unverified). Moving the pin can therefore break
    the query.
  - **Mixed releases.** Tiles fetched under different releases sit side by
    side and can disagree at their edges.
- **Requirement:**
  - **Provenance.** Record the release on each stored fetch (M3).
  - **Specific error.** Fail with an error (`OVERTURE_RELEASE_NOT_FOUND`) that
    names the missing path and the setting to change.
  - **Tests.**
    - A fixture test runs the query against the schema of the pinned release.
    - A small opt-in live check detects a removed path or changed columns.
  - **Where the pin lives is disputed (D4):**
    - `egm-implementation-readiness`: a code constant tied to a tested query.
    - `egm-structural`, `egm-design` and `egm-zoom-out`: a Helm value,
      optionally resolved at startup from Overture's STAC catalog or the
      bucket's `release/` listing.
  - **Policy.**
    - Changing the pin does not invalidate complete tiles.
    - Mixed releases are accepted and recorded.
    - A purge command exists (M20).
    - Document the retention period, with a source.

### Major

#### M1. DuckDB inside a pod: memory, CPU, extensions and native bindings

- **Lenses:** all six.
- **Problem:**
  - **Memory and CPU.** The 25 s figure is one sample, taken on the
    workstation. DuckDB sizes its threads and memory from what it detects.
    Inside a pod with limits (which SonarCloud's Kubernetes rules push for),
    it may size itself from the host's 31 GB and be OOM-killed. If it runs in
    the API process, cached reads go down with it.
  - **Extensions.** DuckDB keeps `httpfs` and `spatial` under the user's home
    directory and downloads them on first use.
    - Suppose they are installed at build time as root, and the container
      runs as non-root or with a read-only root filesystem. DuckDB then looks
      elsewhere and tries to download them again.
    - Without internet this fails. With internet it works and hides the
      packaging error.
  - **Version coupling.** Extensions are built for each DuckDB version, so
    every DuckDB upgrade must re-bake them.
  - **Platform coverage.** Prebuilt binaries cover only some OS, libc and
    architecture combinations; musl (Alpine) and arm64 may lack them.
  - **Deprecated package.** The legacy `duckdb` npm package is deprecated in
    favour of `@duckdb/node-api` (current status unverified).
- **Requirement:**
  - **Package and image.** Use `@duckdb/node-api`, pinned exactly, on a glibc
    base image. Only the Overture adapter imports it.
  - **Extensions:**
    - Install them at image build into a fixed `extension_directory` that the
      runtime user can read.
    - Set `autoinstall_known_extensions=false`.
    - Run `LOAD httpfs; LOAD spatial;` at startup and fail loudly if either
      fails.
    - Add a check that loads both with no network.
  - **Resources.** Set `memory_limit`, `threads` and `temp_directory` from
    configuration so they fit the pod limits.
  - **One instance.** Keep one long-lived instance with the Parquet metadata
    cache on.
  - **Measure inside Kind:** cold and warm query time, peak RSS, and bytes
    transferred.
  - **Maybe drop `spatial`.** Check whether it is needed at all: the bbox
    filter can use the plain `bbox` columns, and geometry can go to PostGIS
    as WKB through `ST_GeomFromWKB`.
  - **Optional (`egm-design`):**
    - Run ingestion as a separate Deployment from the same image.
      `egm-zoom-out` prefers a single API process.
    - Use the STAC file extents so DuckDB reads only the files that intersect
      the area. This might cut the 25 s; it has not been measured.

#### M2. Height estimation needs stored inputs, a stable seed and a version number

- **Lenses:** `egm-implementation-readiness` and `egm-structural` (Major).
  `egm-codebase-details` (part of M3). `egm-zoom-out` (Nit).
- **Problem:**
  - **The skyline is mostly the rule.** About 99% of buildings within 1 km
    have no height, and the rule is likely to change. If only the estimated
    height is stored, changing the rule means refetching.
  - **Unstable seeds.** The "deterministic variation" is not deterministic if
    it is seeded from an array index, a database serial ID or a library's
    random generator. Heights then change after re-ingestion or a library
    upgrade.
  - **Class coverage unknown.** How many buildings within 1 km have a `class`
    was not measured. If most are null, the per-class default table collapses
    to one value.
- **Requirement:**
  - **Store the raw inputs:** Overture `height`, `num_floors`, `min_height`,
    `class`, `subtype` and `sources[].dataset`, plus the OSM tags the rule
    uses.
  - **A pure function.** The rule is a pure domain function with a
    `rule_version`. It is seeded by the GERS id through a named hash
    implemented in the repo, and covered by tests that pin outputs for real
    IDs.
  - **Return `heightSource`** (`measured | floors | class_default`) with every
    building. The server computes heights; the client receives final values.
  - **When to compute.** Either at read time (`egm-structural`), or at ingest
    with the raw inputs kept and `ingest_version` raised whenever the rule
    changes (`egm-zoom-out`, `egm-implementation-readiness`).
  - **Measure first.** Measure `class` coverage before building a per-class
    table.

#### M3. Provenance is not recorded

- **Lenses:** `egm-codebase-details`, `egm-implementation-readiness`,
  `egm-structural`, `egm-design` and `egm-comprehension`.
- **Problem:** Without the source and version on each stored fetch, nobody can
  explain a scene built from two releases, invalidate data selectively, show
  correct attribution, or tell measured heights from estimates.
- **Requirement:**
  - **Per (tile, source) fetch row:**
    - source;
    - Overture release, or Overpass `osm3s.timestamp_osm_base`;
    - endpoint and query hash;
    - request ID;
    - start and finish time (UTC) and duration;
    - status, error class and bytes;
    - feature counts per layer;
    - app git SHA and `ingest_version`.
  - **Per feature:** source ID; `sources[].dataset` for buildings;
    `height_source`.
  - **Duplicates.** A unique constraint on source ID per layer. Log how many
    duplicates were skipped.

#### M4. Request tracing and log content

- **Lenses:** `egm-codebase-details`.
- **Problem:**
  - **No shared ID.** Without one, a browser symptom can only be matched to
    the logs by timestamp.
  - **Short log history.** `kubectl logs` keeps only the current and previous
    container's logs.
  - **Repeating IDs.** Fastify's default request IDs (`req-1`, ...) repeat
    after every restart.
  - **Noise and personal data.** Full Overpass bodies (about 1 MB) would flood
    `kubectl logs`. Raw typed addresses would keep personal data for no
    debugging gain.
- **Requirement:**
  - **Request ID.** Generate a random ID (`genReqId`) and return it in a
    header. Show it in client error messages and store it on provenance rows.
  - **What to log.**
    - One info line per area request and one per source fetch.
    - No response bodies or geometries.
    - Rounded coordinates instead of typed addresses.
  - **How to log.** Inject a logger port into use cases. No `console` calls in
    the API.

#### M5. Outbound calls lack timeouts and error classes, and user-facing errors are undefined

- **Lenses:** `egm-codebase-details`, `egm-comprehension`, `egm-design` and
  `egm-structural`.
- **Problem:**
  - **Hangs.** One Overpass instance gave no answer in 200 s. Without
    client-side timeouts, a request or a lease hangs indefinitely.
  - **Unclear errors.** DuckDB and S3 errors surface as raw driver text, and
    a removed release becomes a generic 500.
  - **No error codes.** Without stable codes, the browser would have to parse
    message text to choose what to show.
  - **No user messages.** The concept does not say what the user sees when
    Overpass is busy, S3 fails, Photon is down, or the point has no data.
- **Requirement:**
  - **Timeouts on every adapter**, all shorter than the lease:
    - Overpass: `[timeout:]` plus a slightly longer HTTP timeout.
    - DuckDB: interrupt the query.
    - Photon: a few seconds.
  - **Error classes** stored in provenance and logs: `timeout`, `network`,
    `http_4xx`, `http_429`, `http_5xx`, `source_runtime_error`,
    `release_not_found`, `parse_error`.
  - **Fair-use behaviour:**
    - Respect 429 and `Retry-After`.
    - Back off, with a cap on attempts.
    - Record `next_retry_after` on each failed tile.
    - Send an identifying User-Agent with a contact address.
  - **Error envelope.** One envelope for all endpoints: RFC 9457 Problem
    Details plus `code`, `retryable`, `retryAfterSeconds` and `requestId`.
    Initial codes (from `egm-comprehension`):
    - `INVALID_COORDINATES`
    - `GEOCODER_UNAVAILABLE`, `GEOCODER_RATE_LIMITED`
    - `OVERPASS_RATE_LIMITED`, `OVERPASS_TIMEOUT`, `OVERPASS_INCOMPLETE`
    - `OVERTURE_UNAVAILABLE`, `OVERTURE_RELEASE_NOT_FOUND`
    - `NO_DATA_IN_AREA`
    - `JOB_NOT_FOUND`
    - `INTERNAL`
  - **Failure table in the PRD.** For each failure, give the message the user
    sees, the actions offered, and the server's retry policy. Never show raw
    upstream text; show the request ID.

#### M6. Probes, startup checks and version identity

- **Lenses:** `egm-codebase-details`, `egm-implementation-readiness`,
  `egm-comprehension` and `egm-design`.
- **Problem:**
  - **Early return.** Without readiness probes, `helm install --wait` can
    return before the API can serve.
  - **Wrong dependency.** A readiness probe that checks Overpass, Photon or S3
    would let a source outage make cached areas unavailable too, which
    defeats criterion 2.
  - **Late discovery.** Missing outbound internet in Kind only shows up after
    a 50 s wait on the first request.
  - **Stale code.** A rebuilt image loaded under the same tag does not restart
    running pods, so old code keeps running.
- **Requirement:**
  - **Liveness** checks the process only.
  - **Readiness** checks a database round trip, that PostGIS is present, the
    schema version, and that the DuckDB extensions loaded. It never checks
    external sources.
  - **PostgreSQL** uses `pg_isready` probes. The API retries its database
    connection at startup.
  - **Startup log line** with:
    - git SHA;
    - Overture release;
    - radius and zoom;
    - stored tile count;
    - a non-blocking reachability result for Photon, Overpass and S3.
  - **Version endpoint.** `/version` (or the health payload) reports git SHA,
    build time, schema version and Overture release. The client debug overlay
    (M18) shows it.

#### M7. PostgreSQL persistence, credentials and image choice

- **Lenses:** all six.
- **Problem:**
  - **emptyDir loses the cache.** With `emptyDir` storage, a pod restart
    erases every tile and the next request refetches, which looks like
    criterion 2 failing.
  - **Reinstall breaks the password.** A PVC from StatefulSet
    `volumeClaimTemplates` survives `helm uninstall` by default. On
    reinstall, a password generated with `randAlphaNum` no longer matches,
    because the postgres image applies `POSTGRES_PASSWORD` only to an empty
    data directory.
  - **A PVC written as a chart template** is deleted on uninstall.
  - **Kind storage.** Kind's `standard` StorageClass keeps data inside the
    node container, loses it on `kind delete cluster`, and ignores the
    requested size. `volumeClaimTemplates` fields cannot be changed on
    upgrade.
  - **Common database charts do not fit.**
    - Bitnami's PostgreSQL image lacks PostGIS, and Bitnami restricted its
      free catalog in 2025 (unverified).
    - CloudNativePG needs an operator and CRDs installed before the app
      chart.
  - **Image risks.**
    - A floating PostGIS tag can jump a major version and then refuse the
      existing data directory.
    - The `postgis/postgis` entrypoint starts as root, which Sonar's
      Kubernetes rules flag.
  - **Cache or record?** The concept never says whether PostGIS is a
    rebuildable cache or a system of record. That decides whether migrations
    may drop data, whether backups are needed, and what uninstall should do.
- **Requirement:**
  - **Record this statement:** "PostGIS holds a rebuildable cache of
    external sources. No backups. Migrations may truncate tile tables; the
    consequence is refetching from the release currently pinned." Also
    document that the cache lives only as long as the cluster.
  - **Run PostgreSQL as a single-replica StatefulSet in the same chart:**
    - a pinned `postgis/postgis` tag of the form
      `<pg-major>-<postgis-minor>`, preferably by digest;
    - a PVC from `volumeClaimTemplates` on the default StorageClass;
    - an explicit, documented `persistentVolumeClaimRetentionPolicy`;
    - `PGDATA` in a subdirectory of the mount (check the PostgreSQL 18
      default path change);
    - UID 999 with `fsGroup`.
  - **Stable credentials.** Take them from a fixed Helm value, a Secret
    annotated `helm.sh/resource-policy: keep`, or a `lookup` of the existing
    Secret. Never regenerate them.
  - **Fixed storage.** Treat storage size and StorageClass as fixed after the
    first install.

#### M8. Rollback and rolling upgrades run old code against a newer schema

- **Lenses:** `egm-implementation-readiness`.
- **Problem:** `helm rollback` reverts manifests and images, but never the
  schema. Old pods then either refuse to start (so the rollback fails) or
  crash on a renamed column. A rolling upgrade also runs old and new pods side
  by side.
- **Requirement:**
  - **Expand then contract.** Migrations are forward-only. A release may only
    add things, or drop things the previous release no longer reads.
  - **Tolerate a newer schema.** The API accepts a database ahead of its own
    version, with a warning, and fails only when the database is behind.
  - **No down migrations.** Truncating the tile tables is the documented
    escape route.

#### M9. Tests must run without network access, and the test command is undefined

- **Lenses:** `egm-design`, `egm-structural`, `egm-zoom-out`,
  `egm-comprehension` and `egm-implementation-readiness`.
- **Problem:**
  - **Live calls make tests unreliable.** If `make test` reaches S3,
    Overpass or Photon, criterion 4 fails whenever they do (a 502 "at
    capacity" has already been seen). Each run would add about 50 s of
    automated Overpass load, and results would shift with each Overture
    release.
  - **Command undefined.** `make test` is only an assumption, and Make is not
    in the list of local tools.
- **Requirement:**
  - **`make test` runs offline:**
    - unit tests on the domain and use cases, with in-memory fakes;
    - adapter tests against recorded payloads: one Overpass response and a
      small Parquet extract for the PoC, with an ODbL NOTICE file, because
      the repo's MIT licence does not cover OSM-derived data;
    - PostGIS integration tests through Testcontainers (`postgis/postgis`),
      including a test that applies every migration to an empty database;
    - a headless-browser smoke test with software WebGL on recorded data
      (`egm-comprehension`).
  - **Live tests opt-in only**, for example `make test-live`.
  - **Toolchain.** Record the package manager, lockfile and test runner.
    Vitest was suggested for both server and client.
  - **Command name.** Decide between `make test` and `npm test` (D10).

#### M10. "Zero SonarCloud issues" is ambiguous and will drift

- **Lenses:** `egm-structural`, `egm-zoom-out`, `egm-comprehension` and
  `egm-implementation-readiness`.
- **Problem:**
  - **Issues are not the whole picture.**
    - SonarCloud lists security hotspots separately from issues, and several
      Docker and Kubernetes findings (such as running as root) are hotspots.
    - Coverage and duplication are quality-gate conditions, not issues. The
      default gate requires 80% coverage on new code, and WebGL code is hard
      to cover in Node.
  - **Analysis mode trap.** GitHub projects start with Automatic Analysis on.
    Running `sonar-scanner`, which is needed to import coverage, fails while
    it is on.
  - **Drift without code changes.**
    - The Sonar way profile gains new rules.
    - Deprecation rules fire after Three.js, Fastify or `@types` upgrades.
    - Issues closed in the UI live only on the server.
  - **Sources of new issues.**
    - Geometry, triangulation and collision code tends to exceed the
      cognitive-complexity limit.
    - Three.js example code copied into the repo would be analysed.
    - `.sql` migration files may be sent to a non-PostgreSQL SQL analyser and
      flagged on valid PostGIS syntax (unverified).
    - Build output, coverage reports and fixtures inflate the count if
      analysed.
- **Requirement:**
  - **Define criterion 5 exactly:** zero open issues on `main` at delivery,
    plus a stated position on hotspots and the quality gate (D5).
  - **One analysis mode.** Run the scanner from CI (GitHub Actions with the
    `SONAR_TOKEN` secret), with Automatic Analysis off, and import lcov
    coverage.
  - **Controlled rules.** Use an org quality profile copied from Sonar way,
    so rule changes are deliberate.
  - **Settings in the repo.**
    - Every exclusion lives in `sonar-project.properties`, with a reason.
    - Tests are analysed as tests.
    - Fixtures, `dist/` and `coverage/` are excluded.
  - **Three.js add-ons** are imported, never copied into the repo.
  - **Migration files.** Decide their format and the matching Sonar suffix
    setting.
  - **Upgrades.** Run analysis before merging dependency upgrades.

#### M11. External data formats must stop at the adapters

- **Lenses:** `egm-structural` (Major). `egm-implementation-readiness` (part
  of its contract finding).
- **Problem:** Each source brings its own format and vocabulary:
  - Overture GeoParquet: WKB geometry, nested structs, a schema that changes
    per release.
  - Overpass JSON: elements, open-ended tag values, relation members.
  - Photon GeoJSON: free-form properties.

  If these reach the domain, the database or the client, every upstream change
  spreads across layers.
- **Requirement:**
  - **One adapter per source**, translating into domain types only.
  - **Closed domain vocabularies** (StreetClass, AreaKind, BuildingClass,
    TreePoint), each with an `other` value. The tag-to-vocabulary table lives
    in the adapter.
  - **Assembly and repair at ingestion**, never in the client. This covers
    relation assembly (or `osmtogeojson`) and geometry repair.
  - **Separate ports** for the geocoder, the building source and the map
    feature source.
  - **Batching per adapter.** Overture: one query for all missing tiles.
    Overpass: bounded queries.
  - **Recorded-payload tests.** Each adapter is tested against a recorded
    payload, so an upstream format change shows up as one failing test.

#### M12. Package boundaries and how much DDD to apply

- **Lenses:** `egm-structural`, `egm-zoom-out` and `egm-comprehension`.
- **Problem:**
  - **Shared domain package.** The easy path is one package of domain types
    imported by both the API and the browser. That ties the client build to
    domain internals and ships domain code in the bundle.
  - **No enforcement.** Nothing in `tsc` stops the domain importing pg,
    DuckDB or Fastify.
  - **Ceremony.** Full tactical DDD across many layers, for about three use
    cases, multiplies mapping code, which SonarCloud will flag as
    duplication.
  - **Geocoding has no rules.** It is a pass-through.
- **Requirement:**
  - **Packages:**
    - `core`: domain, use cases and ports. No I/O libraries, Node built-ins,
      Fastify, pg, DuckDB or Three.js.
    - `contracts`: wire schemas. Imports nothing from `core`.
    - `api`: Fastify, the adapters and the composition root.
    - `web`: Three.js. Imports only `contracts`.

    Use npm workspaces and `tsc -b`; no Nx, Turborepo or Lerna.
  - **Enforce direction.** Check dependency direction with dependency-cruiser
    or an ESLint boundaries rule inside the test command.
  - **Use DDD patterns only where a rule exists:** height, classification and
    tile state.
    - Geocoding is an application service with a port.
    - The read path may query PostGIS and map straight to the contract.
    - No domain events, CQRS bus, DI container or generic repository.
  - **Bounded contexts are disputed (D11).** `egm-structural` and
    `egm-zoom-out` say one context. `egm-comprehension` says three:
    Geocoding, Area Acquisition and Scene. Record the choice and a folder map.

#### M13. Photon autocomplete: load on a shared public instance, and a single point of failure

- **Lenses:** `egm-design`, `egm-comprehension` and `egm-zoom-out`.
- **Problem:**
  - **Shared public instance.** Every keystroke goes from the cluster's one
    public IP to photon.komoot.io, a free fair-use instance with no
    availability guarantee. Its usage terms were not recorded, and only one
    request was tested.
  - **Request volume and ordering.** Without debounce and cancellation, typing
    one address sends 20 or more requests, and late responses replace newer
    ones.
  - **Undefined behaviour:**
    - Enter with nothing selected.
    - Which result types are allowed (choosing "Brazil" gives a point with no
      data).
    - What happens when Photon is down. Then no address can be entered and
      criterion 1 fails.
- **Requirement:**
  - **Client:**
    - Debounce 250 to 300 ms; require at least 3 characters.
    - Cancel the previous request on each keystroke (AbortController).
    - Show at most 5 suggestions.
  - **Server:**
    - A short-lived cache keyed on the normalised query.
    - An identifying User-Agent and a configurable Photon URL.
    - Respect 429 responses.
  - **Result types.** Restrict them with Photon's `layer`/`osm_tag` filters
    (check the parameter names).
  - **Keyboard.** Follow the ARIA combobox keyboard pattern.
  - **Fallback.** Accept a pasted "lat, lon".
  - **Attribution.** Show "Search by Photon" next to the suggestions.
  - **Terms.** Record Photon's usage terms.

#### M14. Spawn position

- **Lenses:** `egm-zoom-out` and `egm-comprehension`.
- **Problem:** A geocoded house-number point often lies inside a footprint.
  With collision on, the camera starts trapped. Without it, the first frame
  shows walls from the inside. Nothing marks which building is the address.
- **Requirement:**
  - **Spawn point from the server.** Either the nearest point on the nearest
    walkable road (`ST_ClosestPoint`) or a point 1 to 2 m outside the nearest
    footprint, facing the address.
  - **Mark the address.** Show a marker above it and highlight its building.

#### M15. Street-level controls, device scope and the edge of the area

- **Lenses:** `egm-comprehension`.
- **Problem:**
  - **Pointer lock.** It starts only from a click, Esc always exits it, and
    browsers refuse to re-lock immediately.
  - **Keys.** WASD assumes a QWERTY keyboard. Typing in the search box must
    not move the camera.
  - **Distance.** At 1.4 m/s, the edge of the area is 12 minutes away.
  - **Touch.** Phones have no mouse to lock.
  - **Area shape.** The stored data is a 2.2 to 2.8 km square of whole tiles,
    not centred on the point, while the user is told "1 km radius". Nothing
    stops the user walking off the data onto an empty plane.
- **Requirement:**
  - **Controls:**
    - A "Click to walk" overlay to start.
    - Esc opens a pause screen with Resume, New address, Controls and
      Attribution.
    - Read keys by `KeyboardEvent.code` (physical position) and also accept
      the arrow keys.
    - Shift to run, with speeds stated in the PRD.
    - Keyboard turning as an alternative to the mouse.
    - Handle `pointerlockerror`.
    - A controls legend on first entry.
    - Ignore movement keys while a text input has focus.
  - **Desktop only (D12).** Detect touch-only devices before any area request
    and show a message.
  - **Edge of the area (D8):**
    - Clip rendering to the 1 km circle, keeping a feature whole if its
      representative point is inside.
    - Add distance fog.
    - Put an invisible wall at the radius, with a message.

#### M16. Scene readability at eye height, and rendering reuse

- **Lenses:** `egm-comprehension`, `egm-zoom-out`, `egm-design` and
  `egm-structural`.
- **Problem:**
  - **Flicker.** At 1.7 m the ground is seen at grazing angles. Ground layers
    in the same plane (land use, parks, water, roads) flicker there.
  - **Roads.** OSM roads are centre-lines and need widths.
  - **Merged blocks.** With 2 to 3 lighting bands, neighbouring walls that
    face the same way merge into one block.
  - **Sparse trees.** There are only 32 tree points within 1 km.
  - **Orientation.** There is no compass or map.
  - **Custom shaders.** Hand-written GLSL toon shaders are not analysed by
    Sonar and do not run on Three.js's newer WebGPU renderer. Three.js does
    not follow semantic versioning.
  - **Draw calls.** 6,719 separate building meshes would mean as many draw
    calls. The triangle estimate leaves out streets, trees and the outline
    pass, and "extrusion takes milliseconds" is an estimate.
- **Requirement:**
  - **Legibility:**
    - A fixed draw order, plus a small height step or polygon offset per
      ground layer, checked at eye height.
    - Road widths by OSM highway class, or `ST_Buffer` ribbons built in SQL.
    - Building colour varied deterministically by class and ID.
    - Ink outlines, with the method stated.
  - **Three.js built-ins, imported from `three/addons`:**
    - `MeshToonMaterial` with a stepped `gradientMap`;
    - `OutlineEffect` or `EdgesGeometry`;
    - `ExtrudeGeometry`;
    - `BufferGeometryUtils.mergeGeometries` per tile and layer;
    - `PointerLockControls`.

    Stay on `WebGLRenderer` and pin the exact Three.js version.
  - **Client split:**
    - a pure scene builder (contract data to typed arrays and collision
      footprints, testable in Node);
    - a thin rendering module;
    - the controls.
  - **Measure before replacing.** Time `ExtrudeGeometry` on the PoC data
    before writing a custom extruder.
  - **Orientation and honesty.** Add a compass and the nearest street name,
    and an "About this scene" note: heights are mostly estimated, the ground
    is flat, trees are sparse.
  - **Acceptance check.** A street-level screenshot at the PoC address in
    which individual buildings can be told apart.

#### M17. Attribution

- **Lenses:** `egm-comprehension` (Major). `egm-structural` (Nit).
- **Problem:**
  - **No place on screen.** Attribution is required, but where it appears is
    undefined, and links cannot be clicked under pointer lock.
  - **Incomplete list.** Overture buildings combine several upstream
    datasets, and Overture publishes attribution requirements per theme.
  - **Stale text.** Fixed text goes wrong if the sources change (B1).
- **Requirement:**
  - **Placement.** Persistent corner text while walking, and clickable links
    on the pause and search screens.
  - **Wording.** Take the exact text from Overture's attribution page and
    OSM's copyright page, and record where each line came from.
  - **Preferably derived.** The API returns the attribution list derived from
    the provenance of the returned features.

#### M18. Debugging a broken scene in the browser

- **Lenses:** `egm-codebase-details`.
- **Problem:** These faults all look the same on screen:
  - missing data or a failed tile;
  - a parse bug;
  - wrong estimated heights;
  - a coordinate bug;
  - WebGL context loss;
  - a geocoder outage.

  In a single-user PoC, the user is the only person present to see the
  evidence.
- **Requirement:**
  - **Response data.** Per-layer feature counts and per-tile status in the
    response.
  - **Debug overlay** (`?debug=1` or a key) showing:
    - request ID;
    - tiles and their status;
    - features received versus rendered;
    - triangle count and frame time;
    - camera lat/lon;
    - the source ID and `heightSource` of the building under the crosshair.
  - **Distinct messages** for:
    - geocoder unavailable versus no match;
    - partly loaded;
    - no data here;
    - WebGL context lost.

#### M19. Nothing limits who can trigger ingestion

- **Lenses:** `egm-design` and `egm-comprehension`.
- **Problem:** Any client can trigger fetches anywhere on Earth, and all
  cluster traffic leaves from one IP. One heavy user can get the server
  rate-limited by Overpass for everyone. Nothing validates coordinates.
- **Requirement:**
  - **Per-client rate limit** on new-area requests.
  - **Validate** the lat/lon range.
  - **Queue source calls,** one at a time per source (configurable),
    honouring `Retry-After` and Overpass `/api/status`.
  - **Check** the Overpass slot count for the host's IP.

#### M20. Operator controls and configuration

- **Lenses:** `egm-comprehension`, `egm-implementation-readiness`,
  `egm-codebase-details`, `egm-structural` and `egm-design`.
- **Problem:** A bad tile cannot be repaired. Stored data never updates, even
  though OSM changes. Nothing explains a removed release to the operator.
- **Requirement:**
  - **Admin CLI.** A CLI in the API image, run with `kubectl exec` or as a
    Job, that lists tiles with their source versions and evicts them by key,
    bounding box, release or `ingest_version`.
  - **Configuration table.** One documented table of Helm values:
    - Overture release;
    - Overpass URLs;
    - Photon URL;
    - radius, with a validated maximum;
    - User-Agent and contact;
    - database connection;
    - per-source concurrency;
    - timeouts.
  - **Self-hosted Overpass.** Document how to point the app at a self-hosted
    Overpass instance.
  - **README troubleshooting section:**
    - finding the request ID;
    - searching logs for it;
    - port-forwarding to PostgreSQL;
    - three provenance queries (failed tiles, tiles by release, latest
      fetches);
    - forcing a tile to be refetched.

#### M21. The repository scaffold contradicts the concept

- **Lenses:** `egm-structural` and `egm-comprehension` (Major).
  `egm-implementation-readiness` and `egm-zoom-out` (Nit).
- **Problem:**
  - **Over-broad patterns.** `/home/marcelomiyake/projects/geotoon/.gitignore`
    is the Rust template. Its bare `debug` and `target` patterns ignore any
    path with those names at any depth, so a `web/src/debug/` folder would
    silently drop out of commits and analysis.
  - **Missing entries.** It ignores none of `node_modules/`, `dist/`,
    `coverage/`, `.scannerwork/` or `.env*`.
  - **Secret exposure.** The repo is public and a `SONAR_TOKEN` exists in the
    environment, so `git add .` could publish a secret.
  - **Wrong signal.** The file also tells newcomers the project is Rust.
- **Requirement:**
  - **Replace the file** before the first code commit with Node/TypeScript
    entries plus `.env*`, `.scannerwork/`, `coverage/`, `dist/`, `*.duckdb*`
    and kubeconfig files.
  - **Commit a `.env.example`.**
  - **Secrets** pass only through CI secrets or the environment.

#### M22. Onboarding: commands, README and glossary

- **Lenses:** `egm-comprehension`.
- **Problem:**
  - **Commands.** Only `make test` is named, and only as an assumption.
  - **README.** There is none. Nothing states the prerequisites, the outbound
    hosts needed, the expected first-load time, or how to tell a stored tile
    from a fetch.
  - **Terms.** Many terms are undefined for a newcomer, and some hide
    behaviour. For example, the size of a zoom-16 tile depends on latitude.
- **Requirement:**
  - **Make targets,** listed by `make help`:
    - `setup`;
    - `dev`: PostGIS in Docker, the API with hot reload, and a web dev server
      that proxies `/api`, with no Kind in the daily loop;
    - `test`, `lint`, `typecheck`;
    - `images`;
    - `kind-up`, `kind-down`;
    - `deploy`, `open`;
    - `sonar`.
  - **Pin Node** through `.nvmrc` or `engines`, and pin the package manager.
    Check whether Node 26 still ships Corepack.
  - **README,** in this order:
    1. Description and a screenshot.
    2. Prerequisites with versions.
    3. Required outbound hosts.
    4. The commands above.
    5. Expected first-load time, and how to confirm a read came from storage.
    6. The configuration table (M20).
    7. Attribution.
    8. Troubleshooting.
  - **Glossary,** one line per term:
    - Map grid and data model: slippy-map zoom 16 (with its latitude
      dependence); tile, area and scene.
    - Rendering: cel shading and stepped N·L lighting; extrude; footprint;
      pointer lock.
    - Overture: release, GERS id, themes.
    - OSM: Overpass, Overpass QL, `out geom`; height tags.
    - PostGIS: SRID; EPSG:4326 versus 3857.
    - DuckDB: extensions.
    - Geocoding: Photon, and why Nominatim is not used.
    - Licensing: ODbL.
    - Architecture: DDD terms; ports and adapters.
    - Deployment: Kind, Helm, `NOTES.txt`, port-forward, NodePort.
    - Excluded: Cesium terms, needed only to explain the exclusion; Reference
      2 terms, marked "not used".
    - PoC.

### Nit

- **N1. Storage size is not a bottleneck** (`egm-design`; derived, not
  measured).
  - About 3 to 5 MB per 1 km area at this density, or 1.6 to 2.5 times that
    with the tile-box overshoot.
  - Set the PVC size, and measure real table and index sizes after the PoC
    ingest.
  - Either accept "no eviction" as a stated limitation, or add `last_read_at`
    now (`egm-implementation-readiness`).
- **N2. Read path** (`egm-design`, `egm-comprehension`).
  - Ready tiles never change: pre-serialize each tile at ingest.
  - Enable gzip or brotli, and measure the payload size.
  - Per-tile endpoints may use ETags; the area endpoint stays `no-store`
    (B6).
- **N3. Bulk inserts** (`egm-design`). Use COPY or multi-row inserts in one
  transaction. Inserting 7k to 17k rows one at a time adds avoidable seconds.
- **N4. Slow-query logging** (`egm-codebase-details`). Set
  `log_min_duration_statement` (for example 500 ms) through a Helm value. No
  exporter.
- **N5. Raw Overpass payloads** (`egm-codebase-details`). Decide whether to
  keep the compressed response per fetch (about 1 MB), so that a parser fix
  does not require refetching.
- **N6. Static asset caching after an upgrade**
  (`egm-implementation-readiness`).
  - Use hashed filenames, and send `Cache-Control: no-cache` on `index.html`.
  - The client checks `contractVersion` and asks the user to reload on a
    mismatch.
- **N7. Flat ground** (`egm-structural`). Use one `groundHeightAt(x, z)`
  function returning 0 everywhere ground height is needed: eye height,
  collision, building bases and roads.
- **N8. Kind specifics** (`egm-structural`). Keep port mappings and storage
  class in a Kind config file and a `values-kind.yaml`, not in the
  templates.
- **N9. Toolchain** (`egm-structural`, `egm-zoom-out`).
  - ESM everywhere.
  - One package manager with workspaces, and one test runner.
  - Exact version pins and a lockfile.
  - Plain TypeScript and Vite, with no UI framework.
- **N10. Simpler PostGIS model** (`egm-zoom-out`).
  - One `feature` table (source ID primary key, layer, EPSG:4326 geometry,
    height fields, raw attributes as jsonb, GiST index) plus the coverage
    table.
  - GeoJSON built in SQL (`ST_AsGeoJSON`, `json_agg`).
  - An equirectangular projection around the centre in the client, with no
    proj4. The error is under 1 m at 1 km (arithmetic).
- **N11. Collision** (`egm-zoom-out`). No done criterion requires collision.
  If it stays (decision 6, D13), reuse the `Octree` and `Capsule` add-ons, or
  a 2D circle-against-footprint check, since flat ground and prism-shaped
  buildings make the problem 2D. Octree build time on about 100k triangles
  was not measured.
- **N12. Radius maximum** (`egm-design`, `egm-structural`,
  `egm-comprehension`, `egm-zoom-out`).
  - Validate a maximum in `values.schema.json` and at startup.
  - If Overpass is removed (B1a), the reason for decision 4 no longer holds,
    and "maximum feasible" needs a new answer.
- **N13. Tile size depends on latitude** (`egm-design`, `egm-zoom-out`,
  `egm-comprehension`).
  - "~560 m" holds only near 23.5° latitude. A zoom-16 tile is 611 m wide at
    the equator, 381 m in London and 306 m at 60°.
  - Tiles per request therefore range from about 16 to 64.
- **N14. Browser details** (`egm-comprehension`).
  - A deep-link URL (`?lat=&lon=`), which also lets tests skip Photon.
  - A plain-language message when WebGL2 is unavailable or the context is
    lost.
  - State the UI language and Photon's `lang` parameter.
  - A fixed field of view, no head bob, and adjustable mouse sensitivity.
- **N15. PostGIS image on arm64** (`egm-comprehension`). Check which
  architectures the chosen image supports.
- **N16. Stale data** (`egm-design`, `egm-structural`). "Never refetch" means
  data never updates. The fetch time and source version (M3) plus the purge
  command (M20) allow a refresh later; a time-to-live can be added as
  configuration.

### Claims in the context that need support

1. **"~560 m tiles":** true only near this latitude (N13).
2. **"First load ~25 to 50 s":**
   - assumes the two fetches run in parallel;
   - rests on single samples;
   - used a smaller query than the one planned;
   - leaves out insert time.
3. **"Overture time is roughly the same for any radius up to 2 km":** one
   25 s figure is reported, measured on the workstation, not in a pod with
   limits.
4. **"Not fetching OSM buildings makes the Overpass query smaller":** the
   query was not re-run without buildings.
5. **"1 km is the feasible maximum":**
   - one attempt per radius per instance;
   - nothing tested between 1 and 2 km;
   - the area actually fetched is the tile box, not the circle.
6. **"Each tile is fetched once":** not guaranteed under concurrent requests
   or partial failures (B2).
7. **"Overture merges OSM buildings, so there are no duplicates":** true at
   the source only. Tile edges create duplicates (B3).
8. **Overpass counts:** relations and water areas are not reported, and it is
   unclear whether multipolygon relations were requested.
9. **Photon suitability:** rests on one request; its usage terms are not
   recorded.
10. **Overture S3 access:** the context does not say the reads were anonymous,
    which would confirm there is no requester-pays cost.
11. **"Extrusion takes milliseconds":** an estimate (M16).

### Measurements required before the PRD

- **Overpass:**
  - the exact production query, run 5 or more times at different times;
  - the slot count for the host's outbound IP (`/api/status`).
- **Overture `transportation` and `base` themes** for the PoC box: query time
  per theme, and coverage of street classes, parks, water and trees, compared
  with Overpass.
- **DuckDB inside Kind,** under the planned limits: cold and warm query time,
  and peak memory.
- **Building `class` coverage** in the PoC area.
- **Rendering:** `ExtrudeGeometry` time and draw-call count on the PoC data.
- **PostGIS:** table and index size, and insert time, for the PoC area.
- **End to end:** first-request time, second-request time, and scene payload
  size.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * **The five done criteria:**
    1. An address entered in the browser shows a cel-shaded 3D map around it.
    2. A second request for the same area reads from PostGIS and does not
       refetch.
    3. `helm install` on a fresh Kind cluster brings up the system, and the
       app loads in the browser.
    4. The test command passes.
    5. SonarCloud shows zero issues; the exact meaning is pending D5.
  * **Address search:** autocomplete through a backend endpoint that calls
    Photon.
  * **Area:** a 1 km radius around the chosen point, set by a Helm value with
    a validated maximum.
  * **Buildings** from Overture, with estimated heights. The rule is: source
    height; otherwise floors × 3 m; otherwise a default by class; with
    deterministic per-building variation.
  * **Streets, land use, parks, water and trees** from OSM data. The path for
    fetching them is open (D1).
  * **Storage:** fetched data stored in PostGIS with per-tile state,
    provenance, and per-request evidence that criterion 2 holds.
  * **Scene:** cel-shaded and first-person, at 1.7 m eye height, with
    keyboard and mouse under pointer lock, collision against footprints
    (pending D13), flat ground, and on-screen attribution.
  * **Code structure:** a TypeScript monorepo using DDD and Clean
    Architecture scaled to the size of the app, with the dependency direction
    checked by the test command.
  * **Deployment:** Docker images and one Helm chart (app plus a
    PostgreSQL/PostGIS StatefulSet) that installs on a fresh Kind cluster.
  * **Quality:** a test command that runs offline, and a SonarCloud project in
    org `marcelomiyake`.
* **Out-of-Scope Non-Goals:**
  * **Owner exclusions:** user accounts, payments, extra data sources.
  * **Cesium:** Cesium OSM Buildings and Cesium ion (decision 1; reported as
    a departure from checklist item 3).
  * **Google:** Google Earth and Photorealistic 3D Tiles. Google's terms
    forbid storing or rebuilding them (Reference 1).
  * **Reference 2 stack:**
    - Rust, WebAssembly, wgpu and Bevy;
    - GPU-driven indirect rendering;
    - floating-origin grids;
    - CDLOD terrain;
    - Cesium 3D Tiles streaming;
    - Draco, meshopt and Basis compression;
    - navmesh and pathfinding;
    - rendering in a worker through OffscreenCanvas.
  * **Terrain:** no elevation; the ground is flat.
  * **Touch and mobile controls:** proposed by `egm-comprehension`; needs
    owner confirmation (D12).
  * **Refresh and backups:** no data refresh or expiry, and no PostGIS
    backups. This is proposed on the basis that PostGIS is a rebuildable
    cache (M7).
  * **Observability stack:**
    - OpenTelemetry collector and Jaeger or Tempo;
    - Prometheus, Grafana and Alertmanager;
    - a PostgreSQL exporter;
    - Loki or EFK;
    - browser RUM or error-reporting services.

    `egm-codebase-details`: no done criterion needs these, and request IDs in
    structured logs plus provenance rows cover tracing from browser to
    database.
  * **Async infrastructure:** no separate job queue (Redis, BullMQ) and no
    SSE or WebSocket progress streams.
  * **Ingress controller.**
  * **High availability** or PostgreSQL replicas.
  * **Admin HTTP API:** operator actions use a CLI in the image (M20).

## Alternatives Weighed

### Rejected before this review (context decisions)

- **Cesium OSM Buildings:**
  - It holds only OSM buildings (585 within 1 km here), which Overture
    already includes along with their height tags.
  - It needs a Cesium ion token, and none is available.
  - Cesium staff state that storing Asset Depot data offline needs a paid
    licence, which conflicts with criterion 2.
  - Its height-estimation idea is kept as a domain rule.
- **Rust:** no measured reason. About 38k footprint vertices are expected to
  extrude quickly in TypeScript; this is an estimate (M16).
- **Google Earth and Photorealistic 3D Tiles:**
  - Google's terms forbid storing, exporting or rebuilding them.
  - They are also a poor base for toon shading: baked shadows, missing or
    wrong normals, and trees, cars and buildings fused into one mesh.
- **Nominatim for autocomplete:** its usage policy forbids autocomplete.
- **Fetching OSM buildings through Overpass:** Overture already merges OSM
  buildings, so this would add duplicates and a larger query.
- **A 2 km radius:** the Overpass query failed on all four public instances
  tried.
- **The Reference 2 planet-scale stack** (floating origin, CDLOD, 3D Tiles
  streaming, navmesh, mesh compression, OffscreenCanvas):
  - a ~1 km scene around a local origin works with 32-bit floats;
  - no terrain source is in scope;
  - no done criterion requires navigation.

### Rejected by the reviewers

**Database and Helm**
- **Bitnami PostgreSQL chart or image:** no PostGIS, and its free catalog was
  restricted in 2025 (unverified).
- **CloudNativePG operator:** its operator and CRDs must be installed before
  the app chart, which breaks "`helm install` brings up the full system".
- **Prisma as the migration tool:** no native geometry type.
- **Helm `pre-install` hook for migrations:** the in-chart database does not
  exist yet.
- **Plain Job for migrations:** its template cannot change, so `helm upgrade`
  fails.
- **`emptyDir` storage for PostgreSQL:** every pod restart erases the cache
  and looks like a criterion 2 failure.
- **A database password generated on each install:** it stops matching the
  existing data directory after a reinstall.
- **`latest` or floating image tags:** `ErrImagePull` on Kind, or a silent
  PostgreSQL major-version jump.
- **ingress-nginx, or any Ingress:**
  - a controller must be installed before the chart;
  - the default 60 s read timeout is below the first load;
  - retirement was announced (unverified).

**Storage and concurrency**
- **Clipping features at tile edges:** it loses the original geometry and
  produces seams that the outlines draw.
- **Storing whole features once per tile:** it duplicates rendering and
  collision at tile edges.
- **Zoom as a Helm value:** changing it makes stored rows unreachable.
- **A bounding box over non-adjacent missing tiles:** it refetches tiles that
  are already stored.
- **In-process locks for single-flight fetching:** they do not cover several
  replicas or restarts.
- **A transaction-scoped advisory lock held across the remote fetch:**
  proposed by `egm-zoom-out`. Rejected by `egm-implementation-readiness` and
  `egm-codebase-details` in favour of lease rows, because it ties up a pool
  connection for 50 s or more and holds a transaction open during a remote
  call.
- **Storing only the final estimated height:** a rule change would then
  force refetches.
- **Seeding height variation from a database ID, array index or library
  random generator:** heights would change after re-ingestion or an upgrade.

**Probes and tests**
- **A readiness probe that checks external sources:** a source outage would
  make cached areas unavailable.
- **Live source calls in `make test`:** flaky, slow, and against Overpass's
  fair-use policy.

**Code and tooling**
- **A shared domain package imported by the browser:** it couples the client
  to domain internals.
- **Full tactical DDD everywhere,** with domain events, CQRS bus, DI container
  or generic repository: mapping code with no rule behind it, flagged by Sonar
  as duplication.
- **Nx, Turborepo, Lerna or React:** nothing in the scope needs them.
- **Custom GLSL toon shaders, and copying Three.js example code into the
  repo:** built-in materials and add-ons cover the need, and copied code is
  analysed by Sonar.
- **Three.js `WebGPURenderer`:** `OutlineEffect` is WebGL-only.
- **Rendering in Mercator metres, or adding proj4:** a 9% scale error at this
  latitude, or a dependency the job does not need.
- **The official Overture Python CLI:** it adds a second runtime.
- **The legacy `duckdb` npm package:** deprecated (unverified).
- **An Alpine (musl) base image:** DuckDB prebuilt binaries may not exist for
  it.
- **SonarCloud suppressions made in the web UI:** lost if the project is
  recreated, and invisible in the repo.

**Infrastructure**
- **A full observability stack:** no done criterion needs it, and every
  template adds SonarCloud surface.
- **A Redis or BullMQ job queue:** the tile state table covers job state.

### Options not yet settled (see Key Decisions)

These are not rejected; they are listed so `/egm-draft` carries them forward.

- **Source of the OSM layers (D1):** hardened Overpass, Overture themes, or a
  one-time `osm2pgsql` extract.
- **Loading model (D2):** a request followed by polling, or one synchronous
  request.
- **Coverage tracking (D3):** the zoom-16 tile grid, or a `loaded_area` table
  of fetched circles.
- **Overture release pin (D4):** a code constant, or a Helm value resolved at
  startup.
- **Migrations (D6):** a migration tool in an init container, or an init
  script / idempotent SQL at startup.
- **Ingestion process:** a separate ingestion Deployment (`egm-design`), or a
  single API process (`egm-zoom-out`).

## Key Decisions & Staging for Next Steps

### Decisions carried forward from the context (no lens objected)

1. **Cesium OSM Buildings out.** Report it as a departure from checklist
   item 3.
2. **TypeScript only.** Rust is out.
3. **Overture is the only building source.** OSM buildings are not fetched.
4. **Photon is the geocoder, called through the API.** Nominatim is not used.
5. **Flat ground and a first-person camera at 1.7 m.** Whether collision
   stays is D13.
6. **1 km radius.** Its stated reason holds only while Overpass stays (N12).
7. **"Same area" means "same stored coverage".** The mechanism is open (D3).

### Decisions the reviewers converged on (record in the PRD)

1. **Tile state.** Per (tile, source) state with leases, held in PostgreSQL.
   Atomic writes. An Overpass `remark` reporting an error counts as failure;
   zero features counts as complete. (B2)
2. **Feature storage.** Each feature stored once by stable source ID,
   unclipped, in EPSG:4326. Coverage tracked separately. The grid stays
   inside the server, and zoom is fixed in code. (B3)
3. **Height inputs.** Raw source attributes are stored. The height rule is
   versioned and seeded by the GERS id. `heightSource` is returned. (M2)
4. **Provenance.** Recorded on every fetch, including the Overture release.
   (M3, B9)
5. **Cache status.** PostGIS is a rebuildable cache; no backups. (M7)
6. **Ingestion.** Overture and Overpass are fetched in parallel, and
   ingestion outlives the HTTP request. (B4)
7. **Contract:**
   - `/api/v1`, with a shared `contracts` package;
   - GeoJSON lon/lat on the wire, local metres in the client;
   - Problem Details errors;
   - per-tile origin and source-call counts in the response.

   (B5, B6, M5)
8. **Deployment:**
   - one origin: Fastify serves the client, so there is one app image;
   - a pinned `postgis/postgis` StatefulSet with a PVC in the same chart;
   - access through `kubectl port-forward`, printed by `NOTES.txt`;
   - no ingress controller;
   - git-SHA image tags with `IfNotPresent`.

   (B8, M7)
9. **Probes.** Liveness checks the process only. Readiness checks the
   database, PostGIS, the schema version and the DuckDB extensions, and never
   external sources. (M6)
10. **DuckDB.** `@duckdb/node-api`, pinned, on a glibc base; extensions baked
    into the image with auto-install off; memory and threads set. (M1)
11. **Tests.** The test command runs offline, with fixtures and
    Testcontainers. Live tests are opt-in. (M9)
12. **Packages.** `core`, `contracts`, `api` and `web`, with the dependency
    rule enforced. Tactical DDD only where a rule exists. (M12)
13. **Rendering.** Three.js built-ins, a pinned Three.js version, and a pure
    scene-builder module. (M16)
14. **Repository.** Replace `.gitignore` before the first commit. (M21)

### Open decisions for the owner (needed before `/egm-draft`)

- **D1. Source of streets, land use, parks, water and trees.** This is the
  most consequential decision, and it depends on the B1 measurements. The
  options:
  - hardened Overpass (B1b);
  - Overture's `transportation` and `base` themes (B1a). This departs from
    the checklist wording, though the data is still OSM under ODbL;
  - a one-time OSM extract (B1c).
- **D2. Loading model.**
  - Five lenses favour a request followed by polling, backed by the tile
    state table.
  - `egm-zoom-out` favours one synchronous request with a written timeout
    chain.
- **D3. Coverage mechanism.** Either the current zoom-16 tile grid, or a
  `loaded_area` table of fetched circles tested with `ST_Covers`.
  - `egm-zoom-out`'s case for the table: Overture's cost is flat per query,
    so the grid saves nothing there. It helps Overpass only if queries are
    per tile.
  - `egm-comprehension` adds that, with the grid, an address 300 m away can
    still cost a full first-load wait.
- **D4. Where the Overture release pin lives.** Either a code constant tied
  to a tested query, or a Helm value, optionally resolved at startup.
- **D5. Meaning of "zero SonarCloud issues".** Issues only; issues plus all
  hotspots reviewed; or issues plus a passing quality gate.
- **D6. Migration mechanism.** Either a migration tool run by an init
  container under an advisory lock, or an init-script ConfigMap / idempotent
  SQL at startup.
- **D7. Partial scenes.** Whether a buildings-only scene may be shown when
  Overpass fails. If so, it is labelled incomplete and never stored as
  complete.
- **D8. Area edge.** Clip the scene to the 1 km circle (with fog and an edge
  wall), or show whole tiles.
- **D9. Payload shape.** One scene payload per area, or per-tile endpoints.
- **D10. Test command name.** `make test`, which needs Make on the machine,
  or `npm test` with `make test` as a wrapper.
- **D11. Bounded contexts.** One context, or three: Geocoding, Area
  Acquisition and Scene.
- **D12. Device and language scope.** Desktop only; the UI language; Photon's
  `lang` parameter.
- **D13. Collision.** Whether it stays (decision 6), given that no done
  criterion requires it.

### Departures from the owner's checklist to report

- **Cesium OSM Buildings** is not used (decision 1).
- **OSM layers through Overture.** If D1 chooses Overture themes, OSM data
  arrives through Overture rather than from OSM directly.
- **Test command.** The command is an assumption until D10 is settled.

### Staging

1. **Stage 0: Measure.** Take the measurements listed under "Measurements
   required before the PRD", and add the results to
   `/home/marcelomiyake/projects/geotoon/docs/egm/brainstorm_context.md`.
2. **Stage 1: Owner decisions.** The owner answers D1 to D13. D1, D2 and D3
   come first, because the schema and the contract depend on them.
3. **Stage 2: Design document.** Run `/egm-draft` to produce:
   - the contract;
   - the PostGIS schema and the tile state machine;
   - the ingestion flow for each source;
   - the Helm chart layout;
   - the SonarCloud setup;
   - the test plan;
   - the failure table (M5);
   - the glossary (M22).
4. **Stage 3: Scaffold.**
   - Replace `.gitignore`.
   - Set up workspaces and packages, with the dependency rule.
   - Create the SonarCloud project, with the CI scanner and Automatic
     Analysis off.
   - Add the Make targets and a Kind config.
   - Write a chart skeleton with the PostGIS StatefulSet and probes.
   - Run SonarCloud on the empty skeleton, to surface Docker and Kubernetes
     rule conflicts early.
5. **Stage 4: Walking skeleton on recorded fixtures.** Take the PoC data from
   fixtures through PostGIS to a toon-shaded scene in the browser on Kind.
   This exercises criteria 1, 3 and 4 without live sources.
6. **Stage 5: Live adapters.** Add tile state, leases, timeouts and
   provenance, and the criterion 2 proof (`make verify-cache`).
7. **Stage 6: UX hardening and SonarCloud.** Add spawn position, controls,
   the area edge, attribution, error messages and the debug overlay, and
   bring SonarCloud to zero.
