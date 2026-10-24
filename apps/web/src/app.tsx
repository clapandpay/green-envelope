// SPDX-License-Identifier: AGPL-3.0-or-later
// The shell: top bar, the routed screen, footer. The claim screen is in the first chunk;
// create and wallet arrive on demand.
import type { ComponentType } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AlphaBanner } from './components/AlphaBanner';
import { Footer } from './components/Footer';
import { I18nProvider, type Lang, useI18n } from './i18n';
import { reloadForNewBuild } from './lib/reload';
import { onLinkClick, type Route, useRoute } from './router';
import { ClaimScreen } from './screens/claim/ClaimScreen';
import { loadCreateScreen, loadHelloScreen, loadWalletScreen } from './screens/lazy';
import { ServicesProvider } from './services/context';
import type { AppServices } from './services/types';

/** Renders a screen from its own chunk, with a placeholder while it loads and a retry. */
function Lazy<P extends object>(props: { load: () => Promise<ComponentType<P>>; with: P }) {
  const { t } = useI18n();
  const [Screen, setScreen] = useState<ComponentType<P> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const { load } = props;
  useEffect(() => {
    let alive = true;
    setFailed(false);
    load().then(
      (component) => alive && setScreen(() => component),
      // Most often a tab from before a release asking for files that are gone: one reload
      // brings the current ones. Otherwise (offline), say so and offer to try again.
      () => alive && !reloadForNewBuild() && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [load, attempt]);

  if (Screen) return <Screen {...props.with} />;
  if (failed) {
    return (
      <div class="stack">
        <p class="notice" role="alert">
          {t.errors.loadFailed} {t.errors.network}
        </p>
        <button type="button" class="btn btn--primary" onClick={() => setAttempt(attempt + 1)}>
          {t.common.retry}
        </button>
      </div>
    );
  }
  return (
    <div class="stack" aria-busy="true">
      <span class="sr-only">{t.common.loading}</span>
      <span class="skeleton" style="height:44px;width:60%" />
      <span class="skeleton" style="height:160px" />
      <span class="skeleton" style="height:56px" />
    </div>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div class="stack">
      <h1 class="title">{t.notFound.title}</h1>
      <p>{t.notFound.body}</p>
      <a class="btn btn--primary" href="/" onClick={onLinkClick}>
        {t.common.home}
      </a>
    </div>
  );
}

function Screen(props: { route: Route }) {
  const { route } = props;
  switch (route.name) {
    case 'claim':
      // The whole address, fragment included: the secret lives there and never leaves the phone.
      return <ClaimScreen key={route.id} link={location.href} />;
    case 'create':
      return <Lazy load={loadCreateScreen} with={{ prefill: route.amount }} />;
    case 'wallet':
      return <Lazy load={loadWalletScreen} with={{}} />;
    case 'hello':
      return <Lazy load={loadHelloScreen} with={{}} />;
    default:
      return <NotFound />;
  }
}

function Shell() {
  const { t } = useI18n();
  const route = useRoute();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    document.title = t.common.appName;
    if (first.current) first.current = false;
    else main.current?.focus(); // keyboard and screen readers start at the new screen
  }, [route, t]);

  return (
    <div class="app">
      <a class="skip" href="#main">
        {t.common.skip}
      </a>
      <AlphaBanner />
      <header class="topbar">
        <a class="brand" href="/" onClick={onLinkClick}>
          {/* The logo on its own paper: ivory by day, black at night. Files in public/. */}
          <picture>
            <source srcset="/logo-dark.png" media="(prefers-color-scheme: dark)" />
            <img src="/logo-light.png" width={32} height={32} alt="" decoding="async" />
          </picture>
          {t.common.appName}
        </a>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        <Screen route={route} />
      </main>
      <Footer />
    </div>
  );
}

export function App(props: { services: AppServices; lang?: Lang }) {
  return (
    <ServicesProvider services={props.services}>
      <I18nProvider {...(props.lang ? { initial: props.lang } : {})}>
        <Shell />
      </I18nProvider>
    </ServicesProvider>
  );
}
