// SPDX-License-Identifier: AGPL-3.0-or-later
// A timed test rather than `vitest bench`, so the numbers show up in every `pnpm test` run.
// The limits are generous (CI machines vary); the printed numbers are what to watch.
import { describe, expect, it } from 'vitest';
import { deriveUnhardenedPublic, keyGen, publicKey } from './keys';
import { TESTNET11 } from './network';
import { signSpends, spendStandardCoin } from './spend';
import { standardPuzzleHash, syntheticPublicKey, syntheticSecretKey } from './standard';

function time<T>(run: () => T): { ms: number; result: T } {
  const start = performance.now();
  const result = run();
  return { ms: performance.now() - start, result };
}

describe('benchmark', () => {
  it('derives 100 unhardened public children with puzzle hashes, and signs one spend', () => {
    const master = keyGen(new Uint8Array(32).fill(42));
    const masterPk = publicKey(master);

    // First call pays for noble's one-off precomputation of G1 multiples; report it apart.
    const warmup = time(() =>
      standardPuzzleHash(syntheticPublicKey(deriveUnhardenedPublic(masterPk, 1000))),
    );

    const derive = time(() => {
      const hashes = [];
      for (let i = 0; i < 100; i++) {
        hashes.push(standardPuzzleHash(syntheticPublicKey(deriveUnhardenedPublic(masterPk, i))));
      }
      return hashes;
    });
    expect(new Set(derive.result.map(String)).size).toBe(100);

    const syntheticSk = syntheticSecretKey(master);
    const syntheticPk = publicKey(syntheticSk);
    const puzzleHash = standardPuzzleHash(syntheticPk);
    const coin = { parentCoinInfo: new Uint8Array(32), puzzleHash, amount: 1_000_000n };
    const sign = time(() => {
      const coinSpend = spendStandardCoin(coin, syntheticPk, [
        { kind: 'createCoin', puzzleHash, amount: 999_000n, memos: [puzzleHash] },
        { kind: 'reserveFee', amount: 1_000n },
      ]);
      return signSpends([{ coinSpend, syntheticSk }], TESTNET11);
    });
    expect(sign.result.aggregatedSignature.length).toBe(96);

    process.stdout.write(
      `[bench] first derivation (cold): ${warmup.ms.toFixed(1)} ms; ` +
        `100 unhardened public children + synthetic keys + puzzle hashes: ${derive.ms.toFixed(1)} ms ` +
        `(${(derive.ms / 100).toFixed(2)} ms each); build + sign one spend: ${sign.ms.toFixed(1)} ms\n`,
    );
    expect(derive.ms).toBeLessThan(5_000);
    expect(sign.ms).toBeLessThan(2_000);
  });
});
