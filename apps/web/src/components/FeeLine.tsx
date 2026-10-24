// SPDX-License-Identifier: AGPL-3.0-or-later
// The network fee of the payment about to be made, shown before every one of them. The amount
// is the one the payment will use: the screen hands it back (the services' `fee` argument).
import { useI18n } from '../i18n';
import { formatXch } from '../lib/money';

export function FeeLine(props: {
  /** Null while it is being worked out. */
  fee: bigint | null;
  /** When given, a second line: what this costs in all, fee included. */
  total?: bigint | null;
}) {
  const { t, locale } = useI18n();
  const xch = (mojos: bigint) => formatXch(mojos, locale, 12);
  return (
    <dl class="fee-line">
      <div>
        <dt>{t.wallet.feeLine}</dt>
        <dd class="num">{props.fee === null ? t.wallet.feeWorking : xch(props.fee)}</dd>
      </div>
      {props.total !== undefined && (
        <div class="fee-line__total">
          <dt>{t.wallet.feeTotal}</dt>
          <dd class="num">{props.total === null ? '…' : xch(props.total)}</dd>
        </div>
      )}
    </dl>
  );
}
