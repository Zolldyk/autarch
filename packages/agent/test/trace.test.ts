import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildDecisionTrace } from '../src/trace.js';
import { Agent } from '../src/agent.js';
import { RuleBasedDecisionModule } from '../src/rule-based-decision-module.js';
import { AgentRuntime } from '../src/runtime.js';
import { MAX_TRACE_HISTORY } from '../src/constants.js';
import type {
  EngineResult,
  MarketData,
  RuleEvaluation,
  TraceExecution,
  AgentConfig,
  AgentState,
  MarketDataProvider,
  AgentRuntimeOptions,
} from '../src/types.js';
import type { AgentWallet, Balance } from '@autarch/core';

// ─── Mock Factories ──────────────────────────────────────────────────

function makeMarketData(overrides: Partial<MarketData> = {}): MarketData {
  return {
    price: 100,
    priceChange1m: -10,
    priceChange5m: -8,
    volumeChange1m: 50,
    timestamp: Date.now(),
    source: 'simulated',
    ...overrides,
  };
}

function makeConditions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    field: `field_${i}`,
    operator: '>' as const,
    threshold: i * 10,
    actual: i * 10 + 5,
    passed: true,
  }));
}

function makeEvaluation(overrides: Partial<RuleEvaluation> = {}): RuleEvaluation {
  return {
    ruleIndex: 0,
    ruleName: 'Test Rule',
    conditions: makeConditions(3),
    matched: true,
    score: 80,
    ...overrides,
  };
}

function makeEngineResult(overrides: Partial<EngineResult> = {}): EngineResult {
  return {
    evaluations: [makeEvaluation()],
    decision: {
      action: 'buy',
      reason: 'Rule matched with score 80',
      amount: 0.1,
      ruleIndex: 0,
      ruleName: 'Test Rule',
      score: 80,
    },
    ...overrides,
  };
}

function makeNoMatchResult(): EngineResult {
  return {
    evaluations: [
      makeEvaluation({
        matched: false,
        score: 0,
        conditions: [
          { field: 'price_drop', operator: '>', threshold: 5, actual: 2, passed: false },
        ],
      }),
    ],
    decision: {
      action: 'none',
      reason: 'no rules matched',
    },
  };
}

function makeBelowThresholdResult(): EngineResult {
  return {
    evaluations: [
      makeEvaluation({
        matched: false,
        score: 40,
        conditions: makeConditions(2),
      }),
    ],
    decision: {
      action: 'none',
      reason: 'best score 40 below threshold 70',
      score: 40,
    },
  };
}

function makeInsufficientBalanceResult(): EngineResult {
  return {
    evaluations: [
      makeEvaluation({
        matched: true,
        score: 80,
        blocked: 'insufficient_balance',
      }),
    ],
    decision: {
      action: 'none',
      reason: 'insufficient balance for action',
    },
  };
}

function makeLargeEngineResult(ruleCount: number, conditionsPerRule: number): EngineResult {
  const evaluations: RuleEvaluation[] = Array.from({ length: ruleCount }, (_, i) => ({
    ruleIndex: i,
    ruleName: `Rule ${i}`,
    conditions: makeConditions(conditionsPerRule),
    matched: i === 0,
    score: i === 0 ? 80 : 0,
  }));
  return {
    evaluations,
    decision: {
      action: 'buy',
      reason: 'Rule matched',
      amount: 0.1,
      ruleIndex: 0,
      ruleName: 'Rule 0',
      score: 80,
    },
  };
}

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

function makeMockWallet(): AgentWallet {
  return { address: 'mock-address-base58', signTransaction: vi.fn() };
}

function makeMockGetBalance(sol = 1.0): ReturnType<typeof vi.fn<() => Promise<Balance>>> {
  return vi.fn<() => Promise<Balance>>().mockResolvedValue({ lamports: BigInt(sol * 1e9), sol });
}

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
    getCurrentData: vi.fn<() => MarketData>().mockReturnValue({ ...snapshot }),
    getSnapshot: vi.fn<() => MarketData>().mockImplementation(() => ({ ...snapshot })),
    getHistory: vi.fn().mockReturnValue([]),
    injectDip: vi.fn(),
    injectRally: vi.fn(),
    resetToBaseline: vi.fn(),
  };
}

