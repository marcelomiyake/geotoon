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

## Alternatives Considered

### Alternative A: Google Photorealistic 3D Tiles (Google Earth meshes)

*   **Pros**: Photographic detail of every facade, sign and tree; worldwide
    city coverage.
*   **Cons**:
    *   Google's terms forbid storing, exporting or rebuilding them, which
        contradicts G2 (store once in PostGIS).
    *   The meshes are unlit, with shadows baked into the photos and missing
        normals, so stepped toon lighting cannot work.
    *   Trees, cars and buildings are fused into one surface, so there is
        nothing to collide with per building.
    *   A billing account is needed.
*   **Reason for Rejection**: Incompatible with G2, with the cel-shaded goal
    and with licensing (Reference 1).

### Alternative B: Cesium OSM Buildings (checklist item 3)

*   **Pros**: Ready-made 3D buildings with estimated heights; the owner's
    original list included it.
*   **Cons**:
    *   It contains only OSM buildings: 585 within 1 km of the PoC address,
        against 6,719 in Overture, which already includes those OSM buildings
        and their height tags.
    *   It needs a Cesium ion account token.
    *   Cesium staff state that storing or exporting its data for offline use
        needs a paid licence, which conflicts with G2.
*   **Reason for Rejection**: It adds no buildings or heights beyond
    Overture, and storing it is likely not permitted. Its height-estimation
    idea is kept as `HeightRule`. Reported as a departure from the checklist.

### Alternative C: OSM layers from the public Overpass API (D1)

*   **Pros**: Data comes straight from OSM, minutes old, with full tags.
    This matches the checklist wording "ingestion from OSM".
*   **Cons**:
    *   Stage 0 measurements: 38 s for one 0.3 km² tile, 32 s for the 1 km
        circle, and the third back-to-back query was refused (502).
    *   A 2 km query failed on all four public instances.
    *   The operator asks automated users to run their own instance.
    *   Multipolygon relations need ring assembly, and an HTTP 200 can carry
        a `remark` error with truncated data.
*   **Reason for Rejection**: Overture's `transportation` and `base` themes
    carry the same OSM streets, parks, water and trees (100%
    `OpenStreetMap`-sourced in the PoC box), read from S3 in 3 to 17 s per
    theme, through the DuckDB reader already needed for buildings. Reported
    as a departure: the OSM data arrives through Overture.

### Alternative D: One-time regional OSM extract loaded with osm2pgsql

*   **Pros**: No runtime dependency on any OSM server; full tags.
*   **Cons**: A heavy import (a regional extract is hundreds of MB to GB) at
    install time. It covers only the region loaded, so any other address
    fails. It adds osm2pgsql to the image or chart.
*   **Reason for Rejection**: Breaks "enter any address" and slows down
    `helm install` (G3).

### Alternative E: Rust and WebAssembly renderer (Reference 2 stack)

*   **Pros**: Lower-level control over GPU memory and threads; a single
    language could span client and server.
*   **Cons**:
    *   wgpu or Bevy for the web costs much more to build than Three.js.
    *   Floating origins, CDLOD terrain and navmesh solve planet-scale
        problems this PoC does not have: a 2 km scene works with 32-bit
        floats, there is no terrain source, and no goal needs pathfinding.
*   **Reason for Rejection**: The owner chose TypeScript and Three.js, with
    Rust only where it measurably helps. The estimates show no hot spot
    (about 108k footprint vertices at 2 km).

### Alternative F: One long synchronous request instead of request-then-poll (D2)

