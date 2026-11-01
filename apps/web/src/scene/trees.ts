import { fnv1a32 } from './palette.js';

/** Per-tree instance data: x, z, uniform scale and rotation about the vertical axis. */
export interface TreeInstances {
  /** Packed as [x, z, scale, rotationRad] per tree. */
  readonly data: Float32Array;
  readonly count: number;
}

export const MIN_TREE_SCALE = 0.8;
export const MAX_TREE_SCALE = 1.25;

/** Builds instance data; size and rotation vary by a hash of the position, so they are stable. */
export function buildTrees(points: readonly (readonly [number, number])[]): TreeInstances {
  const data = new Float32Array(points.length * 4);
  points.forEach(([x, z], i) => {
    const hash = fnv1a32(`${x.toFixed(2)},${z.toFixed(2)}`);
    const t = (hash & 0xffff) / 0xffff;
    data[i * 4] = x;
    data[i * 4 + 1] = z;
    data[i * 4 + 2] = MIN_TREE_SCALE + t * (MAX_TREE_SCALE - MIN_TREE_SCALE);
    data[i * 4 + 3] = ((hash >>> 16) / 0xffff) * Math.PI * 2;
  });
  return { data, count: points.length };
}