// ─── Trace Construction Tests ────────────────────────────────────────

describe('buildDecisionTrace', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('includes timestamp close to Date.now() (AC: #1)', () => {
    vi.setSystemTime(1700000000000);
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData());
    expect(trace.timestamp).toBe(1700000000000);
  });

  it('includes correct agentId (AC: #1)', () => {
    const trace = buildDecisionTrace(42, makeEngineResult(), makeMarketData());
    expect(trace.agentId).toBe(42);
  });

  it('includes full marketData snapshot (AC: #1)', () => {
    const marketData = makeMarketData({ price: 150, priceChange1m: -3 });
    const trace = buildDecisionTrace(1, makeEngineResult(), marketData);
    expect(trace.marketData).toEqual(marketData);
    expect(trace.marketData.price).toBe(150);
    expect(trace.marketData.priceChange1m).toBe(-3);
  });

  it('includes all evaluations from EngineResult (AC: #1, #2)', () => {
    const result = makeEngineResult({
      evaluations: [makeEvaluation({ ruleIndex: 0 }), makeEvaluation({ ruleIndex: 1, ruleName: 'Rule 2' })],
    });
    const trace = buildDecisionTrace(1, result, makeMarketData());
    expect(trace.evaluations).toHaveLength(2);
    expect(trace.evaluations[0]!.ruleIndex).toBe(0);
    expect(trace.evaluations[1]!.ruleIndex).toBe(1);
  });

  it('each evaluation has ruleIndex, ruleName, conditions, score, matched (AC: #2)', () => {
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData());
    const eval0 = trace.evaluations[0]!;
    expect(eval0).toHaveProperty('ruleIndex');
    expect(eval0).toHaveProperty('ruleName');
    expect(eval0).toHaveProperty('conditions');
    expect(eval0).toHaveProperty('score');
    expect(eval0).toHaveProperty('matched');
    expect(typeof eval0.ruleIndex).toBe('number');
    expect(typeof eval0.ruleName).toBe('string');
    expect(Array.isArray(eval0.conditions)).toBe(true);
    expect(typeof eval0.score).toBe('number');
    expect(typeof eval0.matched).toBe('boolean');
  });

  it('each condition has field, operator, threshold, actual, passed (AC: #2)', () => {
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData());
    const cond = trace.evaluations[0]!.conditions[0]!;
    expect(cond).toHaveProperty('field');
    expect(cond).toHaveProperty('operator');
    expect(cond).toHaveProperty('threshold');
    expect(cond).toHaveProperty('actual');
    expect(cond).toHaveProperty('passed');
  });

  it('with execution param includes status, signature, mode (AC: #3)', () => {
    const execution: TraceExecution = {
      status: 'confirmed',
      signature: 'abc123sig',
      mode: 'normal',
    };
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData(), execution);
    expect(trace.execution).toBeDefined();
    expect(trace.execution!.status).toBe('confirmed');
    expect(trace.execution!.signature).toBe('abc123sig');
    expect(trace.execution!.mode).toBe('normal');
  });

  it('without execution param has undefined execution (AC: #3)', () => {
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData());
    expect(trace.execution).toBeUndefined();
  });

  it('with execution status simulated includes mode simulation (AC: #3)', () => {
    const execution: TraceExecution = {
      status: 'simulated',
      mode: 'simulation',
    };
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData(), execution);
    expect(trace.execution).toBeDefined();
    expect(trace.execution!.status).toBe('simulated');
    expect(trace.execution!.mode).toBe('simulation');
    expect(trace.execution!.signature).toBeUndefined();
    expect(trace.execution!.error).toBeUndefined();
  });

  it('with execution status failed includes error message (AC: #3)', () => {
    const execution: TraceExecution = {
      status: 'failed',
      mode: 'normal',
      error: 'Transaction simulation failed: insufficient funds',
    };
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData(), execution);
    expect(trace.execution).toBeDefined();
    expect(trace.execution!.status).toBe('failed');
    expect(trace.execution!.error).toBe('Transaction simulation failed: insufficient funds');
    expect(trace.execution!.mode).toBe('normal');
    expect(trace.execution!.signature).toBeUndefined();
  });

  it('with execution mode degraded includes correct mode (AC: #3)', () => {
    const execution: TraceExecution = {
      status: 'confirmed',
      signature: 'fallback-sig-123',
      mode: 'degraded',
    };
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData(), execution);
    expect(trace.execution!.mode).toBe('degraded');
    expect(trace.execution!.status).toBe('confirmed');
    expect(trace.execution!.signature).toBe('fallback-sig-123');
  });

  it('execution snapshot is immutable after build (AC: #3)', () => {
    const execution: TraceExecution = {
      status: 'confirmed',
      signature: 'original-sig',
      mode: 'normal',
    };
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData(), execution);

    // Mutate the source object
    (execution as { status: string }).status = 'failed';
    (execution as { signature: string }).signature = 'mutated-sig';

    // Trace should retain original values
    expect(trace.execution!.status).toBe('confirmed');
    expect(trace.execution!.signature).toBe('original-sig');
  });

  it('cooldown metadata preserved in trace evaluations (AC: #2)', () => {
    const result = makeEngineResult({
      evaluations: [
        makeEvaluation({
          matched: false,
          score: 0,
          cooldown: 'active',
          cooldownRemaining: 15000,
          conditions: [],
        }),
        makeEvaluation({ ruleIndex: 1, ruleName: 'Available Rule' }),
      ],
    });
    const trace = buildDecisionTrace(1, result, makeMarketData());
    expect(trace.evaluations[0]!.cooldown).toBe('active');
    expect(trace.evaluations[0]!.cooldownRemaining).toBe(15000);
    expect(trace.evaluations[1]!.cooldown).toBeUndefined();
  });

  it('blocked evaluation metadata preserved in trace (AC: #2)', () => {
    const result = makeEngineResult({
      evaluations: [
        makeEvaluation({ matched: true, score: 80, blocked: 'insufficient_balance' }),
      ],
      decision: { action: 'none', reason: 'insufficient_balance' },
    });
    const trace = buildDecisionTrace(1, result, makeMarketData());
    expect(trace.evaluations[0]!.blocked).toBe('insufficient_balance');
    expect(trace.decision.action).toBe('none');
  });

  it('no-rules-matched has decision.action = none with reason (AC: #4)', () => {
    const trace = buildDecisionTrace(1, makeNoMatchResult(), makeMarketData());
    expect(trace.decision.action).toBe('none');
    expect(trace.decision.reason).toContain('no rules matched');
    expect(trace.evaluations[0]!.conditions[0]!.passed).toBe(false);
  });

  it('below-threshold has decision.action = none with score in reason (AC: #4)', () => {
    const trace = buildDecisionTrace(1, makeBelowThresholdResult(), makeMarketData());
    expect(trace.decision.action).toBe('none');
    expect(trace.decision.reason).toContain('40');
    expect(trace.decision.reason).toContain('threshold');
  });

  it('insufficient-balance has blocked evaluation (AC: #4)', () => {
    const trace = buildDecisionTrace(1, makeInsufficientBalanceResult(), makeMarketData());
    expect(trace.decision.action).toBe('none');
    expect(trace.evaluations[0]!.blocked).toBe('insufficient_balance');
  });

  it('returned trace is frozen (AC: #1)', () => {
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData());
    expect(Object.isFrozen(trace)).toBe(true);
  });

  it('trace captures immutable snapshot of nested market/evaluation data', () => {
    const marketData = makeMarketData({ price: 111 });
    const result = makeEngineResult();
    const trace = buildDecisionTrace(1, result, marketData);

    (marketData as unknown as { price: number }).price = 999;
    (result.decision as { action: 'buy' | 'sell' | 'transfer' | 'none' }).action = 'sell';
    (result.evaluations[0]!.conditions[0] as { passed: boolean }).passed = false;

    expect(trace.marketData.price).toBe(111);
    expect(trace.decision.action).toBe('buy');
    expect(trace.evaluations[0]!.conditions[0]!.passed).toBe(true);
  });
});

