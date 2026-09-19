// SPDX-License-Identifier: AGPL-3.0-or-later
// Screens get their services from here, so tests and demos can inject their own.
import { type ComponentChildren, createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { AppServices } from './types';

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider(props: { services: AppServices; children: ComponentChildren }) {
  return (
    <ServicesContext.Provider value={props.services}>{props.children}</ServicesContext.Provider>
  );
}

/** The app's services. Throws when no provider is mounted: that is a programming error. */
export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider is missing');
  return services;
}
