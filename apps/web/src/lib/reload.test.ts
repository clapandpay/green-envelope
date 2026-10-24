// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { reloadForNewBuild } from './reload';

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('reloading for a newer build', () => {
  it('reloads once, then not again within a minute, then again', () => {
    const storage = memory();
    const reload = vi.fn();
    expect(reloadForNewBuild(storage, 1_000_000, reload)).toBe(true);
    expect(reloadForNewBuild(storage, 1_030_000, reload)).toBe(false);
    expect(reloadForNewBuild(storage, 1_061_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads when storage is blocked, so it cannot loop', () => {
    const reload = vi.fn();
    expect(reloadForNewBuild(null, 1, reload)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
    };
    expect(reloadForNewBuild(broken, 1, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
