import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '../src/agent.js';
import type { AgentConfig, MarketData, MarketDataProvider, DecisionModule, DecisionResult, EvaluationContext, ExecuteAction, TraceExecution } from '../src/types.js';
import type { AgentWallet, Balance } from '@autarch/core';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'Exec Agent',
    strategy: 'Execute trades',
    rules: [
      {
        name: 'buy-rule',
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
  return { address: 'mock-address', signTransaction: vi.fn() };
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
    getSnapshot: vi.fn<() => MarketData>().mockReturnValue({ ...snapshot }),
    getHistory: vi.fn().mockReturnValue([]),
    injectDip: vi.fn(),
    injectRally: vi.fn(),
    resetToBaseline: vi.fn(),
  };
}

function makeBuyModule(): DecisionModule {
  return {
    evaluate: vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
      const { buildDecisionTrace } = await import('../src/trace.js');
      return {
        action: 'buy',
        amount: 0.5,
        reason: 'Buy signal',
        trace: buildDecisionTrace(ctx.agentState.agentId, {
          evaluations: [],
          decision: { action: 'buy', reason: 'Buy signal', amount: 0.5, score: 85 },
        }, ctx.marketData),
      };
    }),
  };
}

function makeNoneModule(): DecisionModule {
  return {
    evaluate: vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
      const { buildDecisionTrace } = await import('../src/trace.js');
      return {
        action: 'none',
        reason: 'No signal',
        trace: buildDecisionTrace(ctx.agentState.agentId, {
          evaluations: [],
          decision: { action: 'none', reason: 'No signal' },
        }, ctx.marketData),
      };
    }),
  };
}

describe('Agent executeAction integration', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls executeAction on buy decision and attaches execution to trace', async () => {
    const mockExecute: ExecuteAction = vi.fn<ExecuteAction>().mockResolvedValue({
      status: 'confirmed',
      signature: 'sig123',
      mode: 'normal',
    });

    const agent = new Agent(
      1, makeConfig(), makeMockWallet(), makeMockGetBalance(),
      makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(),
      makeBuyModule(), true, mockExecute,
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledWith({
      action: 'buy',
      amount: 0.5,
      agentId: 1,
    });

    const state = agent.getState();
    expect(state.lastDecision).toBeDefined();
    expect(state.lastDecision!.execution).toBeDefined();
    expect(state.lastDecision!.execution!.status).toBe('confirmed');
    expect(state.lastDecision!.execution!.signature).toBe('sig123');

    agent.stop();
  });

  it('works normally without executeAction (undefined)', async () => {
    const agent = new Agent(
      1, makeConfig(), makeMockWallet(), makeMockGetBalance(),
      makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(),
      makeBuyModule(), true, undefined,
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    const state = agent.getState();
    expect(state.lastDecision).toBeDefined();
    expect(state.lastDecision!.execution).toBeUndefined();
    expect(state.lastAction).toContain('buy');

    agent.stop();
  });

  it('updates trade metrics on successful execution', async () => {
    const mockExecute: ExecuteAction = vi.fn<ExecuteAction>().mockResolvedValue({
      status: 'confirmed',
      signature: 'sig456',
      mode: 'normal',
    });

    const agent = new Agent(
      2, makeConfig(), makeMockWallet(), makeMockGetBalance(),
      makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(),
      makeBuyModule(), true, mockExecute,
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    const state = agent.getState();
    expect(state.lastTradeAmount).toBe(0.5);
    expect(state.consecutiveWins).toBe(1);
    expect(state.positionSize).toBeGreaterThan(0);

    agent.stop();
  });

  it('produces failed execution trace when executeAction throws', async () => {
    const mockExecute: ExecuteAction = vi.fn<ExecuteAction>().mockRejectedValue(
      new Error('Insufficient funds'),
    );

    const agent = new Agent(
      1, makeConfig(), makeMockWallet(), makeMockGetBalance(),
      makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(),
      makeBuyModule(), true, mockExecute,
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    const state = agent.getState();
    expect(state.lastDecision).toBeDefined();
    expect(state.lastDecision!.execution).toBeDefined();
    expect(state.lastDecision!.execution!.status).toBe('failed');
    expect(state.lastDecision!.execution!.error).toBe('Insufficient funds');
    expect(state.consecutiveWins).toBe(0);

    agent.stop();
  });

  it('skips executeAction when action is none', async () => {
    const mockExecute: ExecuteAction = vi.fn<ExecuteAction>();

    const agent = new Agent(
      1, makeConfig(), makeMockWallet(), makeMockGetBalance(),
      makeMockMarketProvider({ priceChange1m: 5 }), () => [], vi.fn(), vi.fn(), vi.fn(),
      makeNoneModule(), true, mockExecute,
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockExecute).not.toHaveBeenCalled();
    expect(agent.getState().lastDecision!.decision.action).toBe('none');

    agent.stop();
  });

  it('handles sell action execution', async () => {
    const sellModule: DecisionModule = {
      evaluate: vi.fn<(ctx: EvaluationContext) => Promise<DecisionResult>>().mockImplementation(async (ctx) => {
        const { buildDecisionTrace } = await import('../src/trace.js');
        return {
          action: 'sell',
          amount: 0.3,
          reason: 'Sell signal',
          trace: buildDecisionTrace(ctx.agentState.agentId, {
            evaluations: [],
            decision: { action: 'sell', reason: 'Sell signal', amount: 0.3, score: 75 },
          }, ctx.marketData),
        };
      }),
    };

    const execResult: TraceExecution = { status: 'confirmed', signature: 'sell-sig', mode: 'normal' };
    const mockExecute: ExecuteAction = vi.fn<ExecuteAction>().mockResolvedValue(execResult);

    const agent = new Agent(
      1, makeConfig(), makeMockWallet(), makeMockGetBalance(),
      makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(),
      sellModule, true, mockExecute,
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockExecute).toHaveBeenCalledWith({ action: 'sell', amount: 0.3, agentId: 1 });
    expect(agent.getState().lastDecision!.execution!.status).toBe('confirmed');

    agent.stop();
  });

  it('execution result stored in traceHistory', async () => {
    const mockExecute: ExecuteAction = vi.fn<ExecuteAction>().mockResolvedValue({
      status: 'simulated',
      signature: 'sim-sig',
      mode: 'simulation',
    });

    const agent = new Agent(
      1, makeConfig(), makeMockWallet(), makeMockGetBalance(),
      makeMockMarketProvider(), () => [], vi.fn(), vi.fn(), vi.fn(),
      makeBuyModule(), true, mockExecute,
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    const history = agent.getState().traceHistory;
    expect(history).toHaveLength(1);
    expect(history[0]!.execution).toBeDefined();
    expect(history[0]!.execution!.signature).toBe('sim-sig');

    agent.stop();
  });
});