*   **Pros**: The simplest contract and client (`egm-zoom-out`'s position).
*   **Cons**:
    *   The first load can exceed the common 60 s proxy timeout. The browser
        then sees a 504 while the server finishes, and the fast retry hides
        the cause.
    *   A client disconnect could abort ingestion that should be stored.
    *   Switching to polling later would change the contract.
*   **Reason for Rejection**: Polling the same idempotent `POST /areas` adds
    no queue, using the coverage table as the job state.

### Alternative G: Separate ingestion worker Deployment (PD1)

*   **Pros**: DuckDB memory spikes cannot take down reads of stored areas.
*   **Cons**: A second Deployment, a polling loop, about 1 s more latency,
    and silent `pending` when the worker is down.
*   **Reason for Rejection**: The owner chose ingestion inside the API
    process (PD1 = A), with the mitigations listed in the Technical Plan.

### Alternative H: One table per feature layer (PD2)

*   **Pros**: Typed geometry columns and constraints per layer.
*   **Cons**: Four near-identical upsert, read and mapping paths.
*   **Reason for Rejection**: The owner chose one `map_feature` table
    (PD2 = A).

### Alternative I: A table of fetched circles instead of a tile grid (D3)

*   **Pros**:
    *   No tile maths.
    *   Overture's fetch time is flat per query, so tiles do not save fetch
        time (`egm-zoom-out`).
*   **Cons**: No fixed keys to lease, so two overlapping requests cannot
    agree on who fetches. "Same area" would need an `ST_Covers` test over a
    union of circles.
*   **Reason for Rejection**: Fixed tile keys give single-flight leases and
    per-tile evidence for G2.

### Smaller choices rejected during review

*   **PostgreSQL packaging:**
    *   Bitnami's PostgreSQL chart: no PostGIS.
    *   The CloudNativePG operator: needs CRDs installed before the chart.
    *   `emptyDir` storage: a restart erases the cache.
    *   A password regenerated on every install: no longer matches the data
        directory after a reinstall.
*   **Migrations:** Prisma (no geometry type), a Helm `pre-install` hook (the
    database does not exist yet), and a plain Job (its template cannot
    change on upgrade).
*   **Reaching the app:** an ingress controller (an extra install, and a
    60 s timeout) and separate web and API Services (CORS, two ports).
*   **Images:** `latest` tags (pull errors on Kind).
*   **Tile storage:**
    *   Clipping features at tile edges: seams and lost geometry.
    *   Storing a feature once per tile: drawn twice.
    *   Zoom as a Helm value: stored rows become unreachable.
*   **Concurrency:**
    *   In-process locks: do not survive restarts.
    *   An advisory lock held across the remote fetch: ties up a connection
        and an open transaction for a minute.
*   **Heights:**
    *   Storing only the final estimated height: a rule change would force
        refetching.
    *   A per-class height table: 95% of buildings have no class.
*   **Data access:**
    *   The legacy `duckdb` npm package: deprecated in favour of
        `@duckdb/node-api`.
    *   An Alpine base image: DuckDB binaries need glibc.
    *   The Overture Python CLI: a second runtime.
*   **Rendering:**
    *   Custom GLSL toon shaders, or Three.js example code copied into the
        repo: unanalysed, or duplicated, code.
    *   `WebGPURenderer`: `OutlineEffect` is WebGL-only.
    *   Rendering in Web Mercator metres: a 9% scale error at -23.5°.
*   **Monorepo tooling:** Nx, Turborepo, Lerna or a UI framework. Nothing
    in scope needs them.
*   **Observability:** a full stack (OpenTelemetry, Prometheus, Grafana,
    Loki). Request IDs in logs cover the PoC.

### Brief requirements not adopted (owner decision at finalisation)

The owner kept the draft's version of each of these items from
`concepts_brief.md`:

*   **Tile origin (B6):** the brief's per-tile origin field
    (`stored | fetched | failed`). The draft uses `state`, `fetchedAt` and
    `sourceCalls` instead.
*   **Admin CLI (M20):** a CLI to list and evict tiles. The draft uses a
    documented SQL `DELETE`.
*   **Browser smoke test (M9):** a headless-browser test with software
    WebGL. G1 and G6 are verified manually in a browser instead.
*   **Quality profile (M10):** an org quality profile copied from Sonar way.
    The draft uses the default Sonar way profile.
*   **Photon filters (M13):** Photon `layer`/`osm_tag` result filters. The
    draft returns a `kind` on each suggestion instead.
*   **Startup reachability (M6):** reachability checks for the sources in
    the startup log.
*   **Provenance (M3):** query hash, bytes and app git SHA on each fetch
    record. The git SHA is reported by `/version` instead.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security & Privacy**:
    *   No user data is stored. Typed addresses go only to Photon and are
        never logged; logged coordinates are rounded to 3 decimals.
    *   No secrets in the repository:
        *   the database password lives in a Kubernetes Secret;
        *   `SONAR_TOKEN` stays in the environment and in a CI secret.
    *   `.gitignore` covers `.env*`, `.scannerwork/`, `coverage/`, `dist/`
        and kubeconfig files.
    *   Both containers run as non-root, with all capabilities dropped and
        no privilege escalation; the app container has a read-only root
        filesystem.
    *   Per-IP rate limits on `POST /areas` and `GET /geocode`. Coordinates
        are validated, and the radius is server-side configuration only.
*   **Performance & Latency** (checked on the PoC address, G7):
    *   first load at most 60 s;
    *   a stored area returned within 3 s;
    *   gzip scene payload at most 3 MB;
    *   scene build in the browser at most 1.5 s;
    *   no visible stutter while walking.

    Autocomplete answers in under 1 s when Photon is healthy.
*   **Resource limits**: app pod 2 GiB memory with DuckDB capped at 1 GB;
    PostGIS 1 GiB; PVC 2 Gi. At 2 km the PoC stores roughly 20k features,
    a few MB.
*   **Rollout & Rollback**:
    *   Migrations only move forward and only add, or remove what the
        previous release no longer reads.
    *   `helm rollback` works because the API accepts a newer schema with a
        warning.
    *   The emergency step is truncating the feature and coverage tables,
        which costs a refetch.
*   **Licensing**:
    *   OSM-derived data is ODbL. Overture building sources carry their own
        licences.
    *   The screen shows the attribution lines derived from the datasets in
        the scene.
    *   Recorded fixtures ship with an ODbL NOTICE.

### Additional Resources

*   `concepts_brief.md`: six-lens review, Stage 0 measurements and decisions
    D1 to D13.
*   `docs/egm/brainstorm_context.md`: owner requirements, done criteria,
    measurements and reference digests.
*   Reference 1 (owner-supplied): "Legal, Financial, and Technical
    Constraints of Building Walkable Cel-Shaded Simulations from Google
    Earth Data".
*   Reference 2 (owner-supplied): "Architectural Blueprint for
    High-Performance 3D Open-World Rendering and Navigation in Rust and
    WebAssembly".
*   Overture Maps release bucket: `s3://overturemaps-us-west-2/release/`.
*   Photon: `https://photon.komoot.io` (komoot, open source).

### Future Improvements

*   **Fresher OSM data**: a self-hosted Overpass instance or OSM diffs,
    behind the same `MapDataSource` port.
*   **Terrain**: an elevation source (for example Copernicus GLO-30) to
    replace the flat ground. `groundHeightAt(x, z)` is the single place to
    change.
*   **Refresh and eviction**: a time-to-live per tile, using the stored
    release and fetch time.
*   **Touch controls** for phones and tablets.
*   **Shadows and a day-night cycle** with toon-stepped shadow maps.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Build order: scaffold (§1) → core (§2) → contracts (§3) → API and adapters
(§4) → web client (§5) → fixtures and offline tests (§6) → image, chart and
Kind (§7) → SonarCloud (§8) → measurements and docs (§9). Every path below is
relative to the repository root.

### Target Files to Create/Modify

#### 1. Repository scaffold

##### 1.1 `./.gitignore` (Modify)

*   **Type / Scope**: Repository configuration.
*   **Proposed Changes**:
    *   Replace the Rust template. Its bare `debug` and `target` patterns
        would hide folders at any depth.
    *   New entries: `node_modules/`, `dist/`, `coverage/`, `.scannerwork/`,
        `.env*` (except `.env.example`), `*.duckdb*`, `kubeconfig*`,
        `*.tgz`, `.vite/`.

##### 1.2 `./.nvmrc` (Create)

*   **Type / Scope**: Toolchain pin.
*   **Proposed Changes**: `26`. Node 26 ships no Corepack, so npm 11 is the
    package manager.

##### 1.3 `./package.json` and `./package-lock.json` (Create)

*   **Type / Scope**: npm workspace root.
*   **Proposed Changes**:
    *   Workspaces: `packages/*` and `apps/*`. `"type": "module"`.
    *   `engines.node: ">=26"`.
    *   Scripts: `build` (`tsc -b`, then `vite build` in `apps/web`), `test`
        (Vitest, all projects, with coverage), `lint` (ESLint plus
        dependency-cruiser), `typecheck` (`tsc -b --noEmit` equivalent).
    *   Dev dependencies, exact versions: typescript, vitest,
        @vitest/coverage-v8, eslint, typescript-eslint, eslint-plugin-sonarjs,
        dependency-cruiser, testcontainers, @testcontainers/postgresql.
    *   The lockfile is committed.

##### 1.4 `./tsconfig.base.json` and `./tsconfig.json` (Create)

*   **Type / Scope**: TypeScript build configuration.
*   **Proposed Changes**: strict mode, `module`/`moduleResolution`
    `nodenext` (bundler for web), `target` ES2024, declaration output. The
    root `tsconfig.json` holds only project references to the four
    packages, for `tsc -b`.

##### 1.5 `./vitest.config.ts` (Create)

*   **Type / Scope**: Test runner configuration.
*   **Proposed Changes**:
    *   Projects: `core`, `contracts`, `api-unit`, `api-integration`
        (Testcontainers; 120 s timeout; runs serially), and `web` (Node
        environment, testing only the pure modules).
    *   Coverage: v8 provider, lcov output in `coverage/lcov.info`.
    *   Excluded from coverage: `apps/web/src/render/**`,
        `apps/web/src/main.ts`, `apps/api/src/main.ts`. These are wiring or
        WebGL-only code, and the reasons are repeated in
        `sonar-project.properties`.

##### 1.6 `./eslint.config.js` (Create)

*   **Type / Scope**: Lint rules.
*   **Proposed Changes**: Flat config with typescript-eslint
    `recommendedTypeChecked` and `eslint-plugin-sonarjs` recommended rules.
    These catch most SonarCloud issues before analysis. The config ignores
    `dist/`, `coverage/` and `fixtures/`.

##### 1.7 `./.dependency-cruiser.cjs` (Create)

*   **Type / Scope**: Architecture test (G9).
*   **Proposed Changes**: Rules, each failing `make lint` and `make test`:
    *   `packages/core` may not import outside itself (no `node:*`,
        fastify, pg, @duckdb, three, zod);
    *   `packages/contracts` may import only zod;
    *   `apps/web` may import only `contracts`, three and earcut;
    *   `apps/api` may not import `apps/web`;
    *   no circular imports.

##### 1.8 `./Makefile` (Create)

*   **Type / Scope**: Developer and operator commands (D10).
*   **Proposed Changes**: Targets, each listed with a one-line help by
    `make help`:
    *   `setup` (`npm ci`);
    *   `dev` (PostGIS in Docker, the API in watch mode, and Vite with an
        `/api` proxy);
    *   `test` (`npm run lint` then `npm test`; offline apart from the
        locally cached PostGIS image);
    *   `lint`, `typecheck`, `build`;
    *   `images` (`docker build -t geotoon-app:$(GIT_SHA)`);
    *   `kind-up`, `kind-load`, `deploy`
        (`helm upgrade --install geotoon deploy/helm/geotoon --set
        image.tag=$(GIT_SHA) --wait --timeout 5m`);
    *   `open` (port-forward to 8080), `verify-cache`, `sonar`, `kind-down`.

##### 1.9 `./.env.example` (Create)

*   **Type / Scope**: Documentation of local configuration.
*   **Proposed Changes**: Every variable read by `apps/api/src/config.ts`
    (see 4.2), with safe local defaults and no secrets.

##### 1.10 `./.dockerignore` (Create)

*   **Type / Scope**: Docker build context.
*   **Proposed Changes**: Excludes `node_modules`, `dist`, `coverage`,
    `.git`, `.scannerwork`, `fixtures` and `.env*` from the build context.

#### 2. `packages/core` (domain and application; no I/O)

##### 2.1 `packages/core/package.json`, `packages/core/tsconfig.json` (Create)

*   **Type / Scope**: Package manifest.
*   **Proposed Changes**: Name `@geotoon/core`, ESM, no runtime
    dependencies.

##### 2.2 `packages/core/src/index.ts` (Create)

*   **Type / Scope**: Public API of the package.
*   **Proposed Changes**: Re-exports the value objects, use cases and port
    interfaces listed below; nothing else.

##### 2.3 `packages/core/src/shared/geo-point.ts` (Create)

*   **Type / Scope**: Value object.
*   **Proposed Changes**:
    *   `GeoPoint.of(lat, lon)` validates the ranges and finite numbers;
        otherwise it throws `DomainError('INVALID_COORDINATES')`.
    *   `distanceMeters(a, b)` uses the haversine formula with mean earth
        radius 6,371,008.8 m.
    *   `toLocalMeters(origin, p)` and `fromLocalMeters` are equirectangular
        helpers.

##### 2.4 `packages/core/src/shared/domain-error.ts` (Create)

*   **Type / Scope**: Error type.
*   **Proposed Changes**: `DomainError(code, message, {retryable,
    retryAfterSeconds})`. The codes are a union type matching the contract's
    error codes.

##### 2.5 `packages/core/src/shared/ports.ts` (Create)

*   **Type / Scope**: Cross-cutting ports.
*   **Proposed Changes**:
    *   `Clock { now(): Date }`;
    *   `Logger { info, warn, error }`, each taking a message and a fields
        object.

##### 2.6 `packages/core/src/geocoding/` (Create): `address-suggestion.ts`, `geocoder-port.ts`, `suggest-addresses.ts`

*   **Type / Scope**: Geocoding bounded context.
*   **Proposed Changes**:
    *   `AddressSuggestion {id, label, point: GeoPoint, kind: 'house' |
        'street' | 'place' | 'other'}`.
    *   `Geocoder.search(query, {bias?: GeoPoint, limit})`.
    *   `SuggestAddresses.execute(query, bias?)`:
        *   trims the query;
        *   rejects fewer than 3 or more than 200 characters
            (`INVALID_QUERY`);
        *   limits results to 5;
        *   caches results for 10 minutes in an injected Map-based cache,
            with at most 1,000 entries and least-recently-used eviction.

##### 2.7 `packages/core/src/cartography/domain/tile-key.ts` and `tile-grid.ts` (Create)

*   **Type / Scope**: Domain service.
*   **Proposed Changes**:
    *   `TILE_ZOOM = 16` is a constant.
    *   `TileKey {x, y}`.
    *   `tileOf(point)`, `boundsOf(tile)` (south, west, north, east).
    *   `tilesCovering(centre, radiusM)` lists the tiles whose bounds come
        within the radius. It uses the distance from the centre to the
        nearest point of the tile's bounds, measured in local metres.
    *   `bboxOf(tiles)` returns the union bounds.

##### 2.8 `packages/core/src/cartography/domain/tile-coverage.ts` (Create)

*   **Type / Scope**: Entity rules.
*   **Proposed Changes**:
    *   `TileState = 'missing' | 'fetching' | 'complete' | 'failed'`.
    *   `TileCoverage {tile, state, leaseExpiresAt?, attempts, errorClass?,
        retryAfter?, release?, featureCount?, fetchedAt?,
        fetchRequestId?}`.
    *   Pure functions:
        *   `isClaimable(c, now)`;
        *   `retryDelaySeconds(attempts) = min(10 × 2^attempts, 600)`;
        *   `areaStatus(coverages, now)`, which returns `ready` (all
            complete), `failed` (any failed with a future retry-after) or
            `pending`.
    *   `LEASE_SECONDS = 180`.

##### 2.9 `packages/core/src/cartography/domain/features.ts` (Create)

*   **Type / Scope**: Domain types.
*   **Proposed Changes**:
    *   **Geometry types:** `Polygon` and `MultiPolygon` as nested
        `[lon, lat][]` arrays.
    *   **`BuildingRecord`:** `{id, footprint, sourceHeightM?, numFloors?,
        minHeightM?, kind, sourceDataset}`.
    *   **`MapLine`:** `{id, kind, name?, coords}`, where kind is one of
        `motorway`, `trunk`, `primary`, `secondary`, `tertiary`,
        `residential`, `service`, `unclassified`, `footway`, `path`,
        `cycleway`, `steps`, `rail`, `stream`, `river` or `other`.
    *   **`MapArea`:** `{id, kind, polygon}`, where kind is one of `park`,
        `grass`, `pitch`, `water`, `forest`, `residential`, `industrial`,
        `commercial`, `education` or `other`.
    *   **`TreeFeature`:** `{id, geometry: point | line}`.
    *   **`FeatureBatch`:** `{buildings, lines, areas, trees, release}`.
    *   **`LINE_WIDTH_M`:**

        | Kind | Width |
        | --- | --- |
        | motorway | 14 |
        | trunk | 12 |
        | primary | 10 |
        | secondary | 9 |
        | tertiary | 8 |
        | residential, unclassified | 6 |
        | service | 4 |
        | footway, path, cycleway, steps | 2 |
        | rail | 3 |
        | stream | 3 |
        | river | 8 |
        | other | 5 |

##### 2.10 `packages/core/src/cartography/domain/height-rule.ts` and `fnv1a.ts` (Create)

*   **Type / Scope**: Domain rule (M2).
*   **Proposed Changes**:
    *   `HEIGHT_RULE_VERSION = 1`.
    *   `fnv1a32(text)` is an FNV-1a 32-bit hash over UTF-8 bytes.
    *   `estimateHeight(b)` returns `{heightM, minHeightM, source}`:
        1.  `sourceHeightM > 0`: measured.
        2.  Else `numFloors > 0`: `numFloors × 3.0`, source floors.
        3.  Else estimated from the footprint area in m², computed with
            local metres. Below 40 m²: 3–6 m. Up to 150: 3–9 m. Up to 600:
            6–15 m. Larger: 8–12 m. Within each band the height is
            `min + (fnv1a32(id) mod 1000)/1000 × (max − min)`, rounded to
            0.1 m.

##### 2.11 `packages/core/src/cartography/domain/spawn-point.ts` (Create)

*   **Type / Scope**: Domain rule (M14).
*   **Proposed Changes**: `chooseSpawn(address, lines, buildings)` returns
    `{point, headingDeg}`:
    1.  Find the nearest point on any line of a walkable kind (everything
        except rail and water) within 150 m.
    2.  If there is none, take the point 2 m outside the nearest footprint
        edge.
    3.  If there is still none, use the address point itself.

    The heading is the bearing from the spawn point to the address. Uses
    local metres.

##### 2.12 `packages/core/src/cartography/application/ports.ts` (Create)

*   **Type / Scope**: Port interfaces.
*   **Proposed Changes**:
    *   `MapDataSource.fetch(bbox, {signal})` returns a `FeatureBatch`.
    *   `TileCoverageRepository`:
        *   `get(tiles)`;
        *   `claim(tiles, owner, leaseSeconds)`, returning the claimed
            subset;
        *   `markFailed(tiles, owner, errorClass, retryAfter)`;
        *   `releaseOwner(owner)`.
    *   `FeatureStore.storeAndComplete(batch, tiles, owner, requestId)` runs
        in one transaction. It returns the tiles it completed.
    *   `FeatureReader.readWithin(centre, radiusM)` returns the stored
        buildings, lines, areas and trees.
    *   `IngestionScheduler.schedule(job)`.

##### 2.13 `packages/core/src/cartography/application/request-area.ts` (Create)

*   **Type / Scope**: Use case.
*   **Proposed Changes**: `RequestArea.execute(point, requestId)` follows
    steps 1 to 5 in the Technical Plan. It returns `{status, tiles,
    sourceCalls, scene?}`. `sourceCalls` is 1 if this request scheduled a
    fetch, else 0.

##### 2.14 `packages/core/src/cartography/application/ingest-tiles.ts` (Create)

*   **Type / Scope**: Use case.
*   **Proposed Changes**: `IngestTiles.run({tiles, owner, requestId})`:
    1.  Fetch the bounding box of the tiles, with a 120 s abort signal.
    2.  Call `storeAndComplete`.
    3.  On error, classify it (`timeout`, `network`, `release_not_found`,
        `parse_error` or `unknown`) and call `markFailed` with
        `retryDelaySeconds`.
    4.  Log one line with the tiles, the feature counts and the duration.

##### 2.15 `packages/core/src/cartography/application/read-scene.ts` (Create)

*   **Type / Scope**: Use case.
*   **Proposed Changes**:
    *   `ReadScene.execute(centre, radiusM)` calls the reader, applies
        `estimateHeight` to every building and `chooseSpawn`, and samples
        tree lines every 6 m.
    *   It builds the attribution list from the distinct source datasets:
        *   always "© OpenStreetMap contributors" (ODbL) and "Overture Maps
            Foundation";
        *   plus "Google Open Buildings" and "Microsoft ML Buildings" when
            present.
    *   It returns a `Scene` domain object.

##### 2.16 `packages/core/src/cartography/application/counting-map-data-source.ts` (Create)

*   **Type / Scope**: Decorator (B6).
*   **Proposed Changes**: Wraps any `MapDataSource` and counts calls,
    exposing `count()`. The composition root uses it, and so does the
    integration test.

##### 2.17 `packages/core/test/*.spec.ts` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**:
    *   **`geo-point`:** range validation and known distances.
    *   **`tile-grid`:** known tile for the PoC point (x 24257, y 37180 at
        zoom 16); 16 or fewer tiles for 1 km; corners excluded.
    *   **`tile-coverage`:** each transition, the backoff caps, and
        `areaStatus`.
    *   **`height-rule`:** measured, floors and estimated paths; outputs
        pinned for 3 real GERS ids; bounds per band.
    *   **`spawn-point`:** a point inside a footprint moves to the street;
        the no-street fallback; the heading.
    *   **`suggest-addresses`:** validation, limit and cache.
    *   **`request-area`:** in-memory fakes:
        *   ready path;
        *   pending path, which schedules exactly once;
        *   failed path, with retry-after;
        *   two concurrent calls, which schedule one fetch.
    *   **`ingest-tiles`:** success; failure classification;
        lease-lost tiles are not marked complete.
    *   **`read-scene`:** heights, attribution and tree sampling.

#### 3. `packages/contracts` (wire schemas)

##### 3.1 `packages/contracts/package.json`, `packages/contracts/tsconfig.json` (Create)

*   **Type / Scope**: Package manifest.
*   **Proposed Changes**: Name `@geotoon/contracts`, ESM, with zod as the
    only dependency (exact pin).

##### 3.2 `packages/contracts/src/` (Create): `index.ts`, `version.ts`, `geocode.ts`, `areas.ts`, `problem.ts`

*   **Type / Scope**: Shared schemas.
*   **Proposed Changes**:
    *   `CONTRACT_VERSION = 1`.
    *   Zod schemas and inferred types:
        *   `GeocodeQuery`, `GeocodeResponse`;
        *   `AreaRequestBody {lat, lon}`;
        *   `AreaPending`, `AreaReady`, `Scene`, `SceneBuilding`, `SceneLine`,
            `SceneArea`, `Spawn`, `Attribution`, `TileStatus`;
        *   `Problem`, with an `ErrorCode` enum holding the codes listed in
            the Technical Plan.
    *   Coordinates are `[lon, lat]` tuples rounded to 6 decimals.

##### 3.3 `packages/contracts/test/areas.spec.ts` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Valid and invalid examples parse or fail as
    expected; the version is present.

#### 4. `apps/api` (Fastify server and adapters)

##### 4.1 `apps/api/package.json`, `apps/api/tsconfig.json` (Create)

*   **Type / Scope**: Package manifest.
*   **Proposed Changes**: Name `@geotoon/api`. Dependencies, exact pins:
    `@geotoon/core`, `@geotoon/contracts`, fastify, @fastify/static,
    @fastify/compress, @fastify/rate-limit, pg, @duckdb/node-api, zod.
    Scripts: `build`, `start`, `dev`.

##### 4.2 `apps/api/src/config.ts` (Create)

*   **Type / Scope**: Configuration.
*   **Proposed Changes**: A zod-validated environment, read once:
    *   **Server:** `PORT` (8080), `STATIC_DIR`.
    *   **Database:** `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`,
        `DATABASE_USER`, `DATABASE_PASSWORD`.
    *   **Overture:** `OVERTURE_BASE_URL`
        (`s3://overturemaps-us-west-2/release`), `OVERTURE_RELEASE`
        (`2026-10-21.0`), `OVERTURE_QUERY_TIMEOUT_S` (120).
    *   **Area:** `AREA_RADIUS_M` (2000), `AREA_RADIUS_MAX_M` (2000).
    *   **Photon:** `PHOTON_URL` (`https://photon.komoot.io`),
        `PHOTON_TIMEOUT_MS` (4000).
    *   **Outbound identity:** `USER_AGENT`
        (`geotoon/<version> (+https://github.com/marcelomiyake/geotoon)`).
    *   **DuckDB:** `DUCKDB_MEMORY_LIMIT` (`1GB`), `DUCKDB_THREADS` (4),
        `DUCKDB_EXTENSION_DIR`, `DUCKDB_TEMP_DIR` (`/tmp/duckdb`).
    *   **Limits:** `RATE_LIMIT_AREAS_PER_MIN` (30),
        `RATE_LIMIT_GEOCODE_PER_MIN` (60).

    Startup fails with one message listing every invalid variable.

##### 4.3 `apps/api/src/main.ts` (Create)

*   **Type / Scope**: Process entry point.
*   **Proposed Changes**:
    1.  Load the configuration.
    2.  Connect to PostgreSQL, retrying for up to 60 s.
    3.  Run the migrator.
    4.  Open DuckDB and load `httpfs`.
    5.  Build the app through the composition root and listen.
    6.  Log one startup line: git SHA, release, radius, zoom, stored tile
        count.

    On SIGTERM: stop accepting requests, call
    `TileCoverageRepository.releaseOwner(owner)`, close the pools and exit.

##### 4.4 `apps/api/src/composition-root.ts` (Create)

*   **Type / Scope**: Wiring.
*   **Proposed Changes**: Builds the adapters and use cases by hand and
    returns `{app, close}`. The owner ID is `hostname:pid:uuid`.

##### 4.5 `apps/api/src/http/server.ts` (Create)

*   **Type / Scope**: Fastify setup.
*   **Proposed Changes**:
    *   Request IDs from `crypto.randomUUID`, echoed in `x-request-id`.
    *   @fastify/compress (gzip and brotli).
    *   @fastify/rate-limit, with a limit per route.
    *   @fastify/static serving `STATIC_DIR`:
        *   hashed assets with long-lived caching;
        *   `index.html` with `no-cache`;
        *   SPA fallback to `index.html`.
    *   A `Server-Timing` hook.
    *   An error handler that maps `DomainError` and zod errors to
        `application/problem+json` via `problem.ts`. Unknown errors become
        `INTERNAL` with no internal details.

##### 4.6 `apps/api/src/http/problem.ts` (Create)

*   **Type / Scope**: Error mapping.
*   **Proposed Changes**: A table from error code to HTTP status:
    *   400: `INVALID_COORDINATES`, `INVALID_QUERY`;
    *   429: `RATE_LIMITED`, `GEOCODER_RATE_LIMITED`;
    *   502: `AREA_FETCH_FAILED`, `OVERTURE_RELEASE_NOT_FOUND`;
    *   503: `GEOCODER_UNAVAILABLE`, `OVERTURE_UNAVAILABLE`;
    *   500: `INTERNAL`.

    It also builds the problem body.

##### 4.7 `apps/api/src/http/routes/geocode.ts`, `areas.ts`, `ops.ts` (Create)

*   **Type / Scope**: HTTP routes.
*   **Proposed Changes**:
    *   **`GET /api/v1/geocode`:** validates against the contract and calls
        `SuggestAddresses`.
    *   **`POST /api/v1/areas`:** validates, then calls `RequestArea`.
        Returns 202 or 200 with `Cache-Control: no-store`, and logs one line
        with the status, tile counts, source calls and duration.
    *   **`GET /healthz`:** liveness.
    *   **`GET /readyz`:** checks `SELECT postgis_version()`, that the
        schema version equals the expected one, and that DuckDB is loaded.
        It never checks Photon or S3.
    *   **`GET /version`.**

##### 4.8 `apps/api/src/adapters/postgres/pool.ts`, `migrator.ts` (Create)

*   **Type / Scope**: Database infrastructure.
*   **Proposed Changes**:
    *   `pg.Pool` with a maximum of 10 connections and statement timeouts.
    *   The migrator:
        1.  takes `pg_advisory_lock(hashtext('geotoon-migrations'))`;
        2.  creates `schema_migrations(version int primary key,
            applied_at)` if missing;
        3.  applies the missing `migrations/NNNN_*.sql` files in order, one
            transaction each;
        4.  refuses to start if the database is behind the files' highest
            version after this, and warns if the database is ahead.

##### 4.9 `apps/api/migrations/0001_init.sql` (Create)

*   **Type / Scope**: Database schema.
*   **Proposed Changes**:
    *   `CREATE EXTENSION IF NOT EXISTS postgis`.
    *   The `map_feature` table from the Technical Plan, with its GiST
        index.
    *   `tile_coverage`: `z smallint`, `x int`, `y int`, `state text` CHECK
        in the four states, `lease_owner text`, `lease_expires_at
        timestamptz`, `attempts int NOT NULL DEFAULT 0`, `error_class text`,
        `retry_after timestamptz`, `overture_release text`, `feature_count
        int`, `fetched_at timestamptz`, `fetch_request_id text`,
        `ingest_version int`, PRIMARY KEY (z, x, y).

##### 4.10 `apps/api/src/adapters/postgres/tile-coverage-repository.ts` (Create)

*   **Type / Scope**: Repository adapter.
*   **Proposed Changes**:
    *   `get`, `claim` (the SQL statement in the Technical Plan),
        `markFailed` and `releaseOwner`.
    *   Every update also checks `lease_owner = $owner AND state =
        'fetching'`.

##### 4.11 `apps/api/src/adapters/postgres/feature-store.ts` (Create)

*   **Type / Scope**: Write adapter.
*   **Proposed Changes**: `storeAndComplete` in one transaction:
    1.  For each layer, upsert in batches of 1,000 rows. Columns are passed
        as arrays and expanded with `unnest`, and each geometry is built
        with `ST_MakeValid(ST_GeomFromWKB(wkb, 4326))`. Upserts use `ON
        CONFLICT (id) DO UPDATE`.
    2.  Mark the claimed tiles `complete`, with release, count, time and
        request ID, but only where this owner still holds the lease.

    Returns the tiles it completed.

##### 4.12 `apps/api/src/adapters/postgres/feature-reader.ts` (Create)

*   **Type / Scope**: Read adapter.
*   **Proposed Changes**: One query per layer:
    *   filter: `geom && ST_MakeEnvelope(bbox of circle, 4326) AND
        ST_DWithin(geom::geography, ST_MakePoint(lon, lat)::geography,
        radius)`;
    *   output: `ST_AsGeoJSON(geom, 6)`, parsed into domain types.

##### 4.13 `apps/api/src/adapters/overture/duckdb-client.ts` (Create)

*   **Type / Scope**: Infrastructure.
*   **Proposed Changes**:
    *   One `DuckDBInstance`, in memory, with settings `memory_limit`,
        `threads`, `temp_directory`, `extension_directory`,
        `autoinstall_known_extensions=false`, `autoload_known_extensions=false`
        and `s3_region='us-west-2'`.
    *   `LOAD httpfs` at startup; failure stops startup.
    *   `query(sql, params, signal)` runs on a fresh connection. On abort it
        calls `connection.interrupt()`.

##### 4.14 `apps/api/src/adapters/overture/overture-map-data-source.ts` and `overture-mapping.ts` (Create)

*   **Type / Scope**: `MapDataSource` adapter (D1).
*   **Proposed Changes**:
    *   **Five queries**, run in parallel, filtered on `bbox.xmin < E AND
        bbox.xmax > W AND bbox.ymin < N AND bbox.ymax > S`:
        *   `buildings/building`;
        *   `transportation/segment`;
        *   `base/land_use`;
        *   `base/water`;
        *   `base/land`, filtered to tree, forest and grass classes.
    *   **Path:** `${OVERTURE_BASE_URL}/${release}/theme=…/type=…/*`, passed
        to `read_parquet(..., hive_partitioning=1)`.
    *   **Mapping:** `overture-mapping.ts` holds the tables from Overture
        `subtype`/`class` to domain kinds:
        *   **Lines:** transportation road classes map to the line kinds of
            the same name, rail maps to `rail`, and water lines map to
            `stream` or `river`.
        *   **Areas:**
            *   land_use: `park` and `recreation` map to `park`, except a
                pitch, which maps to `pitch`;
            *   land_use: managed `grass` maps to `grass`;
            *   land_use: `developed` industrial, commercial and retail map
                to `industrial` or `commercial`;
            *   land_use: education maps to `education`;
            *   water polygons map to `water`;
            *   land: forest and wood map to `forest`.
        *   Anything else maps to `other`.
    *   **Errors:** "No files found" maps to `release_not_found`; abort maps
        to `timeout`; HTTP and IO errors map to `network`.
    *   Geometry stays as WKB bytes until PostGIS.

##### 4.15 `apps/api/src/adapters/photon/photon-geocoder.ts` (Create)

*   **Type / Scope**: `Geocoder` adapter.
*   **Proposed Changes**:
    *   `GET ${PHOTON_URL}/api/?q=&limit=5&lang=default&lat=&lon=`, using
        global `fetch` with `AbortSignal.timeout` and the `USER_AGENT`
        header.
    *   It maps features to `AddressSuggestion`. The label is built from
        name, street and house number, district, city, state and country,
        without repeats.
    *   Errors: 429 maps to `GEOCODER_RATE_LIMITED`; timeout, network and
        5xx map to `GEOCODER_UNAVAILABLE`.

##### 4.16 `apps/api/src/adapters/ingestion/in-process-scheduler.ts` (Create)

*   **Type / Scope**: `IngestionScheduler` adapter (PD1 = A).
*   **Proposed Changes**:
    *   A FIFO queue that runs one `IngestTiles` job at a time, detached
        from the HTTP request.
    *   `drain()` waits for the job in progress, for shutdown and tests.

##### 4.17 `apps/api/scripts/record-overture-fixture.ts` (Create)

*   **Type / Scope**: Developer script (not shipped).
*   **Proposed Changes**:
    *   Copies the PoC centre tile and its 8 neighbours from the pinned
        release into
        `fixtures/overture/<release>/theme=…/type=…/part-0.parquet`, using
        DuckDB `COPY … TO … (FORMAT parquet)` and only the columns the
        adapter reads.
    *   Run once with network access; its output is committed.

##### 4.18 `apps/api/test/unit/*.spec.ts` (Create)

*   **Type / Scope**: Unit and adapter tests (offline).
*   **Proposed Changes**:
    *   **`config`:** defaults, and invalid values listed together.
    *   **`problem`:** every code maps to its status.
    *   **Routes,** through `fastify.inject` with fake use cases:
        *   200, 202 and problem responses;
        *   the `no-store` and `x-request-id` headers;
        *   rate-limit responses.
    *   **`photon-geocoder`:** an undici `MockAgent` replays
        `fixtures/photon/av-bolonha-200.json`; also 429, timeout and 500.
    *   **`overture-map-data-source`:** reads the local fixture through
        `OVERTURE_BASE_URL=fixtures/overture`. It checks:
        *   counts per layer;
        *   kind mapping;
        *   that a missing release gives `release_not_found`;
        *   that an aborted query gives `timeout`.
    *   **`in-process-scheduler`:** jobs run one at a time.

##### 4.19 `apps/api/test/integration/*.spec.ts` (Create)

*   **Type / Scope**: Integration tests (Testcontainers `postgis/postgis:17-3.6`).
*   **Proposed Changes**:
    *   **`migrator`:** applies to an empty database, is idempotent, two
        concurrent runs serialise, and the version guard works.
    *   **`tile-coverage-repository`:**
        *   claims race between two owners;
        *   expired leases are re-claimed;
        *   failed tiles wait for their retry-after;
        *   a stale owner cannot complete or fail tiles.
    *   **`feature-store` and `feature-reader`:**
        *   upsert is idempotent;
        *   features crossing a tile edge are stored once;
        *   the radius filter is exact;
        *   invalid geometry is repaired.
    *   **G2 proof:** the full `RequestArea` flow, with the Overture fixture
        source wrapped in `CountingMapDataSource`:
        *   first request: pending, then ready, with a count of 1;
        *   second request: ready immediately, count still 1, every tile
            complete;
        *   the source is then replaced by one that throws if called, and a
            third request still succeeds;
        *   two concurrent first requests give a count of 1.

#### 5. `apps/web` (browser client)

##### 5.1 `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html` (Create)

*   **Type / Scope**: Client package and build.
*   **Proposed Changes**:
    *   Dependencies, exact pins: `@geotoon/contracts`, three, earcut. Dev
        dependencies: vite, @types/three.
    *   Vite builds into `apps/web/dist` with hashed asset names, and the
        dev server proxies `/api` to `localhost:8080`.
    *   `index.html` holds the search panel, the canvas container and the
        overlays.

##### 5.2 `apps/web/src/main.ts` (Create)

*   **Type / Scope**: Client entry (excluded from coverage).
*   **Proposed Changes**:
    1.  Check for WebGL2 and a touch-only device (D12), with a message for
        each.
    2.  Wire the search box, the loading view, the scene builder, the
        renderer and the controls.
    3.  Handle `?lat=&lon=` and `?debug=1`.

##### 5.3 `apps/web/src/api/client.ts` (Create)

*   **Type / Scope**: HTTP client.
*   **Proposed Changes**:
    *   `suggest(query, signal)`, and `loadArea(lat, lon, onProgress,
        signal)`, which polls `POST /areas` every `pollAfterMs` until it
        gets `ready`, a problem response, or an abort.
    *   Responses are validated with the contract schemas.
    *   Problems are thrown as `ApiProblem` with the code and request ID.

##### 5.4 `apps/web/src/ui/search-box.ts`, `loading-view.ts`, `overlays.ts`, `styles.css` (Create)

*   **Type / Scope**: DOM user interface.
*   **Proposed Changes**:
    *   **Search box** (ARIA combobox):
        *   300 ms debounce, at least 3 characters, AbortController per
            keystroke;
        *   arrow keys, Enter and Esc;
        *   a pasted "lat, lon" is accepted;
        *   "Search by Photon" credit.
    *   **Loading view:** elapsed seconds, tiles complete out of total.
    *   **Overlays:**
        *   "Click to walk";
        *   a pause screen with Resume, New address, Controls and
            Attribution;
        *   the edge-of-area message;
        *   error messages per code, with the request ID and Retry;
        *   corner attribution;
        *   the debug panel.
    *   The debounce and parsing logic is pure, so it can be tested.

##### 5.5 `apps/web/src/scene/` (Create): `projection.ts`, `palette.ts`, `extrude.ts`, `ribbons.ts`, `ground.ts`, `trees.ts`, `collision.ts`, `scene-builder.ts`

*   **Type / Scope**: Pure scene construction (no WebGL).
*   **Proposed Changes**:
    *   **`projection`:** lon/lat to local x/z metres around the centre,
        computed in float64.
    *   **`palette`:** a deterministic colour per building from a fixed
        palette of 8 warm toon colours, indexed by FNV-1a of the id;
        colours per area kind and line kind.
    *   **`extrude`:** walls as one quad per ring edge with outward normals;
        roofs triangulated with earcut, holes supported. Output is
        position, normal and colour arrays.
    *   **`ribbons`:** each line becomes a strip of `widthM` with mitred
        joins. Miters are limited to 2× the width.
    *   **`ground`:** area polygons triangulated with earcut at fixed
        heights per kind, plus one ground disc of radius + 50 m.
    *   **`trees`:** an instance transform per tree point. Size varies by id
        hash.
    *   **`collision`:** footprint edges in a 20 m uniform grid.
        `resolve(from, to, radius 0.3)` returns the corrected position,
        sliding along walls.
    *   **`scene-builder`:** `buildScene(contractScene)` returns typed
        arrays per material, the collision index and stats (triangles,
        build ms).

##### 5.6 `apps/web/src/render/renderer.ts`, `controls.ts` (Create)

*   **Type / Scope**: WebGL and input (excluded from coverage; tested by the
    smoke check in §9).
*   **Proposed Changes**:
    *   **`renderer.ts`:**
        *   `WebGLRenderer` with antialiasing.
        *   `MeshToonMaterial` with vertex colours and a 3-step gradient
            `DataTexture` (`NearestFilter`).
        *   `OutlineEffect` with thickness 0.004 and black outlines.
        *   A `DirectionalLight` from the north-west at 45°, and a
            `HemisphereLight`.
        *   Fog from 150 m to 600 m, and a sky colour background.
        *   An `InstancedMesh` for trees (cone plus cylinder).
        *   An address marker sprite.
        *   Handling of `webglcontextlost`.
    *   **`controls.ts`:**
        *   `PointerLockControls`, with movement keys read by
            `KeyboardEvent.code` (WASD and the arrow keys).
        *   Shift to run (1.4 and 4 m/s), Q and E to turn at 90°/s.
        *   Movement is ignored while an input has focus.
        *   Each frame, the move goes through `collision.resolve` and the
            radius clamp (2 m inside the radius), and the eye height is
            fixed at 1.7 m.

##### 5.7 `apps/web/test/*.spec.ts` (Create)

*   **Type / Scope**: Unit tests (Node).
*   **Proposed Changes**:
    *   **`projection`:** known offsets; error under 1 m at 2 km.
    *   **`extrude`:** a square gives 8 wall and 2 roof triangles, plus
        normals; holes; clockwise and anticlockwise input.
    *   **`ribbons`:** width; miter limit.
    *   **`ground`:** layer heights.
    *   **`collision`:** blocks a wall, slides along it, empty cells.
    *   **`scene-builder`:** built from a recorded PoC scene payload
        (`fixtures/scene/poc-scene.json`, generated by the integration test
        helper). It checks counts per layer and that every building yields
        triangles. Build time is measured under G7, not asserted in a unit
        test, because a time limit inside `make test` would fail randomly.
    *   **`client`:** polling stops at ready, and a problem response throws.
    *   **`search-box` logic:** debounce, "lat, lon" parsing.

#### 6. Fixtures

##### 6.1 `fixtures/overture/2026-10-21.0/theme=*/type=*/part-0.parquet` (Create)

*   **Type / Scope**: Recorded test data (five files).
*   **Proposed Changes**: Output of the script in 4.17; about 3 × 3 tiles
    around the PoC point. Used only by tests.

##### 6.2 `fixtures/photon/av-bolonha-200.json`, `fixtures/scene/poc-scene.json` (Create)

*   **Type / Scope**: Recorded test data.
*   **Proposed Changes**: One Photon response for "Av. Bolonha 200
    Jaguaré", and one scene payload built from the Overture fixture.

##### 6.3 `fixtures/NOTICE` (Create)

*   **Type / Scope**: Licence notice.
*   **Proposed Changes**: States that the fixtures contain data © OpenStreetMap
    contributors (ODbL 1.0), distributed by Overture Maps Foundation, plus
    Google Open Buildings and Microsoft ML Buildings where present, and that
    the repository's MIT licence does not apply to them.

#### 7. Image, chart and Kind

##### 7.1 `docker/app.Dockerfile` (Create)

*   **Type / Scope**: Container image.
*   **Proposed Changes**:
    *   **Stage `build`** (`node:26-bookworm-slim`): `npm ci`, then
        `npm run build`, then prune dev dependencies.
    *   **Stage `duckdb-ext`:** a short Node script, using the same
        `@duckdb/node-api` version, runs `INSTALL httpfs` into
        `/opt/duckdb/extensions`.
    *   **Stage `runtime`** (`node:26-bookworm-slim`):
        *   copies the API `dist`, production `node_modules`, `migrations`,
            the web `dist` (to `/app/public`) and the extensions;
        *   creates user 10001;
        *   `USER 10001`, `EXPOSE 8080`, a `HEALTHCHECK`-free image (probes
            live in the chart);
        *   `CMD ["node", "apps/api/dist/main.js"]`;
        *   `GIT_SHA` build argument, exposed as an environment variable.
    *   Base images are pinned by digest.

##### 7.2 `deploy/kind/kind-config.yaml` (Create)

*   **Type / Scope**: Kind cluster definition.
*   **Proposed Changes**: One control-plane node. `extraPortMappings` maps
    host port 8080 to node port 30080, used only with `values-kind.yaml`.

##### 7.3 `deploy/helm/geotoon/Chart.yaml`, `.helmignore` (Create)

*   **Type / Scope**: Chart metadata.
*   **Proposed Changes**: apiVersion v2, chart version 0.1.0, appVersion
    from the git SHA set at install.

##### 7.4 `deploy/helm/geotoon/values.yaml`, `values.schema.json`, `values-kind.yaml` (Create)

*   **Type / Scope**: Chart configuration.
*   **Proposed Changes**:
    *   **`values.yaml`:**
        *   `image.repository` and `image.tag`;
        *   `area.radiusM` (2000);
        *   `overture.release` and `overture.baseUrl`;
        *   `photon.url`;
        *   `duckdb.memoryLimit` and `duckdb.threads`;
        *   `resources` for the app (2 GiB) and PostgreSQL (1 GiB);
        *   `postgresql.image` (`postgis/postgis:17-3.6`, pinned) and
            `postgresql.storage` (2Gi);
        *   `service.type` (ClusterIP).
    *   **`values.schema.json`:** requires all of the above and limits
        `area.radiusM` to 100–2000.
    *   **`values-kind.yaml`:** `service.type: NodePort`, `nodePort: 30080`.

##### 7.5 `deploy/helm/geotoon/templates/` (Create): `_helpers.tpl`, `app-deployment.yaml`, `app-service.yaml`, `postgres-statefulset.yaml`, `postgres-service.yaml`, `postgres-secret.yaml`, `NOTES.txt`

*   **Type / Scope**: Kubernetes manifests.
*   **Proposed Changes**:
    *   **App Deployment:**
        *   1 replica; environment from values and the Secret;
        *   probes: startup and readiness on `/readyz`, liveness on
            `/healthz`;
        *   pod and container security contexts: non-root UID 10001,
            read-only root filesystem, `allowPrivilegeEscalation: false`,
            drop ALL capabilities, seccomp `RuntimeDefault`;
        *   an `emptyDir` at `/tmp`;
        *   resource requests and limits;
        *   `automountServiceAccountToken: false`;
        *   `terminationGracePeriodSeconds: 30`.
    *   **PostGIS StatefulSet:**
        *   1 replica, UID and GID 999 with `fsGroup` 999;
        *   `PGDATA=/var/lib/postgresql/data/pgdata`;
        *   `pg_isready` probes;
        *   `volumeClaimTemplates` (2Gi), with
            `persistentVolumeClaimRetentionPolicy {whenDeleted: Delete,
            whenScaled: Retain}`;
        *   resource limits; `automountServiceAccountToken: false`.
    *   **Secret:** created with a 32-character random password only when
        `lookup` finds none, and annotated `helm.sh/resource-policy: keep`.
    *   **`NOTES.txt`:** prints the port-forward command and the expected
        first-load time.

#### 8. SonarCloud and CI

##### 8.1 `sonar-project.properties` (Create)

*   **Type / Scope**: Analysis configuration (D5).
*   **Proposed Changes**:
    *   `sonar.organization=marcelomiyake`,
        `sonar.projectKey=marcelomiyake_geotoon`.
    *   Sources and tests:
        *   `sonar.sources`: packages, apps, deploy and docker;
        *   `sonar.tests`: the `test/` folders;
        *   `sonar.test.inclusions`: `**/*.spec.ts`.
    *   `sonar.javascript.lcov.reportPaths=coverage/lcov.info`.
    *   Exclusions:
        *   `sonar.exclusions`: `**/dist/**`, `**/coverage/**`,
            `fixtures/**`;
        *   `sonar.coverage.exclusions`: the WebGL and entry files from 1.5,
            with a comment giving the reason.

##### 8.2 `.github/workflows/ci.yml` (Create)

*   **Type / Scope**: CI pipeline.
*   **Proposed Changes**:
    *   Triggers: push to `main` and pull requests.
    *   Steps:
        1.  Set up Node 26.
        2.  `make setup lint typecheck test build`.
        3.  SonarCloud scan using the `SONAR_TOKEN` repository secret.
    *   Actions pinned by commit SHA.
    *   The workflow file exists, but it runs only after the owner pushes
        and adds the secret. Both are outward actions that need the owner's
        approval.

##### 8.3 SonarCloud project (external, not a file)

*   **Type / Scope**: External configuration.
*   **Proposed Changes**:
    *   Create `marcelomiyake_geotoon` (public) with `api/projects/create`
        using `SONAR_TOKEN`. It is not imported from GitHub, so Automatic
        Analysis stays off.
    *   Analysis comes from `make sonar` (local `sonar-scanner`) until CI
        is enabled.

#### 9. Documentation and verification scripts

##### 9.1 `README.md` (Create)

*   **Type / Scope**: Documentation (M22).
*   **Proposed Changes**: Sections, in this order:
    1.  What it is, with a screenshot.
    2.  Prerequisites with versions.
    3.  Outbound hosts needed (`overturemaps-us-west-2.s3.amazonaws.com`,
        `photon.komoot.io`).
    4.  Quick start: `make kind-up images kind-load deploy open`.
    5.  The command table.
    6.  The configuration table.
    7.  How to confirm a read came from storage.
    8.  Attribution and licences.
    9.  Troubleshooting:
        *   request IDs;
        *   `kubectl logs`;
        *   psql through port-forward;
        *   three provenance queries;
        *   forcing a refetch with `DELETE FROM tile_coverage WHERE …`.
    10. Glossary.
    11. The departures from the original checklist.

##### 9.2 `scripts/verify-cache.sh` (Create)

*   **Type / Scope**: G2 check on Kind (CUJ 2).
*   **Proposed Changes**:
    1.  Port-forward the app.
    2.  `POST /api/v1/areas` at the PoC point until ready, and record the
        first-load time and payload bytes (for G7).
    3.  `helm upgrade --reuse-values --set
        overture.baseUrl=s3://geotoon-unreachable-invalid/release`, then
        restart the app and PostgreSQL pods and wait for readiness.
    4.  POST again: it must be `ready` on the first response, with
        `sourceCalls == 0` and every tile `complete`.
    5.  Restore the base URL.

    Exits non-zero on any failure.

##### 9.3 `docs/designs/geotoon.md` (Create, at finalisation)

*   **Type / Scope**: Final design document.
*   **Proposed Changes**: The approved content of `design_draft.md`.

### Verification Plan

*   **Compilation/Build**: `make build` (`tsc -b` plus `vite build`);
    `make images`.
*   **Unit Tests**: `make test`. It runs:
    *   ESLint and dependency-cruiser;
    *   Vitest for core, contracts, the API (unit and integration with
        Testcontainers) and web.

    It needs no network access beyond Docker's local image cache.
*   **Static Analysis & Linting**: `make lint`, then `make sonar`. Then
    check through the SonarCloud API:
    *   `api/issues/search?componentKeys=marcelomiyake_geotoon&resolved=false`:
        total 0;
    *   `api/hotspots/search?projectKey=marcelomiyake_geotoon&status=TO_REVIEW`:
        total 0;
    *   `api/qualitygates/project_status`: `OK`.
*   **Test Coverage Requirement**: at least 80% line coverage on the
    analysed code (SonarCloud's default gate on new code); WebGL and entry
    files are excluded, as listed in 1.5.
*   **E2E/Integration**:
    *   **G3:** `make kind-down kind-up images kind-load deploy` on a fresh
        cluster. All pods ready within 5 minutes.
    *   **G2:** `make verify-cache` passes.
    *   **G1 and G6:** open the app through `make open`, enter "Av. Bolonha,
        200 - Jaguaré", wait for the scene, then:
        1.  take a street-level screenshot showing toon bands, outlines and
            separate buildings;
        2.  walk into a wall and check that it blocks;
        3.  walk to the edge and check that the message appears.
    *   **G7:** record the first-load time, the gzip payload size, the scene
        build time from the debug overlay, and the frame time. If any
        target is missed at 2 km, set `area.radiusM` to 1500, then 1000,
        and repeat.

--------------------------------------------------------------------------------

*Drafted with EGM*
