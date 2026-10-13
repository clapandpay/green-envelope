// SPDX-License-Identifier: AGPL-3.0-or-later
//! Golden vectors and spend verifier for `@ge/chia`. See the README next to `Cargo.toml`.

mod generate;
mod mnemonic;
mod verify;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str =
    "usage: ge-vectors generate [out.json] | mnemonic [out.json] | verify [cases.json | -]";

/// `packages/chia/src`, resolved from this crate's location so the commands work from any cwd.
fn chia_src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/chia/src")
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = args.get(1).map(String::as_str);

    let result = match args.first().map(String::as_str) {
        Some("generate") => {
            let out = arg.map_or_else(|| chia_src_dir().join("vectors.json"), PathBuf::from);
            generate::run(&out).map(|()| true)
        }
        Some("mnemonic") => {
            let out = arg.map_or_else(
                || {
                    Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../../packages/wallet/src/mnemonic-vectors.json")
                },
                PathBuf::from,
            );
            mnemonic::run(&out).map(|()| true)
        }
        Some("verify") => {
            let default = chia_src_dir().join("spend-cases.json");
            verify::run(arg.unwrap_or_else(|| default.to_str().unwrap_or_default()))
        }
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };

    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}
