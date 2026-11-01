# GeoToon

Type an address and walk the streets around it in a cel-shaded 3D map. GeoToon looks the
address up with the Photon geocoder, loads buildings, streets, land use, water and trees
for a 2 km radius from Overture Maps into PostGIS, and draws them in the browser with
Three.js in an anime street style: pastel walls with windows, clay-tile roofs, ink
contours, crisp blue shadows, utility poles and a painted sky.

![Street level: pastel houses with pitched roofs, a dashed centre line and cast shadows](docs/images/street-view.jpg)

![From above: the area around Av. Bolonha, 200, São Paulo](docs/images/aerial-view.jpg)

The first visit to an area downloads its map data (about 80 s for 2 km); every later
visit to the same area reads only from PostGIS.

The design, with the reasons behind each choice, is in
[docs/designs/geotoon.md](docs/designs/geotoon.md).

## Prerequisites

| Tool | Version used | Needed for |
| --- | --- | --- |
| Node.js | 26 (`.nvmrc`) | building, tests, local development |
| Docker | 29 | images, local PostGIS, integration tests (Testcontainers) |
| kind | 0.33 | the local Kubernetes cluster |
| Helm | 4.3 | installing the chart |
| kubectl | 1.37 | port-forwarding and logs |

A desktop browser with WebGL2, a keyboard and a mouse.

### Outbound hosts

The app container needs HTTPS access to:

- `overturemaps-us-west-2.s3.amazonaws.com`: Overture Maps data (public bucket, no account).
- `photon.komoot.io`: address search.

The image build also downloads the DuckDB `httpfs` extension from `extensions.duckdb.org`.

## Quick start (Kind)

```sh
make kind-up images kind-load deploy open
```

Then open <http://localhost:8080>, type an address (for example
`Av. Bolonha, 200, São Paulo`) and pick a suggestion. You can also type coordinates as
`lat, lon`. Click **Click to walk**: the mouse looks around, W A S D or the arrow keys
move at about 22 km/h (bicycle speed), Shift moves at about 54 km/h (car speed), Q and E
turn, Esc pauses.

To reach the app on <http://localhost:8090> through the Kind port mapping instead of
`make open`, install with `-f deploy/helm/geotoon/values-kind.yaml`.

`make kind-down` deletes the cluster.

## Commands

| Command | What it does |
| --- | --- |
| `make setup` | Install dependencies (`npm ci`). |
| `make dev` | PostGIS in Docker, the API on :8080 and Vite on :5173 (proxying `/api`). |
| `make build` | Build every package and the web client. |
| `make typecheck` | Type-check every package. |
| `make lint` | ESLint (with SonarJS rules) and the dependency rules for the architecture layers. |
| `make test` | Lint, then unit and integration tests with coverage. Needs Docker: integration tests start PostGIS through Testcontainers. |
| `make images` | Build the app image `geotoon-app:<git sha>`. |
| `make kind-up` | Create the Kind cluster `geotoon`. |
| `make kind-load` | Load the app image into Kind. |
| `make deploy` | `helm upgrade --install` the chart with the current image tag. |
| `make open` | Port-forward the app to <http://localhost:8080>. |
| `make verify-cache` | Prove a repeated area request reads only from PostGIS (needs `make open`). |
| `make sonar` | Run the SonarCloud scan (needs `SONAR_TOKEN`; run `make test` first for coverage). |
| `make kind-down` | Delete the Kind cluster. |

`make test` is the test command. It runs 239 tests in 18 files: the domain and use cases,
the API contracts, the HTTP API, the Overture and Photon adapters against recorded
fixtures, the PostGIS adapters and the full area flow against a real PostGIS, and the
scene geometry the browser draws.

## Configuration

The API reads environment variables; the Helm chart sets them from `values.yaml`.

| Variable | Helm value | Default | Meaning |
| --- | --- | --- | --- |
| `PORT` | | `8080` | HTTP port. |
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER` | `postgresql.*` | `localhost`, `5432`, `geotoon`, `geotoon` | PostGIS connection. |
| `DATABASE_PASSWORD` | generated Secret | (required) | PostGIS password. The chart creates a random one and keeps it across upgrades. |
| `AREA_RADIUS_M` | `area.radiusM` | `2000` | Radius loaded around each address, in metres (at most `AREA_RADIUS_MAX_M`, 2000). |
| `OVERTURE_BASE_URL` | `overture.baseUrl` | `s3://overturemaps-us-west-2/release` | Where Overture releases are read from. |
| `OVERTURE_RELEASE` | `overture.release` | `2026-10-21.0` | Overture release to read. |
| `OVERTURE_QUERY_TIMEOUT_S` | `overture.queryTimeoutSeconds` | `120` | Time limit for one fetch from Overture. |
| `PHOTON_URL` | `photon.url` | `https://photon.komoot.io` | Geocoder. |
| `PHOTON_TIMEOUT_MS` | | `4000` | Geocoder time limit. |
| `DUCKDB_MEMORY_LIMIT`, `DUCKDB_THREADS` | `duckdb.*` | `1GB`, `4` | Limits for the DuckDB reader. |
| `DUCKDB_EXTENSION_DIR`, `DUCKDB_TEMP_DIR` | set by the image | | Where the `httpfs` extension and spill files live. |
| `RATE_LIMIT_AREAS_PER_MIN`, `RATE_LIMIT_GEOCODE_PER_MIN` | `rateLimits.*` | `30`, `60` | Requests per minute per client address. |
| `LOG_LEVEL` | `logLevel` | `info` | `debug`, `info`, `warn` or `error`. |
| `USER_AGENT` | | `geotoon/<version> (+repo URL)` | Sent to Photon, as its usage policy asks. |

