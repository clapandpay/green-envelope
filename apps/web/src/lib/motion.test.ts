// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { countUpValue } from './motion';

describe('countUpValue', () => {
  it('starts at zero, ends exactly on the target and never overshoots', () => {
    const target = 296_000_000_001n;
    expect(countUpValue(target, 0)).toBe(0n);
    expect(countUpValue(target, -1)).toBe(0n);
    expect(countUpValue(target, 1)).toBe(target);
    expect(countUpValue(target, 1.7)).toBe(target);
    let previous = 0n;
    for (let step = 0; step <= 100; step++) {
      const value = countUpValue(target, step / 100);
      expect(value >= previous && value <= target).toBe(true);
      previous = value;
    }
  });
});
