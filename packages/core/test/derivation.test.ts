import { describe, it, expect } from 'vitest';
import { deriveKeypair } from '../src/derivation.js';
import { DEMO_SEED } from '../src/constants.js';
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey } from '@solana/kit';
import slip10 from 'micro-key-producer/slip10.js';

// Use DEMO_SEED as test seed (64-byte known vector)
function getDemoSeedBytes(): Uint8Array {
  const bytes = new Uint8Array(DEMO_SEED.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(DEMO_SEED.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

describe('deriveKeypair', () => {
  const seed = getDemoSeedBytes();

  // AC #5: Returns CryptoKeyPair with publicKey and privateKey
  it('returns a CryptoKeyPair with publicKey and privateKey CryptoKey objects', async () => {
    const keypair = await deriveKeypair(seed, 0);
    expect(keypair).toHaveProperty('publicKey');
    expect(keypair).toHaveProperty('privateKey');
    expect(keypair.publicKey).toBeInstanceOf(CryptoKey);
    expect(keypair.privateKey).toBeInstanceOf(CryptoKey);
  });

  // AC #6: Deterministic — same seed + same agentId → identical keys
  it('produces identical public keys for same seed + same agentId', async () => {
    const keypair1 = await deriveKeypair(seed, 0);
    const keypair2 = await deriveKeypair(seed, 0);
    const addr1 = await getAddressFromPublicKey(keypair1.publicKey);
    const addr2 = await getAddressFromPublicKey(keypair2.publicKey);
    expect(addr1).toBe(addr2);
  });

  // AC #7: Independent — same seed + different agentId → different keys
  it('produces different public keys for same seed + different agentId', async () => {
    const keypair0 = await deriveKeypair(seed, 0);
    const keypair1 = await deriveKeypair(seed, 1);
    const addr0 = await getAddressFromPublicKey(keypair0.publicKey);
    const addr1 = await getAddressFromPublicKey(keypair1.publicKey);
    expect(addr0).not.toBe(addr1);
  });

  // Path verification: agentId 0 → treasury path m/44'/501'/0'/0'
  it('agentId 0 produces a valid treasury keypair', async () => {
    const keypair = await deriveKeypair(seed, 0);
    const addr = await getAddressFromPublicKey(keypair.publicKey);
    // Solana addresses are base58, 32-44 chars
    expect(addr.length).toBeGreaterThanOrEqual(32);
    expect(addr.length).toBeLessThanOrEqual(44);
  });

  it("uses BIP44 path m/44'/501'/{agentId}'/0' for derivation", async () => {
    const agentId = 3;

    const derivedByFunction = await deriveKeypair(seed, agentId);
    const derivedByExplicitPath = slip10
      .fromMasterSeed(seed)
      .derive(`m/44'/501'/${String(agentId)}'/0'`);
    const expectedKeypair = await createKeyPairFromPrivateKeyBytes(derivedByExplicitPath.privateKey);

    const actualAddress = await getAddressFromPublicKey(derivedByFunction.publicKey);
    const expectedAddress = await getAddressFromPublicKey(expectedKeypair.publicKey);

    expect(actualAddress).toBe(expectedAddress);
  });

  // Address derivation: derived keypair produces valid base58 Solana address
  it('derived keypair produces a valid base58 Solana address', async () => {
    const keypair = await deriveKeypair(seed, 5);
    const addr = await getAddressFromPublicKey(keypair.publicKey);
    // Base58 chars: 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, O, I, l)
    expect(addr).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('throws for negative, non-integer, and non-finite agentId values', async () => {
    await expect(deriveKeypair(seed, -1)).rejects.toThrow('agentId must be a non-negative integer');
    await expect(deriveKeypair(seed, 1.5)).rejects.toThrow('agentId must be a non-negative integer');
    await expect(deriveKeypair(seed, Number.NaN)).rejects.toThrow('agentId must be a non-negative integer');
  });
});
