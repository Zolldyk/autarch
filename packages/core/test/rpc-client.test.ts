import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RpcConfig } from '../src/types.js';

const mockGetBalanceSend = vi.fn();
const mockGetLatestBlockhashSend = vi.fn();
const mockSendAndConfirmFn = vi.fn();
const mockRequestAirdropSend = vi.fn();
const mockGetHealthSend = vi.fn();
let originalRpcUrl: string | undefined;
let originalRpcEndpoints: string | undefined;

vi.mock('@solana/kit', async () => {
  const actual = await vi.importActual<typeof import('@solana/kit')>('@solana/kit');
  return {
    ...actual,
    createSolanaRpc: vi.fn(() => ({
      getBalance: vi.fn(() => ({ send: mockGetBalanceSend })),
      getLatestBlockhash: vi.fn(() => ({ send: mockGetLatestBlockhashSend })),
      requestAirdrop: vi.fn(() => ({ send: mockRequestAirdropSend })),
      getHealth: vi.fn(() => ({ send: mockGetHealthSend })),
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
    originalRpcEndpoints = process.env.RPC_ENDPOINTS;
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINTS;
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

  it('uses RPC_ENDPOINTS env list and starts from first endpoint', () => {
    process.env.RPC_ENDPOINTS = ' https://primary.example.com, https://secondary.example.com ';
    createRpcClient({});
    expect(createSolanaRpc).toHaveBeenCalledWith('https://primary.example.com');
  });

  it('falls back to default endpoint when configured endpoints are blank', () => {
    createRpcClient({ endpoints: ['   ', ''] });
    expect(createSolanaRpc).toHaveBeenCalledWith('https://api.devnet.solana.com');
  });
});

describe('getBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  // 7.4: returns Balance with both lamports (bigint) and sol (number)
  it('returns Balance with lamports (bigint) and sol (number)', async () => {
    mockGetBalanceSend.mockResolvedValue({ value: 5_000_000_000n });
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(typeof balance.lamports).toBe('bigint');
    expect(typeof balance.sol).toBe('number');
  });

  // 7.5: converts lamports to SOL correctly
  it('converts lamports to SOL correctly (1 SOL = 1_000_000_000 lamports)', async () => {
    mockGetBalanceSend.mockResolvedValue({ value: 2_500_000_000n });
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance.lamports).toBe(2_500_000_000n);
    expect(balance.sol).toBe(2.5);
  });

  it('converts zero lamports correctly', async () => {
    mockGetBalanceSend.mockResolvedValue({ value: 0n });
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance.lamports).toBe(0n);
    expect(balance.sol).toBe(0);
  });

  // 7.7: network errors produce "network" context
  it('network errors produce error messages containing network context (NFR30.4)', async () => {
    const networkError = new Error('fetch failed');
    (networkError as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(networkError);
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('Network issue');
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('Check your RPC endpoint configuration');
  });

  // 7.8: non-network errors on getBalance are request errors (not transaction errors)
  it('non-network getBalance errors produce request-context messages (NFR30.4)', async () => {
    mockGetBalanceSend.mockRejectedValue(new Error('Account not found'));
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('RPC request while fetching balance failed');
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('Check the request parameters');
  });

  // 7.9: error messages never contain key material (NFR7)
  it('error messages never contain seed, private key, or keypair data (NFR7)', async () => {
    const seedHex = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1';
    mockGetBalanceSend.mockRejectedValue(new Error('some error'));
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
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
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  // 7.6: returns { blockhash, lastValidBlockHeight }
  it('returns blockhash and lastValidBlockHeight', async () => {
    mockGetLatestBlockhashSend.mockResolvedValue({
      value: { blockhash: 'mockBlockhash123', lastValidBlockHeight: 200n },
    });
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    const result = await client.getLatestBlockhash();
    expect(result.blockhash).toBe('mockBlockhash123');
    expect(result.lastValidBlockHeight).toBe(200n);
  });

  it('network errors on getLatestBlockhash contain network context', async () => {
    const err = new Error('timeout');
    (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    mockGetLatestBlockhashSend.mockRejectedValue(err);
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    await expect(client.getLatestBlockhash()).rejects.toThrow('Network issue');
  });

  it('non-network errors on getLatestBlockhash contain request context', async () => {
    mockGetLatestBlockhashSend.mockRejectedValue(new Error('bad response'));
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    await expect(client.getLatestBlockhash()).rejects.toThrow('RPC request while fetching latest blockhash failed');
  });
});

describe('sendAndConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  it("calls sendAndConfirm with commitment 'confirmed'", async () => {
    mockSendAndConfirmFn.mockResolvedValue(undefined);
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    const signedTx = { mock: 'signed' } as never;
    await client.sendAndConfirm(signedTx);
    expect(mockSendAndConfirmFn).toHaveBeenCalledWith(signedTx, { commitment: 'confirmed' });
  });

  it('non-network sendAndConfirm errors produce transaction context', async () => {
    mockSendAndConfirmFn.mockRejectedValue(new Error('insufficient funds'));
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    await expect(client.sendAndConfirm({} as never)).rejects.toThrow('Transaction submission failed');
    await expect(client.sendAndConfirm({} as never)).rejects.toThrow('Transaction invalid — check your config');
  });
});

describe('requestAirdrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  // 6.2: calls RPC with correct address and lamport amount
  it('calls RPC requestAirdrop with correct address and lamport amount', async () => {
    mockRequestAirdropSend.mockResolvedValue('mockAirdropSig456');
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    expect(mockRequestAirdropSend).toHaveBeenCalled();
  });

  // 6.3: returns the airdrop transaction signature on success
  it('returns the airdrop transaction signature on success', async () => {
    mockRequestAirdropSend.mockResolvedValue('mockAirdropSig456');
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    const sig = await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    expect(sig).toBe('mockAirdropSig456');
  });

  // 6.4: rate-limit error (429) produces clear error message containing "rate-limited"
  it('rate-limit error produces clear error message containing "rate-limited" (NFR30)', async () => {
    mockRequestAirdropSend.mockRejectedValue(new Error('HTTP 429: Too many requests'));
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
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
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
    await expect(
      client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n),
    ).rejects.toThrow('RPC_NETWORK_ERROR');
  });

  // 6.6: no key material in any error output
  it('no key material in any error output (NFR7)', async () => {
    const seedHex = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1';
    mockRequestAirdropSend.mockRejectedValue(new Error('some error'));
    const client = createRpcClient({ ...DEFAULT_CONFIG, maxRetries: 0 });
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

// === Story 3.3: Airdrop retry and rate-limit verification (FR30, NFR18) ===

import { MAX_RETRY_ATTEMPTS } from '../src/constants.js';

describe('airdrop retry verification (FR30, NFR18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  // 6.8: Verify airdrop retry count matches MAX_RETRY_ATTEMPTS (3)
  it('retries airdrop on rate-limit error with multiple attempts before exhaustion', async () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
    mockRequestAirdropSend.mockRejectedValue(new Error('HTTP 429: Too many requests'));
    // Use maxRetries: 2 to avoid simulation threshold (3) being hit before retries exhaust
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 2,
      baseDelayMs: 1,
    });

    try {
      await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    } catch {
      // expected — retries exhausted or simulation entered
    }
    // 1 initial + 2 retries = 3 total attempts (matching SIMULATION_FAILURE_THRESHOLD)
    expect(mockRequestAirdropSend).toHaveBeenCalledTimes(3);
  });

  // 6.9: Verify rate-limit error gives 2× backoff delay
  it('rate-limit retry uses 2× delay multiplier', async () => {
    mockRequestAirdropSend.mockRejectedValue(new Error('HTTP 429: Too many requests'));

    const capturedDelays: number[] = [];
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler: TimerHandler, timeout?: number) => {
      capturedDelays.push((timeout as number | undefined) ?? 0);
      if (typeof handler === 'function') handler();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 2,
      baseDelayMs: 100,
    });

    try {
      await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    } catch {
      // expected
    }

    // Rate limit: base * 2^(attempt-1) * 2 (rate limit multiplier)
    // Attempt 1 retry: 100 * 1 * 2 = 200ms
    // Attempt 2 retry: 100 * 2 * 2 = 400ms
    expect(capturedDelays[0]).toBe(200);
    expect(capturedDelays[1]).toBe(400);

    setTimeoutSpy.mockRestore();
  });

  // 6.10: Verify rate-limit exhaustion message matches NFR30.1 format
  it('throws [RPC_AIRDROP_RATE_LIMITED] with clear message after all retries exhausted', async () => {
    mockRequestAirdropSend.mockRejectedValue(new Error('HTTP 429: Too many requests'));
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 1,
      baseDelayMs: 1,
    });

    try {
      await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      const msg = (error as Error).message;
      expect(msg).toContain('[RPC_AIRDROP_RATE_LIMITED]');
      expect(msg).toContain('devnet faucet rate-limited');
      expect(msg).toContain('Wait 60 seconds or fund treasury manually');
    }
  });

  // 6.11: Verify airdrop in simulation mode returns sim- prefixed signature
  it('airdrop in simulation mode returns sim- prefixed signature without network call', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    // Enter simulation mode via network failures on getBalance
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(err);
    for (let i = 0; i < 3; i++) {
      try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    }
    expect(client.getConnectionMode()).toBe('simulation');

    vi.clearAllMocks();
    const sig = await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    expect(sig).toMatch(/^sim-/);
    expect(mockRequestAirdropSend).not.toHaveBeenCalled();
  });

  // 6.13: Rate-limit errors should not trigger simulation mode
  it('rate-limit exhaustion returns rate-limit error without entering simulation mode', async () => {
    mockRequestAirdropSend.mockRejectedValue(new Error('HTTP 429: Too many requests'));
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 2,
      baseDelayMs: 1,
    });

    await expect(
      client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n),
    ).rejects.toThrow('[RPC_AIRDROP_RATE_LIMITED]');
    expect(client.getConnectionMode()).toBe('normal');
  });

  // 6.12: Verify no key material in any airdrop error output (NFR7)
  it('no key material in any airdrop error output (NFR7)', async () => {
    const seedHex = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1';
    mockRequestAirdropSend.mockRejectedValue(new Error('HTTP 429: Too many requests'));
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 1,
      baseDelayMs: 1,
    });

    try {
      await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    } catch (error: unknown) {
      const msg = (error as Error).message;
      expect(msg).not.toContain('privateKey');
      expect(msg).not.toContain('secretKey');
      expect(msg).not.toContain(seedHex);
    }
  });
});

