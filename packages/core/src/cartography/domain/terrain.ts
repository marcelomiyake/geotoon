/** A square elevation grid in local metres, rows north to south, relative to datumM. */
export interface TerrainGrid {
  readonly originM: number;
  readonly spacingM: number;
  readonly size: number;
  readonly datumM: number;
  readonly heights: readonly number[];
}
