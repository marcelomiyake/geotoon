import {
  LIT_TINT, SHADE_LIFT, SHADOW_TINT, SKY_HORIZON_COLOUR, SKY_ZENITH_COLOUR,
  type Rgb, hexToRgb,
} from './palette.js';
import type { Vec3 } from './mesh-buffer.js';

/** A complete simulated day lasts twelve real minutes; a new view starts at noon. */
export const DAY_DURATION_S = 12 * 60;

const NIGHT_ZENITH = hexToRgb(0x080f29);
const NIGHT_HORIZON = hexToRgb(0x202c50);
const TWILIGHT_ZENITH = hexToRgb(0x625784);
const TWILIGHT_HORIZON = hexToRgb(0xf6a477);
const DAY_ZENITH = hexToRgb(SKY_ZENITH_COLOUR);
const DAY_HORIZON = hexToRgb(SKY_HORIZON_COLOUR);
const DAY_SUN: Rgb = [LIT_TINT[0] - SHADOW_TINT[0], LIT_TINT[1] - SHADOW_TINT[1], LIT_TINT[2] - SHADOW_TINT[2]];

export interface DiurnalState {
  readonly hour: number;
  readonly daylight: number;
  readonly nightLights: number;
  readonly sunDirection: Vec3;
  readonly moonDirection: Vec3;
  readonly sunVisibility: number;
  readonly moonVisibility: number;
  readonly starVisibility: number;
  readonly sunIntensity: number;
  readonly sunColour: Rgb;
  readonly ambientColour: Rgb;
  readonly shadeLift: Rgb;
  readonly skyZenith: Rgb;
  readonly skyHorizon: Rgb;
  readonly landscapeTint: Rgb;
}

/** Absolute elapsed time avoids frame-rate drift and catches up after a hidden tab. */
export function diurnalState(elapsedSeconds: number): DiurnalState {
  const phase = ((elapsedSeconds % DAY_DURATION_S) + DAY_DURATION_S) % DAY_DURATION_S / DAY_DURATION_S;
  const hour = (12 + phase * 24) % 24;
  const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
  const elevation = Math.sin(angle);
  const daylight = smoothstep(-0.16, 0.3, elevation);
  const twilight = 1 - smoothstep(0, 0.45, Math.abs(elevation));
  const direction: Vec3 = [-0.45 * elevation - Math.cos(angle), 1.05 * elevation, -0.62 * elevation];
  const length = Math.hypot(...direction);
  return {
    hour,
    daylight,
    nightLights: 1 - smoothstep(-0.12, 0.12, elevation),
    sunDirection: [direction[0] / length, direction[1] / length, direction[2] / length],
    moonDirection: [-direction[0] / length, -direction[1] / length, -direction[2] / length],
    sunVisibility: smoothstep(-0.04, 0.04, elevation),
    moonVisibility: smoothstep(-0.04, 0.04, -elevation) * (1 - daylight),
    starVisibility: 1 - smoothstep(-0.25, 0.02, elevation),
    sunIntensity: Math.PI * smoothstep(0, 0.4, elevation),
    sunColour: blend([1, 0.36, 0.12], DAY_SUN, smoothstep(0, 0.6, elevation)),
    ambientColour: blend([0.055, 0.075, 0.15], SHADOW_TINT, daylight),
    shadeLift: blend([0.003, 0.006, 0.018], SHADE_LIFT, daylight),
    skyZenith: blend(blend(NIGHT_ZENITH, DAY_ZENITH, daylight), TWILIGHT_ZENITH, twilight * 0.65),
    skyHorizon: blend(blend(NIGHT_HORIZON, DAY_HORIZON, daylight), TWILIGHT_HORIZON, twilight * 0.85),
    landscapeTint: blend([0.07, 0.1, 0.22], [1, 1, 1], daylight),
  };
}

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

function blend(from: Rgb, to: Rgb, t: number): Rgb {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}
