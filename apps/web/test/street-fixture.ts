import type { SceneLine } from '@geotoon/contracts';
import type { Vec2 } from '../src/scene/mesh-buffer.js';
import { createProjection } from '../src/scene/projection.js';

export const projection = createProjection(0, 0);
export function road(points: readonly Vec2[], name = 'Rua São João', kind = 'residential'): SceneLine {
  return { id: name, name, kind, widthM: 6, coords: [points.map(([x, z]) => projection.toGeo(x, z))] };
}
export function junctionRoads(kind = 'residential'): SceneLine[] {
  return [road([[-50, 0], [0, 0], [50, 0]], 'Avenida Paulista', kind),
    road([[0, -50], [0, 0], [0, 50]], 'Alameda Campinas')];
}
