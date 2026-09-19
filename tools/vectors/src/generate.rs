// SPDX-License-Identifier: AGPL-3.0-or-later
//! `generate`: writes the golden vectors that the TypeScript tests assert byte for byte.
//! Every value comes from chia-wallet-sdk (chia-bls, clvmr, chia-puzzle-types, the SDK driver and
//! signer); nothing here re-implements what it is supposed to prove.

use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};
use chia_wallet_sdk::chia::bls::{
    DerivableKey, PublicKey, SecretKey, Signature, aggregate, aggregate_verify,
    master_to_wallet_hardened, master_to_wallet_unhardened, sign, verify,
};
use chia_wallet_sdk::chia::consensus::flags::MEMPOOL_MODE;
use chia_wallet_sdk::chia::consensus::spendbundle_validation::validate_clvm_and_signature;
use chia_wallet_sdk::chia::puzzle_types::DeriveSynthetic;
use chia_wallet_sdk::chia::puzzle_types::standard::{DEFAULT_HIDDEN_PUZZLE_HASH, StandardArgs};
use chia_wallet_sdk::clvmr::serde::node_to_bytes;
use chia_wallet_sdk::prelude::*;
use chia_wallet_sdk::puzzles::{
    P2_DELEGATED_PUZZLE_OR_HIDDEN_PUZZLE, P2_DELEGATED_PUZZLE_OR_HIDDEN_PUZZLE_HASH,
};
use serde_json::{Value, json};

fn h(bytes: impl AsRef<[u8]>) -> String {
    hex::encode(bytes)
}

// ---------------------------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------------------------

fn seeds() -> Vec<Vec<u8>> {
    vec![
        vec![0u8; 32],
        (0u8..32).collect(),
        vec![0xff; 32],
        (0u8..64)
            .map(|i| i.wrapping_mul(7).wrapping_add(3))
            .collect(),
        b"green envelope golden vector seed, longer than sixty-four bytes on purpose.".to_vec(),
    ]
}

fn standard_puzzle(synthetic_pk: PublicKey) -> Result<(Bytes32, Vec<u8>)> {
    let mut ctx = SpendContext::new();
    let ptr = ctx.curry(StandardArgs::new(synthetic_pk))?;
    let hash: Bytes32 = ctx.tree_hash(ptr).into();
    let shortcut: Bytes32 = StandardArgs::curry_tree_hash(synthetic_pk).into();
    if hash != shortcut {
        bail!("curried puzzle hash and curry_tree_hash disagree");
    }
    Ok((hash, node_to_bytes(&ctx, ptr)?))
}

fn address(puzzle_hash: Bytes32, prefix: &str) -> Result<String> {
    Ok(Address::new(puzzle_hash, prefix.to_string()).encode()?)
}

