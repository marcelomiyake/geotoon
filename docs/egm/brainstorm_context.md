# GeoToon: brainstorm context (input for Goldfish review)

Date: 2026-11-01. Repo: `marcelomiyake/geotoon` (public). Current contents: MIT LICENSE and a Rust `.gitignore` template only. No code yet.

## Anchored hypothesis

A TypeScript monorepo (Fastify API, Three.js browser client, PostgreSQL + PostGIS). The user types an address; Photon (komoot's open-source geocoder, free public instance) autocompletes it. The API loads a 1 km radius around the chosen point as a fixed grid of ~560 m tiles: buildings come from Overture Maps, and streets, land use, parks, water and trees come from OpenStreetMap (OSM) via the Overpass API. Each tile is fetched from the sources once and stored in PostGIS; later requests that cover the same tiles read from PostGIS only. The browser extrudes the building footprints into 3D and renders a cel-shaded (toon) scene that the user walks through at street level (first person). Cesium OSM Buildings and Rust are left out. The system ships as Docker images and one Helm chart that runs on a fresh Kind cluster, with PostgreSQL as a container.

## Owner's requirements (verbatim intent)

- Checklist: inspect repo/references; propose layout, service boundaries, data flow; data layer (PostGIS schema, ingestion from Overture, OSM, Cesium OSM Buildings, reuse of stored data); backend API for address autocomplete and area request; browser frontend rendering cel-shaded 3D scene around the point; Dockerfiles, Helm charts, Kind setup incl. PostgreSQL container; tests and SonarCloud config (org `marcelomiyake`) with all issues fixed; Domain-Driven Design and Clean Architecture.
- Done means:
  1. Entering an address in the browser shows a cel-shaded 3D map around that point.
  2. A second request for the same area reads from PostGIS and does not refetch the source data.
  3. `helm install` on a fresh Kind cluster brings up the full system, and the app loads in the browser.
  4. The test command passes (command not specified by owner; assumption: `make test`).
  5. The SonarCloud project shows zero issues.
- Scope: build only the above. No user accounts, no payments, no extra data sources. Missing details: make the smallest reasonable assumption and note it.
- Owner answers during clarification:
  - Cesium OSM Buildings: "choose the solution that fits this project better".
  - Language: "use TypeScript/Three.js; use Rust only if it helps improve performance".
  - Interaction: "walk through it at street level".
  - Area size: "check the maximum that is feasible for the user and performance".
- PoC target: Av. Bolonha, 200 - Jaguaré, São Paulo - SP, 05334-000, Brazil. Photon resolves it to lat -23.5486, lon -46.7469.

## Measurements taken on 2026-11-01

Overture release `2026-10-21.0`, read with DuckDB (httpfs + spatial) directly from `s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/*` with a bbox filter. One query took 25 s; the time is dominated by reading Parquet metadata and is roughly the same for any radius up to 2 km.

| Radius | Overture buildings | with `height` | with `num_floors` | footprint vertices | sourced from OSM |
|---|---|---|---|---|---|
| 500 m | 2,054 | 8 | 28 | 11,406 | 179 |
| 1 km | 6,719 | 66 | 46 | 37,575 | 570 |
| 1.5 km | 11,450 | 456 | 86 | 65,006 | 1,066 |
| 2 km | 17,815 | 2,037 | 138 | 108,222 | 2,789 |

OSM via public Overpass API:
- 1 km radius (buildings, highways, trees, natural, landuse, leisure, waterway; `out geom`): 49 s on overpass-api.de, 0.95 MB JSON. Counts: 585 building ways (68 with `height`, 48 with `building:levels`), 546 highway ways, 45 leisure, 44 landuse, 32 tree nodes, 1 waterway.
- 2 km radius, same query: failed on all three public instances tried (overpass-api.de: 502 "at capacity"; overpass.private.coffee: 504 after 124 s; overpass.kumi.systems: no response in 200 s; maps.mail.ru: 504).
- Main instance's error page states the public endpoint is meant for human-operated tools and recommends a local Overpass instance for automated use.

Photon: `https://photon.komoot.io/api/?q=...&lat=..&lon=..` returned the target address correctly. Nominatim's usage policy forbids autocomplete, so it is not used.

Rendering estimate: 2 km radius extruded is about 300k triangles; 1 km about 100k. Not a limit for a browser GPU.

SonarCloud: org `marcelomiyake` has 74 projects, none for geotoon. A `SONAR_TOKEN` exists in the environment. SonarCloud analyzes TypeScript, Docker, Kubernetes manifests, shell, SQL dialects.

Local tools: Docker (12 CPU, 31 GB), kind 0.33, Helm 4.3, kubectl, Node 26, Python 3.15 with uv, Rust 1.99, sonar-scanner, gh. No Cesium ion token available.

## Decisions taken so far, with reasons

1. **Cesium OSM Buildings left out.** It contains only OSM buildings (585 within 1 km here), which Overture already includes with their OSM height tags; for the rest it supplies an estimated default. It needs a Cesium ion account token (none available, and the assistant cannot create accounts). Cesium staff state on their forum that storing or exporting Asset Depot data such as OSM Buildings for offline use requires a paid licence, which conflicts with done criterion 2 (store in PostGIS, no refetch). Its height-estimation idea is reproduced as a domain rule: OSM/Overture `height` → `num_floors`/`building:levels` × 3 m → default by building class, with deterministic per-building variation. This departs from checklist item 3 and will be reported.
2. **Source roles.** Overture supplies all buildings (it already merges OSM buildings with ML-derived footprints, so there are no duplicates). OSM supplies non-building layers only: streets, land use, parks, water, trees. Not fetching OSM buildings makes the Overpass query smaller.
3. **TypeScript only.** 1 km is ~38k footprint vertices; extruding them in TypeScript takes milliseconds. No measured reason for Rust.
4. **Area = 1 km radius.** The binding limit is the public Overpass server (1 km: 49 s; 2 km: failed everywhere), not the GPU. A 1 km radius is ~12 minutes' walk from centre to edge. Radius is a Helm value.
5. **"Same area" = same tiles.** Fixed grid of ~560 m tiles (slippy-map zoom 16). A request computes the tiles covering its circle, fetches only the missing ones (one Overture query and one Overpass query for the bounding box of the missing tiles), stores them, and returns the scene from PostGIS.
6. **Street-level walking.** First-person camera at 1.7 m eye height, keyboard + mouse (pointer lock), collision against building footprints, flat ground plane (no elevation source is in scope).

## Reference 1 digest (owner-supplied Gemini report): "Legal, Financial, and Technical Constraints of Building Walkable Cel-Shaded Simulations from Google Earth Data"

- Google Earth / Google Photorealistic 3D Tiles may be streamed live but not stored, exported, or rebuilt (Google Maps Platform ToS 3.2.3 no scraping, no caching, no derivative content).
- Google photogrammetry is a poor base for toon shading: tiles use `KHR_materials_unlit`, shadows are baked into textures, normals are missing or wrong, and the mesh fuses trees, cars and buildings.
- Recommends instead building the city procedurally from open vector data (Overture Maps, OSM, Cesium OSM Buildings): extrude footprints with heights, then apply true stepped N·L toon lighting and ink outlines; such geometry may be stored and modified (ODbL attribution applies).
- Some claims are unverified (third-party tools and prices; that Cesium ion "Clips" permit offline download of OSM Buildings, which Cesium staff forum replies contradict).

## Reference 2 digest (owner-supplied Gemini report): "Architectural Blueprint for High-Performance 3D Open-World Rendering and Navigation in Rust and WebAssembly"

- Proposes Rust + WebAssembly + wgpu/WGSL (or Bevy), GPU-driven indirect rendering, `big_space` floating-origin integer grids for planet-scale precision, GPU terrain LOD (CDLOD), Cesium 3D Tiles streaming, Draco/meshopt/Basis compression, navmesh generation and any-angle pathfinding, rendering in a Web Worker via OffscreenCanvas, SIMD.
- Aimed at planet-scale open worlds. For a ~1 km scene centred on a local origin, 32-bit float precision is sufficient, no terrain source is in scope, and no done criterion requires navigation/pathfinding. Owner chose TypeScript/Three.js, with Rust only where it measurably helps.

## Known open risks (for reviewers to stress-test)

- Public Overpass reliability and fair-use policy for automated requests; first-load latency (~25–50 s or worse under load).
- Overture release paths are pinned and older releases are removed from S3 after some time.
- ~99% of buildings within 1 km lack height data; heights are mostly estimated.
- Flat ground although the area is hilly.
- First request for a new area is slow: synchronous HTTP vs. asynchronous job with polling.
- Kind cluster needs outbound internet (S3, Overpass, Photon); DuckDB extensions must be preinstalled in the image.
- Attribution required on screen: OpenStreetMap contributors (ODbL), Overture Maps Foundation, Photon/komoot.
- SonarCloud "zero issues" also covers Dockerfile and Kubernetes/Helm rules (non-root users, resource limits, etc.).

## Stage 0 measurements (after Goldfish review)

See `concepts_brief.md`, section "Stage 0 results". Summary: Overpass query time is queueing (38 s for one 0.3 km² tile, 32 s for the 1 km circle, third query refused); Overture `transportation` and `base` themes for the 5.0 km² 16-tile box took 3-17 s each and are 100% OpenStreetMap-sourced; 95% of buildings have no `class`.
