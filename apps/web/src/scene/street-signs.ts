import type { SceneLine } from '@geotoon/contracts';
import type { ArchitectureStyle } from './architecture.js';
import { CollisionIndex } from './collision.js';
import type { Vec2 } from './mesh-buffer.js';
import type { Projection } from './projection.js';
import { SIDEWALK_WIDTH_M, hasSidewalks } from './street.js';

export const MAX_STREET_SIGNS = 128;
export const SIGN_WIDTH_M = 1.8;
export const SIGN_HEIGHT_M = 0.56;
export const SIGN_CENTRE_Y_M = 2.65;
const SIGN_SPACING_M = 160;
const END_SETBACK_M = 12;

export interface StreetSign {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /** Direction along the road, radians from +x towards +z. */
  readonly angle: number;
}

/** Named surface streets only. Panels sit on the sidewalk, parallel to the street. */
export function buildStreetSigns(
  lines: readonly SceneLine[], projection: Projection, radiusM: number, collision = new CollisionIndex(),
): StreetSign[] {
  const candidates = lines.flatMap((line) => {
    const name = line.name?.trim();
    if (!name || !hasSidewalks(line.kind)) {
      return [];
    }
    return line.coords.flatMap((part) => signsAlong(
      part.map(([lon, lat]) => projection.toLocal(lon, lat)), name, line.widthM, collision,
    ));
  });
  // Spend a bounded render budget on signs nearest the address, independent of input order.
  candidates.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)
    || a.name.localeCompare(b.name) || a.x - b.x || a.z - b.z);
  const signs: StreetSign[] = [];
  for (const candidate of candidates) {
    if (Math.hypot(candidate.x, candidate.z) + SIGN_WIDTH_M / 2 > radiusM) {
      continue;
    }
    const crowded = signs.some((sign) => Math.hypot(sign.x - candidate.x, sign.z - candidate.z)
      < (sign.name === candidate.name ? 60 : 8));
    if (!crowded) {
      signs.push(candidate);
    }
    if (signs.length === MAX_STREET_SIGNS) {
      break;
    }
  }
  return signs;
}

function signsAlong(points: readonly Vec2[], name: string, widthM: number, collision: CollisionIndex): StreetSign[] {
  const lengths = points.slice(1).map((q, i) => Math.hypot(q[0] - points[i]![0], q[1] - points[i]![1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total < 8) {
    return [];
  }
  const distances = [Math.min(END_SETBACK_M, total / 2)];
  for (let at = END_SETBACK_M + SIGN_SPACING_M; at < total - END_SETBACK_M; at += SIGN_SPACING_M) {
    distances.push(at);
  }
  if (total > 80) {
    distances.push(total - END_SETBACK_M);
  }
  const signs: StreetSign[] = [];
  let travelled = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i]!;
    if (length < 1e-6) {
      continue;
    }
    const p = points[i]!;
    const q = points[i + 1]!;
    const ux = (q[0] - p[0]) / length;
    const uz = (q[1] - p[1]) / length;
    while (distances[0] !== undefined && distances[0] <= travelled + length) {
      const along = distances.shift()! - travelled;
      const road = { x: p[0] + ux * along, z: p[1] + uz * along };
      const offset = widthM / 2 + SIDEWALK_WIDTH_M / 2;
      const sign = { name, x: road.x - uz * offset, z: road.z + ux * offset, angle: Math.atan2(uz, ux) };
      // If reaching the panel from the street crosses a wall, omit it rather than embed it.
      const reached = collision.move(road, sign, SIGN_WIDTH_M / 2);
      if (Math.hypot(reached.x - sign.x, reached.z - sign.z) < 0.01) {
        signs.push(sign);
      }
    }
    travelled += length;
  }
  return signs;
}

export function streetSignDesign(style: ArchitectureStyle) {
  const brazil = style.streetSign !== 'generic';
  return {
    background: brazil ? '#07549a' : '#f4efdf',
    foreground: brazil ? '#ffffff' : '#26394c',
    footer: style.streetSign === 'sao-paulo' ? '#d8dcdf' : '#f4efdf',
    caption: style.streetSign === 'sao-paulo' ? 'São Paulo' : '',
  };
}

/** The full sourced name stays below the larger short name; no invented address ranges/CEP. */
export function streetSignText(name: string, style: ArchitectureStyle): { title: string; subtitle: string } {
  const title = style.streetSign === 'generic' ? name
    : name.replace(/^(?:Rua|Avenida|Alameda|Travessa|Praça|Estrada|Rodovia|Av\.|R\.|Al\.)\s+/iu, '').trim();
  return { title: title || name, subtitle: name };
}
