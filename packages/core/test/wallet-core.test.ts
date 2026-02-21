import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveKeypair } from '../src/derivation.js';
import { getAddressFromPublicKey } from '@solana/kit';
import { DEMO_SEED, TREASURY_AGENT_ID } from '../src/constants.js';
import type { WalletConfig, TransactionToSign } from '../src/types.js';

const mockGetBalance = vi.fn();
const mockGetLatestBlockhash = vi.fn();
const mockSendAndConfirm = vi.fn();
const mockRequestAirdrop = vi.fn();

vi.mock('../src/rpc-client.js', () => ({
  createRpcClient: vi.fn(() => ({
    getBalance: mockGetBalance,
    getLatestBlockhash: mockGetLatestBlockhash,
    sendAndConfirm: mockSendAndConfirm,
    requestAirdrop: mockRequestAirdrop,
  })),
}));

// Mock signTransactionMessageWithSigners and getSignatureFromTransaction
const mockSignTransactionMessageWithSigners = vi.fn();
const mockGetSignatureFromTransaction = vi.fn();
const mockAssertIsTransactionWithinSizeLimit = vi.fn();

vi.mock('@solana/kit', async () => {
  const actual = await vi.importActual<typeof import('@solana/kit')>('@solana/kit');
  return {
    ...actual,
    signTransactionMessageWithSigners: (...args: unknown[]) => mockSignTransactionMessageWithSigners(...args),
    getSignatureFromTransaction: (...args: unknown[]) => mockGetSignatureFromTransaction(...args),
    assertIsTransactionWithinSizeLimit: (...args: unknown[]) => mockAssertIsTransactionWithinSizeLimit(...args),
  };
});

const mockGetTransferSolInstruction = vi.fn().mockReturnValue({ mock: 'transferInstruction' });
vi.mock('@solana-program/system', () => ({
  getTransferSolInstruction: (...args: unknown[]) => mockGetTransferSolInstruction(...args),
}));

const { createAutarchWallet } = await import('../src/wallet-core.js');

