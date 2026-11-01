# GeoToon: Walkable Cel-Shaded 3D Map Built from Open Map Data

*   **Author:** Marcelo Miyake
*   **Status:** Draft
*   **Date:** 2026-11-01

--------------------------------------------------------------------------------

## Overview

GeoToon turns an address into a small world you can walk through. A person
types an address in a browser, picks one of the suggestions, and after a
short wait stands at street level inside a cel-shaded 3D model of the
neighbourhood around that address. Cel shading (toon shading) means lighting
reduced to a few flat colour bands, plus dark outlines.

The model contains buildings raised from their footprints, streets, parks,
water and trees. It is built only from open map data: Overture Maps, which
also distributes OpenStreetMap (OSM) data. The first time an area is
requested, the data is fetched and stored in PostgreSQL with PostGIS; every
later request for that area reads from the database. Address suggestions come
from Photon, an open-source geocoder.

The whole system runs on a local Kubernetes cluster (Kind) and is installed
by one Helm chart. The proof of concept (PoC) targets Av. Bolonha, 200,
Jaguaré, São Paulo (lat -23.5486, lon -46.7469).

This design follows `concepts_brief.md` (brainstorm, six-lens review, Stage 0
measurements and decisions D1 to D13).

## The Problem

**No free, legal way to walk a real place in a stylised form.** Google Earth
has detailed 3D cities, but Google's terms forbid storing, exporting or
rebuilding them. Their meshes also suit toon shading badly: they are unlit,
have shadows baked into the photos, and fuse trees, cars and buildings into
one surface (Reference 1).

**Open data can be stored and restyled, but it is not 3D and it is
incomplete.**
- It arrives as flat 2D footprints and lines.
- It is spread across several themes and monthly releases.
- Heights are missing for most buildings: 1% of the 6,719 buildings within
  1 km of the PoC address have a height, and 95% have no building type.
- Something has to raise footprints into 3D, estimate the missing heights in
  a repeatable way, and keep the layers consistent.

**Fetching open data is slow and relies on shared infrastructure.**
- One Overture read from cloud storage took 17 to 38 s per theme in Stage 0.
- The public Overpass (OSM) server queued each query for 30 to 50 s and
  refused back-to-back queries.
- Fetching on every visit would make every visit slow and load public
  services. Each area must be fetched once and reused.

**Proposed solution.** A browser client sends the chosen point to an API.
The API works out which fixed map tiles cover the requested radius, fetches
only the tiles it has not stored yet from Overture (buildings, streets, land
use, water, trees), stores them in PostGIS, and returns one scene payload.
The browser raises the footprints into 3D, applies toon materials and
outlines, and lets the user walk through the result.

## Goals

Each goal is a pass/fail check. G1 to G5 are the owner's done criteria.

*   **G1. Address to scene.** Typing an address shows suggestions. Picking
    one shows a cel-shaded 3D scene around that point, with the camera at
    street level near the address.
*   **G2. Fetch once.** A second request for an area makes zero calls to
    external data sources and reads only from PostGIS. The response shows,
    per tile, whether it was read from storage or fetched, and counts the
    source calls made.
*   **G3. One-command install.** On a fresh Kind cluster with the images
    loaded, `helm install` brings up the app and PostGIS, and the app opens
    in a browser through the port-forward command the chart prints.
*   **G4. Tests.** `make test` passes without network access.
*   **G5. Code quality.** SonarCloud project `marcelomiyake_geotoon` shows,
    on `main`: zero open issues, zero security hotspots left to review, and
    a passed quality gate.
*   **G6. Walkable.** First-person walking with keyboard and mouse at 1.7 m
    eye height. The user cannot walk through buildings or past the edge of
    the area, and starts outside a building, facing the address.
*   **G7. Largest feasible area.** The radius is the largest of 2 km, 1.5 km
    and 1 km that meets all of these on the PoC address:
    *   first load within 60 s;
    *   compressed scene payload at most 3 MB;
    *   scene built in the browser within 1.5 s;
    *   smooth frame rate while walking (no visible stutter on this
        workstation).
