// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { renderScreen } from '../test/render';
import { AlphaBanner } from './AlphaBanner';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the alpha notice', () => {
  it('says it is alpha software, and stays away once dismissed', () => {
    renderScreen(<AlphaBanner />);
    expect(screen.getByRole('note').textContent).toMatch(/Alpha software/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByRole('note')).toBeNull();

    cleanup();
    renderScreen(<AlphaBanner />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('speaks German', () => {
    renderScreen(<AlphaBanner />, { lang: 'de' });
    expect(screen.getByRole('note').textContent).toMatch(/Alpha-Software/);
  });
});
