import type { ArchitectureStyle } from './architecture.js';
import { CollisionIndex } from './collision.js';
import type { Intersection, StreetArm } from './intersections.js';
import { SIDEWALK_WIDTH_M } from './street.js';

export const MAX_STREET_SIGNS = 128;
export const SIGN_WIDTH_M = 1.8;
export const SIGN_HEIGHT_M = 0.56;
export const SIGN_CENTRE_Y_M = 2.65;

export interface StreetSign {
  readonly x: number;
  readonly z: number;
  /** Two panels meet at one corner post and follow their respective streets. */
  readonly panels: readonly [SignPanel, SignPanel];
}

export interface SignPanel {
  readonly name: string;
  readonly angle: number;
}

/** One paired sign on a clear sidewalk corner of each named intersection. */
export function buildStreetSigns(
  intersections: readonly Intersection[], radiusM: number, collision = new CollisionIndex(),
): StreetSign[] {
  const signs: StreetSign[] = [];
  for (const intersection of intersections) {
    const corners = intersection.arms.flatMap((arm, i, arms) => {
      const other = arms[(i + 1) % arms.length]!;
      const corner = signAtCorner(intersection, arm, other);
      return corner === undefined ? [] : [corner];
    }).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const clear = corners.find((corner) => clearCorner(intersection, corner, radiusM, collision)
      && signs.every((sign) => Math.hypot(sign.x - corner.x, sign.z - corner.z) >= 12));
    if (clear !== undefined) {
      signs.push(clear);
    }
    if (signs.length === MAX_STREET_SIGNS) {
      break;
    }
  }
  return signs;
}

function signAtCorner(node: Intersection, a: StreetArm, b: StreetArm): StreetSign | undefined {
  const [ux, uz] = a.direction;
  const [vx, vz] = b.direction;
  const cross = ux * vz - uz * vx;
  if (!a.name || !b.name || a.name === b.name || cross < 0.4) {
    return undefined;
  }
  const offsetA = a.widthM / 2 + SIDEWALK_WIDTH_M / 2;
  const offsetB = b.widthM / 2 + SIDEWALK_WIDTH_M / 2;
  return {
    x: node.x + (offsetA * vx + offsetB * ux) / cross,
    z: node.z + (offsetA * vz + offsetB * uz) / cross,
    panels: [{ name: a.name, angle: Math.atan2(uz, ux) }, { name: b.name, angle: Math.atan2(vz, vx) }],
  };
}

function clearCorner(node: Intersection, sign: StreetSign, radiusM: number, collision: CollisionIndex): boolean {
  return sign.panels.every((panel) => {
    const end = { x: sign.x + Math.cos(panel.angle) * SIGN_WIDTH_M, z: sign.z + Math.sin(panel.angle) * SIGN_WIDTH_M };
    if (Math.hypot(end.x, end.z) > radiusM) {
      return false;
    }
    const reached = collision.move(node, end, 0.5);
    return Math.hypot(reached.x - end.x, reached.z - end.z) < 0.01;
  });
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
