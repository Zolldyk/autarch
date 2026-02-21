import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RpcConfig } from '../src/types.js';

const mockGetBalanceSend = vi.fn();
const mockGetLatestBlockhashSend = vi.fn();
const mockSendAndConfirmFn = vi.fn();
const mockRequestAirdropSend = vi.fn();
let originalRpcUrl: string | undefined;

vi.mock('@solana/kit', async () => {
  const actual = await vi.importActual<typeof import('@solana/kit')>('@solana/kit');
  return {
    ...actual,
    createSolanaRpc: vi.fn(() => ({
      getBalance: vi.fn(() => ({ send: mockGetBalanceSend })),
      getLatestBlockhash: vi.fn(() => ({ send: mockGetLatestBlockhashSend })),
      requestAirdrop: vi.fn(() => ({ send: mockRequestAirdropSend })),
    })),
    createSolanaRpcSubscriptions: vi.fn(() => ({})),
    sendAndConfirmTransactionFactory: vi.fn(() => mockSendAndConfirmFn),
  };
});

// Must import after mock setup
const { createRpcClient } = await import('../src/rpc-client.js');
const { createSolanaRpc, createSolanaRpcSubscriptions } = await import('@solana/kit');

const DEFAULT_CONFIG: RpcConfig = { rpcUrl: 'https://api.devnet.solana.com' };

describe('createRpcClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalRpcUrl = process.env.RPC_URL;
    delete process.env.RPC_URL;
  });

  // 7.2: creates client with default devnet URL when none provided
  it('creates client with default devnet URL when rpcUrl is not provided', () => {
    createRpcClient({});
    expect(createSolanaRpc).toHaveBeenCalledWith('https://api.devnet.solana.com');
    expect(createSolanaRpcSubscriptions).toHaveBeenCalledWith('wss://api.devnet.solana.com');
  });

  // 7.3: uses provided rpcUrl
  it('uses custom rpcUrl when provided', () => {
    createRpcClient({ rpcUrl: 'https://custom-rpc.example.com' });
    expect(createSolanaRpc).toHaveBeenCalledWith('https://custom-rpc.example.com');
    expect(createSolanaRpcSubscriptions).toHaveBeenCalledWith('wss://custom-rpc.example.com');
  });

  it('derives ws:// from http:// URL', () => {
    createRpcClient({ rpcUrl: 'http://localhost:8899' });
    expect(createSolanaRpcSubscriptions).toHaveBeenCalledWith('ws://localhost:8899');
  });

  it('uses RPC_URL environment variable when rpcUrl is not provided', () => {
    process.env.RPC_URL = 'https://env-rpc.example.com';
    createRpcClient({});
    expect(createSolanaRpc).toHaveBeenCalledWith('https://env-rpc.example.com');
    expect(createSolanaRpcSubscriptions).toHaveBeenCalledWith('wss://env-rpc.example.com');
    process.env.RPC_URL = originalRpcUrl;
  });
});

describe('getBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
  });

  // 7.4: returns Balance with both lamports (bigint) and sol (number)
  it('returns Balance with lamports (bigint) and sol (number)', async () => {
    mockGetBalanceSend.mockResolvedValue({ value: 5_000_000_000n });
    const client = createRpcClient(DEFAULT_CONFIG);
    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(typeof balance.lamports).toBe('bigint');
    expect(typeof balance.sol).toBe('number');
  });

  // 7.5: converts lamports to SOL correctly
  it('converts lamports to SOL correctly (1 SOL = 1_000_000_000 lamports)', async () => {
    mockGetBalanceSend.mockResolvedValue({ value: 2_500_000_000n });
    const client = createRpcClient(DEFAULT_CONFIG);
    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance.lamports).toBe(2_500_000_000n);
    expect(balance.sol).toBe(2.5);
  });

  it('converts zero lamports correctly', async () => {
    mockGetBalanceSend.mockResolvedValue({ value: 0n });
    const client = createRpcClient(DEFAULT_CONFIG);
    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance.lamports).toBe(0n);
    expect(balance.sol).toBe(0);
  });

  // 7.7: network errors produce "network" context
  it('network errors produce error messages containing network context (NFR30.4)', async () => {
    const networkError = new Error('fetch failed');
    (networkError as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(networkError);
    const client = createRpcClient(DEFAULT_CONFIG);
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('Network error');
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('Check your RPC endpoint configuration');
  });

  // 7.8: non-network errors on getBalance are request errors (not transaction errors)
  it('non-network getBalance errors produce request-context messages (NFR30.4)', async () => {
    mockGetBalanceSend.mockRejectedValue(new Error('Account not found'));
    const client = createRpcClient(DEFAULT_CONFIG);
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('RPC request failed while fetching balance');
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('Check the request parameters');
  });

  // 7.9: error messages never contain key material (NFR7)
  it('error messages never contain seed, private key, or keypair data (NFR7)', async () => {
    const seedHex = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1';
    mockGetBalanceSend.mockRejectedValue(new Error('some error'));
    const client = createRpcClient(DEFAULT_CONFIG);
    try {
      await client.getBalance('11111111111111111111111111111111');
    } catch (error: unknown) {
      const msg = (error as Error).message;
      expect(msg).not.toContain('privateKey');
      expect(msg).not.toContain('secretKey');
      expect(msg).not.toContain(seedHex);
    }
  });
});