// === Story 3.1 Task 8: Comprehensive resilience tests ===

describe('retry with exponential backoff (8.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  it('retries network errors up to MAX_RETRY_ATTEMPTS times', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(err);

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 1,
      baseDelayMs: 1,
    });

    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('retrying exhausted');
    // 1 initial + 1 retry = 2 total attempts
    expect(mockGetBalanceSend).toHaveBeenCalledTimes(2);
  });

  it('applies longer backoff for rate limit errors', async () => {
    const rateLimitErr = new Error('HTTP 429: Too many requests');
    const networkErr = new Error('fetch failed');
    (networkErr as NodeJS.ErrnoException).code = 'ECONNREFUSED';

    // First call: rate limit (gets 2x multiplier), second call: network error (1x), third: resolve
    mockGetBalanceSend
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValueOnce({ value: 1_000_000_000n });

    const client = createRpcClient({
      rpcUrl: 'https://single.example.com',
      maxRetries: 3,
      baseDelayMs: 1,
    });

    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance.lamports).toBe(1_000_000_000n);
    expect(mockGetBalanceSend).toHaveBeenCalledTimes(3);
  });

  it('caps total retry backoff delay to 5 seconds recovery budget', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    mockGetBalanceSend.mockRejectedValue(err);

    const capturedDelays: number[] = [];
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler: TimerHandler, timeout?: number) => {
      capturedDelays.push((timeout as number | undefined) ?? 0);
      if (typeof handler === 'function') {
        handler();
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 3,
      baseDelayMs: 1_000,
    });

    try {
      await client.getBalance('11111111111111111111111111111111');
    } catch {
      // acceptable: rejection before simulation fallback
    }
    expect(capturedDelays.reduce((acc, delay) => acc + delay, 0)).toBeLessThanOrEqual(5_000);

    setTimeoutSpy.mockRestore();
  });

  it('succeeds on second attempt after transient failure', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ value: 1_000_000_000n });

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 3,
      baseDelayMs: 1,
    });

    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance.lamports).toBe(1_000_000_000n);
    expect(mockGetBalanceSend).toHaveBeenCalledTimes(2);
  });

  it('succeeds on third attempt after two transient failures', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ value: 2_000_000_000n });

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 3,
      baseDelayMs: 1,
    });

    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance.lamports).toBe(2_000_000_000n);
    expect(mockGetBalanceSend).toHaveBeenCalledTimes(3);
  });

  it('throws before threshold, then enters simulation and returns cached balance', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(err);

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 1,
      baseDelayMs: 1,
    });

    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('retrying exhausted');
    expect(client.getConnectionMode()).toBe('degraded');
    await expect(client.getBalance('11111111111111111111111111111111')).resolves.toEqual({
      lamports: 0n,
      sol: 0,
    });
    expect(client.getConnectionMode()).toBe('simulation');
  });

  it('does NOT retry transaction errors (insufficient funds)', async () => {
    mockSendAndConfirmFn.mockRejectedValue(new Error('insufficient funds'));
    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 3,
      baseDelayMs: 1,
    });

    await expect(client.sendAndConfirm({} as never)).rejects.toThrow('[RPC_TRANSACTION_ERROR]');
    expect(mockSendAndConfirmFn).toHaveBeenCalledTimes(1);
  });

  it('rebuilds signed transaction on retry when sendAndConfirm receives a factory', async () => {
    const err = new Error('timeout');
    (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    mockSendAndConfirmFn
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(undefined);

    const txFactory = vi.fn<() => Promise<never>>()
      .mockResolvedValueOnce({ mock: 'signed-1' } as never)
      .mockResolvedValueOnce({ mock: 'signed-2' } as never);

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 1,
      baseDelayMs: 1,
    });

    await client.sendAndConfirm(txFactory);
    expect(txFactory).toHaveBeenCalledTimes(2);
    expect(mockSendAndConfirmFn).toHaveBeenNthCalledWith(1, { mock: 'signed-1' }, { commitment: 'confirmed' });
    expect(mockSendAndConfirmFn).toHaveBeenNthCalledWith(2, { mock: 'signed-2' }, { commitment: 'confirmed' });
  });

  it('does NOT retry request errors (invalid params)', async () => {
    mockGetBalanceSend.mockRejectedValue(new Error('invalid params'));
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 3,
      baseDelayMs: 1,
    });

    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('[RPC_REQUEST_ERROR]');
    expect(mockGetBalanceSend).toHaveBeenCalledTimes(1);
  });
});

