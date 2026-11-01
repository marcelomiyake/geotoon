import type { Clock } from '@geotoon/core';

export const systemClock: Clock = {
  now: () => new Date(),
};
