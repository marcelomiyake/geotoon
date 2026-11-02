import type { Point2 } from './collision.js';

/** Checks minimum separation in neighbouring cells instead of scanning the whole area. */
export class PointSpacing {
  private readonly cells = new Map<string, Point2[]>();

  constructor(private readonly spacingM: number) {}

  isClear(point: Point2): boolean {
    const cx = Math.floor(point.x / this.spacingM);
    const cz = Math.floor(point.z / this.spacingM);
    for (let x = cx - 1; x <= cx + 1; x += 1) {
      for (let z = cz - 1; z <= cz + 1; z += 1) {
        if (this.cells.get(`${x}:${z}`)?.some((other) =>
          (point.x - other.x) ** 2 + (point.z - other.z) ** 2 < this.spacingM ** 2)) {
          return false;
        }
      }
    }
    return true;
  }

  add(point: Point2): void {
    const key = `${Math.floor(point.x / this.spacingM)}:${Math.floor(point.z / this.spacingM)}`;
    const cell = this.cells.get(key) ?? [];
    cell.push(point);
    this.cells.set(key, cell);
  }
}
