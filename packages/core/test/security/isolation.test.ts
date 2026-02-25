import { describe, it, expect } from 'vitest';
import { createAutarchWallet } from '../../src/wallet-core.js';
import { DEMO_SEED } from '../../src/constants.js';
import type { WalletConfig } from '../../src/types.js';

function getDemoSeedBytes(): Uint8Array {
  const bytes = new Uint8Array(DEMO_SEED.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(DEMO_SEED.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const seed = getDemoSeedBytes();
const config: WalletConfig = { seed };

describe('AgentWallet key isolation', () => {
  // 6.2: Object.keys returns only address and signTransaction
  it('Object.keys(agentWallet) returns only ["address", "signTransaction"]', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    expect(Object.keys(agent).sort()).toEqual(['address', 'signTransaction']);
  });

  // 6.3: Object.getOwnPropertyNames returns only address and signTransaction
  it('Object.getOwnPropertyNames(agentWallet) returns only ["address", "signTransaction"]', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    expect(Object.getOwnPropertyNames(agent).sort()).toEqual(['address', 'signTransaction']);
  });

  // 6.4: JSON.stringify contains no key material
  it('JSON.stringify(agentWallet) contains no seed hex, private key bytes, or key-related strings', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    const json = JSON.stringify(agent);
    expect(json).not.toContain('privateKey');
    expect(json).not.toContain('secretKey');
    expect(json).not.toContain(DEMO_SEED);
    expect(json).not.toContain(DEMO_SEED.substring(0, 32));
  });

  // 6.5: Object.getPrototypeOf is Object.prototype (plain object)
  it('Object.getPrototypeOf(agentWallet) is Object.prototype', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    expect(Object.getPrototypeOf(agent)).toBe(Object.prototype);
  });

  // 6.6: __proto__ leads nowhere with key material
  it('agentWallet.__proto__ leads nowhere with key material', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    // eslint-disable-next-line no-proto
    const proto = (agent as Record<string, unknown>).__proto__ as object;
    expect(proto).toBe(Object.prototype);
    const protoKeys = Object.getOwnPropertyNames(proto);
    for (const key of protoKeys) {
      expect(key).not.toContain('private');
      expect(key).not.toContain('secret');
      expect(key).not.toContain('seed');
    }
  });

  // 6.7: constructor is Object
  it('agentWallet.constructor is Object', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    expect(agent.constructor).toBe(Object);
  });

  // 6.8: adding properties to frozen AgentWallet throws in strict mode
  it('attempting to add properties to frozen AgentWallet throws in strict mode', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    expect(() => {
      (agent as Record<string, unknown>).newProp = 'test';
    }).toThrow();
  });

  // 6.9: modifying address on frozen AgentWallet throws in strict mode
  it('attempting to modify address on frozen AgentWallet throws in strict mode', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    expect(() => {
      (agent as Record<string, string>).address = 'hacked';
    }).toThrow();
  });

  // 6.10: Object.keys(autarchWallet) returns only public method names
  it('Object.keys(autarchWallet) returns only public method names', () => {
    const wallet = createAutarchWallet(config);
    expect(Object.keys(wallet).sort()).toEqual(['cleanup', 'distributeSol', 'getAddress', 'getAgent', 'getBalance', 'requestAirdrop', 'signTransaction']);
  });

  // 6.11: JSON.stringify(autarchWallet) contains no key material
  it('JSON.stringify(autarchWallet) contains no key material', () => {
    const wallet = createAutarchWallet(config);
    const json = JSON.stringify(wallet);
    expect(json).not.toContain('privateKey');
    expect(json).not.toContain('secretKey');
    expect(json).not.toContain('seed');
    expect(json).not.toContain(DEMO_SEED);
  });

  // 6.12: no property value is Uint8Array/ArrayBuffer/CryptoKey, no name includes forbidden key terms
  it('no property is Uint8Array/ArrayBuffer/CryptoKey; no name includes private/secret/seed/key (except signTransaction)', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    for (const name of Object.getOwnPropertyNames(agent)) {
      const value = (agent as Record<string, unknown>)[name];
      expect(value).not.toBeInstanceOf(Uint8Array);
      expect(value).not.toBeInstanceOf(ArrayBuffer);
      if (typeof value === 'object' && value !== null) {
        expect(value.constructor?.name).not.toBe('CryptoKey');
      }
      if (name !== 'signTransaction') {
        const lower = name.toLowerCase();
        expect(lower).not.toContain('private');
        expect(lower).not.toContain('secret');
        expect(lower).not.toContain('seed');
        expect(lower).not.toContain('key');
      }
    }
  });

  // 6.13: string representation reveals no key material
  it('String(agentWallet) and toString() reveal no key material', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    const str = String(agent);
    const toStr = agent.toString();
    expect(str).not.toContain('privateKey');
    expect(str).not.toContain('secretKey');
    expect(str).not.toContain(DEMO_SEED);
    expect(toStr).not.toContain('privateKey');
    expect(toStr).not.toContain('secretKey');
  });

  // 6.14: no exported symbol name contains key/seed-adjacent terms (loadSeed is intentionally public for demo orchestration)
  it('public exports omit deriveKeypair/DEMO_SEED and key-adjacent names (loadSeed allowed)', async () => {
    const coreExports = await import('../../src/index.js');
    const exportNames = Object.keys(coreExports);
    expect(exportNames).toContain('loadSeed');
    expect(exportNames).not.toContain('deriveKeypair');
    expect(exportNames).not.toContain('DEMO_SEED');
    for (const name of exportNames) {
      if (name === 'loadSeed') continue;
      expect(name).not.toMatch(/Keypair|PrivateKey|SecretKey|privateKey|secretKey|Seed|seed/);
    }
  });

  // 6.15: createAutarchWallet is the only callable factory
  it('createAutarchWallet is the only callable factory — AutarchWallet/AgentWallet are type-only', async () => {
    const coreExports = await import('../../src/index.js');
    const callableExports = Object.entries(coreExports).filter(([, v]) => typeof v === 'function');
    const factoryNames = callableExports.map(([name]) => name).filter((n) => n.toLowerCase().includes('wallet'));
    expect(factoryNames).toEqual(['createAutarchWallet']);
  });
});
