import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleBasedDecisionModule } from '../src/rule-based-decision-module.js';
import { DEFAULT_EXECUTION_THRESHOLD } from '../src/constants.js';
import type {
  AgentState,
  DecisionModule,
  DecisionResult,
  EvaluationContext,
  MarketData,
  Rule,
} from '../src/types.js';

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

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return Object.freeze({
    agentId: 1,
    name: 'Test Agent',
    strategy: 'Buy the dip',
    status: 'active' as const,
    address: 'mock-address',
    balance: 5.0,
    lastAction: null,
    lastActionTimestamp: null,
    consecutiveErrors: 0,
    tickCount: 0,
    lastError: null,
    positionSize: 0,
    consecutiveWins: 0,
    lastTradeAmount: 0,
    traceHistory: [],
    ...overrides,
  });
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    name: 'buy-dip',
    conditions: [{ field: 'price_drop', operator: '>', threshold: 5 }],
    action: 'buy',
    amount: 0.1,
    weight: 80,
    cooldownSeconds: 60,
    ...overrides,
  };
}

function makeContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    agentState: makeAgentState(),
    marketData: makeMarketData(),
    rules: [makeRule()],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('RuleBasedDecisionModule', () => {
  let module: RuleBasedDecisionModule;

  beforeEach(() => {
    module = new RuleBasedDecisionModule();
  });

  it('6.1 implements DecisionModule interface (structural type check)', () => {
    const dm: DecisionModule = module;
    expect(typeof dm.evaluate).toBe('function');
    expect(typeof dm.reset).toBe('function');
  });

  it('6.2 evaluate() returns DecisionResult with action, reason, and trace for matching rules', async () => {
    const context = makeContext();
    const result: DecisionResult = await module.evaluate(context);

    expect(result.action).toBe('buy');
    expect(result.amount).toBe(0.1);
    expect(typeof result.reason).toBe('string');
    expect(result.reason).toContain('buy-dip');
    expect(result.trace).toBeDefined();
    expect(result.trace.evaluations).toHaveLength(1);
    expect(result.trace.decision.action).toBe('buy');
  });

  it('6.3 evaluate() returns action none when no rules match', async () => {
    const context = makeContext({
      marketData: makeMarketData({ priceChange1m: 5 }), // no drop
    });
    const result = await module.evaluate(context);

    expect(result.action).toBe('none');
    expect(result.amount).toBeUndefined();
    expect(typeof result.reason).toBe('string');
  });

  it('6.4 evaluate() enforces cooldown — same rule within cooldown returns none', async () => {
    const context = makeContext();

    // First evaluation — rule fires
    const result1 = await module.evaluate(context);
    expect(result1.action).toBe('buy');

    // Second evaluation — cooldown active
    const result2 = await module.evaluate(context);
    expect(result2.action).toBe('none');
    expect(result2.trace.evaluations[0]!.cooldown).toBe('active');
  });

  it('6.5 evaluate() records cooldown after execution — second call within cooldown is blocked', async () => {
    const context = makeContext();

    await module.evaluate(context); // fires, records cooldown

    const result = await module.evaluate(context);
    expect(result.action).toBe('none');
    expect(result.trace.evaluations[0]!.cooldownRemaining).toBeGreaterThan(0);
  });

  it('6.6 evaluate() uses configurable execution threshold', async () => {
    // Rule weight is 80, set threshold to 90
    const highThresholdModule = new RuleBasedDecisionModule(90);
    const context = makeContext();

    const result = await highThresholdModule.evaluate(context);
    expect(result.action).toBe('none');
    expect(result.reason).toContain('below threshold');
  });

  it('6.7 evaluate() performs balance pre-check — insufficient balance blocks action', async () => {
    const context = makeContext({
      agentState: makeAgentState({ balance: 0.01 }), // less than rule amount (0.1)
      rules: [makeRule({ amount: 0.5 })],
    });

    const result = await module.evaluate(context);
    expect(result.action).toBe('none');
    expect(result.reason).toBe('insufficient_balance');
  });

  it('6.8 evaluate() trace includes agentId from context.agentState.agentId', async () => {
    const context = makeContext({
      agentState: makeAgentState({ agentId: 42 }),
    });

    const result = await module.evaluate(context);
    expect(result.trace.agentId).toBe(42);
  });

  it('6.9 evaluate() handles compound conditions (AND/OR/NOT) correctly', async () => {
    const context = makeContext({
      rules: [{
        name: 'compound',
        conditions: [
          { field: 'price_drop', operator: '>', threshold: 5 },         // AND: 10 > 5 = true
          { field: 'volume_spike', operator: '>', threshold: 10, logic: 'OR' }, // OR: 50 > 10 = true
        ],
        action: 'buy',
        amount: 0.1,
        weight: 80,
        cooldownSeconds: 60,
      }],
    });

    const result = await module.evaluate(context);
    expect(result.action).toBe('buy');
  });

  it('6.10 evaluate() handles inter-agent peer state conditions', async () => {
    const peerState = makeAgentState({ agentId: 2, name: 'PeerAgent', balance: 10.0 });
    const context = makeContext({
      rules: [{
        name: 'peer-check',
        conditions: [{ field: 'peer.PeerAgent.balance', operator: '>', threshold: 5.0 }],
        action: 'buy',
        amount: 0.1,
        weight: 80,
        cooldownSeconds: 60,
      }],
      peerStates: [peerState],
    });

    const result = await module.evaluate(context);
    expect(result.action).toBe('buy');
  });

  it('6.11 reset() clears cooldown timers — previously blocked rule can fire again', async () => {
    const context = makeContext();

    // First evaluation — fires
    const result1 = await module.evaluate(context);
    expect(result1.action).toBe('buy');

    // Second evaluation — cooldown
    const result2 = await module.evaluate(context);
    expect(result2.action).toBe('none');

    // Reset and evaluate again — should fire
    module.reset();
    const result3 = await module.evaluate(context);
    expect(result3.action).toBe('buy');
  });

  it('6.12 evaluate() returns frozen DecisionTrace (immutability preserved)', async () => {
    const context = makeContext();
    const result = await module.evaluate(context);

    expect(Object.isFrozen(result.trace)).toBe(true);
    expect(Object.isFrozen(result.trace.decision)).toBe(true);
    expect(Object.isFrozen(result.trace.evaluations)).toBe(true);
  });

  // ─── Additional Coverage (QA Automate) ──────────────────────────────

  it('evaluate() handles sell action type', async () => {
    const context = makeContext({
      rules: [makeRule({
        name: 'sell-rally',
        conditions: [{ field: 'price_rise', operator: '>', threshold: 5 }],
        action: 'sell',
        amount: 0.2,
        weight: 85,
      })],
      marketData: makeMarketData({ priceChange1m: 10 }),
    });

    const result = await module.evaluate(context);
    expect(result.action).toBe('sell');
    expect(result.amount).toBe(0.2);
    expect(result.trace.decision.action).toBe('sell');
  });

  it('evaluate() selects highest-scoring rule when multiple rules match', async () => {
    const context = makeContext({
      rules: [
        makeRule({ name: 'low-weight', weight: 50, amount: 0.05, action: 'buy' }),
        makeRule({ name: 'high-weight', weight: 90, amount: 0.3, action: 'sell' }),
      ],
      marketData: makeMarketData({ priceChange1m: -10 }),
    });

    // high-weight (90) is above threshold (70), low-weight (50) is below
    const result = await module.evaluate(context);
    expect(result.action).toBe('sell');
    expect(result.amount).toBe(0.3);
    expect(result.trace.decision.ruleName).toBe('high-weight');
  });

  it('evaluate() returns none for empty rules array', async () => {
    const context = makeContext({ rules: [] });
    const result = await module.evaluate(context);

    expect(result.action).toBe('none');
    expect(result.trace.evaluations).toHaveLength(0);
  });

  it('default execution threshold matches DEFAULT_EXECUTION_THRESHOLD constant', async () => {
    // Rule weight exactly at threshold should fire
    const atThreshold = new RuleBasedDecisionModule();
    const contextAt = makeContext({ rules: [makeRule({ weight: DEFAULT_EXECUTION_THRESHOLD })] });
    const resultAt = await atThreshold.evaluate(contextAt);
    expect(resultAt.action).toBe('buy');

    // Rule weight below threshold should not fire
    const belowThreshold = new RuleBasedDecisionModule();
    const contextBelow = makeContext({ rules: [makeRule({ weight: DEFAULT_EXECUTION_THRESHOLD - 1 })] });
    const resultBelow = await belowThreshold.evaluate(contextBelow);
    expect(resultBelow.action).toBe('none');
  });
});
