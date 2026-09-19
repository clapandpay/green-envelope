// SPDX-License-Identifier: AGPL-3.0-or-later
//! `verify`: runs spend bundles built elsewhere (the TypeScript code) through the reference
//! implementation and compares the outcome with what each case expects.
//!
//! What is checked, per case, in this order:
//!
//! 1. **Mempool validation against the requested network.** `chia-consensus`'
//!    `validate_clvm_and_signature` (the function a full node's mempool calls) runs every puzzle
//!    in the CLVM interpreter in `MEMPOOL_MODE`, checks puzzle hashes, parses and validates the
//!    conditions (minting, reserve fee, concurrent-spend assertions, ...) and verifies the
//!    aggregated signature. It is given the consensus constants of the network the case names,
//!    so `AGG_SIG_ME` is checked with that network's extra data (the genesis challenge).
//! 2. **Coin set.** Every spent coin must be one of the case's declared coins or be created by
//!    another spend in the same bundle.
//! 3. **The SDK `Simulator`, testnet11 cases only.** The simulator hardcodes
//!    `TESTNET11_CONSTANTS`, so it would reject every correctly signed mainnet bundle with
//!    `BadAggregateSignature`. For testnet11 the declared coins are inserted and the bundle is
//!    submitted with `Simulator::new_transaction`, which repeats CLVM and signature validation
//!    and adds the coin-set rules (unknown coin, double spend, time locks). For mainnet, steps 1
//!    and 2 are the whole check; step 1 is the same code path the simulator uses internally,
//!    only with mainnet constants.

use std::collections::HashSet;
use std::io::Read;

use anyhow::{Context, Result, bail};
use chia_wallet_sdk::chia::bls::Signature;
use chia_wallet_sdk::chia::consensus::consensus_constants::ConsensusConstants;
use chia_wallet_sdk::chia::consensus::flags::MEMPOOL_MODE;
use chia_wallet_sdk::chia::consensus::spendbundle_validation::validate_clvm_and_signature;
use chia_wallet_sdk::chia::protocol::{Bytes32, Coin, CoinSpend, Program, SpendBundle};
use chia_wallet_sdk::test::Simulator;
use chia_wallet_sdk::types::{MAINNET_CONSTANTS, TESTNET11_CONSTANTS};
use serde::Deserialize;

/// Half a block, the limit the mempool and the SDK simulator apply to one spend bundle.
const MAX_BUNDLE_COST: u64 = 11_000_000_000 / 2;

#[derive(Deserialize)]
#[serde(untagged)]
enum CaseFile {
    Many(Vec<Case>),
    One(Box<Case>),
}

#[derive(Deserialize)]
struct Case {
    #[serde(default)]
    name: Option<String>,
    network: Network,
    coins: Vec<CoinJson>,
    spend_bundle: SpendBundleJson,
    expect: String,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Network {
    Mainnet,
    Testnet11,
}

#[derive(Deserialize)]
struct CoinJson {
    parent_coin_info: String,
    puzzle_hash: String,
    amount: Amount,
}

/// `push_tx` carries amounts as JSON numbers; decimal strings are accepted too.
#[derive(Deserialize)]
#[serde(untagged)]
enum Amount {
    Number(u64),
    Text(String),
}

#[derive(Deserialize)]
struct CoinSpendJson {
    coin: CoinJson,
    puzzle_reveal: String,
    solution: String,
}

#[derive(Deserialize)]
struct SpendBundleJson {
    coin_spends: Vec<CoinSpendJson>,
    aggregated_signature: String,
}

fn unhex(text: &str) -> Result<Vec<u8>> {
    let digits = text.strip_prefix("0x").unwrap_or(text);
    hex::decode(digits).with_context(|| format!("bad hex: {text}"))
}

fn bytes32(text: &str) -> Result<Bytes32> {
    let bytes = unhex(text)?;
    let array: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("expected 32 bytes: {text}"))?;
    Ok(Bytes32::new(array))
}

impl CoinJson {
    fn parse(&self) -> Result<Coin> {
        let amount = match &self.amount {
            Amount::Number(n) => *n,
            Amount::Text(s) => s.parse().with_context(|| format!("bad amount: {s}"))?,
        };
        Ok(Coin::new(
            bytes32(&self.parent_coin_info)?,
            bytes32(&self.puzzle_hash)?,
            amount,
        ))
    }
}

