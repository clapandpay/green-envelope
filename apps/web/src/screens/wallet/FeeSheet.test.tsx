// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '../../test/render';
import { createWorld } from '../../test/world';
import { FeeSheet } from './FeeSheet';

afterEach(cleanup);

describe('the network fee section', () => {
  it('shows the setting and saves a fixed amount in XCH', async () => {
    const { services } = createWorld({ fee: 10_000_000n });
    const setFee = vi.spyOn(services.wallet, 'setFee');
    const onClose = vi.fn();
    renderScreen(<FeeSheet onClose={onClose} onChanged={() => {}} />, { services });

    const fixed = (await screen.findByLabelText(/a fixed amount/i)) as HTMLInputElement;
    await waitFor(() => expect(fixed.checked).toBe(true)); // testnet: 0.00001 fixed
    const amount = screen.getByLabelText(/fee in xch/i) as HTMLInputElement;
    expect(amount.value).toBe('0.00001');

    fireEvent.input(amount, { target: { value: 'lots' } });
    expect(await screen.findByText(/an amount like/i)).toBeTruthy();
    fireEvent.input(amount, { target: { value: '0.00002' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setFee).toHaveBeenCalledWith({ mode: 'fixed', mojos: 20_000_000n }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('can switch to automatic', async () => {
    const { services } = createWorld({ fee: 10_000_000n });
    const setFee = vi.spyOn(services.wallet, 'setFee');
    renderScreen(<FeeSheet onClose={() => {}} onChanged={() => {}} />, { services });
    fireEvent.click(await screen.findByLabelText(/automatic/i));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setFee).toHaveBeenCalledWith({ mode: 'auto' }));
  });
});
