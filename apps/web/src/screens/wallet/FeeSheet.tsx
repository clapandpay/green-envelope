// SPDX-License-Identifier: AGPL-3.0-or-later
// The network fee: asked of the network for every transaction (the default on mainnet), or a
// fixed amount (the default on testnet). Remembered per network, in this browser.
import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../i18n';
import { errorCode, errorText } from '../../lib/errors';
import { formatXch, parseDecimal, toDecimalString } from '../../lib/money';
import { useServices } from '../../services/context';
import type { FeeInfo } from '../../services/types';

/** XCH has 12 decimals: one mojo is 0.000000000001 XCH. */
const XCH_DECIMALS = 12;

export function FeeSheet(props: { onClose: () => void; onChanged: (info: FeeInfo) => void }) {
  const { t, locale } = useI18n();
  const services = useServices();
  const [info, setInfo] = useState<FeeInfo | null>(null);
  const [mode, setMode] = useState<'auto' | 'fixed'>('auto');
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    services.wallet.fee().then(
      (now) => {
        if (!alive) return;
        setInfo(now);
        setMode(now.policy.mode);
        const fixed = now.policy.mode === 'fixed' ? now.policy.mojos : now.current;
        setText(toDecimalString(fixed, XCH_DECIMALS));
      },
      (error: unknown) => alive && setProblem(errorText(errorCode(error), t)),
    );
    return () => {
      alive = false;
    };
  }, [services, t]);

  const fixedMojos = parseDecimal(text, XCH_DECIMALS);
  const valid = mode === 'auto' || fixedMojos !== null;

  async function save() {
    if (!valid) return;
    setSaving(true);
    setProblem(null);
    try {
      const next = await services.wallet.setFee(
        mode === 'auto' ? { mode: 'auto' } : { mode: 'fixed', mojos: fixedMojos ?? 0n },
      );
      props.onChanged(next);
      props.onClose();
    } catch (error) {
      setProblem(errorText(errorCode(error), t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open title={t.wallet.feeTitle} onClose={props.onClose}>
      <form
        class="stack"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <p class="soft">{t.wallet.feeBody}</p>
        <fieldset class="field fee-options">
          <legend class="sr-only">{t.wallet.feeTitle}</legend>
          <label class="fee-option">
            <input
              type="radio"
              name="fee"
              checked={mode === 'auto'}
              onChange={() => setMode('auto')}
            />
            <span>
              {t.wallet.feeAuto}
              {info !== null && info.policy.mode === 'auto' && (
                <span class="field__hint num">
                  {' '}
                  · {t.wallet.feeNow(formatXch(info.current, locale, 12))}
                </span>
              )}
            </span>
          </label>
          <label class="fee-option">
            <input
              type="radio"
              name="fee"
              checked={mode === 'fixed'}
              onChange={() => setMode('fixed')}
            />
            <span>{t.wallet.feeFixed}</span>
          </label>
        </fieldset>
        {mode === 'fixed' && (
          <label class="field">
            <span class="field__label">{t.wallet.feeAmountLabel}</span>
            <input
              class="input num"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              aria-invalid={!valid}
              onInput={(event) => setText(event.currentTarget.value)}
            />
            {!valid && <span class="field__error">{t.wallet.feeInvalid}</span>}
          </label>
        )}
        {problem !== null && (
          <p class="notice" role="alert">
            {problem}
          </p>
        )}
        <button type="submit" class="btn btn--primary" disabled={!valid || saving}>
          {t.wallet.feeSave}
        </button>
      </form>
    </Sheet>
  );
}
