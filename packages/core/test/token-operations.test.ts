import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEMO_SEED } from '../src/constants.js';
import type { WalletConfig } from '../src/types.js';

const mockGetBalance = vi.fn();
const mockGetLatestBlockhash = vi.fn();
const mockSendAndConfirm = vi.fn();
const mockRequestAirdrop = vi.fn();
const mockGetConnectionMode = vi.fn<() => 'normal' | 'degraded' | 'simulation'>();
const mockCleanup = vi.fn();
const mockGetMinimumBalanceForRentExemption = vi.fn();
const mockGetTokenAccountBalance = vi.fn();

vi.mock('../src/rpc-client.js', () => ({
  createRpcClient: vi.fn(() => ({
    getBalance: mockGetBalance,
    getLatestBlockhash: mockGetLatestBlockhash,
    sendAndConfirm: mockSendAndConfirm,
    requestAirdrop: mockRequestAirdrop,
    getConnectionMode: mockGetConnectionMode,
    cleanup: mockCleanup,
    getMinimumBalanceForRentExemption: mockGetMinimumBalanceForRentExemption,
    getTokenAccountBalance: mockGetTokenAccountBalance,
  })),
}));

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
    generateKeyPair: vi.fn().mockImplementation(async () => actual.generateKeyPair()),
  };
});

vi.mock('@solana-program/system', () => ({
  getTransferSolInstruction: vi.fn().mockReturnValue({ mock: 'transferInstruction' }),
  getCreateAccountInstruction: vi.fn().mockReturnValue({ mock: 'createAccountInstruction' }),
}));

const mockGetInitializeMintInstruction = vi.fn().mockReturnValue({ mock: 'initMintInstruction' });
const mockGetMintToInstruction = vi.fn().mockReturnValue({ mock: 'mintToInstruction' });
const mockGetTransferCheckedInstruction = vi.fn().mockReturnValue({ mock: 'transferCheckedInstruction' });
const mockGetCreateAssociatedTokenIdempotentInstructionAsync = vi.fn().mockResolvedValue({ mock: 'createAtaInstruction' });
const mockFindAssociatedTokenPda = vi.fn().mockResolvedValue(['11111111111111111111111111111112', 255]);

