import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { RuleBasedDecisionModule } from '../src/rule-based-decision-module.js';
import type { AgentConfig, AgentState, AgentLifecycleEvent, MarketDataProvider, MarketData, DecisionModule, DecisionResult, EvaluationContext } from '../src/types.js';
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

/** Mock wallet with no real network calls. */
function makeMockWallet(): AgentWallet {
  return {
    address: 'mock-address-base58',
    signTransaction: vi.fn(),
  };
}

/** Mock getBalance returning a fixed balance. */
function makeMockGetBalance(sol = 1.0): ReturnType<typeof vi.fn<() => Promise<Balance>>> {
  return vi.fn<() => Promise<Balance>>().mockResolvedValue({ lamports: BigInt(sol * 1e9), sol });
}

/** Mock market data provider returning controlled data. */
function makeMockMarketProvider(overrides: Partial<MarketData> = {}): MarketDataProvider {
  const snapshot: MarketData = {
    price: 100,
    priceChange1m: -10,
    priceChange5m: -8,
    volumeChange1m: 50,
    timestamp: Date.now(),
    source: 'simulated',
    ...overrides,
  };
  return {
    getCurrentData: vi.fn<() => MarketData>().mockReturnValue({
      ...snapshot,
    }),
    getSnapshot: vi.fn<() => MarketData>().mockImplementation(() => ({ ...snapshot })),
    getHistory: vi.fn().mockReturnValue([]),
    injectDip: vi.fn(),
    injectRally: vi.fn(),
    resetToBaseline: vi.fn(),
  };
}

