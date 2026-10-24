// SPDX-License-Identifier: AGPL-3.0-or-later
//! `vault`: reference data for the passkey vault (`@ge/vault`).
//!
//! The wallet is a CHIP-0043 vault: a singleton whose custody is a `PasskeyMember` (the passkey's
//! own P-256 key, checked on-chain with `secp256r1_verify`), and money coins locked to a
//! `SingletonMember` of that vault. Every puzzle, hash and bundle here comes from chia-puzzles and
//! the chia-wallet-sdk drivers (`Launcher::mint_vault`, `Vault::spend`, `MipsSpend`); the
//! TypeScript builders have to reproduce the bundles byte for byte. Only the WebAuthn assertion
//! is simulated: a software P-256 key signs `sha256(authenticatorData || sha256(clientDataJSON))`,
//! which is exactly what a passkey signs.

use std::path::Path;

use anyhow::{Context, Result};
use chia_wallet_sdk::chia::bls::{SecretKey, Signature, master_to_wallet_unhardened, sign};
use chia_wallet_sdk::chia::puzzle_types::DeriveSynthetic;
use chia_wallet_sdk::chia::puzzle_types::standard::StandardArgs;
use chia_wallet_sdk::chia::secp::{R1PublicKey, R1SecretKey};
use chia_wallet_sdk::chia::sha2::Sha256;
use chia_wallet_sdk::driver::{
    InnerPuzzleMemo, InnerPuzzleSpend, MemberMemo, MemoKind, MipsMemo, MipsSpend, Vault,
    mips_puzzle_hash,
};
use chia_wallet_sdk::prelude::*;
use chia_wallet_sdk::puzzles::{
    DELEGATED_PUZZLE_FEEDER, DELEGATED_PUZZLE_FEEDER_HASH, PASSKEY_MEMBER, PASSKEY_MEMBER_HASH,
    SINGLETON_LAUNCHER, SINGLETON_LAUNCHER_HASH, SINGLETON_MEMBER, SINGLETON_MEMBER_HASH,
    SINGLETON_TOP_LAYER_V1_1, SINGLETON_TOP_LAYER_V1_1_HASH,
};
use chia_wallet_sdk::types::puzzles::{
    INDEX_WRAPPER, INDEX_WRAPPER_HASH, PasskeyMember, PasskeyMemberSolution, SingletonMember,
    SingletonMemberSolution,
};
use chia_wallet_sdk::types::{MessageFlags, MessageSide, Mod};
use serde_json::{Value, json};

/// Prefix of the hint every vault coin carries: `sha256(HINT_TAG || public key)`.
/// `HINT_TAG` in `packages/vault/src/vault.ts`.
const HINT_TAG: &[u8] = b"clapandpay:vault:v1";
/// The relying party the simulated passkey belongs to.
const RP_ID: &str = "clapandpay.com";
const ORIGIN: &str = "https://envelope.clapandpay.com";

fn h(bytes: impl AsRef<[u8]>) -> String {
    hex::encode(bytes)
}

fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize()
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        let chars = chunk.len() + 1;
        for i in 0..chars {
            let index = (n >> (18 - 6 * i)) & 63;
            out.push(char::from(ALPHABET[index as usize]));
        }
    }
    out
}

fn hint(pk: &R1PublicKey) -> Bytes32 {
    Bytes32::new(sha256(&[HINT_TAG, &pk.to_bytes()]))
}

fn custody_hash(pk: R1PublicKey) -> TreeHash {
    mips_puzzle_hash(
        0,
        Vec::new(),
        PasskeyMember::new(pk).curry_tree_hash(),
        true,
    )
}

fn p2_hash(launcher_id: Bytes32) -> TreeHash {
    mips_puzzle_hash(
        0,
        Vec::new(),
        SingletonMember::new(launcher_id).curry_tree_hash(),
        true,
    )
}

/// What a passkey returns for one `get()`, with `challenge` as the raw 32-byte challenge.
struct Assertion {
    authenticator_data: Vec<u8>,
    client_data_json: Vec<u8>,
    challenge_index: usize,
    signature: [u8; 64],
}

fn assert_passkey(sk: &R1SecretKey, challenge: [u8; 32]) -> Result<Assertion> {
    // rpIdHash, flags = user present | user verified, sign count 0.
    let mut authenticator_data = sha256(&[RP_ID.as_bytes()]).to_vec();
    authenticator_data.extend_from_slice(&[0x05, 0, 0, 0, 0]);
    let prefix = r#"{"type":"webauthn.get","#;
    let client_data_json = format!(
        r#"{prefix}"challenge":"{}","origin":"{ORIGIN}","crossOrigin":false}}"#,
        base64url(&challenge)
    )
    .into_bytes();
    let message = sha256(&[&authenticator_data, &sha256(&[&client_data_json])]);
    let signature = sk.sign_prehashed(&message)?.to_bytes();
    Ok(Assertion {
        authenticator_data,
        client_data_json,
        challenge_index: prefix.len(),
        signature,
    })
}

