import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track all FileWatcher instances created during tests
interface MockFileWatcherInstance {
  filePath: string;
  onReload: (config: import('../src/types.js').AgentConfig) => void;
  onError: (error: string) => void;
  start: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isWatching: ReturnType<typeof vi.fn>;
}
const fileWatcherInstances: MockFileWatcherInstance[] = [];

vi.mock('../src/file-watcher.js', () => {
  class MockFileWatcher {
    filePath: string;
    onReload: (config: import('../src/types.js').AgentConfig) => void;
    onError: (error: string) => void;
    start = vi.fn();
    close = vi.fn();
    isWatching = vi.fn().mockReturnValue(true);

    constructor(
      filePath: string,
      onReload: (config: import('../src/types.js').AgentConfig) => void,
      onError: (error: string) => void,
    ) {
      this.filePath = filePath;
      this.onReload = onReload;
      this.onError = onError;
      fileWatcherInstances.push(this);
    }
  }
  return { FileWatcher: MockFileWatcher };
});

import { AgentRuntime } from '../src/runtime.js';
import type { AgentConfig, AgentState, AgentLifecycleEvent, AgentRuntimeOptions, MarketDataProvider, MarketData, MarketUpdateEvent, RulesReloadedEvent, SimulationModeEvent } from '../src/types.js';
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

/** Build runtime options with N agents. */
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