impl SpendBundleJson {
    fn parse(&self) -> Result<SpendBundle> {
        let coin_spends = self
            .coin_spends
            .iter()
            .map(|cs| {
                Ok(CoinSpend::new(
                    cs.coin.parse()?,
                    Program::from(unhex(&cs.puzzle_reveal)?),
                    Program::from(unhex(&cs.solution)?),
                ))
            })
            .collect::<Result<Vec<_>>>()?;
        let signature: [u8; 96] = unhex(&self.aggregated_signature)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("aggregated_signature must be 96 bytes"))?;
        let signature = Signature::from_bytes(&signature)
            .map_err(|e| anyhow::anyhow!("aggregated_signature is not a valid G2 point: {e}"))?;
        Ok(SpendBundle::new(coin_spends, signature))
    }
}

fn constants(network: Network) -> &'static ConsensusConstants {
    match network {
        Network::Mainnet => &MAINNET_CONSTANTS,
        Network::Testnet11 => &TESTNET11_CONSTANTS,
    }
}

/// Returns `Ok(())` when the reference implementation accepts the bundle, else its error text.
fn validate(case: &Case) -> Result<std::result::Result<(), String>> {
    let coins = case
        .coins
        .iter()
        .map(CoinJson::parse)
        .collect::<Result<Vec<_>>>()?;
    let bundle = case.spend_bundle.parse()?;

    if bundle.coin_spends.is_empty() {
        return Ok(Err("InvalidSpendBundle (no coin spends)".to_string()));
    }

    // 1. CLVM, conditions and signature, with the requested network's AGG_SIG_ME extra data.
    let conditions = match validate_clvm_and_signature(
        &bundle,
        MAX_BUNDLE_COST,
        constants(case.network),
        MEMPOOL_MODE,
    ) {
        Ok((conditions, _pairings)) => conditions,
        Err(error) => return Ok(Err(format!("{:?}", error.1))),
    };

    // 2. Every spent coin exists: declared by the case, or created inside this bundle.
    let mut known: HashSet<Bytes32> = coins.iter().map(Coin::coin_id).collect();
    for spend in &conditions.spends {
        for (puzzle_hash, amount, _hint) in &spend.create_coin {
            known.insert(Coin::new(spend.coin_id, *puzzle_hash, *amount).coin_id());
        }
    }
    for coin_spend in &bundle.coin_spends {
        if !known.contains(&coin_spend.coin.coin_id()) {
            return Ok(Err("UnknownUnspent".to_string()));
        }
    }

    // 3. The SDK simulator (its constants are fixed to testnet11).
    if case.network == Network::Testnet11 {
        let mut simulator = Simulator::new();
        for coin in coins {
            simulator.insert_coin(coin);
        }
        if let Err(error) = simulator.new_transaction(bundle) {
            return Ok(Err(error.to_string()));
        }
    }

    Ok(Ok(()))
}

fn read_input(path: &str) -> Result<String> {
    if path == "-" {
        let mut text = String::new();
        std::io::stdin().read_to_string(&mut text)?;
        return Ok(text);
    }
    std::fs::read_to_string(path).with_context(|| {
        format!("cannot read {path} (the default case file is written by `pnpm test`)")
    })
}

/// Runs every case; returns whether all of them matched their expectation.
pub fn run(path: &str) -> Result<bool> {
    let cases = match serde_json::from_str(&read_input(path)?).context("bad case file")? {
        CaseFile::Many(cases) => cases,
        CaseFile::One(case) => vec![*case],
    };
    if cases.is_empty() {
        bail!("no cases in {path}");
    }

    let mut failures = 0usize;
    for (index, case) in cases.iter().enumerate() {
        let name = case.name.clone().unwrap_or_else(|| format!("#{index}"));
        let network = match case.network {
            Network::Mainnet => "mainnet",
            Network::Testnet11 => "testnet11",
        };
        let outcome = validate(case).with_context(|| format!("case {name}"))?;
        let (pass, detail) = match (&outcome, case.expect.as_str()) {
            (Ok(()), "ok") => (true, "accepted".to_string()),
            (Ok(()), expected) => (false, format!("accepted, expected error `{expected}`")),
            (Err(error), "ok") => (false, format!("rejected: {error}")),
            (Err(error), expected) if error.contains(expected) => {
                (true, format!("rejected as expected: {error}"))
            }
            (Err(error), expected) => (
                false,
                format!("rejected with `{error}`, expected `{expected}`"),
            ),
        };
        if !pass {
            failures += 1;
        }
        let verdict = if pass { "PASS" } else { "FAIL" };
        println!("{verdict}  [{network}] {name}: {detail}");
    }

    println!(
        "{} cases, {} passed, {failures} failed",
        cases.len(),
        cases.len() - failures
    );
    Ok(failures == 0)
}