fn key_vector(seed: &[u8]) -> Result<Value> {
    let master_sk = SecretKey::from_seed(seed);
    let master_pk = master_sk.public_key();

    let hardened: Vec<Value> = [
        0u32,
        1,
        2,
        8444,
        12381,
        0x7fff_ffff,
        0x8000_0000,
        0xffff_ffff,
    ]
    .iter()
    .map(|&index| {
        let sk = master_sk.derive_hardened(index);
        json!({ "index": index, "sk": h(sk.to_bytes()), "pk": h(sk.public_key().to_bytes()) })
    })
    .collect();

    let mut unhardened = Vec::new();
    for index in [0u32, 1, 2, 3, 99, 0x7fff_ffff, 0xffff_ffff] {
        let sk = master_sk.derive_unhardened(index);
        let pk = master_pk.derive_unhardened(index);
        if sk.public_key() != pk {
            bail!("secret-side and public-side unhardened derivation disagree");
        }
        unhardened.push(json!({ "index": index, "sk": h(sk.to_bytes()), "pk": h(pk.to_bytes()) }));
    }

    // m/12381/8444/2/i, the path of a standard Chia wallet.
    let mut wallet = Vec::new();
    for index in [0u32, 1, 7] {
        let sk = master_to_wallet_unhardened(&master_sk, index);
        let pk = master_to_wallet_unhardened(&master_pk, index);
        let hard = master_to_wallet_hardened(&master_sk, index);
        let (puzzle_hash, _) = standard_puzzle(pk.derive_synthetic())?;
        wallet.push(json!({
            "index": index,
            "unhardened_sk": h(sk.to_bytes()),
            "unhardened_pk": h(pk.to_bytes()),
            "hardened_sk": h(hard.to_bytes()),
            "puzzle_hash": h(puzzle_hash),
        }));
    }

    let synthetic_sk = master_sk.derive_synthetic();
    let synthetic_pk = master_pk.derive_synthetic();
    if synthetic_sk.public_key() != synthetic_pk {
        bail!("synthetic secret and public keys disagree");
    }
    let (puzzle_hash, puzzle_reveal) = standard_puzzle(synthetic_pk)?;

    Ok(json!({
        "seed": h(seed),
        "master_sk": h(master_sk.to_bytes()),
        "master_pk": h(master_pk.to_bytes()),
        "hardened": hardened,
        "unhardened": unhardened,
        "wallet": wallet,
        "synthetic_sk": h(synthetic_sk.to_bytes()),
        "synthetic_pk": h(synthetic_pk.to_bytes()),
        "puzzle_hash": h(puzzle_hash),
        "puzzle_reveal": h(puzzle_reveal),
        "address_xch": address(puzzle_hash, "xch")?,
        "address_txch": address(puzzle_hash, "txch")?,
    }))
}

// ---------------------------------------------------------------------------------------------
// coins, signatures
// ---------------------------------------------------------------------------------------------

fn coin_json(coin: &Coin) -> Value {
    json!({
        "parent_coin_info": h(coin.parent_coin_info),
        "puzzle_hash": h(coin.puzzle_hash),
        "amount": coin.amount.to_string(),
    })
}

fn coin_vectors() -> Vec<Value> {
    let amounts = [
        0u64,
        1,
        127,
        128,
        255,
        256,
        32_767,
        32_768,
        65_535,
        65_536,
        1_000_000_000_000,
        (1 << 32) - 1,
        1 << 32,
        (1 << 63) - 1,
        1 << 63,
        u64::MAX,
    ];
    amounts
        .iter()
        .enumerate()
        .map(|(i, &amount)| {
            let tag = u8::try_from(i).unwrap_or(0xff);
            let coin = Coin::new(
                Bytes32::new([tag; 32]),
                Bytes32::new([tag ^ 0xa5; 32]),
                amount,
            );
            let mut value = coin_json(&coin);
            value["coin_id"] = json!(h(coin.coin_id()));
            value
        })
        .collect()
}

fn signature_vectors() -> Result<Value> {
    let messages: Vec<Vec<u8>> = vec![
        vec![],
        b"hello".to_vec(),
        (0u8..32).collect(),
        vec![0xab; 1000],
    ];
    let keys: Vec<SecretKey> = seeds().iter().map(|s| SecretKey::from_seed(s)).collect();

    let mut single = Vec::new();
    for (sk, message) in keys.iter().zip(messages.iter().cycle()) {
        let signature = sign(sk, message);
        if !verify(&signature, &sk.public_key(), message) {
            bail!("reference signature does not verify");
        }
        single.push(json!({
            "sk": h(sk.to_bytes()),
            "pk": h(sk.public_key().to_bytes()),
            "message": h(message),
            "signature": h(signature.to_bytes()),
        }));
    }
    // The same key over every message too.
    for message in &messages {
        let sk = &keys[0];
        single.push(json!({
            "sk": h(sk.to_bytes()),
            "pk": h(sk.public_key().to_bytes()),
            "message": h(message),
            "signature": h(sign(sk, message).to_bytes()),
        }));
    }

    let parts: Vec<(PublicKey, Vec<u8>, Signature)> = keys
        .iter()
        .take(3)
        .zip(messages.iter().skip(1))
        .map(|(sk, message)| (sk.public_key(), message.clone(), sign(sk, message)))
        .collect();
    let aggregated = aggregate(parts.iter().map(|p| &p.2));
    if !aggregate_verify(&aggregated, parts.iter().map(|p| (&p.0, p.1.as_slice()))) {
        bail!("reference aggregate does not verify");
    }

    Ok(json!({
        "single": single,
        "aggregate": {
            "parts": parts.iter().map(|(pk, message, signature)| json!({
                "pk": h(pk.to_bytes()),
                "message": h(message),
                "signature": h(signature.to_bytes()),
            })).collect::<Vec<_>>(),
            "signature": h(aggregated.to_bytes()),
        },
        "empty_aggregate": h(Signature::default().to_bytes()),
    }))
}