*   **G8. Open data, attributed.** Only openly licensed data is used. The
    screen credits OpenStreetMap contributors, Overture Maps Foundation and
    Photon.
*   **G9. Structure.** Domain-Driven Design and Clean Architecture: domain
    rules have no I/O dependencies, and the test command fails if a package
    imports in the wrong direction.

## Non-Goals

*   User accounts, logins and payments.
*   Data sources beyond Overture and Photon: no Overpass, Cesium OSM
    Buildings, Google, terrain or elevation data. The ground is flat.
*   Phones, tablets and touch controls. Desktop browsers with WebGL2 only.
*   Building interiors, multiplayer, navigation or route-finding, and a
    day-night cycle.
*   Refreshing or expiring stored data, and database backups. PostGIS is a
    rebuildable cache of the sources.
*   High availability: one API replica and one PostgreSQL instance.
*   An ingress controller, a job queue, and a metrics, tracing or log
    collection stack.
*   Rust or WebAssembly.

## Open Questions

*   **Q1. Final radius.** G7 is decided by measurements taken during the
    build. Until then the default is 2 km.
*   **Q2. Overture release retention.** How long Overture keeps a release on
    S3 is not yet documented in this design. The pinned release will
    eventually disappear; the error for that case is defined in the
    Technical Plan.
*   **Q3. Photon fair-use terms.** The public instance's usage terms are not
    yet recorded. The design limits calls (debounce, cache), but the terms
    must be checked before the PoC is shown to others.

## Critical User Journeys (CUJs)

### CUJ 1: First visit to an address

*   **Given**: a fresh install with an empty database, and outbound internet
    access from the cluster.
*   **When**: the user types "Av. Bolonha 200" and picks the suggestion in
    Jaguaré, São Paulo.
*   **Then**:
    *   Within 1 s a loading view shows elapsed time and how many tiles are
        stored.
    *   Within 60 s the scene appears.
    *   The camera stands on open ground outside the building at the address,
        facing it, with a marker above it.
    *   Attribution is visible in a corner of the screen.

### CUJ 2: Return visit reads only from storage

*   **Given**: CUJ 1 has completed.
*   **When**: the same address is requested again, including after the API
    and PostgreSQL pods are restarted and with the source URLs pointed at an
    unreachable host.
*   **Then**: the scene appears within a few seconds. The response lists
    every tile as `stored` and reports zero source calls.

### CUJ 3: Walking

*   **Given**: a loaded scene.
*   **When**: the user clicks "Click to walk" and uses W A S D or the arrow
    keys, the mouse, and Shift to run.
*   **Then**:
    *   The camera moves at walking speed, faster with Shift.
    *   Building walls stop the camera.
    *   At the edge of the area the camera stops and a message explains why.
    *   Esc opens a pause screen with Resume, New address, Controls and
        Attribution.

### CUJ 4: A data source fails

*   **Given**: a new area, and Overture's S3 bucket is unreachable.
*   **When**: the user requests the area.
*   **Then**:
    *   The user sees a plain message, a Retry button and a request ID.
    *   The affected tiles are recorded as failed, with the error class.
    *   A retry fetches only the failed tiles.

### CUJ 5: Operator installs on Kind

*   **Given**: a fresh Kind cluster created with the repo's Kind config, and
    images built and loaded with the documented make target.
*   **When**: the operator runs
    `helm install geotoon deploy/helm/geotoon --wait --timeout 5m`.
*   **Then**: all pods are ready within 5 minutes, the chart prints the
    port-forward command, and the app opens in a browser.

## Technical Plan (Architecture)

### System view