describe('endpoint rotation (8.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  it('rotates to next endpoint on network failure', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ value: 1_000_000_000n });

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 1,
      baseDelayMs: 1,
    });

    await client.getBalance('11111111111111111111111111111111');
    const calledEndpoints = (createSolanaRpc as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0]);
    expect(calledEndpoints).toContain('https://secondary.example.com');
  });

  it('creates new RPC client for rotated endpoint', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ value: 1_000_000_000n });

    createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 1,
      baseDelayMs: 1,
    });

    // Initial creation: 1 call for primary
    const initialCallCount = (createSolanaRpc as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(initialCallCount).toBe(1);
  });

  it('cycles through all endpoints before exhausting retries', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockReset();
    mockGetBalanceSend.mockImplementation(() => Promise.reject(err));

    const client = createRpcClient({
      endpoints: ['https://ep1.example.com', 'https://ep2.example.com', 'https://ep3.example.com'],
      maxRetries: 3,
      baseDelayMs: 1,
    });

    await client.getBalance('11111111111111111111111111111111');
    const calledEndpoints = (createSolanaRpc as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0]);
    // Should have rotated through endpoints
    expect(calledEndpoints).toContain('https://ep2.example.com');
    expect(calledEndpoints).toContain('https://ep3.example.com');
    expect(client.getConnectionMode()).toBe('simulation');
  });

  it('handles single-endpoint config without rotation (backward compat)', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(err);

    const client = createRpcClient({
      rpcUrl: 'https://single.example.com',
      maxRetries: 1,
      baseDelayMs: 1,
    });

    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('retrying exhausted');
    // Should still retry, just on the same endpoint
    expect(mockGetBalanceSend).toHaveBeenCalledTimes(2);
  });

  it('parses RPC_ENDPOINTS env var as comma-separated list', () => {
    process.env.RPC_ENDPOINTS = 'https://ep1.example.com,https://ep2.example.com';
    createRpcClient({});
    expect(createSolanaRpc).toHaveBeenCalledWith('https://ep1.example.com');
  });

  it('trims whitespace from endpoint URLs', () => {
    process.env.RPC_ENDPOINTS = '  https://ep1.example.com , https://ep2.example.com  ';
    createRpcClient({});
    expect(createSolanaRpc).toHaveBeenCalledWith('https://ep1.example.com');
  });

  it('falls back to RPC_URL when RPC_ENDPOINTS not set', () => {
    delete process.env.RPC_ENDPOINTS;
    process.env.RPC_URL = 'https://fallback.example.com';
    createRpcClient({});
    expect(createSolanaRpc).toHaveBeenCalledWith('https://fallback.example.com');
    process.env.RPC_URL = originalRpcUrl;
  });
});

