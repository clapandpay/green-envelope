// SPDX-License-Identifier: AGPL-3.0-or-later
// Test helper: a screen with injected services, English texts and no motion.
import { render } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { vi } from 'vitest';
import { I18nProvider, type Lang } from '../i18n';
import { ServicesProvider } from '../services/context';
import { createMockServices, type MockFlag } from '../services/mock';
import type { AppServices } from '../services/types';

/** Mock services without waiting: no latency, confirmation after `confirmMs`. */
export function fastMock(flags: MockFlag[] = [], confirmMs = 30): AppServices {
  return createMockServices({ flags, latencyMs: 0, confirmMs, origin: 'https://ge.test' });
}

/** Amounts appear at once instead of counting up. */
export function stillMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

export function renderScreen(
  ui: ComponentChildren,
  options: { services?: AppServices; lang?: Lang } = {},
) {
  const services = options.services ?? fastMock();
  const view = render(
    <ServicesProvider services={services}>
      <I18nProvider initial={options.lang ?? 'en'}>{ui}</I18nProvider>
    </ServicesProvider>,
  );
  return { ...view, services };
}
