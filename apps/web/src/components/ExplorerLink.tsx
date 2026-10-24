// SPDX-License-Identifier: AGPL-3.0-or-later
// "See it on mempoolxch.space": where the money went, on a public block explorer.
import { useI18n } from '../i18n';
import { explorerAddress, explorerCoin } from '../lib/explorer';
import { useServices } from '../services/context';

export function ExplorerLink(props: {
  coinId?: string;
  address?: string;
  class?: string;
  /** The link text; default "See it on mempoolxch.space". */
  label?: string;
}) {
  const { t } = useI18n();
  const { network } = useServices();
  const href =
    props.coinId !== undefined
      ? explorerCoin(props.coinId, network)
      : props.address !== undefined
        ? explorerAddress(props.address, network)
        : null;
  if (href === null) return null;
  return (
    <a class={props.class ?? 'explorer-link'} href={href} target="_blank" rel="noopener noreferrer">
      {props.label ?? t.common.explorer}
    </a>
  );
}
