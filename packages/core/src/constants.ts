// FOR DEMO ONLY — DO NOT USE WITH REAL FUNDS
// This is a publicly known seed (BIP39 test vector #1) used exclusively for development and demonstration.
// Mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
export const DEMO_SEED =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';

export const SOLANA_BIP44_COIN_TYPE = 501;
export const DERIVATION_PURPOSE = 44;
export const DEFAULT_CHANGE = 0;

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';

/** Treasury wallet is always agentId 0 — BIP44 path m/44'/501'/0'/0'. */
export const TREASURY_AGENT_ID = 0;

/** Default airdrop amount: 1 SOL = 1_000_000_000 lamports. */
export const DEFAULT_AIRDROP_LAMPORTS = 1_000_000_000n;