fn assertion_json(a: &Assertion) -> Value {
    json!({
        "authenticator_data": h(&a.authenticator_data),
        "client_data_json": String::from_utf8_lossy(&a.client_data_json),
        "challenge_index": a.challenge_index,
        "signature": h(a.signature),
    })
}

fn passkey_spend(
    ctx: &mut SpendContext,
    pk: R1PublicKey,
    assertion: &Assertion,
    coin_id: Bytes32,
) -> Result<Spend> {
    let puzzle = ctx.curry(PasskeyMember::new(pk))?;
    let solution = ctx.alloc(&PasskeyMemberSolution {
        authenticator_data: assertion.authenticator_data.clone().into(),
        client_data_json: assertion.client_data_json.clone().into(),
        challenge_index: assertion.challenge_index,
        signature: chia_wallet_sdk::chia::secp::R1Signature::from_bytes(&assertion.signature)?,
        coin_id,
    })?;
    Ok(Spend::new(puzzle, solution))
}

fn launcher_memo(ctx: &mut SpendContext, pk: R1PublicKey) -> Result<NodePtr> {
    let member = MemberMemo::passkey(ctx, pk, false, true)?;
    let memo = MipsMemo::new(InnerPuzzleMemo::new(
        0,
        Vec::new(),
        MemoKind::Member(member),
    ));
    Ok(ctx.alloc(&memo)?)
}

fn hinted(ctx: &mut SpendContext, hint: Bytes32) -> Result<Memos<NodePtr>> {
    Ok(Memos::Some(ctx.alloc(&[hint])?))
}

fn bundle_json(coin_spends: &[CoinSpend], signature: &Signature) -> Value {
    json!({
        "coin_spends": coin_spends.iter().map(|cs| json!({
            "coin": coin_json(&cs.coin),
            "puzzle_reveal": h(cs.puzzle_reveal.as_ref()),
            "solution": h(cs.solution.as_ref()),
        })).collect::<Vec<_>>(),
        "aggregated_signature": h(signature.to_bytes()),
    })
}

fn coin_json(coin: &Coin) -> Value {
    json!({
        "parent_coin_info": h(coin.parent_coin_info),
        "puzzle_hash": h(coin.puzzle_hash),
        "amount": coin.amount,
    })
}

fn puzzle(reveal: &[u8], hash: impl AsRef<[u8]>) -> Value {
    json!({ "hex": h(reveal), "hash": h(hash) })
}

/// The fixed cast: a passkey, a funder with a standard coin (an envelope share, for example).
struct Cast {
    passkey: R1SecretKey,
    funder_sk: SecretKey,
    funder_coin: Coin,
}

fn cast() -> Result<Cast> {
    let passkey = R1SecretKey::from_bytes(&[0x11; 32])?;
    let master = SecretKey::from_seed(&[3u8; 32]);
    let funder_sk = master_to_wallet_unhardened(&master, 0).derive_synthetic();
    let funder_ph: Bytes32 = StandardArgs::curry_tree_hash(funder_sk.public_key()).into();
    let funder_coin = Coin::new(Bytes32::new([7; 32]), funder_ph, 1_000_000_000);
    Ok(Cast {
        passkey,
        funder_sk,
        funder_coin,
    })
}

const FEE: u64 = 1_000_000;

/// Launch from a standard coin: the coin makes the launcher (hinted, CHIP-0043 memo) and pays
/// the rest, minus the fee, to the vault's money address. No passkey signature is needed.
fn launch_from_standard(c: &Cast) -> Result<(Value, Vault, Coin)> {
    let ctx = &mut SpendContext::new();
    let pk = c.passkey.public_key();
    let memos = hinted(ctx, hint(&pk))?;
    let launcher = Launcher::with_memos(c.funder_coin.coin_id(), 1, memos);
    let launcher_id = launcher.coin().coin_id();
    let memo = launcher_memo(ctx, pk)?;
    let (mint, vault) = launcher.mint_vault(ctx, custody_hash(pk), memo)?;
    let p2: Bytes32 = p2_hash(launcher_id).into();
    let change = c.funder_coin.amount - 1 - FEE;
    let p2_memos = hinted(ctx, p2)?;
    let conditions = mint.create_coin(p2, change, p2_memos).reserve_fee(FEE);
    StandardLayer::new(c.funder_sk.public_key()).spend(ctx, c.funder_coin, conditions)?;
    let coin_spends = ctx.take();

    let mut signatures = Vec::new();
    for cs in &coin_spends {
        if cs.coin == c.funder_coin {
            let mut allocator = Allocator::new();
            let required = RequiredSignature::from_coin_spend(
                &mut allocator,
                cs,
                &AggSigConstants::new(TESTNET11_CONSTANTS.agg_sig_me_additional_data),
            )?;
            for r in required {
                if let RequiredSignature::Bls(bls) = r {
                    signatures.push(sign(&c.funder_sk, bls.message()));
                }
            }
        }
    }
    let signature = signatures
        .iter()
        .fold(Signature::default(), |acc, s| &acc + s);

    let money = Coin::new(c.funder_coin.coin_id(), p2, change);
    let case = json!({
        "name": "vault: launch from a standard coin",
        "network": "testnet11",
        "coins": [coin_json(&c.funder_coin)],
        "spend_bundle": bundle_json(&coin_spends, &signature),
        "expect": "ok",
        "fee": FEE,
        "launcher_id": h(launcher_id),
        "vault_coin": coin_json(&vault.coin),
        "money_coin": coin_json(&money),
    });
    Ok((case, vault, money))
}