```text
 Browser (apps/web: TypeScript + Three.js, served by the API)
   |  GET  /api/v1/geocode?q=...            (debounced autocomplete)
   |  POST /api/v1/areas {lat, lon}         (repeated every 2 s until ready)
   v
 geotoon-app  (apps/api: Fastify, Node 26)
   |-- Geocoding context ---- Photon adapter --HTTPS--> photon.komoot.io
   |-- Cartography context
   |      RequestArea use case --> tile_coverage (claim, state)
   |      IngestTiles use case --> Overture adapter --DuckDB httpfs--> s3://overturemaps-us-west-2/release/<release>/
   |      ReadScene use case   --> feature tables (read within radius)
   v
 PostgreSQL 17 + PostGIS (StatefulSet, PVC)
```

Everything runs in one Kind cluster, installed by one Helm chart. The app
image serves the API and the built browser client from the same origin, so
there is no CORS setup and only one Service to reach. Ingestion runs as a
background task inside the same process (PD1 = A).

### Repository layout

```text
Makefile                    make help | setup | dev | test | lint | typecheck | build
                            images | kind-up | kind-load | deploy | open | verify-cache
                            sonar | kind-down
package.json                npm workspaces; exact version pins; package-lock.json
tsconfig.base.json          strict TypeScript, ES modules everywhere
.nvmrc                      Node 26
packages/core/              domain + application layer; no I/O libraries
packages/contracts/         /api/v1 wire schemas (zod); imports only zod
apps/api/                   Fastify server, adapters, SQL migrations, admin CLI,
                            composition root
apps/web/                   Vite + Three.js client; plain DOM, no UI framework
deploy/helm/geotoon/        the Helm chart (app + PostGIS)
deploy/kind/kind-config.yaml
docker/app.Dockerfile       multi-stage build; one runtime image
fixtures/                   recorded PoC data for offline tests, with an ODbL NOTICE
sonar-project.properties
.github/workflows/ci.yml    build, test, SonarCloud analysis
```

**Dependency rule.** `core` imports nothing outside itself. `contracts`
imports only zod. `api` imports `core` and `contracts`. `web` imports only
`contracts` and Three.js. dependency-cruiser checks these rules as part of
`make test`.

### Bounded contexts (D11)

*   **Geocoding.** A thin context: the `SuggestAddresses` application
    service validates the query (at least 3 characters, at most 5 results)
    and calls the `Geocoder` port. The Photon adapter maps Photon's GeoJSON
    into the API's own `AddressSuggestion` type, so Photon's format never
    reaches the client.
*   **Cartography.** Holds the rules: the tile grid, tile coverage state,
    the feature model, the height rule, the spawn point and scene assembly.

Tactical DDD patterns are used only where a rule exists (tile coverage,
height, spawn). There are no domain events, command bus, DI container or
generic repository. Ports are plain TypeScript interfaces, and the
composition root in `apps/api` wires adapters by hand.

### Domain model (Cartography)

*   **`GeoPoint`** (value object): lat in [-90, 90], lon in [-180, 180];
    rejects anything else with `INVALID_COORDINATES`.
*   **`AreaRequest`** (value object): centre `GeoPoint` plus the radius from
    configuration. The client never sends a radius.
*   **`TileKey`** (value object): zoom fixed at 16 in code, plus x and y.
*   **`TileGrid`** (domain service): `tilesCovering(centre, radius)` returns
    the zoom-16 tiles whose bounds come within `radius` of the centre. A
    tile in the corner of the bounding square that the circle does not
    reach is left out.
*   **`TileCoverage`** (entity, one per tile). States and transitions:

```text
            claim                 store ok
 missing ----------> fetching ---------------> complete
                     |   ^  \
         fetch error |   |   \ lease expired (pod died): next claim re-takes it
                     v   |
                    failed --(retryAfter passed: claim)--> fetching
```

    It also stores attempts, error class, retry-after time, Overture
    release, feature counts, fetch time and the request ID that fetched it.
    A tile is stored only when it is `complete`. A fetch that returns zero
    features is `complete` with a count of 0.
