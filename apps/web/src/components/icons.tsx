// SPDX-License-Identifier: AGPL-3.0-or-later
// A handful of icons, drawn as strokes. All decorative: buttons carry their own text.

function Icon(props: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={props.d} />
    </svg>
  );
}

export const TickIcon = () => <Icon d="M4 12.5 L10 18 L20 6" />;
export const CloseIcon = () => <Icon d="M5 5 L19 19 M19 5 L5 19" />;
export const BackIcon = () => <Icon d="M14 5 L7 12 L14 19" />;
export const ShareIcon = () => <Icon d="M12 15 V3 M7 8 L12 3 L17 8 M5 13 V20 H19 V13" />;
export const CopyIcon = () => <Icon d="M9 9 H20 V20 H9 Z M5 15 H4 V4 H15 V5" />;
export const PlusIcon = () => <Icon d="M12 5 V19 M5 12 H19" />;
export const MinusIcon = () => <Icon d="M5 12 H19" />;
export const DownIcon = () => <Icon d="M12 4 V18 M6 12 L12 18 L18 12" />;
export const UpIcon = () => <Icon d="M12 20 V6 M6 12 L12 6 L18 12" />;
export const InfoIcon = () => <Icon d="M12 11 V17 M12 7 V7.01" />;