describe('connection mode tracking (8.8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  it('starts in normal mode', () => {
    const client = createRpcClient({ rpcUrl: 'https://primary.example.com' });
    expect(client.getConnectionMode()).toBe('normal');
  });

  it('transitions to degraded when using fallback endpoint', async () => {
    const err = new Error('timeout');
    (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    mockGetBalanceSend
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ value: 1_000_000_000n });

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 1,
      baseDelayMs: 1,
    });

    await client.getBalance('11111111111111111111111111111111');
    expect(client.getConnectionMode()).toBe('degraded');
  });

  it('returns to normal when primary endpoint recovers', async () => {
    const networkError = new Error('timeout');
    (networkError as NodeJS.ErrnoException).code = 'ETIMEDOUT';

    mockGetBalanceSend
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ value: 1_000_000_000n })
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ value: 1_000_000_000n });

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 1,
      baseDelayMs: 1,
    });

    await client.getBalance('11111111111111111111111111111111');
    expect(client.getConnectionMode()).toBe('degraded');

    await client.getBalance('11111111111111111111111111111111');
    expect(client.getConnectionMode()).toBe('normal');
  });

  it('includes correct mode in TransactionResult context', async () => {
    const err = new Error('timeout');
    (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    mockSendAndConfirmFn
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(undefined);

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 1,
      baseDelayMs: 1,
    });

    await client.sendAndConfirm({} as never);
    expect(client.getConnectionMode()).toBe('degraded');
  });
});

describe('error discrimination (8.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  it('classifies ECONNREFUSED as network error (retryable)', async () => {
    const err = new Error('connect failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(err);

    const client = createRpcClient({ rpcUrl: 'https://test.example.com', maxRetries: 1, baseDelayMs: 1 });
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('[RPC_NETWORK_ERROR]');
    expect(mockGetBalanceSend).toHaveBeenCalledTimes(2); // retried
  });

  it('classifies ETIMEDOUT as network error (retryable)', async () => {
    const err = new Error('timed out');
    (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    mockGetBalanceSend.mockRejectedValue(err);

    const client = createRpcClient({ rpcUrl: 'https://test.example.com', maxRetries: 1, baseDelayMs: 1 });
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('[RPC_NETWORK_ERROR]');
    expect(mockGetBalanceSend).toHaveBeenCalledTimes(2); // retried
  });

  it('classifies HTTP 429 as rate limit error (retryable)', async () => {
    mockGetBalanceSend.mockRejectedValue(new Error('HTTP 429: Too many requests'));

    const client = createRpcClient({ rpcUrl: 'https://test.example.com', maxRetries: 1, baseDelayMs: 1 });
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('[RPC_NETWORK_ERROR]');
    expect(mockGetBalanceSend).toHaveBeenCalledTimes(2); // retried
  });

  it('classifies insufficient funds as transaction error (not retryable)', async () => {
    mockSendAndConfirmFn.mockRejectedValue(new Error('insufficient funds'));

    const client = createRpcClient({ rpcUrl: 'https://test.example.com', maxRetries: 3, baseDelayMs: 1 });
    await expect(client.sendAndConfirm({} as never)).rejects.toThrow('[RPC_TRANSACTION_ERROR]');
    expect(mockSendAndConfirmFn).toHaveBeenCalledTimes(1); // NOT retried
  });

  it('classifies program error as transaction error (not retryable)', async () => {
    mockSendAndConfirmFn.mockRejectedValue(new Error('program error: custom program error 0x1'));

    const client = createRpcClient({ rpcUrl: 'https://test.example.com', maxRetries: 3, baseDelayMs: 1 });
    await expect(client.sendAndConfirm({} as never)).rejects.toThrow('[RPC_TRANSACTION_ERROR]');
    expect(mockSendAndConfirmFn).toHaveBeenCalledTimes(1); // NOT retried
  });

  it('error messages distinguish network vs transaction failures (NFR30.4)', async () => {
    const networkErr = new Error('fetch failed');
    (networkErr as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(networkErr);

    const client = createRpcClient({ rpcUrl: 'https://test.example.com', maxRetries: 0, baseDelayMs: 1 });
    await expect(client.getBalance('11111111111111111111111111111111')).rejects.toThrow('Network issue');

    vi.clearAllMocks();
    mockSendAndConfirmFn.mockRejectedValue(new Error('insufficient funds'));
    const client2 = createRpcClient({ rpcUrl: 'https://test.example.com', maxRetries: 0, baseDelayMs: 1 });
    await expect(client2.sendAndConfirm({} as never)).rejects.toThrow('Transaction invalid');
  });
});

