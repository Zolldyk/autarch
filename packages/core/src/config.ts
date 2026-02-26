import { validateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { DEMO_SEED } from './constants.js';

/**
 * Load the master seed from environment variables.
 *
 * Detection order:
 * 1. MASTER_SEED with spaces → BIP39 mnemonic
 * 2. MASTER_SEED matching hex pattern → raw hex seed
 * 3. DEMO_MODE=true → built-in demo seed
 * 4. Otherwise → crash with NFR30-compliant error
 *
 * @returns 64-byte Uint8Array seed for HD key derivation
 *
 * @example
 * ```typescript
 * import { loadSeed } from '@autarch/core';
 * process.env.DEMO_MODE = 'true';
 * const seed = loadSeed(); // Uint8Array(64)
 * ```
 */
export function loadSeed(): Uint8Array {
  const masterSeedRaw = process.env.MASTER_SEED;
  const masterSeed = masterSeedRaw?.trim();

  if (masterSeed !== undefined && masterSeed !== '') {
    // Contains spaces → try as mnemonic
    if (masterSeed.includes(' ')) {
      if (!validateMnemonic(masterSeed, wordlist)) {
        throw new Error(
          'Invalid mnemonic: checksum failed or unknown words. ' +
            'The MASTER_SEED value contains spaces but is not a valid BIP39 mnemonic. ' +
            'To fix: Verify your mnemonic phrase is a valid BIP39 word list with correct checksum.',
        );
      }
      return mnemonicToSeedSync(masterSeed);
    }

    // Matches hex pattern
    if (/^[0-9a-fA-F]+$/.test(masterSeed)) {
      if (masterSeed.length !== 64 && masterSeed.length !== 128) {
        throw new Error(
          `Invalid hex seed length: ${String(masterSeed.length)} characters. ` +
            'A hex seed must be exactly 64 (32 bytes) or 128 (64 bytes) hex characters. ' +
            'To fix: Provide a valid hex-encoded seed of the correct length.',
        );
      }
      const bytes = new Uint8Array(masterSeed.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(masterSeed.substring(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }

    // Not recognized
    throw new Error(
      'MASTER_SEED format not recognized. ' +
        'The value is neither a valid BIP39 mnemonic (contains spaces) nor a hex string (only 0-9, a-f). ' +
        'To fix: Provide a BIP39 mnemonic phrase or a hex-encoded seed string.',
    );
  }

  // No MASTER_SEED — check DEMO_MODE
  if (process.env.DEMO_MODE === 'true') {
    const bytes = new Uint8Array(DEMO_SEED.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(DEMO_SEED.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  // Crash fast with NFR30-compliant error
  throw new Error(
    'MASTER_SEED environment variable is required. ' +
      'Without a master seed, agent wallets cannot be derived. ' +
      'To fix: Set MASTER_SEED in your .env file with a BIP39 mnemonic or hex seed. ' +
      'For demo/testing: Set DEMO_MODE=true to use the built-in demo seed.',
  );
}
