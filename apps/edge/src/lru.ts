// SPDX-License-Identifier: AGPL-3.0-or-later

/** A bounded string-keyed cache that evicts the least recently used entry. */
export interface Lru<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  readonly size: number;
}

/** Creates an `Lru` holding at most `capacity` entries; relies on `Map` keeping insertion order. */
export function createLru<V>(capacity: number): Lru<V> {
  const entries = new Map<string, V>();
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      if (entries.size <= capacity) return;
      const oldest = entries.keys().next();
      if (!oldest.done) entries.delete(oldest.value);
    },
    delete(key) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
}