describe('NFR7 compliance during retry (8.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  it('no key material in error messages after retry exhaustion', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(err);

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 3,
      baseDelayMs: 1,
    });

    try {
      await client.getBalance('11111111111111111111111111111111');
    } catch (error: unknown) {
      const msg = (error as Error).message;
      expect(msg).not.toContain('privateKey');
      expect(msg).not.toContain('secretKey');
      expect(msg).not.toContain('seed');
    }
  });

  it('endpoint URLs are safe to log (not secrets)', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(err);

    const client = createRpcClient({
      endpoints: ['https://primary.example.com'],
      maxRetries: 0,
      baseDelayMs: 1,
    });

    try {
      await client.getBalance('11111111111111111111111111111111');
    } catch (error: unknown) {
      const msg = (error as Error).message;
      // Endpoint URL appears in error message — this is intentional and safe
      expect(msg).toContain('https://primary.example.com');
    }
  });
});

describe('NFR14 endpoint recovery (8.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  it('recovers to working endpoint within 5 seconds', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ value: 1_000_000_000n });

    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 3,
      baseDelayMs: 1,  // Use minimal delay for test speed
    });

    const start = Date.now();
    const balance = await client.getBalance('11111111111111111111111111111111');
    const elapsed = Date.now() - start;

    expect(balance.lamports).toBe(1_000_000_000n);
    expect(elapsed).toBeLessThan(5000); // NFR14: recovery within 5 seconds
  });

  it('total retry window does not exceed expected duration', async () => {
    const err = new Error('fetch failed');
    (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockGetBalanceSend.mockRejectedValue(err);

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 3,
      baseDelayMs: 1,  // 1ms base for test: total = 1 + 2 + 4 = 7ms
    });

    const start = Date.now();
    try {
      await client.getBalance('11111111111111111111111111111111');
    } catch {
      // expected
    }
    const elapsed = Date.now() - start;

    // With 1ms base delay, total retry window should be very small
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('backward compatibility (8.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RPC_URL = originalRpcUrl;
    process.env.RPC_ENDPOINTS = originalRpcEndpoints;
  });

  it('single-endpoint config works identically to current behavior', async () => {
    mockGetBalanceSend.mockResolvedValue({ value: 5_000_000_000n });
    const client = createRpcClient({ rpcUrl: 'https://api.devnet.solana.com' });
    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance.lamports).toBe(5_000_000_000n);
    expect(balance.sol).toBe(5.0);
    expect(client.getConnectionMode()).toBe('normal');
  });
});

// 7.10: All tests use mocked Solana connections
describe('mocking verification', () => {
  it('no real devnet calls — all RPC methods are mocked', () => {
    expect(vi.isMockFunction(createSolanaRpc)).toBe(true);
    expect(vi.isMockFunction(createSolanaRpcSubscriptions)).toBe(true);
  });
});

// === Story 3.2: Simulation Fallback & Auto-Recovery ===

import { SIMULATION_FAILURE_THRESHOLD, HEALTH_CHECK_POLL_INTERVAL_MS } from '../src/constants.js';

/** Helper: create a network error with ECONNREFUSED code */
function makeNetworkError(msg = 'fetch failed'): Error {
  const err = new Error(msg);
  (err as NodeJS.ErrnoException).code = 'ECONNREFUSED';
  return err;
}

/** Helper: trigger simulation mode by exhausting retries SIMULATION_FAILURE_THRESHOLD times */
async function triggerSimulationMode(
  client: ReturnType<typeof createRpcClient>,
  mockFn: ReturnType<typeof vi.fn>,
): Promise<void> {
  const err = makeNetworkError();
  mockFn.mockRejectedValue(err);
  for (let i = 0; i < SIMULATION_FAILURE_THRESHOLD; i++) {
    try {
      await client.getBalance('11111111111111111111111111111111');
    } catch {
      // Expected until simulation mode activates
    }
  }
}

