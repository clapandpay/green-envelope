// SPDX-License-Identifier: AGPL-3.0-or-later
// An in-memory chain for service tests. It reads the CREATE_COIN conditions out of each
// standard-transaction solution, so bundles built by the real code have their real effect.
// It does not check signatures or puzzles: the Rust verifier (tools/vectors) does that.
import { type ChainClient, ChainError, type CoinRecord } from '@ge/chain';
import { type Bytes, type Coin, coinId, toHex } from '@ge/chia';

type Node = Bytes | [Node, Node];

function parse(bytes: Bytes): Node {
  let at = 0;
  function node(): Node {
    const first = bytes[at++];
    if (first === undefined) throw new Error('truncated');
    if (first === 0xff) return [node(), node()];
    if (first === 0x80) return new Uint8Array();
    if (first < 0x80) return Uint8Array.of(first);
    // Sizes up to 0x1fff are enough for anything a wallet solution holds.
    // 0x80..0xbf: six size bits. 0xc0..0xdf: five bits plus one more byte.
    const size = first < 0xc0 ? first & 0x3f : ((first & 0x1f) << 8) | (bytes[at++] ?? 0);
    const atom = bytes.slice(at, at + size);
    at += size;
    return atom;
  }
  return node();
}

function items(list: Node): Node[] {
  const out: Node[] = [];
  let rest = list;
  while (Array.isArray(rest)) {
    out.push(rest[0]);
    rest = rest[1];
  }
  return out;
}

function toBigInt(atom: Bytes): bigint {
  return atom.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
}

/** The coins a standard-transaction spend of `parent` creates. */
function outputsOf(parent: Coin, solution: Bytes): Coin[] {
  // (() (q . conditions) ())
  const delegated = items(parse(solution))[1];
  if (!Array.isArray(delegated)) return [];
  return items(delegated[1]).flatMap((condition) => {
    const [opcode, puzzleHash, amount] = items(condition);
    if (!(opcode instanceof Uint8Array) || opcode[0] !== 51) return [];
    if (!(puzzleHash instanceof Uint8Array) || !(amount instanceof Uint8Array)) return [];
    return [{ parentCoinInfo: coinId(parent), puzzleHash, amount: toBigInt(amount) }];
  });
}

/** Creates the chain. `farmBlock()` confirms what is in the mempool. */
export function createFakeChain() {
  const records = new Map<string, CoinRecord>();
  const mempool = new Map<string, Coin[]>();
  let height = 100;

  function add(coin: Coin): void {
    records.set(toHex(coinId(coin)), {
      coin,
      confirmedHeight: height,
      spentHeight: null,
      timestamp: 1_800_000_000 + height * 19,
    });
  }

  const chain: ChainClient = {
    async coinRecordsByPuzzleHashes(hashes, opts) {
      const wanted = new Set(hashes.map(toHex));
      return [...records.values()].filter(
        (record) =>
          wanted.has(toHex(record.coin.puzzleHash)) &&
          (opts?.includeSpent === true || record.spentHeight === null),
      );
    },
    async coinRecordByName(id) {
      return records.get(toHex(id)) ?? null;
    },
    async pushTx(bundle) {
      const spends = bundle.coinSpends.map((spend) => ({ id: toHex(coinId(spend.coin)), spend }));
      for (const { id } of spends) {
        const record = records.get(id);
        if (record === undefined) throw new ChainError('unknown_coin', 'UNKNOWN_UNSPENT');
        if (record.spentHeight !== null) throw new ChainError('double_spend', 'DOUBLE_SPEND');
        if (mempool.has(id)) throw new ChainError('double_spend', 'MEMPOOL_CONFLICT');
      }
      for (const { id, spend } of spends) mempool.set(id, outputsOf(spend.coin, spend.solution));
      return { status: 'success' };
    },
    async peakHeight() {
      return height;
    },
  };

  return {
    chain,
    add,
    farmBlock(): void {
      height += 1;
      for (const [id, outputs] of mempool) {
        const record = records.get(id);
        if (record !== undefined) record.spentHeight = height;
        for (const output of outputs) add(output);
      }
      mempool.clear();
    },
    balanceOf(puzzleHash: Bytes): bigint {
      const wanted = toHex(puzzleHash);
      return [...records.values()]
        .filter((r) => r.spentHeight === null && toHex(r.coin.puzzleHash) === wanted)
        .reduce((sum, r) => sum + r.coin.amount, 0n);
    },
  };
}