// ---------------------------------------------------------------------------------------------
// CLVM
// ---------------------------------------------------------------------------------------------

/// A CLVM value as JSON: an atom is a hex string, a pair is a two-element array.
fn alloc_tree(a: &mut Allocator, tree: &Value) -> Result<NodePtr> {
    match tree {
        Value::String(atom) => Ok(a.new_atom(&hex::decode(atom)?)?),
        Value::Array(pair) if pair.len() == 2 => {
            let first = alloc_tree(a, &pair[0])?;
            let rest = alloc_tree(a, &pair[1])?;
            Ok(a.new_pair(first, rest)?)
        }
        other => bail!("not a CLVM tree: {other}"),
    }
}

fn atom(len: usize, fill: u8) -> Value {
    json!(h(vec![fill; len]))
}

fn proper_list(items: Vec<Value>) -> Value {
    items
        .into_iter()
        .rev()
        .fold(json!(""), |rest, first| json!([first, rest]))
}

fn clvm_vectors() -> Result<Vec<Value>> {
    let mut samples: Vec<(String, Value)> = vec![
        ("nil".into(), json!("")),
        ("atom 0x00".into(), json!("00")),
        ("atom 0x01".into(), json!("01")),
        ("atom 0x7f".into(), json!("7f")),
        ("atom 0x80".into(), json!("80")),
        ("atom 0xff".into(), json!("ff")),
    ];
    // Length prefixes change at 0x40, 0x2000 and 0x100000 bytes.
    for len in [
        2usize, 32, 48, 63, 64, 65, 100, 8191, 8192, 9000, 1_048_575, 1_048_576,
    ] {
        let fill = u8::try_from(len % 251).unwrap_or(0);
        samples.push((format!("atom of {len} bytes"), atom(len, fill)));
    }
    samples.extend([
        ("pair of nils".into(), json!(["", ""])),
        ("pair of atoms".into(), json!(["01", "02"])),
        ("improper list".into(), json!(["01", ["02", "03"]])),
        (
            "list 1 2 3".into(),
            proper_list(vec![json!("01"), json!("02"), json!("03")]),
        ),
        (
            "nested lists".into(),
            proper_list(vec![
                proper_list(vec![json!("01"), atom(32, 0xaa)]),
                proper_list(vec![]),
                proper_list(vec![proper_list(vec![json!("ff"), atom(100, 0x80)])]),
            ]),
        ),
        (
            "left-deep tree".into(),
            (0u8..40).fold(json!("2a"), |tree, i| json!([tree, h([i])])),
        ),
        (
            "quoted condition list".into(),
            json!([
                "01",
                proper_list(vec![proper_list(vec![
                    json!("33"),
                    atom(32, 0x11),
                    json!("03e8"),
                    proper_list(vec![atom(32, 0x11)]),
                ])])
            ]),
        ),
    ]);

    samples
        .into_iter()
        .map(|(name, tree)| {
            let mut a = Allocator::new();
            let ptr = alloc_tree(&mut a, &tree)?;
            // Atoms of a megabyte would bloat the file; they are described, not spelled out.
            let tree = match &tree {
                Value::String(s) if s.len() > 20_000 => {
                    json!({ "atom_len": s.len() / 2, "fill": &s[0..2] })
                }
                _ => tree,
            };
            let serialized = node_to_bytes(&a, ptr)?;
            let serialized = if serialized.len() > 20_000 {
                json!({ "sha256": h(sha256(&serialized)), "len": serialized.len() })
            } else {
                json!(h(serialized))
            };
            Ok(json!({
                "name": name,
                "tree": tree,
                "serialized": serialized,
                "tree_hash": h(tree_hash(&a, ptr)),
            }))
        })
        .collect()
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = chia_wallet_sdk::chia::sha2::Sha256::new();
    hasher.update(bytes);
    hasher.finalize()
}

