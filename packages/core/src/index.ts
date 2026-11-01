export { DomainError, type DomainErrorOptions, type ErrorCode } from './shared/domain-error.js';
export {
  EARTH_RADIUS_M,
  distanceMeters,
  fromLocal,
  geoPoint,
  toLocal,
  type GeoPoint,
  type LocalPoint,
} from './shared/geo-point.js';
export type { Clock, LogFields, Logger } from './shared/ports.js';

export type {
  AddressSuggestion,
  Geocoder,
  GeocoderSearch,
  SuggestionKind,
} from './geocoding/address-suggestion.js';
export {
  MAX_QUERY_LENGTH,
  MAX_SUGGESTIONS,
  MIN_QUERY_LENGTH,
  SuggestAddresses,
  normaliseQuery,
  type SuggestAddressesOptions,
} from './geocoding/suggest-addresses.js';

export { attributionFor, type Attribution } from './cartography/domain/attribution.js';
export {
  AREA_KINDS,
  FEATURE_LAYERS,
  LINE_KINDS,
  LINE_WIDTH_M,
  WALKABLE_LINE_KINDS,
  isAreaKind,
  isLineKind,
  type AreaKind,
  type FeatureBatch,
  type FeatureLayer,
  type IngestFeature,
  type LineCoords,
  type LineKind,
  type MapArea,
  type MapLine,
  type MultiLineCoords,
  type MultiPolygonCoords,
  type PolygonCoords,
  type Position,
  type StoredBuilding,
  type TreeFeature,
  type TreeGeometry,
} from './cartography/domain/features.js';
export {
  isInsideRing,
  multiPolygonAreaM2,
  nearestOnSegment,
  polygonAreaM2,
  sampleLine,
  signedRingArea,
} from './cartography/domain/geometry.js';
export {
  FLOOR_HEIGHT_M,
  HEIGHT_RULE_VERSION,
  estimateHeight,
  fnv1a32,
  type Height,
  type HeightInput,
  type HeightSource,
} from './cartography/domain/height-rule.js';
export type { Scene, SceneArea, SceneBuilding, SceneLine } from './cartography/domain/scene.js';
export type { TerrainGrid } from './cartography/domain/terrain.js';
export {
  SPAWN_MAX_STREET_DISTANCE_M,
  chooseSpawn,
  type Spawn,
} from './cartography/domain/spawn-point.js';
export {
  LEASE_SECONDS,
  areaStatus,
  earliestRetry,
  isClaimable,
  missingCoverage,
  retryDelaySeconds,
  type AreaStatus,
  type TileCoverage,
  type TileState,
} from './cartography/domain/tile-coverage.js';
export {
  TILE_ZOOM,
  boundsOf,
  boundsOfTiles,
  compareTiles,
  tileId,
  tileOf,
  tilesCovering,
  type Bounds,
  type TileKey,
} from './cartography/domain/tile-grid.js';

export { CountingMapDataSource } from './cartography/application/counting-map-data-source.js';
export {
  IngestTiles,
  type IngestTilesDeps,
} from './cartography/application/ingest-tiles.js';
export type {
  FailedTile,
  FeatureReader,
  FeatureStore,
  FetchOptions,
  IngestionJob,
  IngestionScheduler,
  MapDataSource,
  StoredFeatures,
  TileCoverageRepository,
  TerrainReader,
} from './cartography/application/ports.js';
export { ReadScene, TREE_ROW_SPACING_M } from './cartography/application/read-scene.js';
export {
  RequestArea,
  type AreaResult,
  type RequestAreaDeps,
  type TileStatusView,
} from './cartography/application/request-area.js';
export {
  SourceError,
  classifySourceError,
  type SourceErrorClass,
} from './cartography/application/source-error.js';