vi.mock('@solana-program/token', () => ({
  getInitializeMintInstruction: (...args: unknown[]) => mockGetInitializeMintInstruction(...args),
  getMintToInstruction: (...args: unknown[]) => mockGetMintToInstruction(...args),
  getTransferCheckedInstruction: (...args: unknown[]) => mockGetTransferCheckedInstruction(...args),
  getCreateAssociatedTokenIdempotentInstructionAsync: (...args: unknown[]) => mockGetCreateAssociatedTokenIdempotentInstructionAsync(...args),
  findAssociatedTokenPda: (...args: unknown[]) => mockFindAssociatedTokenPda(...args),
  TOKEN_PROGRAM_ADDRESS: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
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

describe('Token operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBalance.mockResolvedValue({ lamports: 5_000_000_000n, sol: 5.0 });
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: 'mockBlockhash123',
      lastValidBlockHeight: 100n,
    });
    mockSendAndConfirm.mockImplementation(async (signedTxOrFactory: unknown) => {
      if (typeof signedTxOrFactory === 'function') {
        await (signedTxOrFactory as () => Promise<unknown>)();
      }
    });
    mockGetConnectionMode.mockReturnValue('normal');
    mockSignTransactionMessageWithSigners.mockResolvedValue({ mock: 'signedTx' });
    mockGetSignatureFromTransaction.mockReturnValue('mockTokenSignature');
    mockAssertIsTransactionWithinSizeLimit.mockImplementation(() => {});
    mockGetMinimumBalanceForRentExemption.mockResolvedValue(1_461_600n);
    mockGetTokenAccountBalance.mockResolvedValue({ amount: 1000000000n, decimals: 9, uiAmount: 1.0 });
    mockCleanup.mockImplementation(() => {});
    mockRequestAirdrop.mockResolvedValue('mockAirdropSignature');
  });

  describe('createTokenMint', () => {
    it('returns MintInfo with address and decimals', async () => {
      const wallet = createAutarchWallet(config);
      const mintInfo = await wallet.createTokenMint(9);

      expect(mintInfo).toHaveProperty('mintAddress');
      expect(mintInfo).toHaveProperty('decimals');
      expect(mintInfo.decimals).toBe(9);
      expect(typeof mintInfo.mintAddress).toBe('string');
    });

    it('defaults to 9 decimals when not specified', async () => {
      const wallet = createAutarchWallet(config);
      const mintInfo = await wallet.createTokenMint();

      expect(mintInfo.decimals).toBe(9);
    });

    it('uses custom decimals', async () => {
      const wallet = createAutarchWallet(config);
      const mintInfo = await wallet.createTokenMint(6);

      expect(mintInfo.decimals).toBe(6);
    });

    it('calls getMinimumBalanceForRentExemption for mint account', async () => {
      const wallet = createAutarchWallet(config);
      await wallet.createTokenMint();

      expect(mockGetMinimumBalanceForRentExemption).toHaveBeenCalledWith(82n);
    });

    it('calls sendAndConfirm to create mint', async () => {
      const wallet = createAutarchWallet(config);
      await wallet.createTokenMint();

      expect(mockSendAndConfirm).toHaveBeenCalled();
    });

    it('throws on network failure', async () => {
      mockSendAndConfirm.mockRejectedValue(new Error('Network failure'));
      const wallet = createAutarchWallet(config);

      await expect(wallet.createTokenMint()).rejects.toThrow('Failed to create token mint');
    });
  });

  describe('mintTokens', () => {
    it('calls sendAndConfirm to mint tokens', async () => {
      const wallet = createAutarchWallet(config);
      const result = await wallet.mintTokens('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1, 1000n);

      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('mode');
      expect(mockSendAndConfirm).toHaveBeenCalled();
    });

    it('derives ATA for recipient', async () => {
      const wallet = createAutarchWallet(config);
      await wallet.mintTokens('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1, 1000n);

      expect(mockFindAssociatedTokenPda).toHaveBeenCalled();
    });

    it('creates ATA idempotently', async () => {
      const wallet = createAutarchWallet(config);
      await wallet.mintTokens('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1, 1000n);

      expect(mockGetCreateAssociatedTokenIdempotentInstructionAsync).toHaveBeenCalled();
    });

    it('throws on failure', async () => {
      mockSendAndConfirm.mockRejectedValue(new Error('Mint failed'));
      const wallet = createAutarchWallet(config);

      await expect(wallet.mintTokens('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1, 1000n)).rejects.toThrow('Failed to mint tokens');
    });
  });

  describe('getTokenBalance', () => {
    it('returns correct balance', async () => {
      const wallet = createAutarchWallet(config);
      const balance = await wallet.getTokenBalance('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1);

      expect(balance.mint).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      expect(balance.amount).toBe(1000000000n);
      expect(balance.decimals).toBe(9);
      expect(balance.uiAmount).toBe(1.0);
    });

    it('returns zero balance when ATA does not exist', async () => {
      mockGetTokenAccountBalance.mockRejectedValue(new Error('Account not found'));
      const wallet = createAutarchWallet(config);
      const balance = await wallet.getTokenBalance('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1);

      expect(balance.amount).toBe(0n);
      expect(balance.uiAmount).toBe(0);
    });

    it('derives ATA before querying', async () => {
      const wallet = createAutarchWallet(config);
      await wallet.getTokenBalance('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1);

      expect(mockFindAssociatedTokenPda).toHaveBeenCalled();
    });
  });

  describe('transferTokens', () => {
    it('creates dest ATA and transfers tokens', async () => {
      const wallet = createAutarchWallet(config);
      const result = await wallet.transferTokens('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 0, 1, 500n, 9);

      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('status');
      expect(mockGetCreateAssociatedTokenIdempotentInstructionAsync).toHaveBeenCalled();
      expect(mockGetTransferCheckedInstruction).toHaveBeenCalled();
      expect(mockSendAndConfirm).toHaveBeenCalled();
    });

    it('derives ATAs for both source and destination', async () => {
      const wallet = createAutarchWallet(config);
      await wallet.transferTokens('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 0, 1, 500n, 9);

      // findAssociatedTokenPda called for both from and to
      expect(mockFindAssociatedTokenPda).toHaveBeenCalledTimes(2);
    });

    it('throws on failure', async () => {
      mockSendAndConfirm.mockRejectedValue(new Error('Transfer failed'));
      const wallet = createAutarchWallet(config);

      await expect(wallet.transferTokens('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 0, 1, 500n, 9)).rejects.toThrow('Failed to transfer tokens');
    });
  });
});
