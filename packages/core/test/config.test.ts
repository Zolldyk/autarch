import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSeed } from '../src/config.js';
import { DEMO_SEED } from '../src/constants.js';

let originalEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  originalEnv = { ...process.env };
});
afterEach(() => {
  process.env = originalEnv;
});

describe('loadSeed', () => {
  // AC #1: Valid BIP39 mnemonic → seed buffer (64 bytes)
  it('converts a valid BIP39 mnemonic to a 64-byte seed buffer', () => {
    process.env.MASTER_SEED =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed = loadSeed();
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
  });

  // AC #2: Valid hex seed → seed buffer
  it('converts a valid 128-char hex string to a 64-byte seed buffer', () => {
    process.env.MASTER_SEED = DEMO_SEED;
    const seed = loadSeed();
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
  });

  it('converts a valid 64-char hex string to a 32-byte seed buffer', () => {
    process.env.MASTER_SEED = 'a'.repeat(64);
    const seed = loadSeed();
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(32);
  });

  it('produces identical seed bytes for equivalent mnemonic and hex values', () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    process.env.MASTER_SEED = mnemonic;
    const mnemonicSeed = loadSeed();

    process.env.MASTER_SEED = DEMO_SEED;
    const hexSeed = loadSeed();

    expect(hexSeed).toEqual(mnemonicSeed);
  });

  // AC #3: DEMO_MODE=true, no MASTER_SEED → uses demo seed without error
  it('uses DEMO_SEED when DEMO_MODE=true and no MASTER_SEED', () => {
    delete process.env.MASTER_SEED;
    process.env.DEMO_MODE = 'true';
    const seed = loadSeed();
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
    // Verify it matches DEMO_SEED bytes
    const expected = new Uint8Array(DEMO_SEED.length / 2);
    for (let i = 0; i < expected.length; i++) {
      expected[i] = parseInt(DEMO_SEED.substring(i * 2, i * 2 + 2), 16);
    }
    expect(seed).toEqual(expected);
  });

  // AC #4: Missing seed without DEMO_MODE → throws
  it('throws with descriptive error when MASTER_SEED missing and DEMO_MODE not set', () => {
    delete process.env.MASTER_SEED;
    delete process.env.DEMO_MODE;
    expect(() => loadSeed()).toThrow('MASTER_SEED environment variable is required');
  });

  it('error message includes what happened, why, and how to fix', () => {
    delete process.env.MASTER_SEED;
    delete process.env.DEMO_MODE;
    expect(() => loadSeed()).toThrow('agent wallets cannot be derived');
    expect(() => loadSeed()).toThrow('To fix');
  });

  // Edge cases
  it('throws on invalid mnemonic (wrong words)', () => {
    process.env.MASTER_SEED = 'invalid words that are not a real mnemonic phrase at all here now';
    expect(() => loadSeed()).toThrow('Invalid mnemonic');
  });

  it('throws on invalid hex (odd length)', () => {
    process.env.MASTER_SEED = 'abcdef123'; // 9 chars — valid hex chars but invalid length
    expect(() => loadSeed()).toThrow('Invalid hex seed length');
  });

  it('throws on non-hex non-mnemonic string', () => {
    process.env.MASTER_SEED = 'not-hex-and-no-spaces!';
    expect(() => loadSeed()).toThrow('MASTER_SEED format not recognized');
  });

  it('throws on empty string MASTER_SEED', () => {
    process.env.MASTER_SEED = '';
    delete process.env.DEMO_MODE;
    expect(() => loadSeed()).toThrow('MASTER_SEED environment variable is required');
  });

  it('prefers MASTER_SEED over DEMO_MODE when both are set', () => {
    process.env.MASTER_SEED = 'b'.repeat(64);
    process.env.DEMO_MODE = 'true';
    const seed = loadSeed();
    // Should use MASTER_SEED, not DEMO_SEED
    expect(seed[0]).toBe(0xbb);
  });
});