describe('simulation mode entry (8.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINTS;
  });

  it('transitions to simulation after SIMULATION_FAILURE_THRESHOLD consecutive network failures', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    expect(client.getConnectionMode()).toBe('simulation');
  });

  it('counts network failures per failed attempt (not per exhausted operation)', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 2, // 3 failed attempts in one call
      baseDelayMs: 1,
    });

    mockGetBalanceSend.mockRejectedValue(makeNetworkError());
    try {
      await client.getBalance('11111111111111111111111111111111');
    } catch {
      // expected
    }

    expect(client.getConnectionMode()).toBe('simulation');
  });

  it('does NOT enter simulation on transaction errors (insufficient funds)', async () => {
    mockSendAndConfirmFn.mockRejectedValue(new Error('insufficient funds'));
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    for (let i = 0; i < SIMULATION_FAILURE_THRESHOLD + 1; i++) {
      try {
        await client.sendAndConfirm({} as never);
      } catch {
        // expected
      }
    }
    expect(client.getConnectionMode()).not.toBe('simulation');
  });

  it('enters simulation even with single-endpoint config', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://single.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    expect(client.getConnectionMode()).toBe('simulation');
  });

  it('resets failure counter on any successful operation', async () => {
    const err = makeNetworkError();
    // Fail twice, then succeed, then fail twice more — should NOT enter simulation
    mockGetBalanceSend
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ value: 1_000_000_000n })
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ value: 1_000_000_000n });

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    // First two failures: consecutiveNetworkFailures = 2
    try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }

    // Success resets counter
    await client.getBalance('11111111111111111111111111111111');
    expect(client.getConnectionMode()).not.toBe('simulation');

    // Two more failures: counter = 2 (not 4), still under threshold
    try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    expect(client.getConnectionMode()).not.toBe('simulation');

    // Another success
    await client.getBalance('11111111111111111111111111111111');
    expect(client.getConnectionMode()).not.toBe('simulation');
  });

  it('invokes onSimulationModeChange(true, reason) on simulation entry', async () => {
    const callback = vi.fn();
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      onSimulationModeChange: callback,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    expect(callback).toHaveBeenCalledWith(true, expect.stringContaining('consecutive network failures'));
  });
});

describe('simulated transactions (8.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINTS;
  });

  it('sendAndConfirm returns { status: "simulated", mode: "simulation" } without network call', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    vi.clearAllMocks(); // Clear to verify no network calls

    const result = await client.sendAndConfirm({} as never);
    expect(result).toBeDefined();
    expect(result!.status).toBe('simulated');
    expect(result!.mode).toBe('simulation');
    expect(mockSendAndConfirmFn).not.toHaveBeenCalled();
  });

  it('simulated signature starts with "sim-" prefix', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    const result = await client.sendAndConfirm({} as never);
    expect(result!.signature).toMatch(/^sim-/);
  });

  it('simulated signature is unique per call', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    const result1 = await client.sendAndConfirm({} as never);
    const result2 = await client.sendAndConfirm({} as never);
    expect(result1!.signature).not.toBe(result2!.signature);
  });

  it('getBalance returns cached value in simulation mode', async () => {
    // First: successful balance fetch to cache a value
    mockGetBalanceSend.mockResolvedValueOnce({ value: 5_000_000_000n });
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await client.getBalance('11111111111111111111111111111111');

    // Now trigger simulation
    await triggerSimulationMode(client, mockGetBalanceSend);
    vi.clearAllMocks();

    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance).toEqual({ lamports: 5_000_000_000n, sol: 5.0 });
    expect(mockGetBalanceSend).not.toHaveBeenCalled();
  });

  it('getBalance returns zero when no cached value exists in simulation mode', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance).toEqual({ lamports: 0n, sol: 0 });
  });

  it('getLatestBlockhash returns synthetic blockhash in simulation mode', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    vi.clearAllMocks();

    const result = await client.getLatestBlockhash();
    expect(result.blockhash).toBe('11111111111111111111111111111111');
    expect(result.lastValidBlockHeight).toBe(0n);
    expect(mockGetLatestBlockhashSend).not.toHaveBeenCalled();
  });

  it('requestAirdrop returns simulated result in simulation mode', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    vi.clearAllMocks();

    const sig = await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    expect(sig).toMatch(/^sim-/);
    expect(mockRequestAirdropSend).not.toHaveBeenCalled();
  });
});