describe('AgentRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fileWatcherInstances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates agents from options', () => {
    const runtime = new AgentRuntime(makeOptions(3));

    expect(runtime.getAgent(1)).toBeDefined();
    expect(runtime.getAgent(2)).toBeDefined();
    expect(runtime.getAgent(3)).toBeDefined();
    expect(runtime.getAgent(99)).toBeUndefined();
  });

  it('start() starts all agents concurrently (FR9)', async () => {
    const runtime = new AgentRuntime(makeOptions(3));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    expect(states).toHaveLength(3);
    for (const state of states) {
      expect(state.status).toBe('active');
      expect(state.tickCount).toBe(1);
    }
  });

  it('stop(agentId) stops only that agent, others continue (FR10)', async () => {
    const runtime = new AgentRuntime(makeOptions(3));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    runtime.stop(2);

    const states = runtime.getStates();
    const agent2 = states.find(s => s.agentId === 2);
    expect(agent2?.status).toBe('stopped');

    // Others still active
    const agent1 = states.find(s => s.agentId === 1);
    const agent3 = states.find(s => s.agentId === 3);
    expect(agent1?.status).toBe('active');
    expect(agent3?.status).toBe('active');

    // Others still tick
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    const updatedStates = runtime.getStates();
    expect(updatedStates.find(s => s.agentId === 1)?.tickCount).toBe(2);
    expect(updatedStates.find(s => s.agentId === 3)?.tickCount).toBe(2);
    expect(updatedStates.find(s => s.agentId === 2)?.tickCount).toBe(1); // no more ticks

    runtime.stop();
  });

  it('stop() (no args) stops all agents', async () => {
    const runtime = new AgentRuntime(makeOptions(3));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    runtime.stop();

    const states = runtime.getStates();
    for (const state of states) {
      expect(state.status).toBe('stopped');
    }
  });

  it('agentLifecycle event emitted on start with started for each agent', async () => {
    const runtime = new AgentRuntime(makeOptions(3));
    const lifecycleEvents: AgentLifecycleEvent[] = [];
    runtime.on('agentLifecycle', (event: AgentLifecycleEvent) => lifecycleEvents.push(event));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const startEvents = lifecycleEvents.filter(e => e.event === 'started');
    expect(startEvents).toHaveLength(3);
    expect(startEvents.map(e => e.agentId).sort()).toEqual([1, 2, 3]);

    runtime.stop();
  });

  it('repeated start() does not emit duplicate started events', async () => {
    const runtime = new AgentRuntime(makeOptions(2));
    const lifecycleEvents: AgentLifecycleEvent[] = [];
    runtime.on('agentLifecycle', (event: AgentLifecycleEvent) => lifecycleEvents.push(event));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    runtime.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);

    const startEvents = lifecycleEvents.filter(e => e.event === 'started');
    expect(startEvents).toHaveLength(2);

    runtime.stop();
  });

  it('agentLifecycle event emitted on stop with stopped', async () => {
    const runtime = new AgentRuntime(makeOptions(2));
    const lifecycleEvents: AgentLifecycleEvent[] = [];
    runtime.on('agentLifecycle', (event: AgentLifecycleEvent) => lifecycleEvents.push(event));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    runtime.stop(1);

    const stopEvents = lifecycleEvents.filter(e => e.event === 'stopped');
    expect(stopEvents).toHaveLength(1);
    expect(stopEvents[0]!.agentId).toBe(1);

    runtime.stop();
  });

  it('agentLifecycle event emitted on auto-stop with auto-stopped', async () => {
    const failingGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig(),
          wallet: makeMockWallet(),
          getBalance: failingGetBalance,
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    const lifecycleEvents: AgentLifecycleEvent[] = [];
    runtime.on('agentLifecycle', (event: AgentLifecycleEvent) => lifecycleEvents.push(event));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0); // error 1

    for (let i = 0; i < MAX_CONSECUTIVE_ERRORS - 1; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    }

    const autoStopEvents = lifecycleEvents.filter(e => e.event === 'auto-stopped');
    expect(autoStopEvents).toHaveLength(1);
    expect(autoStopEvents[0]!.agentId).toBe(1);

    consoleSpy.mockRestore();
  });

  it('agentLifecycle event emitted on error', async () => {
    const failingGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig(),
          wallet: makeMockWallet(),
          getBalance: failingGetBalance,
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    const lifecycleEvents: AgentLifecycleEvent[] = [];
    runtime.on('agentLifecycle', (event: AgentLifecycleEvent) => lifecycleEvents.push(event));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const errorEvents = lifecycleEvents.filter(e => e.event === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.agentId).toBe(1);
    expect(errorEvents[0]!.reason).toBe('fail');

    consoleSpy.mockRestore();
  });

  it('getStates() returns all agent states', async () => {
    const runtime = new AgentRuntime(makeOptions(3));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    expect(states).toHaveLength(3);
    expect(states.map(s => s.agentId).sort()).toEqual([1, 2, 3]);
  });

  it('one agent error does not affect sibling state collection (NFR16)', async () => {
    const failingGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const options: AgentRuntimeOptions = {
      agents: [
        { agentId: 1, config: makeConfig({ name: 'OK Agent' }), wallet: makeMockWallet('addr-1'), getBalance: makeMockGetBalance(5.0) },
        { agentId: 2, config: makeConfig({ name: 'Failing Agent' }), wallet: makeMockWallet('addr-2'), getBalance: failingGetBalance },
        { agentId: 3, config: makeConfig({ name: 'OK Agent 2' }), wallet: makeMockWallet('addr-3'), getBalance: makeMockGetBalance(3.0) },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    expect(states).toHaveLength(3);

    const agent1 = states.find(s => s.agentId === 1);
    const agent2 = states.find(s => s.agentId === 2);
    const agent3 = states.find(s => s.agentId === 3);

    expect(agent1?.status).toBe('active');
    expect(agent1?.balance).toBe(5.0);
    expect(agent2?.status).toBe('error');
    expect(agent3?.status).toBe('active');
    expect(agent3?.balance).toBe(3.0);

    consoleSpy.mockRestore();
    runtime.stop();
  });

  it('stateUpdate event emitted when agent state changes', async () => {
    const runtime = new AgentRuntime(makeOptions(1));
    const stateUpdates: AgentState[] = [];
    runtime.on('stateUpdate', (state: AgentState) => stateUpdates.push(state));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // At least initial state + tick state
    expect(stateUpdates.length).toBeGreaterThanOrEqual(1);
    expect(stateUpdates.some(s => s.status === 'active')).toBe(true);

    runtime.stop();
  });

  it('runtime cleanup on stop — all intervals cleared, no resource leaks', async () => {
    const options = makeOptions(3);
    const getBalanceFns = options.agents.map(a => a.getBalance);
    const runtime = new AgentRuntime(options);

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    runtime.stop();

    // Record call counts after stop
    const callsAfterStop = getBalanceFns.map(fn => (fn as ReturnType<typeof vi.fn>).mock.calls.length);

    // Advance time — no more ticks should occur
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS * 5);

    for (let i = 0; i < getBalanceFns.length; i++) {
      expect((getBalanceFns[i] as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterStop[i]);
    }
  });

  it('collectStates() uses fault isolation and returns last-known-good state on failures', async () => {
    const flappyGetBalance = vi.fn<() => Promise<Balance>>()
      .mockResolvedValueOnce({ lamports: 2000000000n, sol: 2.0 })
      .mockRejectedValue(new Error('refresh failed'));
    const steadyGetBalance = vi.fn<() => Promise<Balance>>()
      .mockResolvedValueOnce({ lamports: 1000000000n, sol: 1.0 })
      .mockResolvedValue({ lamports: 1500000000n, sol: 1.5 });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const runtime = new AgentRuntime({
      agents: [
        { agentId: 1, config: makeConfig({ name: 'Flappy' }), wallet: makeMockWallet('addr-1'), getBalance: flappyGetBalance },
        { agentId: 2, config: makeConfig({ name: 'Steady' }), wallet: makeMockWallet('addr-2'), getBalance: steadyGetBalance },
      ],
      marketProvider: makeMockMarketProvider(),
    });

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = await runtime.collectStates();
    const flappy = states.find(s => s.agentId === 1);
    const steady = states.find(s => s.agentId === 2);

    expect(flappy?.balance).toBe(2.0);
    expect(steady?.balance).toBe(1.5);

    consoleSpy.mockRestore();
    runtime.stop();
  });

  // ─── File Watcher Integration Tests (Story 2.7) ─────────────

  it('creates FileWatcher when configPath is provided', () => {
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

    new AgentRuntime(options);

    expect(fileWatcherInstances).toHaveLength(1);
    expect(fileWatcherInstances[0]!.filePath).toBe('/path/to/config.json');
  });

  it('does NOT create FileWatcher when configPath is absent', () => {
    new AgentRuntime(makeOptions(2));

    expect(fileWatcherInstances).toHaveLength(0);
  });

  it('emits rulesReloaded event with success: true on valid reload', async () => {
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
    const events: RulesReloadedEvent[] = [];
    runtime.on('rulesReloaded', (e: RulesReloadedEvent) => events.push(e));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Simulate successful reload via the captured callback
    const newConfig = makeConfig({ name: 'Reloaded Agent' });
    fileWatcherInstances[0]!.onReload(newConfig);

    expect(events).toHaveLength(1);
    expect(events[0]!.agentId).toBe(1);
    expect(events[0]!.success).toBe(true);
    expect(events[0]!.error).toBeUndefined();
    expect(typeof events[0]!.timestamp).toBe('number');

    runtime.stop();
  });

  it('emits rulesReloaded event with success: false and error on invalid reload', async () => {
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
    const events: RulesReloadedEvent[] = [];
    runtime.on('rulesReloaded', (e: RulesReloadedEvent) => events.push(e));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Simulate failed reload
    fileWatcherInstances[0]!.onError('Invalid JSON in config file');

    expect(events).toHaveLength(1);
    expect(events[0]!.agentId).toBe(1);
    expect(events[0]!.success).toBe(false);
    expect(events[0]!.error).toBe('Invalid JSON in config file');

    runtime.stop();
  });

  it('stop(agentId) closes that agents watcher (AC: #5)', async () => {
    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig(),
          configPath: '/path/to/config1.json',
          wallet: makeMockWallet('addr-1'),
          getBalance: makeMockGetBalance(),
        },
        {
          agentId: 2,
          config: makeConfig({ name: 'Agent 2' }),
          configPath: '/path/to/config2.json',
          wallet: makeMockWallet('addr-2'),
          getBalance: makeMockGetBalance(),
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    runtime.stop(1);

    // Agent 1's watcher should be closed
    const watcher1 = fileWatcherInstances.find(w => w.filePath === '/path/to/config1.json');
    expect(watcher1!.close).toHaveBeenCalledOnce();

    // Agent 2's watcher should NOT be closed
    const watcher2 = fileWatcherInstances.find(w => w.filePath === '/path/to/config2.json');
    expect(watcher2!.close).not.toHaveBeenCalled();

    runtime.stop();
  });

  it('stop() (all) closes all watchers (AC: #6)', async () => {
    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig(),
          configPath: '/path/to/config1.json',
          wallet: makeMockWallet('addr-1'),
          getBalance: makeMockGetBalance(),
        },
        {
          agentId: 2,
          config: makeConfig({ name: 'Agent 2' }),
          configPath: '/path/to/config2.json',
          wallet: makeMockWallet('addr-2'),
          getBalance: makeMockGetBalance(),
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    runtime.stop();

    for (const instance of fileWatcherInstances) {
      expect(instance.close).toHaveBeenCalledOnce();
    }
  });

  it('stop() then start() restarts existing watchers', async () => {
    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig(),
          configPath: '/path/to/config1.json',
          wallet: makeMockWallet('addr-1'),
          getBalance: makeMockGetBalance(),
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const watcher = fileWatcherInstances[0]!;
    expect(watcher.start).toHaveBeenCalledTimes(1);

    runtime.stop();
    expect(watcher.close).toHaveBeenCalledTimes(1);

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(watcher.start).toHaveBeenCalledTimes(2);

    runtime.stop();
  });

  it('agent continues with old rules after failed reload (AC: #3)', async () => {
    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig({ name: 'Original' }),
          configPath: '/path/to/config.json',
          wallet: makeMockWallet(),
          getBalance: makeMockGetBalance(),
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Agent should have original config
    const statesBefore = runtime.getStates();
    expect(statesBefore[0]!.name).toBe('Original');

    // Simulate failed reload — error callback fires, no config change
    fileWatcherInstances[0]!.onError('Schema validation failed');

    // Agent still has original config
    const statesAfter = runtime.getStates();
    expect(statesAfter[0]!.name).toBe('Original');

    runtime.stop();
  });

  it('agent uses new rules after successful reload (AC: #2)', async () => {
    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig({ name: 'Original' }),
          configPath: '/path/to/config.json',
          wallet: makeMockWallet(),
          getBalance: makeMockGetBalance(),
        },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(runtime.getStates()[0]!.name).toBe('Original');

    // Simulate successful reload with new config
    const newConfig = makeConfig({ name: 'Reloaded', strategy: 'New Strategy' });
    fileWatcherInstances[0]!.onReload(newConfig);

    // Next tick should use new config — advance to trigger next interval
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);

    const state = runtime.getStates()[0]!;
    expect(state.name).toBe('Reloaded');
    expect(state.strategy).toBe('New Strategy');

    runtime.stop();
  });

  // ─── DecisionModule Propagation Tests (Story 2.8) ─────────────

  it('6.19 Runtime creates per-agent RuleBasedDecisionModule when no custom module provided', async () => {
    const runtime = new AgentRuntime(makeOptions(2));
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Each agent uses default RuleBasedDecisionModule — rules fire normally
    const states = runtime.getStates();
    for (const state of states) {
      expect(state.lastDecision).toBeDefined();
      expect(state.lastDecision!.decision.action).toBe('buy');
    }

    runtime.stop();
  });

  it('6.20 Runtime passes custom DecisionModule to all agents when provided', async () => {
    const evaluateSpy = vi.fn<(ctx: import('../src/types.js').EvaluationContext) => Promise<import('../src/types.js').DecisionResult>>().mockImplementation(async (ctx) => {
      const { buildDecisionTrace } = await import('../src/trace.js');
      return {
        action: 'none' as const,
        reason: 'custom module',
        trace: buildDecisionTrace(ctx.agentState.agentId, {
          evaluations: [],
          decision: { action: 'none' as const, reason: 'custom module' },
        }, ctx.marketData),
      };
    });
    const customModule: import('../src/types.js').DecisionModule = { evaluate: evaluateSpy };

    const options = { ...makeOptions(3), decisionModule: customModule };
    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Custom module was called for all 3 agents
    expect(evaluateSpy).toHaveBeenCalledTimes(3);

    // All agents get 'none' from custom module
    const states = runtime.getStates();
    for (const state of states) {
      expect(state.lastDecision!.decision.action).toBe('none');
      expect(state.lastDecision!.decision.reason).toBe('custom module');
    }

    runtime.stop();
  });

  it('6.21 Runtime with custom module — all agents share the same module instance', async () => {
    const evaluateCallContexts: number[] = [];
    const customModule: import('../src/types.js').DecisionModule = {
      evaluate: vi.fn<(ctx: import('../src/types.js').EvaluationContext) => Promise<import('../src/types.js').DecisionResult>>().mockImplementation(async (ctx) => {
        evaluateCallContexts.push(ctx.agentState.agentId);
        const { buildDecisionTrace } = await import('../src/trace.js');
        return {
          action: 'none' as const,
          reason: 'shared',
          trace: buildDecisionTrace(ctx.agentState.agentId, {
            evaluations: [],
            decision: { action: 'none' as const, reason: 'shared' },
          }, ctx.marketData),
        };
      }),
    };

    const options = { ...makeOptions(2), decisionModule: customModule };
    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Same instance was called for both agents (verified by tracking agentIds)
    expect(evaluateCallContexts.sort()).toEqual([1, 2]);
    expect(customModule.evaluate).toHaveBeenCalledTimes(2);

    runtime.stop();
  });

  it('stopping one agent does not reset shared custom DecisionModule state for running agents', async () => {
    const resetSpy = vi.fn();
    const evaluateSpy = vi.fn<(ctx: import('../src/types.js').EvaluationContext) => Promise<import('../src/types.js').DecisionResult>>().mockImplementation(async (ctx) => {
      const { buildDecisionTrace } = await import('../src/trace.js');
      return {
        action: 'none',
        reason: 'shared',
        trace: buildDecisionTrace(ctx.agentState.agentId, {
          evaluations: [],
          decision: { action: 'none', reason: 'shared' },
        }, ctx.marketData),
      };
    });
    const sharedModule: import('../src/types.js').DecisionModule = {
      evaluate: evaluateSpy,
      reset: resetSpy,
    };

    const runtime = new AgentRuntime({ ...makeOptions(2), decisionModule: sharedModule });
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    runtime.stop(1);
    expect(resetSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    const agent2Calls = evaluateSpy.mock.calls.filter(call => call[0].agentState.agentId === 2);
    expect(agent2Calls.length).toBeGreaterThanOrEqual(2);

    runtime.stop();
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('6.22 Runtime without custom module — agents have independent cooldown tracking', async () => {
    // Use short interval so second tick fires within cooldown (60s)
    const options: AgentRuntimeOptions = {
      agents: Array.from({ length: 2 }, (_, i) => ({
        agentId: i + 1,
        config: makeConfig({ name: `Agent ${i + 1}`, intervalMs: 5000 }),
        wallet: makeMockWallet(`address-${i + 1}`),
        getBalance: makeMockGetBalance(1.0 + i),
      })),
      marketProvider: makeMockMarketProvider(),
    };
    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Both agents should fire on first tick (independent cooldowns)
    const states1 = runtime.getStates();
    expect(states1.find(s => s.agentId === 1)!.lastDecision!.decision.action).toBe('buy');
    expect(states1.find(s => s.agentId === 2)!.lastDecision!.decision.action).toBe('buy');

    // On second tick (5s), within 60s cooldown, both should be blocked independently
    await vi.advanceTimersByTimeAsync(5000);
    const states2 = runtime.getStates();
    expect(states2.find(s => s.agentId === 1)!.lastDecision!.decision.action).toBe('none');
    expect(states2.find(s => s.agentId === 2)!.lastDecision!.decision.action).toBe('none');

    runtime.stop();
  });

  it('6.23 Existing runtime tests still pass with RuleBasedDecisionModule as default (no regressions)', async () => {
    // This test verifies the baseline: runtime creates agents with default module,
    // agents tick, evaluate rules, and produce correct states — same as pre-2.8 behavior
    const runtime = new AgentRuntime(makeOptions(3));
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    expect(states).toHaveLength(3);
    for (const state of states) {
      expect(state.tickCount).toBe(1);
      expect(state.lastDecision).toBeDefined();
    }

    runtime.stop();
  });

  // ─── Market Control Tests (Story 2.9, AC #4, #5) ─────────────

  it('injectDip calls marketProvider.injectDip and emits marketUpdate event', () => {
    const mockProvider = makeMockMarketProvider();
    const runtime = new AgentRuntime({ ...makeOptions(1), marketProvider: mockProvider });
    const events: MarketUpdateEvent[] = [];
    runtime.on('marketUpdate', (e: MarketUpdateEvent) => events.push(e));

    runtime.injectDip(10);

    expect(mockProvider.injectDip).toHaveBeenCalledWith(10);
    expect(mockProvider.getSnapshot).toHaveBeenCalledOnce();
    expect(mockProvider.getCurrentData).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]!.marketData).toBeDefined();
    expect(typeof events[0]!.timestamp).toBe('number');
  });

  it('injectRally calls marketProvider.injectRally and emits marketUpdate event', () => {
    const mockProvider = makeMockMarketProvider();
    const runtime = new AgentRuntime({ ...makeOptions(1), marketProvider: mockProvider });
    const events: MarketUpdateEvent[] = [];
    runtime.on('marketUpdate', (e: MarketUpdateEvent) => events.push(e));

    runtime.injectRally(15);

    expect(mockProvider.injectRally).toHaveBeenCalledWith(15);
    expect(mockProvider.getSnapshot).toHaveBeenCalledOnce();
    expect(mockProvider.getCurrentData).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]!.marketData).toBeDefined();
    expect(typeof events[0]!.timestamp).toBe('number');
  });

  it('resetMarket calls marketProvider.resetToBaseline and emits marketUpdate event', () => {
    const mockProvider = makeMockMarketProvider();
    const runtime = new AgentRuntime({ ...makeOptions(1), marketProvider: mockProvider });
    const events: MarketUpdateEvent[] = [];
    runtime.on('marketUpdate', (e: MarketUpdateEvent) => events.push(e));

    runtime.resetMarket();

    expect(mockProvider.resetToBaseline).toHaveBeenCalledOnce();
    expect(mockProvider.getSnapshot).toHaveBeenCalledOnce();
    expect(mockProvider.getCurrentData).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]!.marketData).toBeDefined();
    expect(typeof events[0]!.timestamp).toBe('number');
  });

  it('marketUpdate event payload includes marketData and timestamp', () => {
    const mockProvider = makeMockMarketProvider();
    const runtime = new AgentRuntime({ ...makeOptions(1), marketProvider: mockProvider });
    const events: MarketUpdateEvent[] = [];
    runtime.on('marketUpdate', (e: MarketUpdateEvent) => events.push(e));

    runtime.injectDip(5);

    const payload = events[0]!;
    expect(payload.marketData.price).toBe(100);
    expect(payload.marketData.source).toBe('injected');
    expect(payload.timestamp).toBeGreaterThan(0);
  });

  it('market controls work with mock market provider (no real data dependency)', () => {
    const mockProvider = makeMockMarketProvider();
    const runtime = new AgentRuntime({ ...makeOptions(1), marketProvider: mockProvider });
    const events: MarketUpdateEvent[] = [];
    runtime.on('marketUpdate', (e: MarketUpdateEvent) => events.push(e));

    runtime.injectDip(5);
    runtime.injectRally(10);
    runtime.resetMarket();

    expect(mockProvider.injectDip).toHaveBeenCalledWith(5);
    expect(mockProvider.injectRally).toHaveBeenCalledWith(10);
    expect(mockProvider.resetToBaseline).toHaveBeenCalledOnce();
    expect(events).toHaveLength(3);
  });

  it('market controls work with default SimulatedMarketDataProvider', () => {
    const runtime = new AgentRuntime({
      agents: [{
        agentId: 1,
        config: makeConfig(),
        wallet: makeMockWallet(),
        getBalance: makeMockGetBalance(),
      }],
    });
    const events: MarketUpdateEvent[] = [];
    runtime.on('marketUpdate', (e: MarketUpdateEvent) => events.push(e));

    runtime.injectDip(10);
    expect(events).toHaveLength(1);
    expect(events[0]!.marketData.price).toBeLessThan(100);
    expect(events[0]!.marketData.source).toBe('injected');

    runtime.injectRally(5);
    expect(events).toHaveLength(2);
    expect(events[1]!.marketData.source).toBe('injected');

    runtime.resetMarket();
    expect(events).toHaveLength(3);
    expect(events[2]!.marketData.price).toBe(100);
    expect(events[2]!.marketData.source).toBe('simulated');
  });

  // ─── SimulationMode Event Tests (Story 2.9, AC #2, #5) ─────────────

  it('reportSimulationMode(true, reason) emits simulationMode event', () => {
    const runtime = new AgentRuntime(makeOptions(1));
    const events: SimulationModeEvent[] = [];
    runtime.on('simulationMode', (e: SimulationModeEvent) => events.push(e));

    runtime.reportSimulationMode(true, 'All RPC endpoints failed');

    expect(events).toHaveLength(1);
    expect(events[0]!.active).toBe(true);
    expect(events[0]!.reason).toBe('All RPC endpoints failed');
  });

  it('reportSimulationMode(false, reason) emits simulationMode event', () => {
    const runtime = new AgentRuntime(makeOptions(1));
    const events: SimulationModeEvent[] = [];
    runtime.on('simulationMode', (e: SimulationModeEvent) => events.push(e));

    runtime.reportSimulationMode(false, 'RPC endpoint recovered');

    expect(events).toHaveLength(1);
    expect(events[0]!.active).toBe(false);
    expect(events[0]!.reason).toBe('RPC endpoint recovered');
  });

  it('simulationMode event payload includes active, reason, and timestamp', () => {
    const runtime = new AgentRuntime(makeOptions(1));
    const events: SimulationModeEvent[] = [];
    runtime.on('simulationMode', (e: SimulationModeEvent) => events.push(e));

    runtime.reportSimulationMode(true, 'degraded');

    const payload = events[0]!;
    expect(typeof payload.active).toBe('boolean');
    expect(typeof payload.reason).toBe('string');
    expect(typeof payload.timestamp).toBe('number');
    expect(payload.timestamp).toBeGreaterThan(0);
  });

  // ─── Existing Event Contract Verification (Story 2.9, AC #1, #2, #3, #5) ─────────────

  it('getStates() returns complete state for all registered agents', async () => {
    const runtime = new AgentRuntime(makeOptions(3));
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    expect(states).toHaveLength(3);
    for (const state of states) {
      expect(state.agentId).toBeDefined();
      expect(state.name).toBeDefined();
      expect(state.strategy).toBeDefined();
      expect(state.status).toBe('active');
      expect(state.address).toBeDefined();
      expect(typeof state.balance).toBe('number');
    }

    runtime.stop();
  });

  it('runtime events testable with mock agents — no real wallet dependency', () => {
    const mockProvider = makeMockMarketProvider();
    const runtime = new AgentRuntime({
      agents: [{
        agentId: 1,
        config: makeConfig(),
        wallet: makeMockWallet(),
        getBalance: makeMockGetBalance(),
      }],
      marketProvider: mockProvider,
    });
    const marketEvents: MarketUpdateEvent[] = [];
    const simEvents: SimulationModeEvent[] = [];
    runtime.on('marketUpdate', (e: MarketUpdateEvent) => marketEvents.push(e));
    runtime.on('simulationMode', (e: SimulationModeEvent) => simEvents.push(e));

    runtime.injectDip(10);
    runtime.reportSimulationMode(true, 'test');

    expect(marketEvents).toHaveLength(1);
    expect(simEvents).toHaveLength(1);
  });
});