// ─── Serialization Performance Tests (NFR6) ─────────────────────────

describe('DecisionTrace serialization performance (NFR6)', () => {
  it('JSON.stringify on trace with 10 rules x 5 conditions completes in < 10ms (AC: #5)', () => {
    const result = makeLargeEngineResult(10, 5);
    const trace = buildDecisionTrace(1, result, makeMarketData());

    const start = performance.now();
    JSON.stringify(trace);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
  });

  it('JSON.stringify on trace with 20 rules x 10 conditions completes in < 10ms (AC: #5)', () => {
    const result = makeLargeEngineResult(20, 10);
    const trace = buildDecisionTrace(1, result, makeMarketData());

    const start = performance.now();
    JSON.stringify(trace);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
  });

  it('JSON.stringify on trace with execution data completes in < 10ms (AC: #5)', () => {
    const result = makeLargeEngineResult(10, 5);
    const execution: TraceExecution = {
      status: 'confirmed',
      signature: '5abc1234defg5678ijkl9012mnop3456qrst7890uvwx1234yzab5678cdef9012ghij3456klmn7890',
      mode: 'normal',
    };
    const trace = buildDecisionTrace(1, result, makeMarketData(), execution);

    const start = performance.now();
    JSON.stringify(trace);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
  });
});

// ─── Security Tests (NFR7) ──────────────────────────────────────────

