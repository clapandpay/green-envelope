// SPDX-License-Identifier: AGPL-3.0-or-later
// An in-memory chain for service tests. It reads the CREATE_COIN conditions out of each
// solution (standard transaction, MIPS money or setup coin, vault singleton, launcher), so
// bundles built by the real code have their real effect. It does not check signatures or
// puzzles: the Rust verifier (tools/vectors) does that.
import { type ChainClient, ChainError, type CoinRecord } from '@ge/chain';
import { type Bytes, type Coin, coinId, equalBytes, fromHex, toHex } from '@ge/chia';

/** chia-puzzles `SINGLETON_LAUNCHER_HASH`. */
const LAUNCHER_HASH = fromHex('eff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9');

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

interface Created {
  coin: Coin;
  hint: Bytes | null;
}

const isAtom = (node: Node | undefined): node is Bytes => node instanceof Uint8Array;

/** CREATE_COINs of a `(q . conditions)` delegated puzzle. */
function created(parent: Coin, delegated: Node | undefined): Created[] {
  if (!Array.isArray(delegated)) return [];
  return items(delegated[1]).flatMap((condition) => {
    const [opcode, puzzleHash, amount, memos] = items(condition);
    if (!isAtom(opcode) || opcode[0] !== 51) return [];
    if (!isAtom(puzzleHash) || !isAtom(amount)) return [];
    const first = memos === undefined ? undefined : items(memos)[0];
    return [
      {
        coin: { parentCoinInfo: coinId(parent), puzzleHash, amount: toBigInt(amount) },
        hint: isAtom(first) && first.length === 32 ? first : null,
      },
    ];
  });
}

/** The coins a spend of `parent` creates, for the puzzles this app spends. */
function outputsOf(parent: Coin, solution: Bytes): Created[] {
  const args = items(parse(solution));
  // Launcher: (singleton_puzzle_hash amount key_value_list)
  if (equalBytes(parent.puzzleHash, LAUNCHER_HASH)) {
    const [puzzleHash, amount] = args;
    if (!isAtom(puzzleHash) || !isAtom(amount)) return [];
    return [
      {
        coin: { parentCoinInfo: coinId(parent), puzzleHash, amount: toBigInt(amount) },
        hint: null,
      },
    ];
  }
  // Standard transaction: (() (q . conditions) ())
  if (isAtom(args[0])) return created(parent, args[1]);
  // MIPS (money or setup coin): ((q . conditions) () . member solution)
  const head = args[0];
  if (Array.isArray(head) && isAtom(head[0]) && head[0][0] === 1 && head[0].length === 1) {
    return created(parent, head);
  }
  // Vault singleton: (lineage_proof amount (delegated_puzzle () . member solution)). The odd
  // CREATE_COIN names the inner puzzle; the singleton layer wraps it, and as the custody does
  // not change here, the child is at the parent's own puzzle hash.
  const inner = args[2];
  const delegated = inner === undefined ? undefined : items(inner)[0];
  return created(parent, delegated).map((out) =>
    out.coin.amount % 2n === 1n
      ? { ...out, coin: { ...out.coin, puzzleHash: parent.puzzleHash } }
      : out,
  );
}

/** Creates the chain. `farmBlock()` confirms what is in the mempool. */
export function createFakeChain() {
  const records = new Map<string, CoinRecord>();
  const hints = new Map<string, string>(); // coin id -> hint
  const mempool = new Map<string, { coin: Coin; outputs: Created[] }>();
  let height = 100;

  function add(coin: Coin, hint: Bytes | null = null): void {
    if (hint !== null) hints.set(toHex(coinId(coin)), toHex(hint));
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
    async coinRecordsByHint(hint, opts) {
      const wanted = toHex(hint);
      return [...records.entries()]
        .filter(([id, record]) => hints.get(id) === wanted)
        .map(([, record]) => record)
        .filter((record) => opts?.includeSpent === true || record.spentHeight === null);
    },
    async coinRecordsByParentIds(parentIds, opts) {
      const wanted = new Set(parentIds.map(toHex));
      return [...records.values()].filter(
        (record) =>
          wanted.has(toHex(record.coin.parentCoinInfo)) &&
          (opts?.includeSpent === true || record.spentHeight === null),
      );
    },
    async pushTx(bundle) {
      const spends = bundle.coinSpends.map((spend) => ({ id: toHex(coinId(spend.coin)), spend }));
      // A coin made and spent in the same bundle (a vault's launcher) needs no record yet.
      const madeHere = new Set(
        spends.flatMap(({ spend }) =>
          outputsOf(spend.coin, spend.solution).map((out) => toHex(coinId(out.coin))),
        ),
      );
      for (const { id } of spends) {
        const record = records.get(id);
        if (record === undefined && !madeHere.has(id)) {
          throw new ChainError('unknown_coin', 'UNKNOWN_UNSPENT');
        }
        if (record !== undefined && record.spentHeight !== null) {
          throw new ChainError('double_spend', 'DOUBLE_SPEND');
        }
        if (mempool.has(id)) throw new ChainError('double_spend', 'MEMPOOL_CONFLICT');
      }
      for (const { id, spend } of spends) {
        mempool.set(id, { coin: spend.coin, outputs: outputsOf(spend.coin, spend.solution) });
      }
      return { status: 'success' };
    },
    async peakHeight() {
      return height;
    },
    async feeEstimate(cost) {
      // A quiet mempool: one mojo per thousand cost.
      return cost / 1000n;
    },
  };

  return {
    chain,
    add,
    farmBlock(): void {
      height += 1;
      // Outputs first, so a coin made and spent in this block exists before it is spent.
      for (const { outputs } of mempool.values()) {
        for (const output of outputs) add(output.coin, output.hint);
      }
      for (const [id, { coin }] of mempool) {
        if (!records.has(id)) add(coin);
        const record = records.get(id);
        if (record !== undefined) record.spentHeight = height;
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