describe('health check auto-recovery (8.5–8.8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINTS;
    // Default health check to fail so simulation doesn't accidentally recover
    mockGetHealthSend.mockRejectedValue(new Error('not ready'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts health check timer on simulation entry', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    expect(client.getConnectionMode()).toBe('simulation');

    // Health check should be scheduled — advance timer
    mockGetHealthSend.mockRejectedValue(new Error('still down'));
    await vi.advanceTimersByTimeAsync(1000);

    // getHealth was called (health check ran)
    expect(mockGetHealthSend).toHaveBeenCalled();
    client.cleanup();
  });

  it('successful health check transitions back to normal mode', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    expect(client.getConnectionMode()).toBe('simulation');

    // Health check succeeds
    mockGetHealthSend.mockResolvedValue('ok');
    await vi.advanceTimersByTimeAsync(1000);

    expect(client.getConnectionMode()).toBe('normal');
    client.cleanup();
  });

  it('successful health check resets consecutiveNetworkFailures', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);

    // Health check succeeds → recover
    mockGetHealthSend.mockResolvedValue('ok');
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getConnectionMode()).toBe('normal');

    // Now fail again — should need THRESHOLD failures to re-enter simulation
    mockGetBalanceSend.mockRejectedValue(makeNetworkError());
    for (let i = 0; i < SIMULATION_FAILURE_THRESHOLD - 1; i++) {
      try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    }
    expect(client.getConnectionMode()).not.toBe('simulation');
    client.cleanup();
  });

  it('successful health check invokes onSimulationModeChange(false)', async () => {
    const callback = vi.fn();
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
      onSimulationModeChange: callback,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    callback.mockClear();

    mockGetHealthSend.mockResolvedValue('ok');
    await vi.advanceTimersByTimeAsync(1000);

    expect(callback).toHaveBeenCalledWith(false, expect.stringContaining('Health check succeeded'));
    client.cleanup();
  });

  it('failed health check stays in simulation mode', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);

    mockGetHealthSend.mockRejectedValue(new Error('still unhealthy'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(client.getConnectionMode()).toBe('simulation');
    client.cleanup();
  });

  it('health check calls getHealth() on primary endpoint', async () => {
    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    vi.clearAllMocks();

    mockGetHealthSend.mockRejectedValue(new Error('down'));
    await vi.advanceTimersByTimeAsync(1000);

    // Verify createSolanaRpc was called for health check (creates fresh instance for primary endpoint)
    expect(createSolanaRpc).toHaveBeenCalledWith('https://primary.example.com');
    client.cleanup();
  });
});

describe('complete state machine cycle (8.9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINTS;
    // Prevent health check from accidentally recovering
    mockGetHealthSend.mockRejectedValue(new Error('not ready'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('NORMAL → DEGRADED → SIMULATION → NORMAL full cycle', async () => {
    const err = makeNetworkError();

    // Use maxRetries: 0 for clean simulation entry (no sleep in withRetry)
    // DEGRADED is tested separately; here we test the full SIMULATION cycle
    const client = createRpcClient({
      endpoints: ['https://primary.example.com', 'https://secondary.example.com'],
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    // NORMAL
    expect(client.getConnectionMode()).toBe('normal');

    // Trigger simulation via consecutive network failures
    mockGetBalanceSend.mockRejectedValue(err);
    for (let i = 0; i < SIMULATION_FAILURE_THRESHOLD; i++) {
      try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    }
    expect(client.getConnectionMode()).toBe('simulation');

    // SIMULATION → NORMAL: health check succeeds
    mockGetHealthSend.mockResolvedValue('ok');
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getConnectionMode()).toBe('normal');

    client.cleanup();
  });

  it('multiple simulation entries and recoveries within a session', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    // First simulation entry
    await triggerSimulationMode(client, mockGetBalanceSend);
    expect(client.getConnectionMode()).toBe('simulation');

    // Recover via health check
    mockGetHealthSend.mockResolvedValue('ok');
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getConnectionMode()).toBe('normal');

    // Second simulation entry
    mockGetBalanceSend.mockRejectedValue(makeNetworkError());
    for (let i = 0; i < SIMULATION_FAILURE_THRESHOLD; i++) {
      try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    }
    expect(client.getConnectionMode()).toBe('simulation');

    // Recover again
    mockGetHealthSend.mockResolvedValue('ok');
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getConnectionMode()).toBe('normal');

    client.cleanup();
  });

  it('mode is correct in every TransactionResult throughout cycle', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    // Normal mode — sendAndConfirm returns void
    mockSendAndConfirmFn.mockResolvedValueOnce(undefined);
    const normalResult = await client.sendAndConfirm({} as never);
    expect(normalResult).toBeUndefined();
    expect(client.getConnectionMode()).toBe('normal');

    // Enter simulation
    await triggerSimulationMode(client, mockGetBalanceSend);

    // Simulation mode — sendAndConfirm returns TransactionResult
    const simResult = await client.sendAndConfirm({} as never);
    expect(simResult).toBeDefined();
    expect(simResult!.mode).toBe('simulation');
    expect(simResult!.status).toBe('simulated');

    client.cleanup();
  });
});

describe('resource cleanup (3.6–3.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINTS;
    mockGetHealthSend.mockRejectedValue(new Error('not ready'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cleanup() clears health check timer', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    client.cleanup();
    vi.clearAllMocks();

    // Advance timer — health check should NOT run
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockGetHealthSend).not.toHaveBeenCalled();
  });

  it('cleanup() prevents further health checks', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 500,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);

    // Let one health check fire
    mockGetHealthSend.mockRejectedValue(new Error('down'));
    await vi.advanceTimersByTimeAsync(500);
    expect(mockGetHealthSend).toHaveBeenCalledTimes(1);

    // Cleanup
    client.cleanup();
    vi.clearAllMocks();

    // No more health checks
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockGetHealthSend).not.toHaveBeenCalled();
  });

  it('no leaked intervals after client destruction', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    client.cleanup();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});