describe('DecisionTrace security (NFR7)', () => {
  it('serialized trace contains no private key patterns (AC: #6)', () => {
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData());
    const json = JSON.stringify(trace);

    expect(json).not.toMatch(/privateKey/i);
    expect(json).not.toMatch(/secretKey/i);
    expect(json).not.toMatch(/mnemonic/i);
    expect(json).not.toMatch(/keypair/i);
  });

  it('serialized trace contains no seed-related fields (AC: #6)', () => {
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData());
    const json = JSON.stringify(trace);

    expect(json).not.toMatch(/"seed"/i);
    expect(json).not.toMatch(/"seedBytes"/i);
  });

  it('trace fields are limited to expected keys only (AC: #6)', () => {
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData());
    const keys = Object.keys(trace);
    const expectedKeys = ['timestamp', 'agentId', 'marketData', 'evaluations', 'decision', 'execution'];

    for (const key of keys) {
      expect(expectedKeys).toContain(key);
    }
  });

  it('trace with execution serialization contains no key material (AC: #6)', () => {
    const execution: TraceExecution = {
      status: 'confirmed',
      signature: '5abc1234defg5678',
      mode: 'normal',
    };
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData(), execution);
    const json = JSON.stringify(trace);

    expect(json).not.toMatch(/privateKey/i);
    expect(json).not.toMatch(/secretKey/i);
    expect(json).not.toMatch(/mnemonic/i);
    expect(json).not.toMatch(/keypair/i);
    expect(json).not.toMatch(/"seed"/i);
  });

  it('execution field keys are limited to expected keys only (AC: #6)', () => {
    const execution: TraceExecution = {
      status: 'failed',
      mode: 'simulation',
      error: 'all endpoints down',
    };
    const trace = buildDecisionTrace(1, makeEngineResult(), makeMarketData(), execution);
    const execKeys = Object.keys(trace.execution!);
    const expectedExecKeys = ['status', 'signature', 'mode', 'error'];

    for (const key of execKeys) {
      expect(expectedExecKeys).toContain(key);
    }
  });
});

// ─── Trace History Tests ────────────────────────────────────────────

