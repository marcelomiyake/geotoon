import type { MeshBuffer } from '../src/scene/mesh-buffer.js';

/** Every triangle's winding must agree with its stored normal (front faces point outward). */
export function windingMatchesNormals(mesh: MeshBuffer): boolean {
  const { positions, normals, triangles } = mesh.toMeshData();
  for (let t = 0; t < triangles; t += 1) {
    const p = (k: number) => [positions[t * 9 + k * 3]!, positions[t * 9 + k * 3 + 1]!, positions[t * 9 + k * 3 + 2]!];
    const [a, b, c] = [p(0), p(1), p(2)];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const n = [normals[t * 9]!, normals[t * 9 + 1]!, normals[t * 9 + 2]!];
    if (cross[0]! * n[0]! + cross[1]! * n[1]! + cross[2]! * n[2]! <= 0) {
      return false;
    }
  }
  return true;
}
