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

/** More than the former 128-junction limit, spread across a complete 2 km area. */
export function junctionGrid(): SceneLine[] {
  return Array.from({ length: 225 }, (_, i) => {
    const x = (i % 15 - 7) * 160;
    const z = (Math.floor(i / 15) - 7) * 160;
    return [road([[x - 40, z], [x, z], [x + 40, z]], `Avenida ${i}`, 'primary'),
      road([[x, z - 40], [x, z], [x, z + 40]], `Rua ${i}`)];
  }).flat();
}
