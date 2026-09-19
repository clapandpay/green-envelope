// SPDX-License-Identifier: AGPL-3.0-or-later
// Trimmed live responses from https://testnet11.api.coinset.org, recorded 2026-09-19.
// Field names and nesting are as observed. The bodies were cut for size: most `peak` fields and
// all but two coin records are dropped, and the closing `"success": true` (and `sync`) follow the
// full node's documented shape because the capture was truncated before the end of the body.

/** `POST /get_blockchain_state {}` (peak trimmed to the fields a client could care about). */
export const BLOCKCHAIN_STATE = `{"blockchain_state": {"average_block_time": 18, "block_max_cost": 11000000000, "difficulty": 61952, "genesis_challenge_initialized": true, "mempool_size": 1537, "peak": {"header_hash": "0x075ec89258314694033cc0b831f19da497a91b0a24c9d460b6d948af993f942f", "height": 4708587, "prev_hash": "0xa32a4261f489654e8ffe529949885c2343f5f0c50c9fde3b67a45588a0ce935b", "reward_claims_incorporated": [{"amount": 1750000000000, "parent_coin_info": "0x37a90eb5185a9c4439a91ddc98bbadce0000000000000000000000000047d8ea", "puzzle_hash": "0x772297e82b1f77724a1fba3810b344f7c07a8987cd02eb0be376fe10aa8520d4"}]}, "sync": {"sync_mode": false, "synced": true}}, "success": true}`;

/** `POST /get_coin_records_by_puzzle_hashes` for the all-zero puzzle hash (first two records). */
export const COIN_RECORDS = `{"coin_records": [{"coin":{"parent_coin_info":"0x0edfcfe8209e81afe4c7bddafb58f5e12e981b2690c5e621588fa2a986d6afa2","puzzle_hash":"0x0000000000000000000000000000000000000000000000000000000000000000","amount":0},"coinbase":false,"confirmed_block_index":492429,"spent":false,"spent_block_index":0,"timestamp":1710509237},{"coin":{"parent_coin_info":"0x695972792098364e738dc207c38a5ca5527ea3b2d2564f217bc4814f37fb4470","puzzle_hash":"0x0000000000000000000000000000000000000000000000000000000000000000","amount":0},"coinbase":false,"confirmed_block_index":513302,"spent":false,"spent_block_index":0,"timestamp":1710899635}], "success": true}`;