*   **Features.** `Building` (GERS id, footprint polygon or multipolygon,
    source height, floors, min height, class, source dataset), `MapLine`
    (streets, rail, streams: id, kind, name, line), `MapArea` (parks, grass,
    water, land use: id, kind, polygon), `Tree` (id, point; tree rows become
    points every 6 m). Kinds are closed lists, each with an `other` value;
    the mapping from Overture classes to kinds lives in the Overture adapter.
*   **`HeightRule`** (pure domain function, version 1):
    1.  source `height` in metres, if present: `heightSource = measured`;
    2.  else `num_floors × 3.0 m`: `heightSource = floors`;
    3.  else an estimate from footprint area: `heightSource = estimated`.
        Small footprints get 1 to 3 floors, large low-rise footprints get
        warehouse heights (8 to 12 m). The value inside each band is picked
        by an FNV-1a hash of the GERS id, so it never changes between runs.

    Heights are computed when the scene is read, from the stored raw
    inputs. Changing the rule needs no refetch.
*   **`SpawnPoint`** (pure domain function): the point on the nearest street
    line within 150 m of the address, else a point 2 m outside the nearest
    footprint. The heading faces the address.

### Use cases

*   **`SuggestAddresses(query, bias)`** calls the `Geocoder` port. The API
    caches answers for 10 minutes, keyed on the normalised query.
*   **`RequestArea(centre)`**:
    1.  `tiles = TileGrid.tilesCovering(centre, radius)`.
    2.  Read the coverage rows for `tiles`.
    3.  If every tile is `complete`, run `ReadScene` and return `ready`.
    4.  Otherwise claim the tiles that are `missing`, `failed` with an
        elapsed retry-after, or `fetching` with an expired lease. The claim
        is one SQL statement (below). Start ingestion for the tiles this
        request won, outside the request's lifetime, and return `pending`
        with every tile's state.
    5.  If any tile is `failed` and its retry-after has not passed, return a
        retryable error (`AREA_FETCH_FAILED`) with that time.
*   **`IngestTiles(claimedTiles)`**:
    1.  Fetch from the `MapDataSource` port once, for the bounding box of
        the claimed tiles. The Overture adapter runs its theme queries in
        parallel.
    2.  After the fetch, open one transaction: upsert every returned feature
        by id (whole, unclipped, repaired with `ST_MakeValid`), then mark the
        claimed tiles `complete`, but only those whose lease this run still
        holds. No transaction stays open during the remote call.
    3.  On any error, mark the claimed tiles `failed` with the error class
        and a retry-after of `min(10 s × 2^attempts, 10 min)`.
    4.  The `MapDataSource` port is wrapped by a counter, so DuckDB reads are
        counted the same way an HTTP call would be.
*   **`ReadScene(centre)`** selects features within the radius
    (`ST_DWithin` on geography), applies `HeightRule` and `SpawnPoint`, and
    maps the result to the contract.

**Claim statement** (sketch; keys sorted to avoid deadlocks):

```sql
INSERT INTO tile_coverage (z, x, y, state, lease_owner, lease_expires_at, attempts)
SELECT 16, x, y, 'fetching', $owner, now() + interval '180 seconds', 1
FROM unnest($xs::int[], $ys::int[]) AS t(x, y) ORDER BY x, y
ON CONFLICT (z, x, y) DO UPDATE
  SET state = 'fetching', lease_owner = EXCLUDED.lease_owner,
      lease_expires_at = EXCLUDED.lease_expires_at,
      attempts = tile_coverage.attempts + 1
  WHERE tile_coverage.state = 'missing'
     OR (tile_coverage.state = 'failed'   AND tile_coverage.retry_after <= now())
     OR (tile_coverage.state = 'fetching' AND tile_coverage.lease_expires_at < now())
RETURNING x, y;
```

The lease (180 s) is longer than the Overture query timeout (120 s). On
SIGTERM the process marks the leases it holds `failed` with an immediate
retry-after, so the next request takes them over.

### Overture adapter (D1)