/// Launch from the setup address: a coin locked to the passkey alone (the custody puzzle as a
/// plain coin) makes the launcher and pays the rest to the money address, signed by one prompt.
fn launch_from_setup(c: &Cast) -> Result<Value> {
    let ctx = &mut SpendContext::new();
    let pk = c.passkey.public_key();
    let setup: Bytes32 = custody_hash(pk).into();
    let setup_coin = Coin::new(Bytes32::new([8; 32]), setup, 50_000_000);
    let memos = hinted(ctx, hint(&pk))?;
    let launcher = Launcher::with_memos(setup_coin.coin_id(), 1, memos);
    let launcher_id = launcher.coin().coin_id();
    let memo = launcher_memo(ctx, pk)?;
    let (mint, _vault) = launcher.mint_vault(ctx, custody_hash(pk), memo)?;
    let p2: Bytes32 = p2_hash(launcher_id).into();
    let change = setup_coin.amount - 1 - FEE;
    let p2_memos = hinted(ctx, p2)?;
    let conditions = mint.create_coin(p2, change, p2_memos).reserve_fee(FEE);

    let delegated = ctx.delegated_spend(conditions)?;
    let challenge = sha256(&[
        &ctx.tree_hash(delegated.puzzle).to_bytes(),
        &setup_coin.coin_id(),
    ]);
    let assertion = assert_passkey(&c.passkey, challenge)?;
    let mut mips = MipsSpend::new(delegated);
    let member = passkey_spend(ctx, pk, &assertion, setup_coin.coin_id())?;
    mips.members.insert(
        custody_hash(pk),
        InnerPuzzleSpend::new(0, Vec::new(), member),
    );
    let spend = mips.spend(ctx, custody_hash(pk))?;
    ctx.spend(setup_coin, spend)?;
    let coin_spends = ctx.take();

    Ok(json!({
        "name": "vault: launch from the setup address (one passkey prompt)",
        "network": "testnet11",
        "coins": [coin_json(&setup_coin)],
        "spend_bundle": bundle_json(&coin_spends, &Signature::default()),
        "expect": "ok",
        "fee": FEE,
        "launcher_id": h(launcher_id),
        "challenge": h(challenge),
        "assertion": assertion_json(&assertion),
    }))
}

