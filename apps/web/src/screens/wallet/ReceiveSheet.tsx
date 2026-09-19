// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo } from 'preact/hooks';
import { CopyButton } from '../../components/CopyButton';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../i18n';
import { encodeQr, qrPath } from '../../lib/qr';

/** Dark on light in both themes: scanners expect it. */
function QrPicture(props: { text: string; label: string }) {
  const path = useMemo(() => {
    try {
      return qrPath(encodeQr(props.text));
    } catch {
      return null; // longer than the encoder takes: the address below still works
    }
  }, [props.text]);
  if (!path) return null;
  return (
    <svg
      class="qr"
      viewBox={path.viewBox}
      role="img"
      aria-label={props.label}
      shape-rendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="var(--qr-light)" />
      <path d={path.d} fill="var(--qr-dark)" />
    </svg>
  );
}

export function ReceiveSheet(props: { address: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open title={t.wallet.receiveTitle} onClose={props.onClose}>
      <div class="stack">
        <p>{t.wallet.receiveBody}</p>
        <QrPicture text={props.address} label={t.wallet.qrLabel} />
        <div class="field">
          <span class="field__label">{t.wallet.addressLabel}</span>
          <p class="address num">{props.address}</p>
        </div>
        <CopyButton text={props.address} class="btn btn--primary" />
      </div>
    </Sheet>
  );
}