*   **Library and process.** One long-lived in-memory DuckDB instance
    (`@duckdb/node-api`, exact pin) with the `httpfs` extension baked into
    the image at a fixed extension directory. Auto-install is off. Settings
    from configuration: `memory_limit` (default 1 GB), `threads` (4),
    `temp_directory`. The `spatial` extension is not used.
*   **Queries.** Anonymous reads from
    `s3://overturemaps-us-west-2/release/<release>/theme=<t>/type=<y>/*`,
    filtered on the `bbox` struct columns. The `geometry` column is read
    as raw WKB and passed to PostGIS (`ST_GeomFromWKB`).
    *   `buildings/building`: id, geometry, height, num_floors,
        min_height, class, `sources[1].dataset`.
    *   `transportation/segment`: id, geometry, subtype, class,
        `names.primary`, OSM record id.
    *   `base/land_use`, `base/water`, `base/land`: id, geometry, subtype,
        class (land filtered to trees and vegetation).
*   **Errors.** A missing release path maps to `OVERTURE_RELEASE_NOT_FOUND`.
    Network failures map to `OVERTURE_UNAVAILABLE`. Every query is
    interrupted after 120 s and recorded as `timeout`.
*   **Load limit.** One ingestion run at a time per process; other claimed
    work waits its turn.
*   **Release.** The release is the Helm value `overture.release` (D4). It
    is recorded on every tile.

### Storage (PostGIS)

*   All geometry is stored in EPSG:4326, with GiST indexes.
*   Features are stored once each, keyed by their source id. Coverage lives
    in `tile_coverage`, primary key (z, x, y).
*   `schema_migrations` records which SQL migrations have been applied.
*   **Feature table (PD2 = A).**

```sql
CREATE TABLE map_feature (
  id               text PRIMARY KEY,           -- Overture GERS id
  layer            text NOT NULL CHECK (layer IN ('building','line','area','tree')),
  kind             text NOT NULL,              -- closed list per layer, incl. 'other'
  geom             geometry(Geometry, 4326) NOT NULL,
  height_m         real,                       -- building only
  num_floors       smallint,                   -- building only
  min_height_m     real,                       -- building only
  name             text,
  source_dataset   text NOT NULL,              -- e.g. 'OpenStreetMap', 'Google Open Buildings'
  source_record_id text,                       -- e.g. OSM 'w123@5'
  overture_release text NOT NULL,
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  attrs            jsonb NOT NULL DEFAULT '{}',-- raw class/subtype only; keys fixed by the adapter
  CHECK (layer = 'building' OR (height_m IS NULL AND num_floors IS NULL AND min_height_m IS NULL)),
  CHECK (layer <> 'building' OR GeometryType(geom) IN ('POLYGON','MULTIPOLYGON')),
  CHECK (layer <> 'line'     OR GeometryType(geom) IN ('LINESTRING','MULTILINESTRING')),
  CHECK (layer <> 'area'     OR GeometryType(geom) IN ('POLYGON','MULTIPOLYGON')),
  CHECK (layer <> 'tree'     OR GeometryType(geom) IN ('POINT','LINESTRING'))
);
CREATE INDEX map_feature_geom_gix ON map_feature USING gist (geom);
```

    The read query filters with `geom && <bounding box of the circle>`
    first, so the GiST index is used, and then with `ST_DWithin` on
    geography for the exact radius.
*   PostGIS is a rebuildable cache: no backups. A migration may truncate
    feature and coverage tables, and the consequence is refetching.
*   **Migrations (D6).** Versioned plain SQL files
    (`apps/api/migrations/NNNN_name.sql`). At startup the API applies the
    missing ones in order, under `pg_advisory_lock`, one transaction per
    file. Readiness fails until this finishes. The API refuses to start if
    the database is at an older version than its code expects. It starts
    with a warning if the database is newer, which allows `helm rollback`.

### Wire contract (`/api/v1`, defined once in `packages/contracts`)

*   **`GET /api/v1/geocode?q=&lat=&lon=`** returns
    `200 {suggestions: [{id, label, lat, lon, kind}]}`, at most 5.