/// One prompt spends the vault and two money coins: a payment, change back to the money address,
/// and the fee; the vault recreates itself (hinted) and sends one message per money coin.
fn vault_spend(c: &Cast, vault: &Vault, first: Coin) -> Result<Value> {
    let ctx = &mut SpendContext::new();
    let pk = c.passkey.public_key();
    let launcher_id = vault.info.launcher_id;
    let p2: Bytes32 = p2_hash(launcher_id).into();
    let second = Coin::new(Bytes32::new([9; 32]), p2, 300_000_000);
    let destination = Bytes32::new([0xd0; 32]);
    let pay = 500_000_000;
    let change = first.amount + second.amount - pay - FEE;

    let mode = MessageFlags::PUZZLE.encode(MessageSide::Sender)
        | MessageFlags::COIN.encode(MessageSide::Receiver);
    let mut vault_conditions = Conditions::new();
    let custody: Bytes32 = custody_hash(pk).into();

    // Money coins, in order: the first carries every output, the others carry nothing.
    let dest_memos = hinted(ctx, destination)?;
    let change_memos = hinted(ctx, p2)?;
    let plans = [
        (
            first,
            Conditions::new()
                .create_coin(destination, pay, dest_memos)
                .create_coin(p2, change, change_memos)
                .reserve_fee(FEE),
        ),
        (second, Conditions::new()),
    ];
    for (coin, conditions) in plans {
        let delegated = ctx.delegated_spend(conditions)?;
        let coin_id = ctx.alloc(&coin.coin_id())?;
        vault_conditions = vault_conditions.send_message(
            mode,
            ctx.tree_hash(delegated.puzzle).to_vec().into(),
            vec![coin_id],
        );
        let mut mips = MipsSpend::new(delegated);
        let puzzle = ctx.curry(SingletonMember::new(launcher_id))?;
        let solution = ctx.alloc(&SingletonMemberSolution::new(custody, 1))?;
        mips.members.insert(
            p2_hash(launcher_id),
            InnerPuzzleSpend::new(0, Vec::new(), Spend::new(puzzle, solution)),
        );
        let spend = mips.spend(ctx, p2_hash(launcher_id))?;
        ctx.spend(coin, spend)?;
    }

    let vault_memos = hinted(ctx, hint(&pk))?;
    let delegated = ctx.delegated_spend(vault_conditions.create_coin(custody, 1, vault_memos))?;
    let challenge = sha256(&[
        &ctx.tree_hash(delegated.puzzle).to_bytes(),
        &vault.coin.coin_id(),
    ]);
    let assertion = assert_passkey(&c.passkey, challenge)?;
    let mut mips = MipsSpend::new(delegated);
    let member = passkey_spend(ctx, pk, &assertion, vault.coin.coin_id())?;
    mips.members.insert(
        custody_hash(pk),
        InnerPuzzleSpend::new(0, Vec::new(), member),
    );
    vault.spend(ctx, &mips)?;
    let coin_spends = ctx.take();

    Ok(json!({
        "name": "vault: one prompt spends the vault and two money coins",
        "network": "testnet11",
        "coins": [coin_json(&vault.coin), coin_json(&first), coin_json(&second)],
        "spend_bundle": bundle_json(&coin_spends, &Signature::default()),
        "expect": "ok",
        "fee": FEE,
        "launcher_id": h(launcher_id),
        "vault_coin": coin_json(&vault.coin),
        "lineage": { "parent_parent_coin_info": h(c.funder_coin.coin_id()), "parent_amount": 1 },
        "destination": h(destination),
        "pay": pay,
        "challenge": h(challenge),
        "assertion": assertion_json(&assertion),
    }))
}

fn hashes(pk: R1PublicKey, launcher_id: Bytes32) -> Value {
    let custody = custody_hash(pk);
    json!({
        "public_key": h(pk.to_bytes()),
        "hint": h(hint(&pk)),
        "passkey_member_hash": h(PasskeyMember::new(pk).curry_tree_hash()),
        "custody_hash": h(custody),
        "launcher_id": h(launcher_id),
        "singleton_member_hash": h(SingletonMember::new(launcher_id).curry_tree_hash()),
        "p2_puzzle_hash": h(p2_hash(launcher_id)),
        "vault_puzzle_hash": h(chia_wallet_sdk::chia::puzzle_types::singleton::SingletonArgs::curry_tree_hash(launcher_id, custody)),
    })
}

/// Builds the vault vectors and writes them as pretty JSON to `out`.
pub fn run(out: &Path) -> Result<()> {
    let c = cast()?;
    let (launch, vault, money) = launch_from_standard(&c)?;
    let setup = launch_from_setup(&c)?;
    let spend = vault_spend(&c, &vault, money)?;

    let other = R1SecretKey::from_bytes(&[0x22; 32])?.public_key();
    let vectors = json!({
        "puzzles": {
            "singleton_top_layer_v1_1": puzzle(&SINGLETON_TOP_LAYER_V1_1, SINGLETON_TOP_LAYER_V1_1_HASH),
            "singleton_launcher": puzzle(&SINGLETON_LAUNCHER, SINGLETON_LAUNCHER_HASH),
            "index_wrapper": puzzle(&INDEX_WRAPPER, INDEX_WRAPPER_HASH),
            "delegated_puzzle_feeder": puzzle(&DELEGATED_PUZZLE_FEEDER, DELEGATED_PUZZLE_FEEDER_HASH),
            "passkey_member": puzzle(&PASSKEY_MEMBER, PASSKEY_MEMBER_HASH),
            "singleton_member": puzzle(&SINGLETON_MEMBER, SINGLETON_MEMBER_HASH),
        },
        "hint_tag": String::from_utf8_lossy(HINT_TAG),
        "hashes": [
            hashes(c.passkey.public_key(), vault.info.launcher_id),
            hashes(other, Bytes32::new([0x42; 32])),
        ],
        "passkey": {
            "secret_key": h([0x11; 32]),
            "public_key": h(c.passkey.public_key().to_bytes()),
        },
        "funder": {
            "synthetic_secret_key": h(c.funder_sk.to_bytes()),
            "coin": coin_json(&c.funder_coin),
        },
        "cases": [launch, setup, spend],
    });
    let mut text = serde_json::to_string_pretty(&vectors)?;
    text.push('\n');
    std::fs::write(out, text).with_context(|| format!("cannot write {}", out.display()))?;
    Ok(())
}