describe('Trace history in Agent', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('agent accumulates traces in traceHistory across multiple ticks', async () => {
    const agent = new Agent(1, makeConfig({ intervalMs: 1000 }), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // tick 1
    await vi.advanceTimersByTimeAsync(1000); // tick 2
    await vi.advanceTimersByTimeAsync(1000); // tick 3

    const state = agent.getState();
    expect(state.traceHistory).toHaveLength(3);

    agent.stop();
  });

  it('trace history is capped at MAX_TRACE_HISTORY (oldest entries removed)', async () => {
    const agent = new Agent(1, makeConfig({ intervalMs: 100 }), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // tick 1

    for (let i = 0; i < MAX_TRACE_HISTORY + 10; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    const state = agent.getState();
    expect(state.traceHistory).toHaveLength(MAX_TRACE_HISTORY);

    agent.stop();
  });

  it('trace history is included in getState() output', async () => {
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    const state = agent.getState();
    expect(state).toHaveProperty('traceHistory');
    expect(Array.isArray(state.traceHistory)).toBe(true);
    expect(state.traceHistory.length).toBeGreaterThanOrEqual(1);

    agent.stop();
  });

  it('trace history is cleared on agent stop', async () => {
    const agent = new Agent(1, makeConfig({ intervalMs: 1000 }), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(agent.getState().traceHistory.length).toBeGreaterThan(0);

    agent.stop();

    expect(agent.getState().traceHistory).toHaveLength(0);
  });

  it('trace history is cleared on auto-stop', async () => {
    let callCount = 0;
    const getBalance = vi.fn<() => Promise<Balance>>().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ lamports: 1000000000n, sol: 1.0 });
      }
      return Promise.reject(new Error('fail'));
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agent = new Agent(
      1,
      makeConfig({ intervalMs: 1000 }),
      makeMockWallet(),
      getBalance,
      makeMockMarketProvider(),
      () => [],
      vi.fn(),
      vi.fn(),
      vi.fn(),
      new RuleBasedDecisionModule(),
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0); // successful tick creates trace
    expect(agent.getState().traceHistory.length).toBe(1);

    // Drive 5 consecutive failures to trigger auto-stop.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(agent.getState().status).toBe('stopped');
    expect(agent.getState().traceHistory).toHaveLength(0);
    consoleSpy.mockRestore();
  });
});

// ─── Integration Tests ──────────────────────────────────────────────

describe('DecisionTrace integration', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('Agent.tick() produces a DecisionTrace in lastDecision (not raw EngineResult)', async () => {
    const agent = new Agent(1, makeConfig(), makeMockWallet(), makeMockGetBalance(), makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(), new RuleBasedDecisionModule());

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    const state = agent.getState();
    expect(state.lastDecision).toBeDefined();
    // DecisionTrace has these extra fields vs EngineResult
    expect(state.lastDecision!).toHaveProperty('timestamp');
    expect(state.lastDecision!).toHaveProperty('agentId');
    expect(state.lastDecision!).toHaveProperty('marketData');
    expect(state.lastDecision!.agentId).toBe(1);
    expect(typeof state.lastDecision!.timestamp).toBe('number');

    agent.stop();
  });

  it('AgentRuntime emits stateUpdate with DecisionTrace in state', async () => {
    const options: AgentRuntimeOptions = {
      agents: [{
        agentId: 1,
        config: makeConfig(),
        wallet: makeMockWallet(),
        getBalance: makeMockGetBalance(),
      }],
      marketProvider: makeMockMarketProvider(),
    };
    const runtime = new AgentRuntime(options);
    const stateUpdates: AgentState[] = [];
    runtime.on('stateUpdate', (state: AgentState) => stateUpdates.push(state));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const traceState = stateUpdates.find(s => s.lastDecision !== undefined);
    expect(traceState).toBeDefined();
    expect(traceState!.lastDecision!).toHaveProperty('timestamp');
    expect(traceState!.lastDecision!).toHaveProperty('agentId');
    expect(traceState!.lastDecision!).toHaveProperty('marketData');

    runtime.stop();
  });

  it('full cycle: evaluate rules → build trace → store in state → emit via runtime', async () => {
    const options: AgentRuntimeOptions = {
      agents: [{
        agentId: 7,
        config: makeConfig({ name: 'Trace Agent' }),
        wallet: makeMockWallet(),
        getBalance: makeMockGetBalance(),
      }],
      marketProvider: makeMockMarketProvider({ priceChange1m: -10 }),
    };
    const runtime = new AgentRuntime(options);
    const stateUpdates: AgentState[] = [];
    runtime.on('stateUpdate', (state: AgentState) => stateUpdates.push(state));

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Find the state with a decision
    const traceState = stateUpdates.find(s => s.lastDecision !== undefined);
    expect(traceState).toBeDefined();

    const trace = traceState!.lastDecision!;
    expect(trace.agentId).toBe(7);
    expect(trace.evaluations).toHaveLength(1);
    expect(trace.decision.action).toBe('buy');
    expect(trace.marketData.price).toBe(100);
    expect(typeof trace.timestamp).toBe('number');
    expect(trace.execution).toBeUndefined();

    // traceHistory also available
    expect(traceState!.traceHistory.length).toBeGreaterThanOrEqual(1);

    runtime.stop();
  });
});