describe('Agent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with start(), status becomes active', async () => {
    const onStateChange = vi.fn();
    const onAutoStop = vi.fn();
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [],onStateChange, onAutoStop, vi.fn(), new RuleBasedDecisionModule());

    agent.start();

    // Flush the immediate tick (async)
    await vi.advanceTimersByTimeAsync(0);

    const state = agent.getState();
    expect(state.status).toBe('active');
  });

  it('calls tick() immediately on start', async () => {
    const mockGetBalance = makeMockGetBalance(2.5);
    const onStateChange = vi.fn();
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],onStateChange, vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetBalance).toHaveBeenCalledOnce();
    expect(agent.getState().balance).toBe(2.5);
    expect(agent.getState().tickCount).toBe(1);
  });

  it('calls tick() on each interval', async () => {
    const mockGetBalance = makeMockGetBalance();
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // immediate tick

    expect(mockGetBalance).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    expect(mockGetBalance).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    expect(mockGetBalance).toHaveBeenCalledTimes(3);

    agent.stop();
  });

  it('start() is idempotent and does not create duplicate intervals', async () => {
    const mockGetBalance = makeMockGetBalance();
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetBalance).toHaveBeenCalledTimes(1);

    agent.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    expect(mockGetBalance).toHaveBeenCalledTimes(2);

    agent.stop();
  });

  it('stop() clears interval, status becomes stopped', async () => {
    const mockGetBalance = makeMockGetBalance();
    const onStateChange = vi.fn();
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],onStateChange, vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    agent.stop();

    expect(agent.getState().status).toBe('stopped');

    // Verify interval is cleared — no more ticks after stop
    const callsBefore = mockGetBalance.mock.calls.length;
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS * 3);
    expect(mockGetBalance).toHaveBeenCalledTimes(callsBefore);
  });

  it('stop() clears lastDecision and traceHistory to avoid stale decision state', async () => {
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.getState().lastDecision).toBeDefined();
    expect(agent.getState().traceHistory.length).toBeGreaterThan(0);

    agent.stop();
    const state = agent.getState();
    expect(state.status).toBe('stopped');
    expect(state.lastDecision).toBeUndefined();
    expect(state.traceHistory).toHaveLength(0);
  });

  it('error in tick sets status to error, increments consecutiveErrors', async () => {
    const mockGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('RPC timeout'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getState().status).toBe('error');
    expect(agent.getState().consecutiveErrors).toBe(1);
    expect(agent.getState().lastError).toBe('RPC timeout');

    consoleSpy.mockRestore();
    agent.stop();
  });

  it('successful tick after error resets consecutiveErrors to 0', async () => {
    let callCount = 0;
    const mockGetBalance = vi.fn<() => Promise<Balance>>().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error('fail'));
      return Promise.resolve({ lamports: 1000000000n, sol: 1.0 });
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // tick 1 — error
    expect(agent.getState().consecutiveErrors).toBe(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS); // tick 2 — error
    expect(agent.getState().consecutiveErrors).toBe(2);

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS); // tick 3 — success
    expect(agent.getState().consecutiveErrors).toBe(0);
    expect(agent.getState().status).toBe('active');

    consoleSpy.mockRestore();
    agent.stop();
  });

  it('5 consecutive errors triggers auto-stop', async () => {
    const mockGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('fail'));
    const onAutoStop = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), onAutoStop, vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    // immediate tick = error 1
    await vi.advanceTimersByTimeAsync(0);

    // 4 more interval ticks = errors 2-5
    for (let i = 0; i < MAX_CONSECUTIVE_ERRORS - 1; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    }

    expect(agent.getState().status).toBe('stopped');
    expect(agent.getState().consecutiveErrors).toBe(MAX_CONSECUTIVE_ERRORS);

    consoleSpy.mockRestore();
  });

  it('auto-stop invokes onAutoStop callback with correct event', async () => {
    const mockGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('fail'));
    const onAutoStop = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), onAutoStop, vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    for (let i = 0; i < MAX_CONSECUTIVE_ERRORS - 1; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    }

    expect(onAutoStop).toHaveBeenCalledOnce();
    const event: AgentLifecycleEvent = onAutoStop.mock.calls[0]![0] as AgentLifecycleEvent;
    expect(event.agentId).toBe(1);
    expect(event.event).toBe('auto-stopped');
    expect(event.reason).toContain('consecutive errors');
    expect(typeof event.timestamp).toBe('number');

    consoleSpy.mockRestore();
  });

  it('error message logged without key material (NFR7)', async () => {
    const mockGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('RPC timeout'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const logMessage = consoleSpy.mock.calls[0]![0] as string;
    expect(logMessage).toContain('Agent 1');
    expect(logMessage).toContain('Test Agent');
    expect(logMessage).toContain('RPC timeout');
    // Must NOT contain key material patterns
    expect(logMessage).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,}/); // base58 key pattern
    expect(logMessage).not.toContain('signTransaction');

    consoleSpy.mockRestore();
    agent.stop();
  });

  it('invokes onError callback when tick fails', async () => {
    const mockGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('RPC timeout'));
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), onError, new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledOnce();
    const event = onError.mock.calls[0]![0] as AgentLifecycleEvent;
    expect(event.agentId).toBe(1);
    expect(event.event).toBe('error');
    expect(event.reason).toBe('RPC timeout');

    consoleSpy.mockRestore();
    agent.stop();
  });

  it('onStateChange callback invoked on each tick', async () => {
    const onStateChange = vi.fn();
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [],onStateChange, vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    // onStateChange called once on start() for initial state, once after immediate tick
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterStart = onStateChange.mock.calls.length;

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    expect(onStateChange.mock.calls.length).toBe(callsAfterStart + 1);

    agent.stop();
  });

  it('getState() returns frozen AgentState object', async () => {
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    const state = agent.getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(() => {
      (state as Record<string, unknown>)['status'] = 'idle';
    }).toThrow();

    agent.stop();
  });

  it('state is ephemeral — new Agent instance has fresh state (FR0.3)', () => {
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    const state = agent.getState();
    expect(state.status).toBe('idle');
    expect(state.balance).toBe(0);
    expect(state.tickCount).toBe(0);
    expect(state.consecutiveErrors).toBe(0);
    expect(state.lastAction).toBeNull();
    expect(state.lastActionTimestamp).toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.positionSize).toBe(0);
    expect(state.consecutiveWins).toBe(0);
    expect(state.lastTradeAmount).toBe(0);
    expect(state.lastDecision).toBeUndefined();
  });

  it('uses configurable interval from AgentConfig.intervalMs (FR11)', async () => {
    const mockGetBalance = makeMockGetBalance();
    const agent = new Agent(1, makeConfig({ intervalMs: 5000 }), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // immediate tick

    expect(mockGetBalance).toHaveBeenCalledTimes(1);

    // Should NOT tick at 4999ms
    await vi.advanceTimersByTimeAsync(4999);
    expect(mockGetBalance).toHaveBeenCalledTimes(1);

    // Should tick at 5000ms
    await vi.advanceTimersByTimeAsync(1);
    expect(mockGetBalance).toHaveBeenCalledTimes(2);

    agent.stop();
  });

  it('uses DEFAULT_INTERVAL_MS when intervalMs not specified', async () => {
    const mockGetBalance = makeMockGetBalance();
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [],vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // immediate tick

    expect(mockGetBalance).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS - 1);
    expect(mockGetBalance).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockGetBalance).toHaveBeenCalledTimes(2);

    agent.stop();
  });

  // ─── Rule Engine Integration Tests (Story 2.4) ─────────────

  it('tick() calls rule engine and updates state (mock market provider)', async () => {
    const onStateChange = vi.fn();
    const marketProvider = makeMockMarketProvider({ priceChange1m: -10 });
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), marketProvider, () => [], onStateChange, vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    const state = agent.getState();
    expect(state.lastDecision).toBeDefined();
    expect(state.lastDecision!.evaluations).toHaveLength(1);
    expect(state.lastAction).not.toBeNull();
    expect(state.lastActionTimestamp).not.toBeNull();
    expect((marketProvider.getCurrentData as ReturnType<typeof vi.fn>)).toHaveBeenCalled();

    agent.stop();
  });

  it('tick() records cooldown after action decision', async () => {
    const marketProvider = makeMockMarketProvider({ priceChange1m: -10 });
    const agent = new Agent(1, makeConfig({ intervalMs: 5000 }), makeMockWallet(), makeMockGetBalance(), marketProvider, () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    // First tick: rule matches, cooldown recorded
    const state1 = agent.getState();
    expect(state1.lastDecision!.decision.action).toBe('buy');

    // Second tick at 5s (within 60s cooldown): rule should be on cooldown
    await vi.advanceTimersByTimeAsync(5000);
    const state2 = agent.getState();
    // Rule is on cooldown, so no match → action 'none'
    expect(state2.lastDecision!.evaluations[0]!.cooldown).toBe('active');
    expect(state2.lastDecision!.decision.action).toBe('none');

    agent.stop();
  });

  it('stop() resets cooldowns so restart evaluates rules fresh', async () => {
    const marketProvider = makeMockMarketProvider({ priceChange1m: -10 });
    const agent = new Agent(1, makeConfig({ intervalMs: 5000 }), makeMockWallet(), makeMockGetBalance(), marketProvider, () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.getState().lastDecision!.decision.action).toBe('buy');

    agent.stop();
    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getState().lastDecision!.decision.action).toBe('buy');
    agent.stop();
  });

  // ─── updateConfig() Tests (Story 2.7) ─────────────

  it('updateConfig() replaces config and next tick uses new rules', async () => {
    const marketProvider = makeMockMarketProvider({ priceChange1m: -10 });
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), marketProvider, () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    // First tick: rule matches (price_drop > 5)
    expect(agent.getState().lastDecision!.decision.action).toBe('buy');
    agent.stop();

    // Update config with a rule that won't match
    const newConfig = makeConfig({
      name: 'Updated Agent',
      strategy: 'Sell the rally',
      rules: [
        {
          name: 'sell-rule',
          conditions: [{ field: 'price_drop', operator: '>', threshold: 999 }],
          action: 'sell',
          amount: 0.5,
          weight: 90,
          cooldownSeconds: 30,
        },
      ],
    });
    agent.updateConfig(newConfig);

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    // Next tick uses new rules — threshold too high, no match
    expect(agent.getState().lastDecision!.decision.action).toBe('none');
    expect(agent.getState().name).toBe('Updated Agent');
    expect(agent.getState().strategy).toBe('Sell the rally');

    agent.stop();
  });

  it('updateConfig() does not restart the interval timer', async () => {
    const mockGetBalance = makeMockGetBalance();
    const agent = new Agent(1, makeConfig({ intervalMs: 5000 }), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetBalance).toHaveBeenCalledTimes(1);

    // Update config — interval should NOT reset
    agent.updateConfig(makeConfig({ intervalMs: 5000 }));

    // Advance to next original interval — tick should fire at original cadence
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockGetBalance).toHaveBeenCalledTimes(2);

    agent.stop();
  });

  it('updateConfig() with different name/strategy reflects in getState()', () => {
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    expect(agent.getState().name).toBe('Test Agent');
    expect(agent.getState().strategy).toBe('Buy the dip');

    agent.updateConfig(makeConfig({ name: 'New Name', strategy: 'New Strategy' }));

    expect(agent.getState().name).toBe('New Name');
    expect(agent.getState().strategy).toBe('New Strategy');
  });

  it('tick() with no rules matching sets status to cooldown', async () => {
    const marketProvider = makeMockMarketProvider({ priceChange1m: 5 }); // price rose, no drop
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), marketProvider, () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getState().status).toBe('cooldown');
    expect(agent.getState().lastDecision!.decision.action).toBe('none');

    agent.stop();
  });

  // ─── DecisionModule Integration Tests (Story 2.8) ─────────────

  it('6.13 Agent constructor accepts DecisionModule and uses it in tick()', async () => {
    const mockModule: DecisionModule = {
      evaluate: vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
        const { buildDecisionTrace: buildTrace } = await import('../src/trace.js');
        return {
          action: 'buy',
          amount: 0.5,
          reason: 'Mock decision',
          trace: buildTrace(ctx.agentState.agentId, {
            evaluations: [],
            decision: { action: 'buy', reason: 'Mock', amount: 0.5, score: 90 },
          }, ctx.marketData),
        };
      }),
      reset: vi.fn(),
    };

    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), mockModule);
    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockModule.evaluate).toHaveBeenCalledOnce();
    expect(agent.getState().lastDecision).toBeDefined();
    expect(agent.getState().lastDecision!.decision.action).toBe('buy');
    expect(agent.getState().lastAction).toContain('buy');

    agent.stop();
  });

  it('6.14 Agent.tick() calls decisionModule.evaluate() with correct EvaluationContext', async () => {
    const evaluateSpy = vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
      const { buildDecisionTrace: buildTrace } = await import('../src/trace.js');
      return {
        action: 'none',
        reason: 'test',
        trace: buildTrace(ctx.agentState.agentId, {
          evaluations: [],
          decision: { action: 'none', reason: 'test' },
        }, ctx.marketData),
      };
    });
    const mockModule: DecisionModule = { evaluate: evaluateSpy };

    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(3.0), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), mockModule);
    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    const ctx = evaluateSpy.mock.calls[0]![0]!;
    expect(ctx.agentState.agentId).toBe(1);
    expect(ctx.agentState.balance).toBe(3.0);
    expect(ctx.marketData).toBeDefined();
    expect(ctx.rules).toHaveLength(1);
    expect(ctx.peerStates).toBeDefined();

    agent.stop();
  });

  it('6.15 Agent.stop() calls decisionModule.reset() if present', async () => {
    const resetSpy = vi.fn();
    const mockModule: DecisionModule = {
      evaluate: vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
        const { buildDecisionTrace: buildTrace } = await import('../src/trace.js');
        return {
          action: 'none',
          reason: 'test',
          trace: buildTrace(ctx.agentState.agentId, {
            evaluations: [],
            decision: { action: 'none', reason: 'test' },
          }, ctx.marketData),
        };
      }),
      reset: resetSpy,
    };

    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), mockModule);
    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    agent.stop();

    expect(resetSpy).toHaveBeenCalledOnce();
  });

  it('6.16 Agent works with custom DecisionModule (mock implementation)', async () => {
    const mockModule: DecisionModule = {
      evaluate: vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
        const { buildDecisionTrace: buildTrace } = await import('../src/trace.js');
        return {
          action: 'sell',
          amount: 1.0,
          reason: 'Custom sell signal',
          trace: buildTrace(ctx.agentState.agentId, {
            evaluations: [],
            decision: { action: 'sell', reason: 'Custom sell signal', amount: 1.0, score: 95 },
          }, ctx.marketData),
        };
      }),
    };

    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), mockModule);
    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getState().lastAction).toContain('sell');
    expect(agent.getState().status).toBe('active');

    agent.stop();
  });

  it('6.17 Agent.autoStop() calls decisionModule.reset()', async () => {
    const resetSpy = vi.fn();
    const mockModule: DecisionModule = {
      evaluate: vi.fn<() => Promise<DecisionResult>>().mockRejectedValue(new Error('evaluate failed')),
      reset: resetSpy,
    };

    const mockGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), mockModule);

    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    }

    expect(agent.getState().status).toBe('stopped');
    expect(resetSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('ownsDecisionModule=false prevents reset() call on stop() (shared module safety)', async () => {
    const resetSpy = vi.fn();
    const mockModule: DecisionModule = {
      evaluate: vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
        const { buildDecisionTrace: buildTrace } = await import('../src/trace.js');
        return {
          action: 'none',
          reason: 'test',
          trace: buildTrace(ctx.agentState.agentId, {
            evaluations: [],
            decision: { action: 'none', reason: 'test' },
          }, ctx.marketData),
        };
      }),
      reset: resetSpy,
    };

    // ownsDecisionModule = false (11th parameter)
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), mockModule, false);
    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    agent.stop();

    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('ownsDecisionModule=false prevents reset() call on autoStop()', async () => {
    const resetSpy = vi.fn();
    const mockModule: DecisionModule = {
      evaluate: vi.fn<() => Promise<DecisionResult>>().mockRejectedValue(new Error('fail')),
      reset: resetSpy,
    };

    const mockGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // ownsDecisionModule = false
    const agent = new Agent(1, makeConfig(), makeMockWallet(), mockGetBalance, makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), mockModule, false);

    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < MAX_CONSECUTIVE_ERRORS - 1; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    }

    expect(agent.getState().status).toBe('stopped');
    expect(resetSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('traceHistory ring buffer caps at MAX_TRACE_HISTORY', async () => {
    const { MAX_TRACE_HISTORY } = await import('../src/constants.js');
    const mockModule: DecisionModule = {
      evaluate: vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
        const { buildDecisionTrace: buildTrace } = await import('../src/trace.js');
        return {
          action: 'buy',
          amount: 0.1,
          reason: 'test',
          trace: buildTrace(ctx.agentState.agentId, {
            evaluations: [],
            decision: { action: 'buy', reason: 'test', amount: 0.1, score: 80 },
          }, ctx.marketData),
        };
      }),
    };

    const agent = new Agent(1, makeConfig({ intervalMs: 100 }), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), mockModule);
    agent.start();

    // Run enough ticks to exceed MAX_TRACE_HISTORY
    for (let i = 0; i < MAX_TRACE_HISTORY + 10; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(agent.getState().traceHistory.length).toBeLessThanOrEqual(MAX_TRACE_HISTORY);
    expect(agent.getState().traceHistory.length).toBe(MAX_TRACE_HISTORY);

    agent.stop();
  });

  it('DecisionModule.evaluate() throwing triggers agent error path', async () => {
    const mockModule: DecisionModule = {
      evaluate: vi.fn<() => Promise<DecisionResult>>().mockRejectedValue(new Error('module crashed')),
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), onError, mockModule);

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getState().status).toBe('error');
    expect(agent.getState().consecutiveErrors).toBe(1);
    expect(agent.getState().lastError).toBe('module crashed');
    expect(onError).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
    agent.stop();
  });

  it('6.18 Custom DecisionModule without reset() — Agent.stop() does not throw', async () => {
    const mockModule: DecisionModule = {
      evaluate: vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
        const { buildDecisionTrace: buildTrace } = await import('../src/trace.js');
        return {
          action: 'none',
          reason: 'test',
          trace: buildTrace(ctx.agentState.agentId, {
            evaluations: [],
            decision: { action: 'none', reason: 'test' },
          }, ctx.marketData),
        };
      }),
      // No reset method
    };

    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), mockModule);
    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(() => agent.stop()).not.toThrow();
    expect(agent.getState().status).toBe('stopped');
  });
});
