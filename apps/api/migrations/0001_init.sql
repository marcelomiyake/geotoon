-- GeoToon schema v1. PostGIS here is a rebuildable cache of the open data sources:
-- truncating map_feature and tile_coverage only costs a refetch.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE map_feature (
  id               text PRIMARY KEY,
  layer            text NOT NULL CHECK (layer IN ('building', 'line', 'area', 'tree')),
  kind             text NOT NULL,
  geom             geometry(Geometry, 4326) NOT NULL,
  height_m         real,
  num_floors       smallint,
  min_height_m     real,
  name             text,
  source_dataset   text NOT NULL,
  source_record_id text,
  overture_release text NOT NULL,
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  attrs            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT height_only_on_buildings CHECK (
    layer = 'building' OR (height_m IS NULL AND num_floors IS NULL AND min_height_m IS NULL)
  ),
  CONSTRAINT building_is_polygonal CHECK (
    layer <> 'building' OR GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')
  ),
  CONSTRAINT area_is_polygonal CHECK (
    layer <> 'area' OR GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')
  ),
  CONSTRAINT line_is_linear CHECK (
    layer <> 'line' OR GeometryType(geom) IN ('LINESTRING', 'MULTILINESTRING')
  ),
  CONSTRAINT tree_is_point_or_row CHECK (
    layer <> 'tree' OR GeometryType(geom) IN ('POINT', 'LINESTRING')
  )
);

CREATE INDEX map_feature_geom_gix ON map_feature USING gist (geom);

CREATE TABLE tile_coverage (
  z                smallint NOT NULL,
  x                integer NOT NULL,
  y                integer NOT NULL,
  state            text NOT NULL CHECK (state IN ('missing', 'fetching', 'complete', 'failed')),
  lease_owner      text,
  lease_expires_at timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  error_class      text,
  retry_after      timestamptz,
  overture_release text,
  feature_count    integer,
  fetched_at       timestamptz,
  fetch_request_id text,
  ingest_version   integer,
  PRIMARY KEY (z, x, y)
);
