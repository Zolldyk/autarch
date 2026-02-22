import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRuntime } from '../src/runtime.js';
import type { AgentConfig, AgentLifecycleEvent, AgentRuntimeOptions, MarketDataProvider, MarketData } from '../src/types.js';
import type { AgentWallet, Balance } from '@autarch/core';
import { DEFAULT_INTERVAL_MS, MAX_CONSECUTIVE_ERRORS } from '../src/constants.js';

/** Minimal valid AgentConfig for testing. */
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'Test Agent',
    strategy: 'Buy the dip',
    rules: [
      {
        name: 'rule-1',
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

function makeMockWallet(address = 'mock-address-base58'): AgentWallet {
  return {
    address,
    signTransaction: vi.fn(),
  };
}

function makeMockGetBalance(sol = 1.0): ReturnType<typeof vi.fn<() => Promise<Balance>>> {
  return vi.fn<() => Promise<Balance>>().mockResolvedValue({ lamports: BigInt(sol * 1e9), sol });
}

function makeMockMarketProvider(): MarketDataProvider {
  const snapshot: MarketData = {
    price: 100,
    priceChange1m: -10,
    priceChange5m: -8,
    volumeChange1m: 50,
    timestamp: Date.now(),
    source: 'simulated',
  };
  return {
    getCurrentData: vi.fn<() => MarketData>().mockReturnValue({ ...snapshot }),
    getSnapshot: vi.fn<() => MarketData>().mockImplementation(() => ({ ...snapshot })),
    getHistory: vi.fn().mockReturnValue([]),
    injectDip: vi.fn(),
    injectRally: vi.fn(),
    resetToBaseline: vi.fn(),
  };
}

describe('Story 2.2 — Agent Lifecycle & Concurrency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-stopped agent does not affect sibling agents — siblings keep ticking (NFR16)', async () => {
    const failingGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('network down'));
    const healthyGetBalance1 = makeMockGetBalance(5.0);
    const healthyGetBalance2 = makeMockGetBalance(3.0);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const options: AgentRuntimeOptions = {
      agents: [
        { agentId: 1, config: makeConfig({ name: 'Healthy A' }), wallet: makeMockWallet('addr-1'), getBalance: healthyGetBalance1 },
        { agentId: 2, config: makeConfig({ name: 'Failing Agent' }), wallet: makeMockWallet('addr-2'), getBalance: failingGetBalance },
        { agentId: 3, config: makeConfig({ name: 'Healthy B' }), wallet: makeMockWallet('addr-3'), getBalance: healthyGetBalance2 },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    const lifecycleEvents: AgentLifecycleEvent[] = [];
    runtime.on('agentLifecycle', (event: AgentLifecycleEvent) => lifecycleEvents.push(event));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0); // immediate tick — error 1 for agent 2

    // Drive agent 2 to auto-stop (5 consecutive errors)
    for (let i = 0; i < MAX_CONSECUTIVE_ERRORS - 1; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    }

    // Verify agent 2 auto-stopped
    const autoStopEvents = lifecycleEvents.filter(e => e.event === 'auto-stopped');
    expect(autoStopEvents).toHaveLength(1);
    expect(autoStopEvents[0]!.agentId).toBe(2);

    // Record healthy agent tick counts at auto-stop point
    const states = runtime.getStates();
    const agent1TicksBefore = states.find(s => s.agentId === 1)!.tickCount;
    const agent3TicksBefore = states.find(s => s.agentId === 3)!.tickCount;

    // Advance several more intervals — siblings should keep ticking
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS * 3);

    const updatedStates = runtime.getStates();
    const agent1 = updatedStates.find(s => s.agentId === 1)!;
    const agent2 = updatedStates.find(s => s.agentId === 2)!;
    const agent3 = updatedStates.find(s => s.agentId === 3)!;

    expect(agent1.status).toBe('active');
    expect(agent1.tickCount).toBe(agent1TicksBefore + 3);
    expect(agent3.status).toBe('active');
    expect(agent3.tickCount).toBe(agent3TicksBefore + 3);

    // Agent 2 stays stopped — no more ticks
    expect(agent2.status).toBe('stopped');

    consoleSpy.mockRestore();
    runtime.stop();
  });

  it('agents with different intervalMs tick independently at their own rates', async () => {
    const getBalance1 = makeMockGetBalance(1.0);
    const getBalance2 = makeMockGetBalance(2.0);
    const getBalance3 = makeMockGetBalance(3.0);

    const options: AgentRuntimeOptions = {
      agents: [
        { agentId: 1, config: makeConfig({ name: 'Fast', intervalMs: 5000 }), wallet: makeMockWallet('addr-1'), getBalance: getBalance1 },
        { agentId: 2, config: makeConfig({ name: 'Medium', intervalMs: 10000 }), wallet: makeMockWallet('addr-2'), getBalance: getBalance2 },
        { agentId: 3, config: makeConfig({ name: 'Slow', intervalMs: 20000 }), wallet: makeMockWallet('addr-3'), getBalance: getBalance3 },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);

    runtime.start();
    await vi.advanceTimersByTimeAsync(0); // immediate tick for all
    expect(getBalance1).toHaveBeenCalledTimes(1);
    expect(getBalance2).toHaveBeenCalledTimes(1);
    expect(getBalance3).toHaveBeenCalledTimes(1);

    // At 5s: only fast agent ticks again
    await vi.advanceTimersByTimeAsync(5000);
    expect(getBalance1).toHaveBeenCalledTimes(2);
    expect(getBalance2).toHaveBeenCalledTimes(1);
    expect(getBalance3).toHaveBeenCalledTimes(1);

    // At 10s: fast has ticked again, medium ticks
    await vi.advanceTimersByTimeAsync(5000);
    expect(getBalance1).toHaveBeenCalledTimes(3);
    expect(getBalance2).toHaveBeenCalledTimes(2);
    expect(getBalance3).toHaveBeenCalledTimes(1);

    // At 20s: fast 2 more, medium 1 more, slow finally ticks
    await vi.advanceTimersByTimeAsync(10000);
    expect(getBalance1).toHaveBeenCalledTimes(5);
    expect(getBalance2).toHaveBeenCalledTimes(3);
    expect(getBalance3).toHaveBeenCalledTimes(2);

    runtime.stop();
  });

  it('stop() on already-stopped agent is safe and does not emit duplicate events', async () => {
    const options: AgentRuntimeOptions = {
      agents: [
        { agentId: 1, config: makeConfig({ name: 'Agent 1' }), wallet: makeMockWallet('addr-1'), getBalance: makeMockGetBalance() },
        { agentId: 2, config: makeConfig({ name: 'Agent 2' }), wallet: makeMockWallet('addr-2'), getBalance: makeMockGetBalance() },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    const lifecycleEvents: AgentLifecycleEvent[] = [];
    runtime.on('agentLifecycle', (event: AgentLifecycleEvent) => lifecycleEvents.push(event));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Stop agent 1
    runtime.stop(1);
    const stopEventsAfterFirst = lifecycleEvents.filter(e => e.event === 'stopped').length;
    expect(stopEventsAfterFirst).toBe(1);

    // Stop agent 1 again — should be safe
    runtime.stop(1);
    const stopEventsAfterSecond = lifecycleEvents.filter(e => e.event === 'stopped').length;
    expect(stopEventsAfterSecond).toBe(1); // no duplicate

    // Agent 2 still running
    const agent2 = runtime.getStates().find(s => s.agentId === 2);
    expect(agent2?.status).toBe('active');

    runtime.stop();
  });

  it('auto-stopped agent produces no further ticks after threshold', async () => {
    let tickCount = 0;
    const countingGetBalance = vi.fn<() => Promise<Balance>>().mockImplementation(() => {
      tickCount++;
      return Promise.reject(new Error('always fail'));
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const options: AgentRuntimeOptions = {
      agents: [
        { agentId: 1, config: makeConfig(), wallet: makeMockWallet(), getBalance: countingGetBalance },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0); // error 1

    for (let i = 0; i < MAX_CONSECUTIVE_ERRORS - 1; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    }

    // Agent should have auto-stopped at exactly MAX_CONSECUTIVE_ERRORS ticks
    expect(tickCount).toBe(MAX_CONSECUTIVE_ERRORS);
    expect(runtime.getStates()[0]!.status).toBe('stopped');

    // Advance a long time — no more ticks
    const tickCountAtAutoStop = tickCount;
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS * 10);
    expect(tickCount).toBe(tickCountAtAutoStop);

    consoleSpy.mockRestore();
  });
});