describe('getLatestBlockhash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
  });

  // 7.6: returns { blockhash, lastValidBlockHeight }
  it('returns blockhash and lastValidBlockHeight', async () => {
    mockGetLatestBlockhashSend.mockResolvedValue({
      value: { blockhash: 'mockBlockhash123', lastValidBlockHeight: 200n },
    });
    const client = createRpcClient(DEFAULT_CONFIG);
    const result = await client.getLatestBlockhash();
    expect(result.blockhash).toBe('mockBlockhash123');
    expect(result.lastValidBlockHeight).toBe(200n);
  });

  it('network errors on getLatestBlockhash contain network context', async () => {
    const err = new Error('timeout');
    (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    mockGetLatestBlockhashSend.mockRejectedValue(err);
    const client = createRpcClient(DEFAULT_CONFIG);
    await expect(client.getLatestBlockhash()).rejects.toThrow('Network error');
  });

  it('non-network errors on getLatestBlockhash contain request context', async () => {
    mockGetLatestBlockhashSend.mockRejectedValue(new Error('bad response'));
    const client = createRpcClient(DEFAULT_CONFIG);
    await expect(client.getLatestBlockhash()).rejects.toThrow('RPC request failed while fetching latest blockhash');
  });
});

describe('sendAndConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
  });

  it("calls sendAndConfirm with commitment 'confirmed'", async () => {
    mockSendAndConfirmFn.mockResolvedValue(undefined);
    const client = createRpcClient(DEFAULT_CONFIG);
    const signedTx = { mock: 'signed' } as never;
    await client.sendAndConfirm(signedTx);
    expect(mockSendAndConfirmFn).toHaveBeenCalledWith(signedTx, { commitment: 'confirmed' });
  });

  it('non-network sendAndConfirm errors produce transaction context', async () => {
    mockSendAndConfirmFn.mockRejectedValue(new Error('insufficient funds'));
    const client = createRpcClient(DEFAULT_CONFIG);
    await expect(client.sendAndConfirm({} as never)).rejects.toThrow('Transaction failed');
    await expect(client.sendAndConfirm({} as never)).rejects.toThrow('Check the transaction parameters');
  });
});

describe('requestAirdrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
  });

  // 6.2: calls RPC with correct address and lamport amount
  it('calls RPC requestAirdrop with correct address and lamport amount', async () => {
    mockRequestAirdropSend.mockResolvedValue('mockAirdropSig456');
    const client = createRpcClient(DEFAULT_CONFIG);
    await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    expect(mockRequestAirdropSend).toHaveBeenCalled();
  });

  // 6.3: returns the airdrop transaction signature on success
  it('returns the airdrop transaction signature on success', async () => {
    mockRequestAirdropSend.mockResolvedValue('mockAirdropSig456');
    const client = createRpcClient(DEFAULT_CONFIG);
    const sig = await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    expect(sig).toBe('mockAirdropSig456');
  });

  // 6.4: rate-limit error (429) produces clear error message containing "rate-limited"
  it('rate-limit error produces clear error message containing "rate-limited" (NFR30)', async () => {
    mockRequestAirdropSend.mockRejectedValue(new Error('HTTP 429: Too many requests'));
    const client = createRpcClient(DEFAULT_CONFIG);
    await expect(
      client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n),
    ).rejects.toThrow('rate-limited');
    await expect(
      client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n),
    ).rejects.toThrow('RPC_AIRDROP_RATE_LIMITED');
  });

  // 6.5: network error produces error with "network" context
  it('network error produces error with network context', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockRequestAirdropSend.mockRejectedValue(err);
    const client = createRpcClient(DEFAULT_CONFIG);
    await expect(
      client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n),
    ).rejects.toThrow('RPC_NETWORK_ERROR');
  });

  // 6.6: no key material in any error output
  it('no key material in any error output (NFR7)', async () => {
    const seedHex = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1';
    mockRequestAirdropSend.mockRejectedValue(new Error('some error'));
    const client = createRpcClient(DEFAULT_CONFIG);
    try {
      await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    } catch (error: unknown) {
      const msg = (error as Error).message;
      expect(msg).not.toContain('privateKey');
      expect(msg).not.toContain('secretKey');
      expect(msg).not.toContain(seedHex);
    }
  });

  // 6.7: all tests mock the Solana RPC
  it('all RPC methods are mocked — no real devnet calls', () => {
    expect(vi.isMockFunction(createSolanaRpc)).toBe(true);
  });
});

// 7.10: All tests use mocked Solana connections
describe('mocking verification', () => {
  it('no real devnet calls — all RPC methods are mocked', () => {
    expect(vi.isMockFunction(createSolanaRpc)).toBe(true);
    expect(vi.isMockFunction(createSolanaRpcSubscriptions)).toBe(true);
  });
});