function getDemoSeedBytes(): Uint8Array {
  const bytes = new Uint8Array(DEMO_SEED.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(DEMO_SEED.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const seed = getDemoSeedBytes();
const config: WalletConfig = { seed };

describe('createAutarchWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBalance.mockResolvedValue({ lamports: 5_000_000_000n, sol: 5.0 });
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: 'mockBlockhash123',
      lastValidBlockHeight: 100n,
    });
    mockSendAndConfirm.mockResolvedValue(undefined);
    mockRequestAirdrop.mockResolvedValue('mockAirdropSignature123');
    mockSignTransactionMessageWithSigners.mockResolvedValue({ mock: 'signedTx' });
    mockGetSignatureFromTransaction.mockReturnValue('mockSignature123');
    mockAssertIsTransactionWithinSizeLimit.mockImplementation(() => {});
    mockGetTransferSolInstruction.mockReturnValue({ mock: 'transferInstruction' });
  });

  // 5.2: returns object with exactly 6 methods (4 original + distributeSol + requestAirdrop)
  it('returns an object with exactly 6 methods', () => {
    const wallet = createAutarchWallet(config);
    const keys = Object.keys(wallet).sort();
    expect(keys).toEqual(['distributeSol', 'getAddress', 'getAgent', 'getBalance', 'requestAirdrop', 'signTransaction']);
    expect(Object.getOwnPropertyNames(wallet).sort()).toEqual(['distributeSol', 'getAddress', 'getAgent', 'getBalance', 'requestAirdrop', 'signTransaction']);
    expect(Object.getOwnPropertySymbols(wallet)).toHaveLength(0);
    expect(typeof wallet.getAgent).toBe('function');
    expect(typeof wallet.getAddress).toBe('function');
    expect(typeof wallet.getBalance).toBe('function');
    expect(typeof wallet.signTransaction).toBe('function');
    expect(typeof wallet.distributeSol).toBe('function');
    expect(typeof wallet.requestAirdrop).toBe('function');
  });

  // 5.3: returned AutarchWallet is frozen
  it('returned AutarchWallet is frozen', () => {
    const wallet = createAutarchWallet(config);
    expect(Object.isFrozen(wallet)).toBe(true);
  });

  // 5.4: getAgent returns AgentWallet with address and signTransaction
  it('getAgent returns AgentWallet with address (string) and signTransaction (function)', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    expect(typeof agent.address).toBe('string');
    expect(typeof agent.signTransaction).toBe('function');
  });

  // 5.5: returned AgentWallet is frozen
  it('returned AgentWallet is frozen', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    expect(Object.isFrozen(agent)).toBe(true);
  });

  // 5.6: getAddress returns valid base58 Solana address
  it('getAddress returns a valid base58 Solana address', async () => {
    const wallet = createAutarchWallet(config);
    const address = await wallet.getAddress(0);
    expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  // 5.7: getAddress(0) matches getAgent(0).address
  it('getAddress(0) matches getAgent(0).address', async () => {
    const wallet = createAutarchWallet(config);
    const address = await wallet.getAddress(0);
    const agent = await wallet.getAgent(0);
    expect(address).toBe(agent.address);
  });

  // 5.8: same agentId returns same address (deterministic, cached)
  it('same agentId returns same address on multiple calls', async () => {
    const wallet = createAutarchWallet(config);
    const addr1 = await wallet.getAddress(0);
    const addr2 = await wallet.getAddress(0);
    expect(addr1).toBe(addr2);
  });

  // 5.9: different agentIds return different addresses
  it('different agentIds return different addresses', async () => {
    const wallet = createAutarchWallet(config);
    const addr0 = await wallet.getAddress(0);
    const addr1 = await wallet.getAddress(1);
    const addr2 = await wallet.getAddress(2);
    expect(addr0).not.toBe(addr1);
    expect(addr0).not.toBe(addr2);
    expect(addr1).not.toBe(addr2);
  });

  // 5.10: addresses match direct deriveKeypair + getAddressFromPublicKey
  it('addresses match direct deriveKeypair + getAddressFromPublicKey', async () => {
    const wallet = createAutarchWallet(config);
    for (const agentId of [0, 1, 5]) {
      const walletAddr = await wallet.getAddress(agentId);
      const keypair = await deriveKeypair(seed, agentId);
      const directAddr = await getAddressFromPublicKey(keypair.publicKey);
      expect(walletAddr).toBe(directAddr);
    }
  });

  // 5.14: getAgent(-1) rejects with NFR30-compliant error
  it('getAgent(-1) rejects with NFR30-compliant error (what/why/how)', async () => {
    const wallet = createAutarchWallet(config);
    await expect(wallet.getAgent(-1)).rejects.toThrow('Failed to derive agent wallet');
    await expect(wallet.getAgent(-1)).rejects.toThrow('cannot operate without a valid wallet');
    await expect(wallet.getAgent(-1)).rejects.toThrow('Verify the seed is valid and agentId is a non-negative integer');
  });

  // 5.15: getAgent(0) called twice returns same object reference
  it('getAgent(0) called twice returns the same object reference', async () => {
    const wallet = createAutarchWallet(config);
    const agent1 = await wallet.getAgent(0);
    const agent2 = await wallet.getAgent(0);
    expect(Object.is(agent1, agent2)).toBe(true);
  });

  it('concurrent getAgent(0) calls return the same object reference', async () => {
    const wallet = createAutarchWallet(config);
    const [agent1, agent2] = await Promise.all([wallet.getAgent(0), wallet.getAgent(0)]);
    expect(Object.is(agent1, agent2)).toBe(true);
  });

  it('wallet derivation is stable even if caller mutates original seed after construction', async () => {
    const mutableSeed = getDemoSeedBytes();
    const wallet = createAutarchWallet({ seed: mutableSeed });

    const expectedAddress = await (async () => {
      const keypair = await deriveKeypair(seed, 7);
      return getAddressFromPublicKey(keypair.publicKey);
    })();

    mutableSeed.fill(0);

    await expect(wallet.getAddress(7)).resolves.toBe(expectedAddress);
  });

  // 8.2: getBalance returns Balance with lamports and sol
  it('getBalance(agentId) returns Balance with lamports and sol', async () => {
    const wallet = createAutarchWallet(config);
    const balance = await wallet.getBalance(0);
    expect(balance).toEqual({ lamports: 5_000_000_000n, sol: 5.0 });
    expect(typeof balance.lamports).toBe('bigint');
    expect(typeof balance.sol).toBe('number');
  });

  // 8.3: getBalance calls RPC with correct derived address
  it('getBalance(agentId) calls RPC with the correct derived address', async () => {
    const wallet = createAutarchWallet(config);
    const expectedAddress = await wallet.getAddress(0);
    await wallet.getBalance(0);
    expect(mockGetBalance).toHaveBeenCalledWith(expectedAddress);
  });

  // 8.4: signTransaction returns TransactionResult
  it('signTransaction(agentId, tx) returns TransactionResult with signature, status, mode', async () => {
    const wallet = createAutarchWallet(config);
    const tx: TransactionToSign = { instructions: [] };
    const result = await wallet.signTransaction(0, tx);
    expect(result).toEqual({
      signature: 'mockSignature123',
      status: 'confirmed',
      mode: 'normal',
    });
  });

  // 8.5: signTransaction refreshes blockhash before signing
  it('signTransaction refreshes blockhash before signing (getLatestBlockhash called)', async () => {
    const wallet = createAutarchWallet(config);
    const tx: TransactionToSign = { instructions: [] };
    await wallet.signTransaction(0, tx);
    expect(mockGetLatestBlockhash).toHaveBeenCalled();
  });

  // 8.6: AgentWallet.signTransaction delegates correctly
  it('AgentWallet.signTransaction(tx) delegates correctly and returns TransactionResult', async () => {
    const wallet = createAutarchWallet(config);
    const agent = await wallet.getAgent(0);
    const tx: TransactionToSign = { instructions: [] };
    const result = await agent.signTransaction(tx);
    expect(result).toEqual({
      signature: 'mockSignature123',
      status: 'confirmed',
      mode: 'normal',
    });
  });

  // 8.7: transaction failure returns error with clear message
  it('transaction failure returns error distinguishing error type', async () => {
    mockSendAndConfirm.mockRejectedValue(new Error('Transaction failed: insufficient funds'));
    const wallet = createAutarchWallet(config);
    const tx: TransactionToSign = { instructions: [] };
    await expect(wallet.signTransaction(0, tx)).rejects.toThrow('Transaction failed for agentId 0');
  });

  it('network failure returns error with network context', async () => {
    mockSendAndConfirm.mockRejectedValue(new Error('Network error connecting to devnet: timeout'));
    const wallet = createAutarchWallet(config);
    const tx: TransactionToSign = { instructions: [] };
    await expect(wallet.signTransaction(0, tx)).rejects.toThrow('Failed to submit transaction for agentId 0');
  });

  // 8.8: no key material in error output
  it('no key material in any error output from signTransaction failures', async () => {
    mockSendAndConfirm.mockRejectedValue(new Error('some RPC failure'));
    const wallet = createAutarchWallet(config);
    const tx: TransactionToSign = { instructions: [] };
    try {
      await wallet.signTransaction(0, tx);
    } catch (error: unknown) {
      const msg = (error as Error).message;
      expect(msg).not.toContain('privateKey');
      expect(msg).not.toContain('secretKey');
      expect(msg).not.toContain(DEMO_SEED);
      expect(msg).not.toContain(DEMO_SEED.substring(0, 32));
    }
  });

  // 8.8 also for getBalance errors
  it('no key material in error output from getBalance failures', async () => {
    mockGetBalance.mockRejectedValue(new Error('network failure'));
    const wallet = createAutarchWallet(config);
    try {
      await wallet.getBalance(0);
    } catch (error: unknown) {
      const msg = (error as Error).message;
      expect(msg).not.toContain('privateKey');
      expect(msg).not.toContain('secretKey');
      expect(msg).not.toContain(DEMO_SEED);
    }
  });

  // === Task 7: distributeSol tests (AC: #2) ===
  describe('distributeSol', () => {
    // 7.2: returns TransactionResult with signature, status, mode
    it('distributeSol(1, 500_000_000n) returns TransactionResult with signature, status: confirmed, mode: normal', async () => {
      const wallet = createAutarchWallet(config);
      const result = await wallet.distributeSol(1, 500_000_000n);
      expect(result).toEqual({
        signature: 'mockSignature123',
        status: 'confirmed',
        mode: 'normal',
      });
    });

    // 7.3: uses treasury (agentId 0) as the signer — verify sendAndConfirm was called
    it('distributeSol uses treasury (agentId 0) as the signer', async () => {
      const wallet = createAutarchWallet(config);
      const treasuryAddr = await wallet.getAddress(0);
      await wallet.distributeSol(1, 500_000_000n);
      expect(mockSendAndConfirm).toHaveBeenCalled();
      expect(mockGetTransferSolInstruction).toHaveBeenCalled();
      const call = mockGetTransferSolInstruction.mock.calls[0]?.[0] as {
        source: { address: string };
      };
      expect(call.source.address).toBe(treasuryAddr);
    });

    // 7.4: distributeSol refreshes blockhash before signing (FR26)
    it('distributeSol refreshes blockhash before signing (FR26)', async () => {
      const wallet = createAutarchWallet(config);
      await wallet.distributeSol(1, 500_000_000n);
      expect(mockGetLatestBlockhash).toHaveBeenCalled();
    });

    // 7.5: distributeSol(0, ...) throws — cannot distribute to self
    it('distributeSol(0, ...) throws error — cannot distribute to self (treasury → treasury)', async () => {
      const wallet = createAutarchWallet(config);
      await expect(wallet.distributeSol(0, 500_000_000n)).rejects.toThrow(
        'Cannot distribute SOL to treasury (self-transfer)',
      );
    });

    it('distributeSol(-1, ...) throws error — child agentId must be > 0', async () => {
      const wallet = createAutarchWallet(config);
      await expect(wallet.distributeSol(-1, 500_000_000n)).rejects.toThrow(
        'Cannot distribute SOL to treasury (self-transfer)',
      );
    });

    // 7.6: distributeSol(1, 0n) throws — zero amount invalid
    it('distributeSol(1, 0n) throws error — zero amount invalid', async () => {
      const wallet = createAutarchWallet(config);
      await expect(wallet.distributeSol(1, 0n)).rejects.toThrow(
        'Distribution amount must be greater than 0 lamports',
      );
    });

    // 7.7: transaction failure returns clear error distinguishing network vs transaction error
    it('transaction failure returns clear error with transaction context', async () => {
      mockSendAndConfirm.mockRejectedValue(new Error('[RPC_TRANSACTION_ERROR] Transaction failed: insufficient funds'));
      const wallet = createAutarchWallet(config);
      await expect(wallet.distributeSol(1, 500_000_000n)).rejects.toThrow('Distribution failed for agentId 1');
    });

    it('network failure returns clear error with network context', async () => {
      mockSendAndConfirm.mockRejectedValue(new Error('[RPC_NETWORK_ERROR] Network error connecting to devnet'));
      const wallet = createAutarchWallet(config);
      await expect(wallet.distributeSol(1, 500_000_000n)).rejects.toThrow(
        'Failed to distribute 500000000 lamports from treasury to agentId 1',
      );
    });

    // 7.8: no key material in any error output (NFR7)
    it('no key material in any error output from distributeSol failures (NFR7)', async () => {
      mockSendAndConfirm.mockRejectedValue(new Error('some RPC failure'));
      const wallet = createAutarchWallet(config);
      try {
        await wallet.distributeSol(1, 500_000_000n);
      } catch (error: unknown) {
        const msg = (error as Error).message;
        expect(msg).not.toContain('privateKey');
        expect(msg).not.toContain('secretKey');
        expect(msg).not.toContain(DEMO_SEED);
        expect(msg).not.toContain(DEMO_SEED.substring(0, 32));
      }
    });

    it('child balance increases by the distributed amount in mocked flow', async () => {
      mockGetBalance.mockResolvedValueOnce({ lamports: 1_000_000_000n, sol: 1.0 });
      mockGetBalance.mockResolvedValueOnce({ lamports: 1_500_000_000n, sol: 1.5 });
      const wallet = createAutarchWallet(config);

      const before = await wallet.getBalance(1);
      await wallet.distributeSol(1, 500_000_000n);
      const after = await wallet.getBalance(1);

      expect(after.lamports - before.lamports).toBe(500_000_000n);
    });
  });

  // === Task 8: requestAirdrop tests (AC: #3, #4) ===
  describe('requestAirdrop', () => {
    // 8.2: requestAirdrop(0) calls RPC with treasury address and default 1 SOL amount
    it('requestAirdrop(0) calls RPC with treasury address and default 1 SOL amount', async () => {
      const wallet = createAutarchWallet(config);
      const treasuryAddr = await wallet.getAddress(0);
      await wallet.requestAirdrop(0);
      expect(mockRequestAirdrop).toHaveBeenCalledWith(treasuryAddr, 1_000_000_000n);
    });

    // 8.3: requestAirdrop(0, 2_000_000_000n) uses custom amount
    it('requestAirdrop(0, 2_000_000_000n) uses custom amount', async () => {
      const wallet = createAutarchWallet(config);
      const treasuryAddr = await wallet.getAddress(0);
      await wallet.requestAirdrop(0, 2_000_000_000n);
      expect(mockRequestAirdrop).toHaveBeenCalledWith(treasuryAddr, 2_000_000_000n);
    });

    // 8.4: returns airdrop signature string on success
    it('returns airdrop signature string on success', async () => {
      const wallet = createAutarchWallet(config);
      const sig = await wallet.requestAirdrop(0);
      expect(sig).toBe('mockAirdropSignature123');
    });

    // 8.5: rate-limit error is returned as error (not crash) with clear message
    it('rate-limit error propagates as error with clear message', async () => {
      mockRequestAirdrop.mockRejectedValue(
        new Error('[RPC_AIRDROP_RATE_LIMITED] Airdrop failed — devnet faucet rate-limited.'),
      );
      const wallet = createAutarchWallet(config);
      await expect(wallet.requestAirdrop(0)).rejects.toThrow('rate-limited');
    });

    // 8.6: no key material in error output
    it('no key material in error output from requestAirdrop failures (NFR7)', async () => {
      mockRequestAirdrop.mockRejectedValue(new Error('some airdrop failure'));
      const wallet = createAutarchWallet(config);
      try {
        await wallet.requestAirdrop(0);
      } catch (error: unknown) {
        const msg = (error as Error).message;
        expect(msg).not.toContain('privateKey');
        expect(msg).not.toContain('secretKey');
        expect(msg).not.toContain(DEMO_SEED);
      }
    });

    it('requestAirdrop rejects non-positive amounts', async () => {
      const wallet = createAutarchWallet(config);
      await expect(wallet.requestAirdrop(0, 0n)).rejects.toThrow('Airdrop amount must be greater than 0 lamports');
      await expect(wallet.requestAirdrop(0, -1n)).rejects.toThrow('Airdrop amount must be greater than 0 lamports');
    });
  });

  // === Task 9: Treasury designation tests (AC: #1) ===
  describe('treasury designation', () => {
    // 9.1: TREASURY_AGENT_ID equals 0
    it('TREASURY_AGENT_ID equals 0', () => {
      expect(TREASURY_AGENT_ID).toBe(0);
    });

    // 9.2: getAddress(0) returns a valid Solana address (treasury)
    it('getAddress(0) returns a valid Solana address (treasury)', async () => {
      const wallet = createAutarchWallet(config);
      const addr = await wallet.getAddress(0);
      expect(addr).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    });

    // 9.3: getAddress(0) and getAddress(1) return different addresses
    it('getAddress(0) and getAddress(1) return different addresses (independent wallets)', async () => {
      const wallet = createAutarchWallet(config);
      const treasuryAddr = await wallet.getAddress(0);
      const childAddr = await wallet.getAddress(1);
      expect(treasuryAddr).not.toBe(childAddr);
    });

    // 9.4: getAgent(0) returns a frozen AgentWallet for the treasury
    it('getAgent(0) returns a frozen AgentWallet for the treasury', async () => {
      const wallet = createAutarchWallet(config);
      const agent = await wallet.getAgent(0);
      expect(Object.isFrozen(agent)).toBe(true);
      expect(typeof agent.address).toBe('string');
      expect(typeof agent.signTransaction).toBe('function');
    });
  });
});
