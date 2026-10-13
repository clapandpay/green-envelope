// SPDX-License-Identifier: AGPL-3.0-or-later
// Wires the claim state machine to the services.
import { useCallback, useEffect, useReducer, useRef } from 'preact/hooks';
import { errorCode } from '../../lib/errors';
import { useServices } from '../../services/context';
import { type ClaimState, claimReducer, INITIAL_CLAIM } from './claim-state';

export function useClaim(link: string): {
  state: ClaimState;
  open(): void;
  /** Opens into a wallet that lives only in this browser, after the person chose that. */
  keepHere(): void;
  retry(): void;
} {
  const services = useServices();
  const [state, dispatch] = useReducer(claimReducer, INITIAL_CLAIM);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Look at the envelope whenever we are (back) in `loading`.
  const loading = state.s === 'loading';
  useEffect(() => {
    if (!loading) return;
    let current = true;
    services.envelopes.inspect(link).then(
      (view) => current && dispatch({ e: 'inspected', view }),
      (error) => current && dispatch({ e: 'inspect_failed', code: errorCode(error) }),
    );
    return () => {
      current = false;
    };
  }, [loading, link, services]);

  const start = useCallback(
    (here: boolean) => {
      dispatch({ e: 'open_started' });
      (async () => {
        try {
          // may show the phone's face / finger sheet
          await (here ? services.wallet.keepInBrowser() : services.wallet.ensure());
          const result = await services.envelopes.open(link);
          if (!alive.current) return;
          dispatch({ e: 'open_done', amount: result.amount }); // show the amount now
          result.confirmed.then(
            () => alive.current && dispatch({ e: 'confirmed' }),
            () => {}, // stays "on its way"; the wallet screen shows the truth
          );
        } catch (error) {
          if (alive.current) dispatch({ e: 'open_failed', code: errorCode(error) });
        }
      })();
    },
    [link, services],
  );

  const open = useCallback(() => start(false), [start]);
  const keepHere = useCallback(() => start(true), [start]);
  const retry = useCallback(() => dispatch({ e: 'reload' }), []);
  return { state, open, keepHere, retry };
}
