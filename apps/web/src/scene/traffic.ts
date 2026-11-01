import type { CollisionIndex } from './collision.js';
import { LAYER_HEIGHT_M } from './ground.js';
import { dot, type Intersection, type StreetArm } from './intersections.js';
import type { MeshBuffer } from './mesh-buffer.js';
import { hexToRgb } from './palette.js';
import { addRibbon } from './ribbons.js';

const SIGNAL_KINDS: ReadonlySet<string> = new Set(['primary', 'secondary', 'tertiary']);
const CROSSING_COLOUR = hexToRgb(0xf5f0df);
export const CROSSING_LENGTH_M = 3;
export const STRIPE_WIDTH_M = 0.5;
const STRIPE_PERIOD_M = 1;

export interface Crossing {
  readonly x: number;
  readonly z: number;
  readonly angle: number;
  readonly widthM: number;
}

export interface TrafficLight {
  readonly x: number;
  readonly z: number;
  /** Faces out along the approach, towards incoming drivers. */
  readonly angle: number;
  readonly armM: number;
  readonly phase: 0 | 1;
}

/** Illustrative intersection furniture; the source has no surveyed signal/crossing positions. */
export function buildTraffic(intersections: readonly Intersection[], radiusM: number, collision: CollisionIndex) {
  const crossings: Crossing[] = [];
  const lights: TrafficLight[] = [];
  for (const node of intersections) {
    if (node.arms.length < 3) {
      continue;
    }
    const main = node.arms.toSorted((a, b) => b.widthM - a.widthM)[0]!;
    for (const arm of node.arms) {
      const crossing = approachCrossing(node, arm);
      if (crossing === undefined || !availableCrossing(crossing, crossings, radiusM)) {
        continue;
      }
      crossings.push(crossing);
      const light = clearLight(node, arm, main, crossing, radiusM, collision);
      if (light !== undefined) {
        lights.push(light);
      }
    }
  }
  return { crossings, lights };
}

function clearLight(
  node: Intersection, arm: StreetArm, main: StreetArm, crossing: Crossing, radiusM: number, collision: CollisionIndex,
): TrafficLight | undefined {
  if (!node.arms.some((other) => SIGNAL_KINDS.has(other.kind))) {
    return undefined;
  }
  const light = approachLight(crossing, arm, Math.abs(dot(arm.direction, main.direction)) > 0.7 ? 0 : 1);
  const reached = collision.move(crossing, light, 0.4);
  return Math.hypot(light.x, light.z) < radiusM && Math.hypot(reached.x - light.x, reached.z - light.z) < 0.01
    ? light : undefined;
}

function availableCrossing(crossing: Crossing, existing: readonly Crossing[], radiusM: number): boolean {
  return Math.hypot(crossing.x, crossing.z) + crossing.widthM / 2 <= radiusM
    && existing.every((other) => Math.hypot(other.x - crossing.x, other.z - crossing.z) >= 5);
}

function approachCrossing(node: Intersection, arm: StreetArm): Crossing | undefined {
  const across = node.arms.filter((other) => Math.abs(dot(arm.direction, other.direction)) < 0.7);
  const setback = Math.max(...across.map((other) => other.widthM / 2), 3) + CROSSING_LENGTH_M / 2 + 1;
  if (arm.lengthM < setback + CROSSING_LENGTH_M + 3) {
    return undefined;
  }
  return {
    x: node.x + arm.direction[0] * setback,
    z: node.z + arm.direction[1] * setback,
    angle: Math.atan2(arm.direction[1], arm.direction[0]),
    widthM: arm.widthM,
  };
}

function approachLight(crossing: Crossing, arm: StreetArm, phase: 0 | 1): TrafficLight {
  const [ux, uz] = arm.direction;
  const side = arm.widthM / 2 + 0.8;
  // Right side of incoming traffic, behind the zebra crossing.
  return {
    x: crossing.x + ux * 3.5 + uz * side,
    z: crossing.z + uz * 3.5 - ux * side,
    angle: crossing.angle, armM: Math.min(2.4, arm.widthM / 3), phase,
  };
}

/** White zebra bars run along the road, repeated across its width with a curb margin. */
export function addCrossings(crossings: readonly Crossing[], out: MeshBuffer): void {
  for (const crossing of crossings) {
    const ux = Math.cos(crossing.angle);
    const uz = Math.sin(crossing.angle);
    const count = Math.max(1, Math.floor((crossing.widthM - 0.8) / STRIPE_PERIOD_M));
    for (let i = 0; i < count; i += 1) {
      const across = (i - (count - 1) / 2) * STRIPE_PERIOD_M;
      const x = crossing.x - uz * across;
      const z = crossing.z + ux * across;
      addRibbon([
        [x - ux * CROSSING_LENGTH_M / 2, z - uz * CROSSING_LENGTH_M / 2],
        [x + ux * CROSSING_LENGTH_M / 2, z + uz * CROSSING_LENGTH_M / 2],
      ], STRIPE_WIDTH_M, LAYER_HEIGHT_M.markings, CROSSING_COLOUR, out);
    }
  }
}

export type SignalColour = 'red' | 'amber' | 'green';

/** Opposing approaches share a phase, with amber and an all-red clearance interval. */
export function signalColour(phase: 0 | 1, seconds: number): SignalColour {
  const time = ((seconds % 48) + 48) % 48;
  const start = phase * 24;
  if (time >= start && time < start + 18) {
    return 'green';
  }
  return time >= start + 18 && time < start + 21 ? 'amber' : 'red';
}
