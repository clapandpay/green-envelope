// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'preact/hooks';
import { useServices } from '../services/context';
import { type Rate, toRate } from './money';

export interface RateState {
  rate: Rate | null;
  /** False until the price service answered (with a price or without). */
  ready: boolean;
}

/** The euro price, asked once per screen. No price is not an error: amounts show in XCH. */
export function useRate(): RateState {
  const { price } = useServices();
  const [state, setState] = useState<RateState>({ rate: null, ready: false });
  useEffect(() => {
    let alive = true;
    price
      .eurPerXch()
      .then(toRate, () => null)
      .then((rate) => {
        if (alive) setState({ rate, ready: true });
      });
    return () => {
      alive = false;
    };
  }, [price]);
  return state;
}
