// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { allOpened, envelopeCopy, genericCopy, helloCopy, pickLanguage } from './copy';

describe('pickLanguage', () => {
  it.each([
    ['de', 'de'],
    ['de-AT,de;q=0.9,en;q=0.8', 'de'],
    [' DE-de', 'de'],
    ['en-US,de;q=0.9', 'en'],
    ['fr', 'en'],
    ['', 'en'],
    [null, 'en'],
  ] as const)('%s -> %s', (header, language) => {
    expect(pickLanguage(header)).toBe(language);
  });
});

describe('envelopeCopy', () => {
  const partial = { kind: 'counted', total: 5, left: 3 } as const;
  const none = { kind: 'counted', total: 5, left: 0 } as const;
  const unknown = { kind: 'unknown' } as const;

  it('writes the English preview', () => {
    expect(envelopeCopy('en', 'Anna', 'Happy birthday', partial)).toEqual({
      title: '🟢 Green envelope from Anna',
      description: 'Happy birthday — 3 of 5 left · tap to open',
    });
  });

  it('writes the German preview', () => {
    expect(envelopeCopy('de', 'Anna', '', partial)).toEqual({
      title: '🟢 Grüner Umschlag von Anna',
      description: 'Noch 3 von 5 · tippen zum Öffnen',
    });
  });

  it('says so when every share is opened', () => {
    expect(envelopeCopy('en', '', '', none).description).toBe('All opened. Make your own.');
    expect(envelopeCopy('de', '', '', none).description).toBe(
      'Alle geöffnet. Mach deinen eigenen.',
    );
    expect(allOpened(none)).toBe(true);
    expect(allOpened(partial)).toBe(false);
    expect(allOpened(unknown)).toBe(false);
  });

  it('has no counts when the state is unknown, and a title without a sender', () => {
    expect(envelopeCopy('en', '', 'Hi', unknown)).toEqual({
      title: '🟢 A green envelope for you',
      description: 'Hi — Tap to open',
    });
    expect(envelopeCopy('de', '', '', unknown).description).toBe('Tippen zum Öffnen');
  });

  it('has generic copy in both languages', () => {
    expect(genericCopy('en').title).toContain('Green Envelope');
    expect(genericCopy('de').title).toContain('Grüner Umschlag');
  });
});

describe('helloCopy', () => {
  it('invites in both languages', () => {
    expect(helloCopy('en').title).toContain('Get your green envelope');
    expect(helloCopy('de').title).toContain('grünen Umschlag');
    expect(helloCopy('en').description).not.toMatch(/blockchain|crypto/i);
  });
});
