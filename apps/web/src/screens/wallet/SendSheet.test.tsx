// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fastMock, renderScreen, stillMotion } from '../../test/render';
import { SendSheet } from './SendSheet';

const A = 'xch1a0t57qn6uhe7tzjlxlhwy2qgmuxvvft8gnfzmg5detg0q9f3yc3s2apz0h';
const B = 'txch1anxwneg6hlkmv2uff2mnqh0qhcp5g24hkkfh5j6m9w4t7vjejfts5au9zn';

beforeEach(() => stillMotion());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(flags: Parameters<typeof fastMock>[0] = []) {
  const services = fastMock(flags);
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
    const { field } = open();
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
    const { field } = open(['nopick']);
    paste(field, `not ${B} any more, use ${A} now`);
    // No suggestion is not a failure: the person is asked instead.
    expect(await screen.findByRole('button', { name: A })).toBeTruthy();
    expect(screen.getByRole('button', { name: B })).toBeTruthy();
  });
});

describe('an @name says where it goes', () => {
  it('shows the address before anything is sent', async () => {
    const { field } = open(['mainnet']);
    fireEvent.input(field, { target: { value: '@anna' } });
    expect(await screen.findByText(/sends to/i)).toBeTruthy();
  });

  it('warns when the name looks like one already paid', async () => {
    const { field } = open(['mainnet']);
    fireEvent.input(field, { target: { value: '@c1apandpay' } });
    expect(await screen.findByText(/looks a lot like @clapandpay/i)).toBeTruthy();
  });

  it('warns when the name is changing hands', async () => {
    const { field } = open(['mainnet']);
    fireEvent.input(field, { target: { value: '@moving' } });
    expect(await screen.findByText(/changing hands/i)).toBeTruthy();
  });

  it('says what is actually wrong, not "check the spelling"', async () => {
    const { field } = open(['mainnet']);
    fireEvent.input(field, { target: { value: '@lapsed' } });
    expect(await screen.findByText(/has run out/i)).toBeTruthy();
  });

  it('says an address still works when names cannot be looked up', async () => {
    const { field } = open(['mainnet', 'nohandles']);
    fireEvent.input(field, { target: { value: '@anna' } });
    expect(await screen.findByText(/an address still works/i)).toBeTruthy();
  });

  it('says @names are a mainnet thing on a test chain', async () => {
    const { field } = open();
    fireEvent.input(field, { target: { value: '@anna' } });
    expect(await screen.findByText(/only work on the real network/i)).toBeTruthy();
  });
});