Container resources (CPU, memory, ephemeral storage) and the PostGIS volume size are in
`values.yaml` under `resources` and `postgresql`.

## How to confirm a read came from storage

Every `POST /api/v1/areas` response carries `sourceCalls`: the number of fetches from
Overture that this request started. A request for an area that is already stored returns
`200` with `"sourceCalls": 0` and every tile `complete`.

```sh
make open            # in one terminal
make verify-cache    # in another
```

The script requests the Av. Bolonha area until it is ready, requests it again, and fails
unless the second answer is `200`, `ready`, `sourceCalls: 0` with no incomplete tile.
In the browser, add `&debug=1` to the URL to see `sourceCalls` and the tile counts.

## Attribution and licences

The code is under the [MIT licence](LICENSE).

Map data is not covered by that licence:

- Buildings, streets, land use, water and trees: © OpenStreetMap contributors,
  [ODbL 1.0](https://www.openstreetmap.org/copyright), distributed by the
  [Overture Maps Foundation](https://overturemaps.org). Building footprints also include
  Google Open Buildings (CC BY 4.0), Microsoft ML Buildings (ODbL 1.0) and Esri Community
  Maps (CC BY 4.0); some street segments are data from TomTom.
- Address search: [Photon](https://photon.komoot.io) by komoot, with OpenStreetMap data.

The app shows the attribution Overture asks for, for each source present in the data it draws. The test fixtures in `fixtures/` are
third-party data; see [fixtures/NOTICE](fixtures/NOTICE).

## Troubleshooting

**Request IDs.** Every API response has an `x-request-id` header, and area responses
repeat it as `requestId`. Error screens and the debug panel show it. Search the logs
for it:

```sh
kubectl -n geotoon logs deploy/geotoon | grep <request id>
```

**Logs.** The API logs JSON lines: `kubectl -n geotoon logs deploy/geotoon -f`. PostGIS:
`kubectl -n geotoon logs statefulset/geotoon-postgresql`.

**psql.** Port-forward PostGIS and connect with the generated password:

```sh
kubectl -n geotoon port-forward svc/geotoon-postgresql 15432:5432 &
PGPASSWORD="$(kubectl -n geotoon get secret geotoon-db -o jsonpath='{.data.password}' | base64 -d)" \
  psql -h localhost -p 15432 -U geotoon geotoon
```

**Provenance queries.**

```sql
-- Tiles by state, and when the last one was fetched.
SELECT state, count(*), max(fetched_at) FROM tile_coverage GROUP BY state;

-- Stored features by layer, source dataset and Overture release.
SELECT layer, source_dataset, overture_release, count(*)
FROM map_feature GROUP BY 1, 2, 3 ORDER BY 4 DESC;

-- The tiles one request fetched.
SELECT x, y, feature_count, fetched_at FROM tile_coverage
WHERE fetch_request_id = '<request id>';
```

**Forcing a refetch.** PostGIS is a cache that can be rebuilt. Deleting coverage rows
makes the next request fetch those tiles again (features are updated in place by id):

```sql
DELETE FROM tile_coverage WHERE z = 16 AND x = 24257 AND y = 37180;  -- one tile
DELETE FROM tile_coverage;                                            -- everything
```

**First load is slow or fails.** The first visit reads Overture's Parquet files from S3;
check that the outbound hosts above are reachable from the cluster. A failed fetch
returns `AREA_FETCH_FAILED` with `retryAfterSeconds`, and the page offers **Retry**.

**The page says WebGL2 is unavailable.** Use a current desktop browser with hardware
acceleration turned on.

## Glossary

- **Area**: the circle loaded around an address (2 km radius by default).
- **Tile**: a zoom-16 map tile (about 560 m across at São Paulo). Map data is fetched and
  stored per tile, so overlapping areas share tiles.
- **Tile coverage**: the row that says whether a tile is `missing`, `fetching`, `complete`
  or `failed`, with the lease that stops two requests fetching the same tile.
- **sourceCalls**: fetches from Overture started by one request; `0` means the answer came
  from PostGIS only.
- **Cel shading**: lighting with hard steps instead of smooth gradients, as in cartoons.

## Departures from the original checklist

- **Cesium OSM Buildings is not ingested.** It holds only OSM buildings, which Overture
  already includes with their height tags (585 buildings within 1 km of the PoC address
  against 6,719 in Overture), it needs a Cesium ion token, and storing its data offline
  needs a paid licence. Its idea of estimating missing heights is kept as the height rule.
- **OSM data arrives through Overture, not from the Overpass API.** Overture's
  transportation and base themes carry the same OSM streets, parks, water and trees; the
  public Overpass servers timed out or refused 2 km queries.
- **The test command is `make test`.**
- **First load takes about 80 s** for a 2 km radius, longer than the 60 s target in the
  design; later loads of the same area take a few seconds.
- **Look.** After the first build, the owner asked for more vivid colours with anime
  contours, and then for the style of an anime street reference image (pastel houses,
  clay roofs, utility poles and wires, cyan sky with clouds, crisp blue shadows).
