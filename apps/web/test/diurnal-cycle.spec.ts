import { describe, expect, it } from 'vitest';
import { DAY_DURATION_S, diurnalState } from '../src/scene/diurnal-cycle.js';
import { LIT_TINT, SHADE_LIFT, SHADOW_TINT } from '../src/scene/palette.js';

describe('diurnal cycle', () => {
  it('starts at noon and runs a complete 24-hour day every twelve real minutes', () => {
    expect(DAY_DURATION_S).toBe(720);
    expect([0, 180, 360, 540, 720].map((seconds) => diurnalState(seconds).hour)).toEqual([12, 18, 0, 6, 12]);
    for (const seconds of [0, 35.5, 180, 360, 540, 719]) {
      expect(diurnalState(seconds + DAY_DURATION_S * 100)).toEqual(diurnalState(seconds));
      expect(diurnalState(seconds - DAY_DURATION_S)).toEqual(diurnalState(seconds));
    }
  });

  it('preserves the daytime palette and makes midnight dark but navigable', () => {
    const noon = diurnalState(0);
    const midnight = diurnalState(360);
    expect(noon.daylight).toBe(1);
    expect(noon.nightLights).toBe(0);
    expect(noon.sunIntensity).toBe(Math.PI);
    expect(noon.ambientColour).toEqual(SHADOW_TINT);
    expect(noon.shadeLift).toEqual(SHADE_LIFT);
    noon.sunColour.forEach((value, i) => expect(value + noon.ambientColour[i]!).toBeCloseTo(LIT_TINT[i]!));
    expect(midnight.daylight).toBe(0);
    expect(midnight.nightLights).toBe(1);
    expect(midnight.sunIntensity).toBe(0);
    midnight.ambientColour.forEach((value, i) => {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(noon.ambientColour[i]!);
      expect(midnight.skyHorizon[i]!).toBeLessThan(noon.skyHorizon[i]!);
    });
    expect(midnight.ambientColour[2]).toBeGreaterThan(midnight.ambientColour[0]);
  });

  it('shows the sun by day and the opposite moon and stars by night, fading through twilight', () => {
    const noon = diurnalState(0);
    const midnight = diurnalState(360);
    expect(noon.sunVisibility).toBe(1);
    expect(noon.moonVisibility).toBe(0);
    expect(noon.starVisibility).toBe(0);
    expect(midnight.sunVisibility).toBe(0);
    expect(midnight.moonVisibility).toBe(1);
    expect(midnight.starVisibility).toBe(1);
    expect(midnight.moonDirection[1]).toBeGreaterThan(0);
    expect(Math.hypot(...midnight.moonDirection)).toBeCloseTo(1);
    midnight.moonDirection.forEach((value, i) => expect(value).toBeCloseTo(-midnight.sunDirection[i]!));
    const dusk = [180, 190, 200, 210].map((seconds) => diurnalState(seconds).starVisibility);
    expect(dusk).toEqual([...dusk].sort((a, b) => a - b));
    expect(dusk[0]!).toBeGreaterThan(0);
    expect(dusk[0]!).toBeLessThan(dusk[1]!);
    expect(dusk.at(-1)).toBe(1);
  });

  it('fades artificial lights up at dusk and down at dawn, with warm twilight skies', () => {
    const dusk = [165, 175, 180, 185, 195].map((seconds) => diurnalState(seconds).nightLights);
    const dawn = [525, 535, 540, 545, 555].map((seconds) => diurnalState(seconds).nightLights);
    expect(dusk[0]).toBe(0);
    expect(dusk[2]).toBeCloseTo(0.5);
    expect(dusk[4]).toBe(1);
    expect(dusk).toEqual([...dusk].sort((a, b) => a - b));
    dawn.forEach((value, i) => expect(value).toBeCloseTo(dusk[4 - i]!, 10));
    expect(diurnalState(180).skyHorizon[0]).toBeGreaterThan(diurnalState(180).skyHorizon[2]);
    expect(diurnalState(540).skyHorizon[0]).toBeGreaterThan(diurnalState(540).skyHorizon[2]);
  });

  it('keeps light and sky values continuous across midnight, sunrise, sunset and cycle wrap', () => {
    for (const seconds of [0, 180, 360, 540, 720]) {
      const before = diurnalState(seconds - 0.001);
      const after = diurnalState(seconds + 0.001);
      expect(after.nightLights).toBeCloseTo(before.nightLights, 3);
      expect(after.sunIntensity).toBeCloseTo(before.sunIntensity, 3);
      for (const key of ['sunDirection', 'moonDirection', 'sunColour', 'ambientColour', 'shadeLift', 'skyZenith', 'skyHorizon', 'landscapeTint'] as const) {
        before[key].forEach((value, i) => expect(after[key][i]!).toBeCloseTo(value, 3));
      }
      for (const key of ['sunVisibility', 'moonVisibility', 'starVisibility'] as const) {
        expect(after[key]).toBeCloseTo(before[key], 3);
      }
    }
  });

  it('moves the sun across the horizon and keeps every sampled lighting value bounded', () => {
    expect(diurnalState(0).sunDirection[1]).toBeGreaterThan(0);
    expect(diurnalState(360).sunDirection[1]).toBeLessThan(0);
    expect(diurnalState(180).sunDirection[0]).toBeGreaterThan(0.99);
    expect(diurnalState(540).sunDirection[0]).toBeLessThan(-0.99);
    for (let seconds = 0; seconds <= DAY_DURATION_S; seconds += 5) {
      const state = diurnalState(seconds);
      expect(Math.hypot(...state.sunDirection)).toBeCloseTo(1);
      expect(state.sunIntensity).toBeGreaterThanOrEqual(0);
      expect(state.sunIntensity).toBeLessThanOrEqual(Math.PI);
      expect(state.nightLights).toBeGreaterThanOrEqual(0);
      expect(state.nightLights).toBeLessThanOrEqual(1);
      for (const colour of [state.sunColour, state.ambientColour, state.shadeLift, state.skyZenith, state.skyHorizon, state.landscapeTint]) {
        colour.forEach((value) => {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        });
      }
    }
  });
});
