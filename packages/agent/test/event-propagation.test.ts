import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../src/file-watcher.js', () => {
  class MockFileWatcher {
    start = vi.fn();
    close = vi.fn();
    isWatching = vi.fn().mockReturnValue(true);
    constructor(
      _filePath: string,
      _onReload: (config: import('../src/types.js').AgentConfig) => void,
      _onError: (error: string) => void,
    ) {}
  }
  return { FileWatcher: MockFileWatcher };
});

import { AgentRuntime } from '../src/runtime.js';
import type { AgentConfig, AgentState, AgentRuntimeOptions, MarketDataProvider, MarketData } from '../src/types.js';
import type { AgentWallet, Balance } from '@autarch/core';
import { DEFAULT_INTERVAL_MS } from '../src/constants.js';

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
    source: 'injected',
  };
  return {
    getCurrentData: vi.fn<() => MarketData>().mockReturnValue({
      price: 100,
      priceChange1m: -10,
      priceChange5m: -8,
      volumeChange1m: 50,
      timestamp: Date.now(),
      source: 'simulated',
    }),
    getSnapshot: vi.fn<() => MarketData>().mockImplementation(() => ({ ...snapshot })),
    getHistory: vi.fn().mockReturnValue([]),
    injectDip: vi.fn(),
    injectRally: vi.fn(),
    resetToBaseline: vi.fn(),
  };
}

function makeOptions(count: number): AgentRuntimeOptions {
  return {
    agents: Array.from({ length: count }, (_, i) => ({
      agentId: i + 1,
      config: makeConfig({ name: `Agent ${i + 1}` }),
      wallet: makeMockWallet(`address-${i + 1}`),
      getBalance: makeMockGetBalance(1.0 + i),
    })),
    marketProvider: makeMockMarketProvider(),
  };
}