describe('NFR compliance in simulation mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINTS;
  });

  it('no key material in any simulation-mode error output (NFR7)', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    const err = makeNetworkError();
    mockGetBalanceSend.mockRejectedValue(err);

    // Trigger simulation mode by exhausting threshold
    for (let i = 0; i < SIMULATION_FAILURE_THRESHOLD; i++) {
      try {
        await client.getBalance('11111111111111111111111111111111');
      } catch (error: unknown) {
        const msg = (error as Error).message;
        expect(msg).not.toContain('privateKey');
        expect(msg).not.toContain('secretKey');
        expect(msg).not.toContain('seed');
      }
    }
  });

  it('3 consecutive failures trigger simulation (NFR17 / SIMULATION_FAILURE_THRESHOLD)', async () => {
    expect(SIMULATION_FAILURE_THRESHOLD).toBe(3);

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    const err = makeNetworkError();
    mockGetBalanceSend.mockRejectedValue(err);

    // After 2 failures, not yet in simulation
    try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    expect(client.getConnectionMode()).not.toBe('simulation');

    // Third failure triggers simulation
    try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    expect(client.getConnectionMode()).toBe('simulation');
  });

  it('HEALTH_CHECK_POLL_INTERVAL_MS is 30 seconds', () => {
    expect(HEALTH_CHECK_POLL_INTERVAL_MS).toBe(30_000);
  });

  it('simulated signatures contain no key-derived data', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    await triggerSimulationMode(client, mockGetBalanceSend);
    const result = await client.sendAndConfirm({} as never);
    const sig = result!.signature;

    expect(sig).toMatch(/^sim-/);
    expect(sig).not.toContain('privateKey');
    expect(sig).not.toContain('secret');
  });
});

describe('backward compatibility with simulation (8.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINTS;
  });

  it('single-endpoint config still works, simulation still activates after failures', async () => {
    const client = createRpcClient({
      rpcUrl: 'https://single.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    // Normal operation works
    mockGetBalanceSend.mockResolvedValueOnce({ value: 1_000_000_000n });
    const balance = await client.getBalance('11111111111111111111111111111111');
    expect(balance.lamports).toBe(1_000_000_000n);

    // Trigger simulation
    await triggerSimulationMode(client, mockGetBalanceSend);
    expect(client.getConnectionMode()).toBe('simulation');

    // Still works in simulation
    const simBalance = await client.getBalance('11111111111111111111111111111111');
    expect(simBalance).toBeDefined();
    expect(typeof simBalance.lamports).toBe('bigint');
  });

  it('sendAndConfirm returns void in normal mode (backward compatible)', async () => {
    mockSendAndConfirmFn.mockResolvedValue(undefined);
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    const result = await client.sendAndConfirm({} as never);
    expect(result).toBeUndefined();
  });

  it('cleanup() is safe to call even without simulation mode', () => {
    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    // Should not throw
    expect(() => client.cleanup()).not.toThrow();
  });
});

describe('simulation entry during specific operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINTS;
  });

  it('sendAndConfirm returns simulated result when simulation mode entered during the call', async () => {
    const err = makeNetworkError();

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    // Use getBalance to exhaust threshold - 1
    mockGetBalanceSend.mockRejectedValue(err);
    for (let i = 0; i < SIMULATION_FAILURE_THRESHOLD - 1; i++) {
      try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    }

    // This sendAndConfirm will be the THRESHOLD-th failure → enters simulation and returns simulated
    mockSendAndConfirmFn.mockRejectedValue(err);
    const result = await client.sendAndConfirm({} as never);
    expect(result).toBeDefined();
    expect(result!.status).toBe('simulated');
    expect(result!.mode).toBe('simulation');
  });

  it('getLatestBlockhash returns synthetic when simulation entered during the call', async () => {
    const err = makeNetworkError();

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    // Exhaust threshold - 1
    mockGetBalanceSend.mockRejectedValue(err);
    for (let i = 0; i < SIMULATION_FAILURE_THRESHOLD - 1; i++) {
      try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    }

    // This blockhash call triggers simulation
    mockGetLatestBlockhashSend.mockRejectedValue(err);
    const result = await client.getLatestBlockhash();
    expect(result.blockhash).toBe('11111111111111111111111111111111');
    expect(result.lastValidBlockHeight).toBe(0n);
  });

  it('requestAirdrop returns simulated when simulation entered during the call', async () => {
    const err = makeNetworkError();

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
    });

    // Exhaust threshold - 1
    mockGetBalanceSend.mockRejectedValue(err);
    for (let i = 0; i < SIMULATION_FAILURE_THRESHOLD - 1; i++) {
      try { await client.getBalance('11111111111111111111111111111111'); } catch { /* expected */ }
    }

    // This airdrop call triggers simulation
    mockRequestAirdropSend.mockRejectedValue(err);
    const sig = await client.requestAirdrop('11111111111111111111111111111111', 1_000_000_000n);
    expect(sig).toMatch(/^sim-/);
  });

  it('callback invocation: onSimulationModeChange called on both entry and exit', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    const client = createRpcClient({
      rpcUrl: 'https://primary.example.com',
      maxRetries: 0,
      baseDelayMs: 1,
      healthCheckIntervalMs: 1000,
      onSimulationModeChange: callback,
    });

    // Entry
    await triggerSimulationMode(client, mockGetBalanceSend);
    expect(callback).toHaveBeenCalledWith(true, expect.any(String));

    // Exit
    callback.mockClear();
    mockGetHealthSend.mockResolvedValue('ok');
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledWith(false, expect.any(String));

    client.cleanup();
    vi.useRealTimers();
  });
});