*   **`POST /api/v1/areas` with body `{lat, lon}`** is idempotent:
    *   `202 {contractVersion: 1, status: "pending", requestId, tiles:
        [{x, y, state}], sourceCalls, pollAfterMs: 2000}`;
    *   `200 {contractVersion: 1, status: "ready", requestId, area: {lat,
        lon, radiusM}, tiles: [{x, y, state, fetchedAt, release}],
        sourceCalls, scene}`.

    `sourceCalls` counts the source calls this request started. Responses
    carry `Cache-Control: no-store`.
*   **`scene`** (coordinates are GeoJSON order [lon, lat], 6 decimals):
    *   `buildings: [{id, footprint, heightM, minHeightM, heightSource,
        kind}]`;
    *   `lines: [{id, kind, widthM, name?, coords}]`;
    *   `areas: [{id, kind, polygon}]`;
    *   `trees: [[lon, lat]]`;
    *   `spawn: {lon, lat, headingDeg}`;
    *   `attribution: [{text, url}]`, derived from the datasets in the
        scene.
*   **Errors.** Every error is `application/problem+json`: `type`, `title`,
    `status`, `detail`, plus `code`, `retryable`, `retryAfterSeconds`,
    `requestId`. Codes:
    *   `INVALID_COORDINATES`, `INVALID_QUERY`;
    *   `GEOCODER_UNAVAILABLE`, `GEOCODER_RATE_LIMITED`;
    *   `OVERTURE_UNAVAILABLE`, `OVERTURE_RELEASE_NOT_FOUND`,
        `AREA_FETCH_FAILED`, `RATE_LIMITED`, `INTERNAL`.
*   **Operations endpoints.**
    *   `GET /healthz`: liveness, process only.
    *   `GET /readyz`: database round trip, PostGIS present, schema
        version, DuckDB extension loaded. It never checks Photon or S3.
    *   `GET /version`: git SHA, build time, schema version, Overture
        release, radius.
*   **Limits.** `POST /areas` is rate-limited per client IP (30 per minute)
    and `GET /geocode` likewise (60 per minute).

### Browser client

*   **Search.** An ARIA combobox: 300 ms debounce, at least 3 characters,
    each keystroke cancels the previous request (AbortController), at most
    5 suggestions. It also accepts a pasted "lat, lon", and `?lat=&lon=` in
    the URL opens an area directly.
*   **Loading view.** Shows elapsed time, tiles stored versus total, and
    the source being fetched. It polls `POST /areas` every 2 s.
*   **Projection.** Local metres around the area centre (equirectangular,
    computed in float64, then stored as float32). The error is under 1 m at
    2 km. Web Mercator metres are not used.
*   **Scene builder** (pure TypeScript, tested in Node). It turns the
    contract into typed arrays:
    *   buildings: walls plus roofs triangulated with earcut, merged into
        one geometry with per-building vertex colours (a deterministic
        palette keyed on id);
    *   streets: ribbons of `widthM` (a width per kind);
    *   areas: flat polygons with a fixed height step per layer (water 2 cm,
        parks 3 cm, roads 5 cm) and polygon offset, so they do not flicker
        at eye height;
    *   trees: one instanced mesh;
    *   a collision index of footprint edges in a 20 m grid.

    `ExtrudeGeometry` is timed on the PoC data first; the custom extruder
    is kept only if it is faster.
*   **Rendering.**
    *   Three.js `WebGLRenderer`, with the exact version pinned.
    *   `MeshToonMaterial` with a 3-step gradient map.
    *   `OutlineEffect` from `three/addons` for ink outlines.
    *   A directional "sun" plus hemisphere light; no shadow maps.
    *   Sky colour background, and fog from 150 m to 600 m.
    *   No custom GLSL.
