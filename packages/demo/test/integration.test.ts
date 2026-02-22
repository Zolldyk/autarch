import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutarchWallet, TREASURY_AGENT_ID } from '@autarch/core';
import type { AgentWallet, Balance, WalletConfig } from '@autarch/core';
import { Agent, AgentRuntime, RuleBasedDecisionModule } from '@autarch/agent';
import type { AgentConfig, AgentState, AgentLifecycleEvent, AgentRuntimeOptions, MarketDataProvider, MarketData } from '@autarch/agent';

/**
 * Integration tests: @autarch/core + @autarch/agent
 *
 * These tests verify the cross-package contract by using REAL wallet
 * derivation from core and REAL agent lifecycle from agent.
 * Only the network boundary (RPC) is bypassed by providing mock
 * getBalance callbacks — which is a genuine integration seam.
 */

const DEMO_SEED_HEX =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';

function getDemoSeedBytes(): Uint8Array {
  const bytes = new Uint8Array(DEMO_SEED_HEX.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(DEMO_SEED_HEX.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const walletConfig: WalletConfig = { seed: getDemoSeedBytes() };

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'Test Agent',
    strategy: 'Integration test',
    rules: [
      {
        name: 'default-rule',
        conditions: [{ field: 'price_drop', operator: '>', threshold: 5 }],
        action: 'buy',
        amount: 0.1,
        weight: 80,
        cooldownSeconds: 60,
      },
    ],
    ...overrides,
  };
}

function mockGetBalance(sol = 1.0): () => Promise<Balance> {
  return vi.fn<() => Promise<Balance>>().mockResolvedValue({
    lamports: BigInt(Math.round(sol * 1e9)),
    sol,
  });
}

function makeMockMarketProvider(): MarketDataProvider {
  return {
    getCurrentData: vi.fn<() => MarketData>().mockReturnValue({
      price: 100,
      priceChange1m: -10,
      priceChange5m: -8,
      volumeChange1m: 50,
      timestamp: Date.now(),
      source: 'simulated',
    }),
    getHistory: vi.fn().mockReturnValue([]),
    injectDip: vi.fn(),
    injectRally: vi.fn(),
    resetToBaseline: vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Suite 1: Agent + Wallet Wiring
// ─────────────────────────────────────────────────────────────────────
describe('Integration: Agent + Wallet wiring', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('Agent receives a real derived AgentWallet from core', async () => {
    const wallet = createAutarchWallet(walletConfig);
    const agentWallet = await wallet.getAgent(1);

    const noop = vi.fn();
    const agent = new Agent(1, makeAgentConfig(), agentWallet, mockGetBalance(2.5), makeMockMarketProvider(), () => [], noop, noop, noop, new RuleBasedDecisionModule());

    const state = agent.getState();
    expect(state.address).toBe(agentWallet.address);
    expect(state.agentId).toBe(1);
    expect(state.status).toBe('idle');
  });

  it('Agent state.address matches wallet.getAddress for the same agentId', async () => {
    const wallet = createAutarchWallet(walletConfig);
    const agentWallet = await wallet.getAgent(3);
    const directAddress = await wallet.getAddress(3);

    const noop = vi.fn();
    const agent = new Agent(3, makeAgentConfig(), agentWallet, mockGetBalance(), makeMockMarketProvider(), () => [], noop, noop, noop, new RuleBasedDecisionModule());

    expect(agent.getState().address).toBe(directAddress);
  });

  it('Agent ticks successfully with a real wallet handle', async () => {
    const wallet = createAutarchWallet(walletConfig);
    const agentWallet = await wallet.getAgent(1);
    const getBalance = mockGetBalance(5.0);

    const stateChanges: AgentState[] = [];
    const agent = new Agent(
      1,
      makeAgentConfig({ intervalMs: 1000 }),
      agentWallet,
      getBalance,
      makeMockMarketProvider(),
      () => [],
      (s) => stateChanges.push(s),
      vi.fn(),
      vi.fn(),
      new RuleBasedDecisionModule(),
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getState().status).toBe('active');
    expect(agent.getState().balance).toBe(5.0);
    expect(agent.getState().tickCount).toBe(1);

    agent.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Suite 2: Multi-Agent Wallet Isolation
// ─────────────────────────────────────────────────────────────────────
describe('Integration: Multi-agent wallet isolation', () => {
  it('each agent receives a distinct derived address from the same seed', async () => {
    const wallet = createAutarchWallet(walletConfig);

    const agents = await Promise.all(
      [1, 2, 3, 4, 5].map((id) => wallet.getAgent(id)),
    );

    const addresses = agents.map((a) => a.address);
    const unique = new Set(addresses);
    expect(unique.size).toBe(5);

    // All are valid base58 Solana addresses
    for (const addr of addresses) {
      expect(addr).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    }
  });

  it('treasury wallet (agentId 0) is distinct from all child wallets', async () => {
    const wallet = createAutarchWallet(walletConfig);
    const treasury = await wallet.getAgent(TREASURY_AGENT_ID);
    const child1 = await wallet.getAgent(1);
    const child2 = await wallet.getAgent(2);

    expect(treasury.address).not.toBe(child1.address);
    expect(treasury.address).not.toBe(child2.address);
  });

  it('same seed produces identical addresses across separate wallet instances', async () => {
    const wallet1 = createAutarchWallet({ seed: getDemoSeedBytes() });
    const wallet2 = createAutarchWallet({ seed: getDemoSeedBytes() });

    for (const agentId of [0, 1, 2, 5, 10]) {
      const addr1 = await wallet1.getAddress(agentId);
      const addr2 = await wallet2.getAddress(agentId);
      expect(addr1).toBe(addr2);
    }
  });

  it('AgentWallet objects remain frozen when passed to Agent instances', async () => {
    const wallet = createAutarchWallet(walletConfig);
    const agentWallet = await wallet.getAgent(1);

    expect(Object.isFrozen(agentWallet)).toBe(true);

    const noop = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _agent = new Agent(1, makeAgentConfig(), agentWallet, mockGetBalance(), makeMockMarketProvider(), () => [], noop, noop, noop, new RuleBasedDecisionModule());

    // Still frozen after being consumed by Agent
    expect(Object.isFrozen(agentWallet)).toBe(true);
  });

  it('multiple Agents in parallel each report their own unique address in state', async () => {
    const wallet = createAutarchWallet(walletConfig);
    const noop = vi.fn();

    const agents = await Promise.all(
      [1, 2, 3].map(async (id) => {
        const w = await wallet.getAgent(id);
        return new Agent(id, makeAgentConfig({ name: `Agent-${id}` }), w, mockGetBalance(), makeMockMarketProvider(), () => [], noop, noop, noop, new RuleBasedDecisionModule());
      }),
    );

    const addresses = agents.map((a) => a.getState().address);
    const unique = new Set(addresses);
    expect(unique.size).toBe(3);

    // Each address matches what core would return
    for (const agent of agents) {
      const state = agent.getState();
      const expected = await wallet.getAddress(state.agentId);
      expect(state.address).toBe(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Suite 3: Runtime + Core Lifecycle
// ─────────────────────────────────────────────────────────────────────
describe('Integration: Runtime + Core lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function buildRuntimeOptions(
    agentIds: number[],
    balances?: Map<number, number>,
  ): Promise<AgentRuntimeOptions> {
    const wallet = createAutarchWallet(walletConfig);

    const agents = await Promise.all(
      agentIds.map(async (id) => {
        const agentWallet = await wallet.getAgent(id);
        const sol = balances?.get(id) ?? 1.0;
        return {
          agentId: id,
          config: makeAgentConfig({ name: `Agent-${id}`, intervalMs: 1000 }),
          wallet: agentWallet,
          getBalance: mockGetBalance(sol),
        };
      }),
    );

    return { agents, marketProvider: makeMockMarketProvider() };
  }

  it('runtime starts agents with real derived wallet addresses', async () => {
    const wallet = createAutarchWallet(walletConfig);
    const options = await buildRuntimeOptions([1, 2, 3]);
    const runtime = new AgentRuntime(options);

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    expect(states).toHaveLength(3);

    for (const state of states) {
      expect(state.status).toBe('active');
      const expectedAddr = await wallet.getAddress(state.agentId);
      expect(state.address).toBe(expectedAddr);
    }

    runtime.stop();
  });

  it('runtime lifecycle events carry correct agentIds with real wallets', async () => {
    const options = await buildRuntimeOptions([1, 2]);
    const runtime = new AgentRuntime(options);
    const events: AgentLifecycleEvent[] = [];
    runtime.on('agentLifecycle', (e: AgentLifecycleEvent) => events.push(e));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const startEvents = events.filter((e) => e.event === 'started');
    expect(startEvents).toHaveLength(2);
    expect(startEvents.map((e) => e.agentId).sort()).toEqual([1, 2]);

    runtime.stop(1);
    const stopEvents = events.filter((e) => e.event === 'stopped');
    expect(stopEvents).toHaveLength(1);
    expect(stopEvents[0]!.agentId).toBe(1);

    // Agent 2 still active
    const agent2State = runtime.getStates().find((s) => s.agentId === 2);
    expect(agent2State?.status).toBe('active');

    runtime.stop();
  });

  it('state updates reflect real wallet addresses and mock balances', async () => {
    const balances = new Map([[1, 3.5], [2, 7.2]]);
    const options = await buildRuntimeOptions([1, 2], balances);
    const runtime = new AgentRuntime(options);

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    const agent1 = states.find((s) => s.agentId === 1);
    const agent2 = states.find((s) => s.agentId === 2);

    expect(agent1?.balance).toBe(3.5);
    expect(agent2?.balance).toBe(7.2);

    // Addresses are valid and distinct
    expect(agent1?.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(agent2?.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(agent1?.address).not.toBe(agent2?.address);

    runtime.stop();
  });

  it('fault isolation: one agent failure does not crash siblings with real wallets', async () => {
    const wallet = createAutarchWallet(walletConfig);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failingGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(
      new Error('simulated RPC failure'),
    );

    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeAgentConfig({ name: 'Healthy', intervalMs: 1000 }),
          wallet: await wallet.getAgent(1),
          getBalance: mockGetBalance(5.0),
        },
        {
          agentId: 2,
          config: makeAgentConfig({ name: 'Failing', intervalMs: 1000 }),
          wallet: await wallet.getAgent(2),
          getBalance: failingGetBalance,
        },
        {
          agentId: 3,
          config: makeAgentConfig({ name: 'Also Healthy', intervalMs: 1000 }),
          wallet: await wallet.getAgent(3),
          getBalance: mockGetBalance(10.0),
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    const healthy = states.find((s) => s.agentId === 1);
    const failing = states.find((s) => s.agentId === 2);
    const alsoHealthy = states.find((s) => s.agentId === 3);

    expect(healthy?.status).toBe('active');
    expect(healthy?.balance).toBe(5.0);
    expect(failing?.status).toBe('error');
    expect(failing?.lastError).toBe('simulated RPC failure');
    expect(alsoHealthy?.status).toBe('active');
    expect(alsoHealthy?.balance).toBe(10.0);

    // Addresses are still real and distinct
    expect(healthy?.address).not.toBe(failing?.address);
    expect(failing?.address).not.toBe(alsoHealthy?.address);

    consoleSpy.mockRestore();
    runtime.stop();
  });

  it('collectStates returns fresh data with real wallet addresses', async () => {
    const wallet = createAutarchWallet(walletConfig);

    const updatingGetBalance = vi.fn<() => Promise<Balance>>()
      .mockResolvedValueOnce({ lamports: 1_000_000_000n, sol: 1.0 })
      .mockResolvedValue({ lamports: 2_000_000_000n, sol: 2.0 });

    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeAgentConfig({ name: 'Updater', intervalMs: 1000 }),
          wallet: await wallet.getAgent(1),
          getBalance: updatingGetBalance,
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // First tick got 1.0 SOL
    expect(runtime.getStates()[0]?.balance).toBe(1.0);

    // collectStates triggers a fresh balance fetch → 2.0 SOL
    const freshStates = await runtime.collectStates();
    expect(freshStates[0]?.balance).toBe(2.0);
    expect(freshStates[0]?.address).toBe(await wallet.getAddress(1));

    runtime.stop();
  });

  it('runtime handles agents across a range of agentIds (non-sequential)', async () => {
    const wallet = createAutarchWallet(walletConfig);
    const agentIds = [1, 5, 42, 100];
    const options = await buildRuntimeOptions(agentIds);
    const runtime = new AgentRuntime(options);

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    expect(states).toHaveLength(4);

    const addresses = new Set<string>();
    for (const state of states) {
      expect(state.status).toBe('active');
      const expected = await wallet.getAddress(state.agentId);
      expect(state.address).toBe(expected);
      addresses.add(state.address);
    }

    // All addresses unique
    expect(addresses.size).toBe(4);

    runtime.stop();
  });
});