fn int_vectors() -> Result<Vec<Value>> {
    let mut values: Vec<i128> = vec![0, i128::MAX, i128::MIN, i128::MIN + 1];
    for bits in [
        7u32, 8, 15, 16, 23, 24, 31, 32, 39, 40, 47, 48, 53, 55, 56, 63, 64, 71, 72,
    ] {
        let p = 1i128 << bits;
        values.extend([p - 1, p, p + 1, -p - 1, -p, -p + 1]);
    }
    values.extend([
        1,
        -1,
        2,
        51,
        100,
        1000,
        -1000,
        1_000_000_000_000,
        0x0123_4567_89ab_cdef,
    ]);
    values.sort_unstable();
    values.dedup();

    values
        .into_iter()
        .map(|value| {
            let mut a = Allocator::new();
            let ptr = value.to_clvm(&mut a)?;
            Ok(json!({ "value": value.to_string(), "atom": h(a.atom(ptr)) }))
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// signed standard-transaction spend bundles
// ---------------------------------------------------------------------------------------------

enum Cond {
    CreateCoin(Bytes32, u64, Option<Vec<Vec<u8>>>),
    ReserveFee(u64),
    AssertConcurrentSpend(Bytes32),
    AssertBeforeSecondsAbsolute(u64),
}

impl Cond {
    fn json(&self) -> Value {
        match self {
            Self::CreateCoin(puzzle_hash, amount, memos) => {
                let mut value = json!({
                    "kind": "createCoin",
                    "puzzle_hash": h(puzzle_hash),
                    "amount": amount.to_string(),
                });
                if let Some(memos) = memos {
                    value["memos"] = memos.iter().map(h).collect();
                }
                value
            }
            Self::ReserveFee(amount) => {
                json!({ "kind": "reserveFee", "amount": amount.to_string() })
            }
            Self::AssertConcurrentSpend(coin_id) => {
                json!({ "kind": "assertConcurrentSpend", "coin_id": h(coin_id) })
            }
            Self::AssertBeforeSecondsAbsolute(seconds) => {
                json!({ "kind": "assertBeforeSecondsAbsolute", "seconds": seconds.to_string() })
            }
        }
    }
}

fn sdk_conditions(ctx: &mut SpendContext, conds: &[Cond]) -> Result<Conditions> {
    let mut out = Conditions::new();
    for cond in conds {
        out = match cond {
            Cond::CreateCoin(puzzle_hash, amount, memos) => {
                let memos = match memos {
                    Some(list) => {
                        let list: Vec<Bytes> = list.iter().cloned().map(Bytes::new).collect();
                        ctx.memos(&list)?
                    }
                    None => Memos::None,
                };
                out.create_coin(*puzzle_hash, *amount, memos)
            }
            Cond::ReserveFee(amount) => out.reserve_fee(*amount),
            Cond::AssertConcurrentSpend(coin_id) => out.assert_concurrent_spend(*coin_id),
            Cond::AssertBeforeSecondsAbsolute(seconds) => {
                out.assert_before_seconds_absolute(*seconds)
            }
        };
    }
    Ok(out)
}

struct Input {
    /// How the TypeScript test gets from `seed` to the key: a list of unhardened indices.
    seed: Vec<u8>,
    path: Vec<u32>,
    coin: Coin,
    conds: Vec<Cond>,
}

fn input_key(seed: &[u8], path: &[u32]) -> SecretKey {
    path.iter()
        .fold(SecretKey::from_seed(seed), |sk, &i| sk.derive_unhardened(i))
        .derive_synthetic()
}

fn bundle_json(bundle: &SpendBundle) -> Value {
    json!({
        "coin_spends": bundle.coin_spends.iter().map(|cs| json!({
            "coin": {
                "parent_coin_info": format!("0x{}", h(cs.coin.parent_coin_info)),
                "puzzle_hash": format!("0x{}", h(cs.coin.puzzle_hash)),
                "amount": cs.coin.amount,
            },
            "puzzle_reveal": format!("0x{}", h(cs.puzzle_reveal.as_ref())),
            "solution": format!("0x{}", h(cs.solution.as_ref())),
        })).collect::<Vec<_>>(),
        "aggregated_signature": format!("0x{}", h(bundle.aggregated_signature.to_bytes())),
    })
}

fn spend_vector(name: &str, inputs: &[Input]) -> Result<Vec<Value>> {
    let mut ctx = SpendContext::new();
    let mut keys = Vec::new();
    for input in inputs {
        let synthetic_sk = input_key(&input.seed, &input.path);
        let conditions = sdk_conditions(&mut ctx, &input.conds)?;
        StandardLayer::new(synthetic_sk.public_key()).spend(&mut ctx, input.coin, conditions)?;
        keys.push(synthetic_sk);
    }
    let coin_spends = ctx.take();

    let networks = [
        ("mainnet", &*MAINNET_CONSTANTS),
        ("testnet11", &*TESTNET11_CONSTANTS),
    ];
    let mut out = Vec::new();
    for (network, constants) in networks {
        let mut allocator = Allocator::new();
        let required = RequiredSignature::from_coin_spends(
            &mut allocator,
            &coin_spends,
            &AggSigConstants::new(constants.agg_sig_me_additional_data),
        )?;
        let mut signature = Signature::default();
        let mut messages = Vec::new();
        for item in required {
            let RequiredSignature::Bls(item) = item else {
                bail!("unexpected non-BLS signature requirement");
            };
            let sk = keys
                .iter()
                .find(|sk| sk.public_key() == item.public_key)
                .ok_or_else(|| anyhow!("no key for required signature"))?;
            messages.push(json!({
                "pk": h(item.public_key.to_bytes()),
                "message": h(item.message()),
            }));
            signature += &sign(sk, item.message());
        }
        let bundle = SpendBundle::new(coin_spends.clone(), signature);

        // The vectors must themselves be valid: mempool validation with this network's
        // constants, and for testnet11 the simulator as well.
        validate_clvm_and_signature(&bundle, 5_500_000_000, constants, MEMPOOL_MODE)
            .map_err(|e| anyhow!("golden bundle {name} rejected on {network}: {:?}", e.1))?;
        if network == "testnet11" {
            let mut simulator = Simulator::new();
            for input in inputs {
                simulator.insert_coin(input.coin);
            }
            simulator.new_transaction(bundle.clone())?;
        }

        out.push(json!({
            "name": name,
            "network": network,
            "agg_sig_me_extra_data": h(constants.agg_sig_me_additional_data),
            "inputs": inputs.iter().zip(&keys).map(|(input, sk)| json!({
                "seed": h(&input.seed),
                "unhardened_path": input.path,
                "synthetic_sk": h(sk.to_bytes()),
                "synthetic_pk": h(sk.public_key().to_bytes()),
                "coin": coin_json(&input.coin),
                "conditions": input.conds.iter().map(Cond::json).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "signed_messages": messages,
            "spend_bundle": bundle_json(&bundle),
        }));
    }
    Ok(out)
}

fn puzzle_hash_of(seed: &[u8], path: &[u32]) -> Bytes32 {
    StandardArgs::curry_tree_hash(input_key(seed, path).public_key()).into()
}

fn spend_vectors() -> Result<Vec<Value>> {
    let seeds = seeds();
    let mut out = Vec::new();

    // 1. One coin: payment with a hint memo, change without memos, a fee.
    let path = vec![12381, 8444, 2, 0];
    let own = puzzle_hash_of(&seeds[0], &path);
    let payee = puzzle_hash_of(&seeds[1], &[12381, 8444, 2, 5]);
    out.extend(spend_vector(
        "single coin: createCoin with memos, change, reserveFee",
        &[Input {
            seed: seeds[0].clone(),
            path,
            coin: Coin::new(Bytes32::new([0x11; 32]), own, 1_000_000),
            conds: vec![
                Cond::CreateCoin(payee, 900_000, Some(vec![payee.to_vec()])),
                Cond::CreateCoin(own, 99_000, None),
                Cond::ReserveFee(1_000),
            ],
        }],
    )?);

    // 2. Two coins under different keys, tied together with assertConcurrentSpend: an envelope
    //    share (unhardened child 3 of the envelope key) and a wallet coin that pays the fee.
    let share_ph = puzzle_hash_of(&seeds[2], &[3]);
    let wallet_path = vec![12381, 8444, 2, 1];
    let wallet_ph = puzzle_hash_of(&seeds[3], &wallet_path);
    let share = Coin::new(Bytes32::new([0x22; 32]), share_ph, 5_000_000_000);
    let wallet = Coin::new(Bytes32::new([0x33; 32]), wallet_ph, (1 << 40) + 129);
    out.extend(spend_vector(
        "two coins, two keys: assertConcurrentSpend, memos, time lock",
        &[
            Input {
                seed: seeds[2].clone(),
                path: vec![3],
                coin: share,
                conds: vec![
                    Cond::CreateCoin(
                        wallet_ph,
                        share.amount,
                        Some(vec![wallet_ph.to_vec(), b"happy birthday".to_vec(), vec![]]),
                    ),
                    Cond::AssertConcurrentSpend(wallet.coin_id()),
                    Cond::AssertBeforeSecondsAbsolute(4_102_444_800),
                ],
            },
            Input {
                seed: seeds[3].clone(),
                path: wallet_path,
                coin: wallet,
                conds: vec![
                    Cond::CreateCoin(wallet_ph, wallet.amount - 50_000, Some(vec![])),
                    Cond::ReserveFee(50_000),
                    Cond::AssertConcurrentSpend(share.coin_id()),
                ],
            },
        ],
    )?);

    // 3. No conditions at all and a zero-amount coin: the smallest possible spend.
    let ph = puzzle_hash_of(&seeds[4], &[]);
    out.extend(spend_vector(
        "zero-amount coin, empty condition list",
        &[Input {
            seed: seeds[4].clone(),
            path: vec![],
            coin: Coin::new(Bytes32::new([0x44; 32]), ph, 0),
            conds: vec![],
        }],
    )?);

    Ok(out)
}

// ---------------------------------------------------------------------------------------------

/// Builds every vector and writes them as pretty JSON to `out`.
pub fn run(out: &Path) -> Result<()> {
    let mod_hash: [u8; 32] = P2_DELEGATED_PUZZLE_OR_HIDDEN_PUZZLE_HASH;
    let vectors = json!({
        "_comment": "Generated by tools/vectors (`cargo run -- generate`) from chia-wallet-sdk 0.33.0. Do not edit.",
        "constants": {
            "mainnet_genesis_challenge": h(MAINNET_CONSTANTS.genesis_challenge),
            "mainnet_agg_sig_me_extra_data": h(MAINNET_CONSTANTS.agg_sig_me_additional_data),
            "testnet11_genesis_challenge": h(TESTNET11_CONSTANTS.genesis_challenge),
            "testnet11_agg_sig_me_extra_data": h(TESTNET11_CONSTANTS.agg_sig_me_additional_data),
            "default_hidden_puzzle_hash": h(DEFAULT_HIDDEN_PUZZLE_HASH),
            "standard_mod_reveal": h(P2_DELEGATED_PUZZLE_OR_HIDDEN_PUZZLE),
            "standard_mod_hash": h(mod_hash),
        },
        "keys": seeds().iter().map(|s| key_vector(s)).collect::<Result<Vec<_>>>()?,
        "coins": coin_vectors(),
        "signatures": signature_vectors()?,
        "clvm": clvm_vectors()?,
        "int_atoms": int_vectors()?,
        "spend_bundles": spend_vectors()?,
    });

    let mut text = serde_json::to_string_pretty(&vectors)?;
    text.push('\n');
    std::fs::write(out, text).with_context(|| format!("cannot write {}", out.display()))?;
    println!("wrote {}", out.display());
    Ok(())
}
