// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { useCountUp } from './motion';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Counter(props: { target: bigint }) {
  return <output>{useCountUp(props.target, true, 900, 2000).toString()}</output>;
}

it('shows the true amount even when the browser never runs an animation frame', async () => {
  // A hidden or unfocused window: frames are requested and never delivered.
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.useFakeTimers();

  render(<Counter target={296_000_000_000n} />);
  expect(screen.getByRole('status').textContent).toBe('0');
  await vi.advanceTimersByTimeAsync(2000 + 900 + 200);
  expect(screen.getByRole('status').textContent).toBe('296000000000');
});
