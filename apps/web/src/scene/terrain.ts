import type { TerrainGrid } from '@geotoon/contracts';
import { MeshBuffer, faceNormal, type MeshData, type Vec2, type Vec3 } from './mesh-buffer.js';
import { GROUND_COLOUR, type Rgb } from './palette.js';

/** Piecewise planar heights: sampling and all draped surfaces use the same grid triangles. */
export class Terrain {
  constructor(readonly grid?: TerrainGrid) {}

  heightAt(x: number, z: number): number {
    const grid = this.grid;
    if (grid === undefined) {
      return 0;
    }
    const gx = Math.max(0, Math.min(grid.size - 1, (x - grid.originM) / grid.spacingM));
    const gz = Math.max(0, Math.min(grid.size - 1, (z - grid.originM) / grid.spacingM));
    const col = Math.min(grid.size - 2, Math.floor(gx));
    const row = Math.min(grid.size - 2, Math.floor(gz));
    const u = gx - col;
    const v = gz - row;
    const a = grid.heights[row * grid.size + col]!;
    const b = grid.heights[row * grid.size + col + 1]!;
    const c = grid.heights[(row + 1) * grid.size + col]!;
    const d = grid.heights[(row + 1) * grid.size + col + 1]!;
    return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
  }

  ground(): MeshData {
    const out = new MeshBuffer();
    const grid = this.grid;
    if (grid === undefined) {
      return out.toMeshData();
    }
    for (let row = 0; row < grid.size - 1; row += 1) {
      for (let col = 0; col < grid.size - 1; col += 1) {
        const x = grid.originM + col * grid.spacingM;
        const z = grid.originM + row * grid.spacingM;
        const a: Vec2 = [x, z];
        const b: Vec2 = [x + grid.spacingM, z];
        const c: Vec2 = [x, z + grid.spacingM];
        const d: Vec2 = [x + grid.spacingM, z + grid.spacingM];
        this.addFace([a, c, b], 0, GROUND_COLOUR, out);
        this.addFace([b, c, d], 0, GROUND_COLOUR, out);
      }
    }
    return out.toMeshData();
  }

  /** Clip ground polygons to the elevation triangles, preventing buried roads and gaps. */
  drape(data: MeshData): MeshData {
    const grid = this.grid;
    if (grid === undefined) {
      return data;
    }
    const out = new MeshBuffer();
    for (let at = 0; at < data.positions.length; at += 9) {
      const points: Vec2[] = [0, 3, 6].map((offset) => [data.positions[at + offset]!, data.positions[at + offset + 2]!]);
      const colour: Rgb = [data.colors[at]!, data.colors[at + 1]!, data.colors[at + 2]!];
      this.drapeTriangle(points, data.positions[at + 1]!, colour, out);
    }
    return out.toMeshData();
  }

  private drapeTriangle(points: readonly Vec2[], y: number, colour: Rgb, out: MeshBuffer): void {
    const grid = this.grid!;
    const cell = (value: number): number => Math.max(0, Math.min(grid.size - 2, Math.floor((value - grid.originM) / grid.spacingM)));
    const cols = points.map((p) => cell(p[0]));
    const rows = points.map((p) => cell(p[1]));
    for (let row = Math.min(...rows); row <= Math.max(...rows); row += 1) {
      for (let col = Math.min(...cols); col <= Math.max(...cols); col += 1) {
        const x = grid.originM + col * grid.spacingM;
        const z = grid.originM + row * grid.spacingM;
        let polygon = clip(points, (p) => p[0] - x);
        polygon = clip(polygon, (p) => x + grid.spacingM - p[0]);
        polygon = clip(polygon, (p) => p[1] - z);
        polygon = clip(polygon, (p) => z + grid.spacingM - p[1]);
        const diagonal = (p: Vec2): number => grid.spacingM - (p[0] - x) - (p[1] - z);
        this.addFace(clip(polygon, diagonal), y, colour, out);
        this.addFace(clip(polygon, (p) => -diagonal(p)), y, colour, out);
      }
    }
  }

  private addFace(points: readonly Vec2[], offset: number, colour: Rgb, out: MeshBuffer): void {
    const vertex = (p: Vec2): Vec3 => [p[0], this.heightAt(p[0], p[1]) + offset, p[1]];
    for (let i = 1; i + 1 < points.length; i += 1) {
      const a = vertex(points[0]!);
      const b = vertex(points[i]!);
      const c = vertex(points[i + 1]!);
      const normal = faceNormal(a, b, c);
      if (normal[1] > 1e-8) {
        out.triangle(a, b, c, normal, colour);
      }
    }
  }
}

/** Sutherland–Hodgman clipping by one half-plane; non-negative distances are inside. */
function clip(points: readonly Vec2[], distance: (point: Vec2) => number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const a = distance(p);
    const b = distance(q);
    if ((a >= 0) !== (b >= 0)) {
      const t = a / (a - b);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
    if (b >= 0) {
      out.push(q);
    }
  }
  return out;
}
