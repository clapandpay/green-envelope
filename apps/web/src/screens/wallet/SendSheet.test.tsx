// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, stillMotion } from '../../test/render';
import { createWorld, type WorldOptions } from '../../test/world';
import { SendSheet } from './SendSheet';

const A = 'xch1a0t57qn6uhe7tzjlxlhwy2qgmuxvvft8gnfzmg5detg0q9f3yc3s2apz0h';
const B = 'txch1anxwneg6hlkmv2uff2mnqh0qhcp5g24hkkfh5j6m9w4t7vjejfts5au9zn';

beforeEach(() => stillMotion());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every handle the send screen is asked about in these tests. */
const HANDLES = {
  anna: {},
  c1apandpay: {},
  moving: { pendingTransfer: true },
  lapsed: { expiresIn: -1 },
};

function open(options: WorldOptions = {}) {
  const { services } = createWorld(options);
  const view = renderScreen(
    <SendSheet
      rate={null}
      balance={{ confirmed: 10_000_000_000n, pending: 0n }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
    { services },
  );
  return { ...view, field: screen.getByLabelText(/to whom/i) as HTMLInputElement };
}

/** A paste event carrying `text`, the way a chat app delivers one. */
function paste(field: HTMLInputElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  field.dispatchEvent(event);
}

describe('pasting a line out of a chat', () => {
  it('takes the address out of the words around it', async () => {
    const { field } = open();
    // recipientKind() alone says null here: the address is not the whole string.
    paste(field, `send it to ${A} 🙏 thanks!`);
    await waitFor(() => expect(field.value).toBe(A));
  });

  it('strips punctuation a chat app left stuck to it', async () => {
    const { field } = open();
    paste(field, `here you go: ${A}.`);
    await waitFor(() => expect(field.value).toBe(A));
  });

  it('asks which one when the message holds more than one', async () => {
    // The suggestion comes back from /api/recipient; without one the field keeps the first
    // candidate and the person picks, which the next test covers.
    const { field } = open({ fetch: { pick: A } });
    paste(field, `not ${B} any more, use ${A} now`);

    // Both are offered, and the suggestion fills the field rather than deciding silently.
    expect(await screen.findByRole('button', { name: A })).toBeTruthy();
    expect(screen.getByRole('button', { name: B })).toBeTruthy();
    await waitFor(() => expect(field.value).toBe(A));

    fireEvent.click(screen.getByRole('button', { name: B }));
    expect(field.value).toBe(B);
  });

  it('leaves an ordinary paste alone when there is nothing to find', async () => {
    const { field } = open();
    paste(field, 'how much did you send?');
    // No candidates: the browser's own paste is not intercepted and no picker appears.
    await waitFor(() => expect(screen.queryByText(/which one did you mean/i)).toBeNull());
  });

  it('still shows the choice when no suggestion comes back', async () => {
    const { field } = open({ fetch: { pick: null } });
    paste(field, `not ${B} any more, use ${A} now`);
    // No suggestion is not a failure: the person is asked instead.
    expect(await screen.findByRole('button', { name: A })).toBeTruthy();
    expect(screen.getByRole('button', { name: B })).toBeTruthy();
  });
});

describe('an @name says where it goes', () => {
  it('shows the address before anything is sent', async () => {
    const { field } = open({ network: 'mainnet', fetch: { handles: HANDLES } });
    fireEvent.input(field, { target: { value: '@anna' } });
    expect(await screen.findByText(/sends to/i)).toBeTruthy();
  });

  it('warns when the name looks like one already paid', async () => {
    // There is nothing to imitate until a name has been paid, so the world pays one first.
    // The mock used to warn unconditionally, which hid that the check has a precondition.
    const world = createWorld({
      network: 'mainnet',
      fetch: { handles: { ...HANDLES, clapandpay: {} }, imitates: '@clapandpay' },
    });
    await world.payHandle('@clapandpay');

    renderScreen(
      <SendSheet
        rate={null}
        balance={{ confirmed: 10_000_000_000n, pending: 0n }}
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { services: world.services },
    );
    const field = screen.getByLabelText(/to whom/i) as HTMLInputElement;
    fireEvent.input(field, { target: { value: '@c1apandpay' } });

    expect(await screen.findByText(/looks a lot like @clapandpay/i)).toBeTruthy();
  });

  it('warns when the name is changing hands', async () => {
    const { field } = open({ network: 'mainnet', fetch: { handles: HANDLES } });
    fireEvent.input(field, { target: { value: '@moving' } });
    expect(await screen.findByText(/changing hands/i)).toBeTruthy();
  });

  it('says what is actually wrong, not "check the spelling"', async () => {
    const { field } = open({ network: 'mainnet', fetch: { handles: HANDLES } });
    fireEvent.input(field, { target: { value: '@lapsed' } });
    expect(await screen.findByText(/has run out/i)).toBeTruthy();
  });

  it('says an address still works when names cannot be looked up', async () => {
    const { field } = open({ network: 'mainnet', fetch: { handles: HANDLES, handlesDown: true } });
    fireEvent.input(field, { target: { value: '@anna' } });
    expect(await screen.findByText(/an address still works/i)).toBeTruthy();
  });

  it('says @names are a mainnet thing on a test chain', async () => {
    const { field } = open();
    fireEvent.input(field, { target: { value: '@anna' } });
    expect(await screen.findByText(/only work on the real network/i)).toBeTruthy();
  });
});

describe('the network fee of a send', () => {
  it('is shown before sending, with the total, and that fee is the one paid', async () => {
    const world = createWorld({ fee: 10_000_000n });
    await world.fund(5_000_000_000n);
    world.fake.farmBlock();
    const send = vi.spyOn(world.services.wallet, 'send');
    renderScreen(
      <SendSheet
        rate={null}
        balance={{ confirmed: 5_000_000_000n, pending: 0n }}
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { services: world.services },
    );
    const other = createWorld({ shared: world.fake });
    const { address } = await other.services.wallet.ensure();
    fireEvent.input(screen.getByLabelText(/to whom/i), { target: { value: address } });
    fireEvent.input(screen.getByLabelText(/how much/i), { target: { value: '0.001' } });
    fireEvent.click(screen.getByRole('button', { name: /next|continue|send/i }));

    expect(await screen.findByText(/network fee/i)).toBeTruthy();
    expect(await screen.findByText(/0[.,]00001\s*XCH/)).toBeTruthy();
    expect(screen.getByText(/in total/i)).toBeTruthy();
    const now = (await screen.findByRole('button', { name: /send now/i })) as HTMLButtonElement;
    await waitFor(() => expect(now.disabled).toBe(false));
    fireEvent.click(now);
    await waitFor(() => expect(send).toHaveBeenCalledWith(address, 1_000_000_000n, 10_000_000n));
  });
});