describe('Story 2.9 — Event Propagation & Runtime API', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── AC1: AgentRuntime is structurally an EventEmitter ─────────────

  it('AgentRuntime is instanceof EventEmitter', () => {
    const runtime = new AgentRuntime(makeOptions(1));
    expect(runtime).toBeInstanceOf(EventEmitter);
  });

  // ─── AC1: stateUpdate event payload includes complete AgentState ─────────────

  it('stateUpdate event payload contains all AgentState fields', async () => {
    const runtime = new AgentRuntime(makeOptions(1));
    const stateUpdates: AgentState[] = [];
    runtime.on('stateUpdate', (state: AgentState) => stateUpdates.push(state));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(stateUpdates.length).toBeGreaterThanOrEqual(1);

    // Find first post-tick state (active, with decision)
    const state = stateUpdates.find(s => s.tickCount > 0);
    expect(state).toBeDefined();

    // Verify all AgentState fields are present
    expect(state!.agentId).toBe(1);
    expect(state!.name).toBe('Agent 1');
    expect(state!.strategy).toBe('Buy the dip');
    expect(state!.status).toBe('active');
    expect(state!.address).toBe('address-1');
    expect(typeof state!.balance).toBe('number');
    expect(state!.lastAction).not.toBeNull();
    expect(typeof state!.lastActionTimestamp).toBe('number');
    expect(state!.consecutiveErrors).toBe(0);
    expect(state!.tickCount).toBe(1);
    expect(state!.lastError).toBeNull();
    expect(typeof state!.positionSize).toBe('number');
    expect(typeof state!.consecutiveWins).toBe('number');
    expect(typeof state!.lastTradeAmount).toBe('number');
    expect(state!.lastDecision).toBeDefined();
    expect(Array.isArray(state!.traceHistory)).toBe(true);

    runtime.stop();
  });

  // ─── AC1: stateUpdate emitted on agent stop ─────────────

  it('stateUpdate event emitted when agent is stopped via runtime.stop(agentId)', async () => {
    const runtime = new AgentRuntime(makeOptions(2));
    const stateUpdates: AgentState[] = [];
    runtime.on('stateUpdate', (state: AgentState) => stateUpdates.push(state));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Clear prior updates
    stateUpdates.length = 0;

    runtime.stop(1);

    // Should have received a stateUpdate with status 'stopped' for agent 1
    const stopUpdate = stateUpdates.find(s => s.agentId === 1 && s.status === 'stopped');
    expect(stopUpdate).toBeDefined();
    expect(stopUpdate!.agentId).toBe(1);
    expect(stopUpdate!.status).toBe('stopped');

    runtime.stop();
  });

  it('stateUpdate event emitted when all agents stopped via runtime.stop()', async () => {
    const runtime = new AgentRuntime(makeOptions(3));
    const stateUpdates: AgentState[] = [];
    runtime.on('stateUpdate', (state: AgentState) => stateUpdates.push(state));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    stateUpdates.length = 0;

    runtime.stop();

    // Each agent should emit a 'stopped' stateUpdate
    const stoppedUpdates = stateUpdates.filter(s => s.status === 'stopped');
    expect(stoppedUpdates).toHaveLength(3);
    expect(stoppedUpdates.map(s => s.agentId).sort()).toEqual([1, 2, 3]);
  });

  // ─── AC1: Multi-agent stateUpdate independence ─────────────

  it('each agent emits independent stateUpdate events on tick', async () => {
    const runtime = new AgentRuntime(makeOptions(3));
    const stateUpdates: AgentState[] = [];
    runtime.on('stateUpdate', (state: AgentState) => stateUpdates.push(state));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Each agent should have emitted at least initial + tick stateUpdates
    const agent1Updates = stateUpdates.filter(s => s.agentId === 1);
    const agent2Updates = stateUpdates.filter(s => s.agentId === 2);
    const agent3Updates = stateUpdates.filter(s => s.agentId === 3);

    expect(agent1Updates.length).toBeGreaterThanOrEqual(1);
    expect(agent2Updates.length).toBeGreaterThanOrEqual(1);
    expect(agent3Updates.length).toBeGreaterThanOrEqual(1);

    // Verify each has correct agentId consistently
    for (const update of agent1Updates) expect(update.agentId).toBe(1);
    for (const update of agent2Updates) expect(update.agentId).toBe(2);
    for (const update of agent3Updates) expect(update.agentId).toBe(3);

    runtime.stop();
  });

  it('stateUpdate events accumulate over multiple ticks per agent', async () => {
    const runtime = new AgentRuntime(makeOptions(2));
    const stateUpdates: AgentState[] = [];
    runtime.on('stateUpdate', (state: AgentState) => stateUpdates.push(state));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0); // tick 1

    const countAfterTick1 = stateUpdates.length;

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS); // tick 2

    // Each agent should have emitted additional stateUpdate for tick 2
    expect(stateUpdates.length).toBeGreaterThan(countAfterTick1);

    // Verify tick counts progressed
    const latestAgent1 = [...stateUpdates].reverse().find(s => s.agentId === 1);
    const latestAgent2 = [...stateUpdates].reverse().find(s => s.agentId === 2);
    expect(latestAgent1!.tickCount).toBe(2);
    expect(latestAgent2!.tickCount).toBe(2);

    runtime.stop();
  });

  // ─── AC1: stateUpdate on error path ─────────────

  it('stateUpdate event emitted when agent encounters tick error', async () => {
    const failingGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('network down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const options: AgentRuntimeOptions = {
      agents: [
        { agentId: 1, config: makeConfig(), wallet: makeMockWallet(), getBalance: failingGetBalance },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    const stateUpdates: AgentState[] = [];
    runtime.on('stateUpdate', (state: AgentState) => stateUpdates.push(state));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Should have emitted stateUpdate with error status
    const errorUpdate = stateUpdates.find(s => s.status === 'error');
    expect(errorUpdate).toBeDefined();
    expect(errorUpdate!.consecutiveErrors).toBe(1);
    expect(errorUpdate!.lastError).toBe('network down');

    consoleSpy.mockRestore();
    runtime.stop();
  });

  // ─── AC2: All event types carry timestamp ─────────────

  it('all runtime events include timestamp field', async () => {
    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig(),
          configPath: '/path/to/config.json',
          wallet: makeMockWallet(),
          getBalance: makeMockGetBalance(),
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    const timestamps: number[] = [];

    runtime.on('agentLifecycle', (e: { timestamp: number }) => timestamps.push(e.timestamp));
    runtime.on('marketUpdate', (e: { timestamp: number }) => timestamps.push(e.timestamp));
    runtime.on('simulationMode', (e: { timestamp: number }) => timestamps.push(e.timestamp));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    runtime.injectDip(5);
    runtime.reportSimulationMode(true, 'test');

    // All collected events should have valid timestamps
    expect(timestamps.length).toBeGreaterThanOrEqual(3); // lifecycle:started + marketUpdate + simulationMode
    for (const ts of timestamps) {
      expect(typeof ts).toBe('number');
      expect(ts).toBeGreaterThan(0);
    }

    runtime.stop();
  });

  // ─── AC5: Agent has zero knowledge of SSE/dashboard/runtime internals ─────────────

  it('Agent source has no imports of SSE, EventEmitter, or dashboard modules', async () => {
    const { readFileSync } = await import('node:fs');
    const agentSource = readFileSync(new URL('../src/agent.ts', import.meta.url), 'utf-8');

    expect(agentSource).not.toContain('EventEmitter');
    expect(agentSource).not.toContain('ServerSentEvent');
    expect(agentSource).not.toContain('SSE');
    expect(agentSource).not.toContain('express');
    expect(agentSource).not.toContain('dashboard');
  });
});
