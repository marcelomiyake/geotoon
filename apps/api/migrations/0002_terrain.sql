-- Elevation rasters have a different grid and source from the Overture feature cache.
CREATE TABLE terrain_tile (
  z integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  png bytea NOT NULL,
  imagery text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (z, x, y)
);