*   **Controls.**
    *   `PointerLockControls`, started from a "Click to walk" overlay.
    *   Movement keys read by `KeyboardEvent.code` (W A S D or the arrow
        keys), Shift to run, Q and E to turn.
    *   Walking speed 1.4 m/s, running speed 4 m/s.
    *   Esc opens the pause screen.
    *   Keys are ignored while a text field has focus.
*   **Collision.** A 0.3 m circle against footprint edges, sliding along
    walls. The camera stops 2 m inside the radius and a message explains
    why.
*   **Diagnostics.** `?debug=1` shows the request ID, tile states, feature
    counts, triangle count, frame time and camera lat/lon. Messages are
    distinct for "geocoder unavailable", "no match", "no data here" and
    "WebGL unavailable or lost".
*   **Attribution.** Corner text while walking, and clickable links on the
    pause and search screens.

### Deployment

*   **Image** `geotoon-app:<git-sha>`, built from `docker/app.Dockerfile`:
    *   base `node:26-bookworm-slim` (glibc, which DuckDB's binaries need);
    *   contents: API build, web build, migrations, DuckDB `httpfs` in
        `/opt/duckdb/extensions`;
    *   runs as UID 10001 with a read-only root filesystem and an `emptyDir`
        at `/tmp`.
*   **Helm chart** `deploy/helm/geotoon`:
    *   **App Deployment:** 1 replica; ClusterIP Service on port 80 → 8080;
        the probes above; CPU and memory requests and limits; non-root;
        all capabilities dropped; no privilege escalation; seccomp
        `RuntimeDefault`; `imagePullPolicy: IfNotPresent`.
    *   **PostGIS StatefulSet:** `postgis/postgis:17-3.6`, pinned; 1
        replica; UID 999 with `fsGroup` 999; `PGDATA` in a subdirectory of
        the mount; `pg_isready` probes; `volumeClaimTemplates` 2 Gi on the
        default StorageClass; `persistentVolumeClaimRetentionPolicy`
        `whenDeleted: Delete`, so uninstall removes the cache.
    *   **Database password:** a Secret created on first install, reused
        through `lookup` on upgrades, and annotated
        `helm.sh/resource-policy: keep`.
    *   **Configuration:** `values.schema.json` validates every value,
        including the maximum radius of 2 km. `NOTES.txt` prints
        `kubectl port-forward svc/geotoon 8080:80`.
*   **Kind.** `deploy/kind/kind-config.yaml` defines a single node, with an
    optional port mapping for `values-kind.yaml` (NodePort). Images reach
    the cluster through `make kind-load` (`kind load docker-image`). There
    is no ingress controller.

### Logging and tracing

*   Fastify's pino logger with a random request ID per request, returned
    in the `x-request-id` header and shown in client error messages.
*   One log line per area request and one per ingestion run.
*   A `Server-Timing` header with phase timings.
*   Coordinates in logs are rounded to 3 decimals; typed addresses are
    never logged.

### Code quality (D5)

*   SonarCloud project `marcelomiyake_geotoon`, created through the API
    with Automatic Analysis turned off.
*   Analysis runs through `sonar-scanner` (`make sonar`, and the CI
    workflow on `main`), importing lcov coverage from Vitest.
*   Exclusions live in `sonar-project.properties`, each with a reason:
    `dist/`, `coverage/`, `fixtures/`. Code that only draws to WebGL is
    excluded from coverage only.

### Owner decisions recorded

*   **PD1 = A: ingestion runs inside the API process.**
    *   This accepts the failure case: an ingestion memory spike past the
        pod limit also stops reads until the pod restarts.
    *   Mitigations:
        *   DuckDB's `memory_limit` (1 GB) is set well below the pod's
            memory limit (2 GiB);
        *   only one ingestion run is active at a time;
        *   leases let a restarted pod resume the work.
    *   Rejected: a separate worker Deployment, because of the second
        Deployment, the polling loop and the extra chart surface.
*   **PD2 = A: one `map_feature` table.**
    *   Rejected: one table per layer, because of four near-identical upsert
        and read paths.

