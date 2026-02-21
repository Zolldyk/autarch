import slip10 from 'micro-key-producer/slip10.js';
import { createKeyPairFromPrivateKeyBytes } from '@solana/kit';
import { DERIVATION_PURPOSE, SOLANA_BIP44_COIN_TYPE, DEFAULT_CHANGE } from './constants.js';

/**
 * Derive a Solana Ed25519 keypair from a master seed using SLIP-0010 / BIP44.
 *
 * Path: m/44'/501'/{agentId}'/0'
 * All segments are hardened (Ed25519 requirement).
 */
export async function deriveKeypair(seed: Uint8Array, agentId: number): Promise<CryptoKeyPair> {
  if (!Number.isInteger(agentId) || agentId < 0) {
    throw new Error(`Invalid agentId: ${String(agentId)}. agentId must be a non-negative integer.`);
  }

  const hdkey = slip10.fromMasterSeed(seed);
  const path = `m/${String(DERIVATION_PURPOSE)}'/${String(SOLANA_BIP44_COIN_TYPE)}'/${String(agentId)}'/${String(DEFAULT_CHANGE)}'`;
  const derived = hdkey.derive(path);

  if (!derived.privateKey) {
    throw new Error(`Key derivation failed for path ${path}: no private key produced`);
  }

  return createKeyPairFromPrivateKeyBytes(derived.privateKey);
}
