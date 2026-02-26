import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveField,
  evaluateCondition,
  evaluateConditions,
  evaluateAllRules,
  evaluateRule,
  CooldownTracker,
} from '../src/rules.js';
import type {
  EvaluationContext,
  MarketData,
  AgentState,
  Condition,
  Rule,
} from '../src/types.js';
import { DEFAULT_EXECUTION_THRESHOLD } from '../src/constants.js';

/** Create a fixed MarketData snapshot. */
function makeMarketData(overrides: Partial<MarketData> = {}): MarketData {
  return {
    price: 100,
    priceChange1m: -5,
    priceChange5m: -8,
    volumeChange1m: 200,
    timestamp: Date.now(),
    source: 'simulated',
    ...overrides,
  };
}

/** Create a minimal valid AgentState. */
function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    agentId: 1,
    name: 'Test Agent',
    strategy: 'Test Strategy',
    status: 'active',
    address: 'mock-address',
    balance: 1.0,
    lastAction: null,
    lastActionTimestamp: null,
    consecutiveErrors: 0,
    tickCount: 5,
    lastError: null,
    positionSize: 25,
    consecutiveWins: 3,
    lastTradeAmount: 0.1,
    traceHistory: [],
    ...overrides,
  };
}

/** Create an evaluation context with controllable values. */
function makeContext(overrides: {
  agentState?: Partial<AgentState>;
  marketData?: Partial<MarketData>;
  rules?: Rule[];
  peerStates?: AgentState[];
} = {}): EvaluationContext {
  return {
    agentState: makeAgentState(overrides.agentState),
    marketData: makeMarketData(overrides.marketData),
    rules: overrides.rules ?? [],
    peerStates: overrides.peerStates ?? [],
  };
}

/** Create a test rule with defaults. */
function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    name: 'Test Rule',
    conditions: [{ field: 'price_drop', operator: '>', threshold: 5 }],
    action: 'buy',
    amount: 0.1,
    weight: 80,
    cooldownSeconds: 60,
    ...overrides,
  };
}

// ─── Field Resolution Tests ────────────────────────────────────────────

describe('resolveField', () => {
  it('resolves price from marketData (AC: #4)', () => {
    const ctx = makeContext({ marketData: { price: 150 } });
    expect(resolveField('price', ctx)).toBe(150);
  });

  it('resolves price_drop as absolute drop percentage (AC: #4)', () => {
    const ctx = makeContext({ marketData: { priceChange1m: -7 } });
    expect(resolveField('price_drop', ctx)).toBe(7);
  });

  it('resolves price_drop as 0 when price rose (AC: #4)', () => {
    const ctx = makeContext({ marketData: { priceChange1m: 3 } });
    expect(resolveField('price_drop', ctx)).toBe(0);
  });

  it('resolves volume_spike from marketData (AC: #4)', () => {
    const ctx = makeContext({ marketData: { volumeChange1m: 250 } });
    expect(resolveField('volume_spike', ctx)).toBe(250);
  });

  it('resolves volume_spike as 0 when volume dropped', () => {
    const ctx = makeContext({ marketData: { volumeChange1m: -50 } });
    expect(resolveField('volume_spike', ctx)).toBe(0);
  });

  it('resolves price_change from marketData', () => {
    const ctx = makeContext({ marketData: { priceChange1m: -3 } });
    expect(resolveField('price_change', ctx)).toBe(-3);
    expect(resolveField('price_change_1m', ctx)).toBe(-3);
  });

  it('resolves price_change_5m from marketData', () => {
    const ctx = makeContext({ marketData: { priceChange5m: 12 } });
    expect(resolveField('price_change_5m', ctx)).toBe(12);
  });

  it('resolves price_rise from marketData', () => {
    const ctx = makeContext({ marketData: { priceChange1m: 8 } });
    expect(resolveField('price_rise', ctx)).toBe(8);
  });

  it('resolves price_rise as 0 when price dropped', () => {
    const ctx = makeContext({ marketData: { priceChange1m: -4 } });
    expect(resolveField('price_rise', ctx)).toBe(0);
  });

  it('resolves volume_change from marketData', () => {
    const ctx = makeContext({ marketData: { volumeChange1m: -30 } });
    expect(resolveField('volume_change', ctx)).toBe(-30);
    expect(resolveField('volume_change_1m', ctx)).toBe(-30);
  });

  it('resolves balance from agentState (AC: #5)', () => {
    const ctx = makeContext({ agentState: { balance: 2.5 } });
    expect(resolveField('balance', ctx)).toBe(2.5);
  });

  it('resolves position_size from agentState (AC: #5)', () => {
    const ctx = makeContext({ agentState: { positionSize: 40 } });
    expect(resolveField('position_size', ctx)).toBe(40);
  });

  it('resolves consecutive_wins from agentState (AC: #5)', () => {
    const ctx = makeContext({ agentState: { consecutiveWins: 7 } });
    expect(resolveField('consecutive_wins', ctx)).toBe(7);
  });

  it('resolves consecutive_errors from agentState', () => {
    const ctx = makeContext({ agentState: { consecutiveErrors: 2 } });
    expect(resolveField('consecutive_errors', ctx)).toBe(2);
  });

  it('resolves tick_count from agentState', () => {
    const ctx = makeContext({ agentState: { tickCount: 42 } });
    expect(resolveField('tick_count', ctx)).toBe(42);
  });

  it('resolves status from agentState', () => {
    const ctx = makeContext({ agentState: { status: 'cooldown' } });
    expect(resolveField('status', ctx)).toBe('cooldown');
  });

  it('resolves last_trade_result from lastAction (AC: #5)', () => {
    const ctx = makeContext({ agentState: { lastAction: 'buy 0.1 SOL' } });
    expect(resolveField('last_trade_result', ctx)).toBe('buy');
  });

  it('resolves last_trade_result as none for no-op action string', () => {
    const ctx = makeContext({ agentState: { lastAction: 'none: No rules matched' } });
    expect(resolveField('last_trade_result', ctx)).toBe('none');
  });

  it('resolves last_trade_result as none when no lastAction', () => {
    const ctx = makeContext({ agentState: { lastAction: null } });
    expect(resolveField('last_trade_result', ctx)).toBe('none');
  });

  it('resolves last_trade_amount from agentState', () => {
    const ctx = makeContext({ agentState: { lastTradeAmount: 0.5 } });
    expect(resolveField('last_trade_amount', ctx)).toBe(0.5);
  });

  it('returns 0 for unknown field (no throw)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeContext();
    expect(resolveField('unknown_field', ctx)).toBe(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});

// ─── Single Condition Tests ────────────────────────────────────────────

describe('evaluateCondition', () => {
  it('> operator passes when actual > threshold', () => {
    const ctx = makeContext({ marketData: { priceChange1m: -10 } });
    const cond: Condition = { field: 'price_drop', operator: '>', threshold: 5 };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(10);
  });

  it('> operator fails when actual <= threshold', () => {
    const ctx = makeContext({ marketData: { priceChange1m: -3 } });
    const cond: Condition = { field: 'price_drop', operator: '>', threshold: 5 };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(3);
  });

  it('< operator works correctly', () => {
    const ctx = makeContext({ agentState: { positionSize: 30 } });
    const cond: Condition = { field: 'position_size', operator: '<', threshold: 50 };
    expect(evaluateCondition(cond, ctx).passed).toBe(true);

    const ctx2 = makeContext({ agentState: { positionSize: 60 } });
    expect(evaluateCondition(cond, ctx2).passed).toBe(false);
  });

  it('>= boundary condition', () => {
    const ctx = makeContext({ agentState: { balance: 1.0 } });
    const cond: Condition = { field: 'balance', operator: '>=', threshold: 1.0 };
    expect(evaluateCondition(cond, ctx).passed).toBe(true);

    const ctx2 = makeContext({ agentState: { balance: 0.99 } });
    expect(evaluateCondition(cond, ctx2).passed).toBe(false);
  });

  it('<= boundary condition', () => {
    const ctx = makeContext({ agentState: { consecutiveErrors: 3 } });
    const cond: Condition = { field: 'consecutive_errors', operator: '<=', threshold: 3 };
    expect(evaluateCondition(cond, ctx).passed).toBe(true);

    const ctx2 = makeContext({ agentState: { consecutiveErrors: 4 } });
    expect(evaluateCondition(cond, ctx2).passed).toBe(false);
  });

  it('== with string comparison', () => {
    const ctx = makeContext({ agentState: { lastAction: 'buy 0.1 SOL' } });
    const cond: Condition = { field: 'last_trade_result', operator: '==', threshold: 'buy' };
    expect(evaluateCondition(cond, ctx).passed).toBe(true);
  });

  it('!= operator', () => {
    const ctx = makeContext({ agentState: { status: 'active' } });
    const cond: Condition = { field: 'status', operator: '!=', threshold: 'error' };
    expect(evaluateCondition(cond, ctx).passed).toBe(true);

    const cond2: Condition = { field: 'status', operator: '!=', threshold: 'active' };
    expect(evaluateCondition(cond2, ctx).passed).toBe(false);
  });

  it('numeric threshold with string actual triggers type coercion', () => {
    // status is a string, comparing against number should coerce — NaN means fail
    const ctx = makeContext({ agentState: { status: 'active' } });
    const cond: Condition = { field: 'status', operator: '>', threshold: 5 };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(false);
  });
});

// ─── Compound Condition Tests (AND/OR/NOT) ─────────────────────────────

describe('evaluateConditions', () => {
  it('AND group — all pass → matched true (AC: #1)', () => {
    const ctx = makeContext({
      marketData: { priceChange1m: -10, volumeChange1m: 250 },
      agentState: { positionSize: 30 },
    });
    const conditions: Condition[] = [
      { field: 'price_drop', operator: '>', threshold: 5 },
      { field: 'volume_spike', operator: '>', threshold: 200 },
      { field: 'position_size', operator: '<', threshold: 50 },
    ];
    const { results, matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(true);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('AND group — one fails → matched false (AC: #1)', () => {
    const ctx = makeContext({
      marketData: { priceChange1m: -10, volumeChange1m: 150 },
      agentState: { positionSize: 30 },
    });
    const conditions: Condition[] = [
      { field: 'price_drop', operator: '>', threshold: 5 },
      { field: 'volume_spike', operator: '>', threshold: 200 }, // fails: 150 < 200
      { field: 'position_size', operator: '<', threshold: 50 },
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(false);
  });

  it('OR group — one passes → matched true (AC: #2)', () => {
    const ctx = makeContext({
      marketData: { priceChange1m: -12, volumeChange1m: 100 },
    });
    const conditions: Condition[] = [
      { field: 'price_drop', operator: '>', threshold: 10, logic: 'OR' },
      { field: 'volume_spike', operator: '>', threshold: 300, logic: 'OR' }, // fails
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(true);
  });

  it('OR group — all fail → matched false (AC: #2)', () => {
    const ctx = makeContext({
      marketData: { priceChange1m: -5, volumeChange1m: 100 },
    });
    const conditions: Condition[] = [
      { field: 'price_drop', operator: '>', threshold: 10, logic: 'OR' },
      { field: 'volume_spike', operator: '>', threshold: 300, logic: 'OR' },
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(false);
  });

  it('NOT condition — inner passes → result inverted to false (AC: #3)', () => {
    const ctx = makeContext({ agentState: { lastAction: 'buy 0.1 SOL' } });
    const conditions: Condition[] = [
      { field: 'last_trade_result', operator: '==', threshold: 'buy', logic: 'NOT' },
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(false); // inner passes (buy == buy), NOT inverts to false
  });

  it('NOT condition — inner fails → result inverted to true (AC: #3)', () => {
    const ctx = makeContext({ agentState: { lastAction: 'sell 0.1 SOL' } });
    const conditions: Condition[] = [
      { field: 'last_trade_result', operator: '==', threshold: 'failure', logic: 'NOT' },
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(true); // inner fails (sell != failure), NOT inverts to true
  });

  it('mixed AND + OR groups — both groups must pass', () => {
    const ctx = makeContext({
      marketData: { priceChange1m: -12, volumeChange1m: 100 },
      agentState: { positionSize: 30 },
    });
    const conditions: Condition[] = [
      // AND group: position_size < 50 → pass
      { field: 'position_size', operator: '<', threshold: 50 },
      // OR group: price_drop > 10 → pass, volume_spike > 300 → fail
      { field: 'price_drop', operator: '>', threshold: 10, logic: 'OR' },
      { field: 'volume_spike', operator: '>', threshold: 300, logic: 'OR' },
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(true); // AND passes, OR passes (one is enough)
  });

  it('mixed AND + OR — AND fails → overall false even if OR passes', () => {
    const ctx = makeContext({
      marketData: { priceChange1m: -12, volumeChange1m: 100 },
      agentState: { positionSize: 60 }, // AND condition fails
    });
    const conditions: Condition[] = [
      { field: 'position_size', operator: '<', threshold: 50 },
      { field: 'price_drop', operator: '>', threshold: 10, logic: 'OR' },
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(false);
  });

  it('all conditions evaluated even if early short-circuit possible (trace completeness)', () => {
    const ctx = makeContext({
      marketData: { priceChange1m: -1, volumeChange1m: 50 },
      agentState: { positionSize: 80 },
    });
    const conditions: Condition[] = [
      { field: 'price_drop', operator: '>', threshold: 5 }, // fails immediately
      { field: 'volume_spike', operator: '>', threshold: 200 },
      { field: 'position_size', operator: '<', threshold: 50 },
    ];
    const { results, matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(false);
    expect(results).toHaveLength(3); // all 3 evaluated
    expect(results[0]!.passed).toBe(false);
    expect(results[1]!.passed).toBe(false);
    expect(results[2]!.passed).toBe(false);
  });
});

// ─── Cooldown Tests ─────────────────────────────────────────────────────

describe('CooldownTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rule with active cooldown returns active (AC: #7)', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(1000);
    tracker.recordExecution(0);

    vi.setSystemTime(1000 + 60_000); // 60s later, cooldown = 120s
    const result = tracker.isOnCooldown(0, 120);
    expect(result.active).toBe(true);
    expect(result.remainingMs).toBe(60_000);
  });

  it('rule with expired cooldown evaluates normally (AC: #7)', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(1000);
    tracker.recordExecution(0);

    vi.setSystemTime(1000 + 121_000); // 121s later, cooldown = 120s
    const result = tracker.isOnCooldown(0, 120);
    expect(result.active).toBe(false);
    expect(result.remainingMs).toBe(0);
  });

  it('rule with zero cooldownSeconds never blocks', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(1000);
    tracker.recordExecution(0);

    vi.setSystemTime(1001); // 1ms later
    const result = tracker.isOnCooldown(0, 0);
    expect(result.active).toBe(false);
    expect(result.remainingMs).toBe(0);
  });

  it('no execution recorded returns clear', () => {
    const tracker = new CooldownTracker();
    const result = tracker.isOnCooldown(0, 120);
    expect(result.active).toBe(false);
    expect(result.remainingMs).toBe(0);
  });

  it('recordExecution + isOnCooldown timing', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(0);

    // Exactly at boundary
    vi.setSystemTime(120_000);
    expect(tracker.isOnCooldown(0, 120).active).toBe(false);

    // 1ms before boundary
    vi.setSystemTime(119_999);
    expect(tracker.isOnCooldown(0, 120).active).toBe(true);
  });

  it('reset() clears all cooldowns', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(0);
    tracker.recordExecution(1);
    tracker.recordExecution(2);

    tracker.reset();

    vi.setSystemTime(1); // 1ms later — would be on cooldown if not reset
    expect(tracker.isOnCooldown(0, 120).active).toBe(false);
    expect(tracker.isOnCooldown(1, 120).active).toBe(false);
    expect(tracker.isOnCooldown(2, 120).active).toBe(false);
  });
});

// ─── evaluateRule Tests ─────────────────────────────────────────────────

describe('evaluateRule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rule on cooldown returns matched: false, cooldown: active (AC: #7)', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(0);

    vi.setSystemTime(30_000); // 30s into 60s cooldown
    const rule = makeRule({ cooldownSeconds: 60 });
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateRule(rule, 0, ctx, tracker);
    expect(result.matched).toBe(false);
    expect(result.cooldown).toBe('active');
    expect(result.conditions).toHaveLength(0);
  });

  it('rule off cooldown evaluates conditions normally', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule();
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateRule(rule, 0, ctx, tracker);
    expect(result.matched).toBe(true);
    expect(result.cooldown).toBe('clear');
    expect(result.score).toBe(80);
    expect(result.conditions).toHaveLength(1);
  });

  it('unmatched rule has score 0', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule();
    const ctx = makeContext({
      marketData: { priceChange1m: 5 }, // price rose, no drop
      rules: [rule],
    });

    const result = evaluateRule(rule, 0, ctx, tracker);
    expect(result.matched).toBe(false);
    expect(result.score).toBe(0);
  });
});

// ─── Weighted Scoring Tests ─────────────────────────────────────────────

describe('evaluateAllRules — Weighted Scoring', () => {
  it('single matching rule with weight 80 → score 80, action executes (AC: #6)', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ weight: 80 });
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(80);
  });

  it('two matching rules with same action → weights sum (AC: #6)', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({ name: 'Rule A', weight: 40, conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }] }),
      makeRule({ name: 'Rule B', weight: 40, conditions: [{ field: 'volume_spike', operator: '>', threshold: 100 }] }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10, volumeChange1m: 200 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(80); // 40 + 40
  });

  it('score below threshold (70) → action is none (AC: #6)', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ weight: 60 });
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('none');
    expect(result.decision.reason).toContain('below threshold');
    expect(result.decision.score).toBe(60);
  });

  it('score exactly at threshold (70) → action executes', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ weight: 70 });
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(70);
  });

  it('two actions compete — highest total weight wins', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({ name: 'Buy Rule', action: 'buy', weight: 60, conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }] }),
      makeRule({ name: 'Sell Rule', action: 'sell', weight: 80, conditions: [{ field: 'volume_spike', operator: '>', threshold: 100 }] }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10, volumeChange1m: 200 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('sell');
    expect(result.decision.score).toBe(80);
  });

  it('action none rules are excluded from winner selection', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({
        name: 'No-op rule',
        action: 'none',
        weight: 95,
        conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }],
      }),
      makeRule({
        name: 'Buy rule',
        action: 'buy',
        weight: 80,
        conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }],
      }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(80);
  });

  it('no rules match → action is none with explanatory reason', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({
      conditions: [{ field: 'price_drop', operator: '>', threshold: 50 }],
    });
    const ctx = makeContext({
      marketData: { priceChange1m: -1 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('none');
    expect(result.decision.reason).toContain('No rules matched');
  });

  it('custom execution threshold overrides default', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ weight: 50 });
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    // With default threshold (70), score 50 would fail
    const result1 = evaluateAllRules(ctx, tracker);
    expect(result1.decision.action).toBe('none');

    // With threshold 40, score 50 passes
    const result2 = evaluateAllRules(ctx, tracker, 40);
    expect(result2.decision.action).toBe('buy');
  });
});

// ─── Balance Pre-Check Tests ────────────────────────────────────────────

describe('evaluateAllRules — Balance Pre-Check', () => {
  it('action requires 0.5 SOL, balance is 1.0 → executes (AC: #8)', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ amount: 0.5, weight: 80 });
    const ctx = makeContext({
      agentState: { balance: 1.0 },
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
  });

  it('action requires 0.5 SOL, balance is 0.3 → blocked with insufficient_balance (AC: #8)', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ amount: 0.5, weight: 80 });
    const ctx = makeContext({
      agentState: { balance: 0.3 },
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('none');
    expect(result.decision.reason).toBe('insufficient_balance');
    // Verify the evaluation is marked as blocked
    const blockedEval = result.evaluations.find(e => e.blocked === 'insufficient_balance');
    expect(blockedEval).toBeDefined();
  });

  it('action none does not trigger balance check', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({
      action: 'none',
      weight: 80,
      conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }],
    });
    const ctx = makeContext({
      agentState: { balance: 0 }, // zero balance
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    // 'none' actions don't require balance, but also don't produce an action
    // Since the only action is 'none', no rules with actionable result match
    expect(result.decision.action).toBe('none');
    expect(result.decision.reason).not.toBe('insufficient_balance');
  });
});

// ─── Integration Tests ──────────────────────────────────────────────────

describe('evaluateAllRules — Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('full evaluation with 3 rules, mixed results, correct action selected', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({
        name: 'Conservative Buy',
        action: 'buy',
        weight: 40,
        conditions: [
          { field: 'price_drop', operator: '>', threshold: 3 },
          { field: 'position_size', operator: '<', threshold: 50 },
        ],
      }),
      makeRule({
        name: 'Aggressive Buy',
        action: 'buy',
        weight: 45,
        conditions: [
          { field: 'price_drop', operator: '>', threshold: 10 },
          { field: 'volume_spike', operator: '>', threshold: 200 },
        ],
      }),
      makeRule({
        name: 'Sell Signal',
        action: 'sell',
        weight: 60,
        conditions: [
          { field: 'price_rise', operator: '>', threshold: 5 },
        ],
      }),
    ];

    const ctx = makeContext({
      marketData: { priceChange1m: -15, volumeChange1m: 300 },
      agentState: { positionSize: 30, balance: 1.0 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.evaluations).toHaveLength(3);
    // Conservative Buy: matched (40), Aggressive Buy: matched (45), Sell: not matched
    expect(result.evaluations[0]!.matched).toBe(true); // Conservative Buy
    expect(result.evaluations[1]!.matched).toBe(true); // Aggressive Buy
    expect(result.evaluations[2]!.matched).toBe(false); // Sell — price dropped, no rise
    // Total buy score = 40 + 45 = 85 >= 70 threshold
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(85);
  });

  it('cooldown interaction: rule on cooldown excluded from scoring', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(0); // Rule 0 on cooldown

    vi.setSystemTime(30_000); // 30s into 60s cooldown

    const rules: Rule[] = [
      makeRule({ name: 'On Cooldown', weight: 80, cooldownSeconds: 60 }),
      makeRule({ name: 'Available', weight: 75, cooldownSeconds: 0, conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }] }),
    ];

    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.evaluations[0]!.cooldown).toBe('active');
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(75); // Only available rule counted
  });

  it('performance — evaluate 10 rules with 5 conditions each in < 100ms (NFR1)', () => {
    const tracker = new CooldownTracker();
    const rules = Array.from({ length: 10 }, (_, i) => makeRule({
      name: `Rule ${i}`,
      weight: 50 + i,
      conditions: [
        { field: 'price_drop', operator: '>', threshold: i },
        { field: 'volume_spike', operator: '>', threshold: i * 10 },
        { field: 'position_size', operator: '<', threshold: 90 },
        { field: 'balance', operator: '>', threshold: 0.01 },
        { field: 'consecutive_errors', operator: '<', threshold: 10 },
      ],
    }));

    const ctx = makeContext({
      marketData: { priceChange1m: -15, volumeChange1m: 300 },
      agentState: { positionSize: 20, balance: 5.0 },
      rules,
    });

    const start = performance.now();
    evaluateAllRules(ctx, tracker);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});

// ─── Story 2.4 Gap Coverage ─────────────────────────────────────────────

describe('evaluateConditions — mixed AND + OR + NOT combined', () => {
  it('AND + OR + NOT all three groups — all pass → matched true', () => {
    const ctx = makeContext({
      marketData: { priceChange1m: -12, volumeChange1m: 350 },
      agentState: { positionSize: 30, lastAction: 'sell 0.2 SOL' },
    });
    const conditions: Condition[] = [
      // AND group: position_size < 50 → passes
      { field: 'position_size', operator: '<', threshold: 50 },
      // OR group: price_drop > 10 → passes, volume_spike > 500 → fails
      { field: 'price_drop', operator: '>', threshold: 10, logic: 'OR' },
      { field: 'volume_spike', operator: '>', threshold: 500, logic: 'OR' },
      // NOT group: NOT(last_trade_result == 'failure') → inner fails → inverted to true
      { field: 'last_trade_result', operator: '==', threshold: 'failure', logic: 'NOT' },
    ];
    const { results, matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(true);
    expect(results).toHaveLength(4);
  });

  it('AND + OR + NOT — NOT group fails → overall false', () => {
    const ctx = makeContext({
      marketData: { priceChange1m: -12, volumeChange1m: 350 },
      agentState: { positionSize: 30, lastAction: 'buy 0.1 SOL' },
    });
    const conditions: Condition[] = [
      { field: 'position_size', operator: '<', threshold: 50 },
      { field: 'price_drop', operator: '>', threshold: 10, logic: 'OR' },
      // NOT(last_trade_result == 'buy') → inner passes → inverted to false
      { field: 'last_trade_result', operator: '==', threshold: 'buy', logic: 'NOT' },
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(false);
  });

  it('multiple NOT conditions — all must pass (inverted)', () => {
    const ctx = makeContext({
      agentState: { status: 'active', lastAction: 'buy 0.1 SOL' },
    });
    const conditions: Condition[] = [
      // NOT(status == 'error') → inner fails → inverted to true
      { field: 'status', operator: '==', threshold: 'error', logic: 'NOT' },
      // NOT(last_trade_result == 'failure') → inner fails → inverted to true
      { field: 'last_trade_result', operator: '==', threshold: 'failure', logic: 'NOT' },
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(true);
  });

  it('multiple NOT conditions — one fails → overall false', () => {
    const ctx = makeContext({
      agentState: { status: 'error', lastAction: 'sell 0.1 SOL' },
    });
    const conditions: Condition[] = [
      // NOT(status == 'error') → inner passes → inverted to false
      { field: 'status', operator: '==', threshold: 'error', logic: 'NOT' },
      // NOT(last_trade_result == 'failure') → inner fails → inverted to true
      { field: 'last_trade_result', operator: '==', threshold: 'failure', logic: 'NOT' },
    ];
    const { matched } = evaluateConditions(conditions, ctx);
    expect(matched).toBe(false);
  });
});

describe('evaluateCondition — ConditionResult structure completeness (AC: #1)', () => {
  it('returns field, operator, threshold, actual, and passed in result', () => {
    const ctx = makeContext({ marketData: { priceChange1m: -8 } });
    const cond: Condition = { field: 'price_drop', operator: '>', threshold: 5 };
    const result = evaluateCondition(cond, ctx);
    expect(result.field).toBe('price_drop');
    expect(result.operator).toBe('>');
    expect(result.threshold).toBe(5);
    expect(result.actual).toBe(8);
    expect(result.passed).toBe(true);
  });

  it('records actual value even when condition fails', () => {
    const ctx = makeContext({ marketData: { priceChange1m: -2 } });
    const cond: Condition = { field: 'price_drop', operator: '>', threshold: 5 };
    const result = evaluateCondition(cond, ctx);
    expect(result.actual).toBe(2);
    expect(result.passed).toBe(false);
  });
});

describe('evaluateAllRules — Balance Pre-Check for sell and transfer (AC: #8)', () => {
  it('sell action blocked when insufficient balance', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ action: 'sell', amount: 2.0, weight: 80 });
    const ctx = makeContext({
      agentState: { balance: 0.5 },
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('none');
    expect(result.decision.reason).toBe('insufficient_balance');
  });

  it('transfer action blocked when insufficient balance', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ action: 'transfer', amount: 1.5, weight: 80 });
    const ctx = makeContext({
      agentState: { balance: 0.3 },
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('none');
    expect(result.decision.reason).toBe('insufficient_balance');
  });

  it('amount exactly equals balance → action executes', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ amount: 1.0, weight: 80 });
    const ctx = makeContext({
      agentState: { balance: 1.0 },
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
  });
});

describe('evaluateAllRules — Edge Cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('empty rules array → action none with no rules matched', () => {
    const tracker = new CooldownTracker();
    const ctx = makeContext({ rules: [] });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('none');
    expect(result.evaluations).toHaveLength(0);
  });

  it('all rules on cooldown → action none', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(0);
    tracker.recordExecution(1);

    vi.setSystemTime(30_000); // 30s into 60s cooldown

    const rules: Rule[] = [
      makeRule({ name: 'Rule A', cooldownSeconds: 60 }),
      makeRule({ name: 'Rule B', cooldownSeconds: 60, conditions: [{ field: 'volume_spike', operator: '>', threshold: 100 }] }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10, volumeChange1m: 200 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('none');
    expect(result.evaluations[0]!.cooldown).toBe('active');
    expect(result.evaluations[1]!.cooldown).toBe('active');
  });

  it('3+ rules with same action — all weights sum correctly (FR19)', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({ name: 'Buy A', action: 'buy', weight: 25, conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }] }),
      makeRule({ name: 'Buy B', action: 'buy', weight: 25, conditions: [{ field: 'volume_spike', operator: '>', threshold: 100 }] }),
      makeRule({ name: 'Buy C', action: 'buy', weight: 25, conditions: [{ field: 'position_size', operator: '<', threshold: 50 }] }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10, volumeChange1m: 200 },
      agentState: { positionSize: 30, balance: 5.0 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(75); // 25 + 25 + 25
  });

  it('rule with weight 0 — matches but contributes no score', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ weight: 0 });
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.evaluations[0]!.matched).toBe(true);
    expect(result.evaluations[0]!.score).toBe(0);
    expect(result.decision.action).toBe('none');
  });

  it('rule with weight 100 — single rule exceeds threshold', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ weight: 100 });
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(100);
  });

  it('multiple competing actions — all below threshold → action none', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({ name: 'Buy', action: 'buy', weight: 40, conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }] }),
      makeRule({ name: 'Sell', action: 'sell', weight: 50, conditions: [{ field: 'volume_spike', operator: '>', threshold: 100 }] }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10, volumeChange1m: 200 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('none');
    expect(result.decision.reason).toContain('below threshold');
    // Sell has higher score but still below 70
    expect(result.decision.score).toBe(50);
  });

  it('cooldownRemaining is accurate in rule evaluation trace (FR20)', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(0);

    vi.setSystemTime(45_000); // 45s into 60s cooldown — 15s remaining

    const rule = makeRule({ cooldownSeconds: 60 });
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateRule(rule, 0, ctx, tracker);
    expect(result.cooldown).toBe('active');
    expect(result.cooldownRemaining).toBe(15_000);
  });

  it('decision includes ruleIndex and ruleName on match', () => {
    const tracker = new CooldownTracker();
    const rule = makeRule({ name: 'Dip Buyer', weight: 80 });
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      rules: [rule],
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.ruleIndex).toBe(0);
    expect(result.decision.ruleName).toBe('Dip Buyer');
    expect(result.decision.amount).toBe(0.1);
  });
});

// ─── CooldownTracker Direct Unit Tests ──────────────────────────────────

describe('CooldownTracker — Direct Unit Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks multiple independent rules with separate cooldowns', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(0);

    vi.setSystemTime(10_000);
    tracker.recordExecution(1);

    vi.setSystemTime(40_000);
    // Rule 0: 40s into cooldown. Rule 1: 30s into cooldown.
    expect(tracker.isOnCooldown(0, 60).active).toBe(true);
    expect(tracker.isOnCooldown(0, 60).remainingMs).toBe(20_000);
    expect(tracker.isOnCooldown(1, 60).active).toBe(true);
    expect(tracker.isOnCooldown(1, 60).remainingMs).toBe(30_000);
  });

  it('re-recording execution resets the cooldown timer', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(0);

    vi.setSystemTime(50_000); // 50s into 60s cooldown
    expect(tracker.isOnCooldown(0, 60).active).toBe(true);

    // Re-record — restarts cooldown
    tracker.recordExecution(0);
    vi.setSystemTime(100_000); // 50s after re-record
    expect(tracker.isOnCooldown(0, 60).active).toBe(true);
    expect(tracker.isOnCooldown(0, 60).remainingMs).toBe(10_000);
  });

  it('isOnCooldown with different cooldownSeconds on same rule', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(0);

    vi.setSystemTime(30_000);
    // Short cooldown (20s) → expired
    expect(tracker.isOnCooldown(0, 20).active).toBe(false);
    // Long cooldown (60s) → still active
    expect(tracker.isOnCooldown(0, 60).active).toBe(true);
  });

  it('handles large rule indices', () => {
    const tracker = new CooldownTracker();
    vi.setSystemTime(0);
    tracker.recordExecution(999);

    vi.setSystemTime(1);
    expect(tracker.isOnCooldown(999, 60).active).toBe(true);
    expect(tracker.isOnCooldown(998, 60).active).toBe(false);
  });
});

// ─── evaluateAllRules — Tied Weights & Mixed Actions ────────────────────

describe('evaluateAllRules — Tied Weights', () => {
  it('two actions with identical total weight — first action in iteration order wins', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({ name: 'Buy', action: 'buy', weight: 80, conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }] }),
      makeRule({ name: 'Sell', action: 'sell', weight: 80, conditions: [{ field: 'volume_spike', operator: '>', threshold: 100 }] }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10, volumeChange1m: 200 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    // Both have weight 80. The Map iteration preserves insertion order,
    // so 'buy' (inserted first) wins the tie.
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(80);
  });

  it('three buy rules with low weights summing above threshold', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({ name: 'Buy A', action: 'buy', weight: 25, conditions: [{ field: 'price_drop', operator: '>', threshold: 1 }] }),
      makeRule({ name: 'Buy B', action: 'buy', weight: 25, conditions: [{ field: 'volume_spike', operator: '>', threshold: 50 }] }),
      makeRule({ name: 'Buy C', action: 'buy', weight: 25, conditions: [{ field: 'balance', operator: '>', threshold: 0 }] }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -5, volumeChange1m: 100 },
      agentState: { balance: 5.0 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(75);
  });

  it('all matched rules have action none → decision is none with explanation', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({ name: 'Noop A', action: 'none', weight: 90, conditions: [{ field: 'price_drop', operator: '>', threshold: 1 }] }),
      makeRule({ name: 'Noop B', action: 'none', weight: 80, conditions: [{ field: 'volume_spike', operator: '>', threshold: 50 }] }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -5, volumeChange1m: 100 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('none');
    expect(result.decision.reason).toContain('No actionable rules matched');
  });

  it('bestRule tracks highest individual weight within winning action', () => {
    const tracker = new CooldownTracker();
    const rules: Rule[] = [
      makeRule({ name: 'Weak Buy', action: 'buy', weight: 30, amount: 0.05, conditions: [{ field: 'price_drop', operator: '>', threshold: 1 }] }),
      makeRule({ name: 'Strong Buy', action: 'buy', weight: 50, amount: 0.5, conditions: [{ field: 'volume_spike', operator: '>', threshold: 50 }] }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -5, volumeChange1m: 100 },
      agentState: { balance: 5.0 },
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.decision.action).toBe('buy');
    expect(result.decision.score).toBe(80); // 30 + 50
    // Best rule is "Strong Buy" (weight 50 > 30), so amount should be 0.5
    expect(result.decision.amount).toBe(0.5);
    expect(result.decision.ruleName).toBe('Strong Buy');
  });
});

// ─── Peer Field Resolution Tests ─────────────────────────────────────────

describe('resolveField — peer fields', () => {
  it('resolves peer.Name.balance via case-insensitive name match', () => {
    const ctx = makeContext({
      peerStates: [
        makeAgentState({ agentId: 2, name: 'AgentAlpha', balance: 3.5 }),
      ],
    });
    expect(resolveField('peer.agentalpha.balance', ctx)).toBe(3.5);
  });

  it('resolves peer by numeric agentId', () => {
    const ctx = makeContext({
      peerStates: [
        makeAgentState({ agentId: 5, name: 'AgentBeta', status: 'active' }),
      ],
    });
    expect(resolveField('peer.5.status', ctx)).toBe('active');
  });

  it('returns 0 for unknown peer name', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeContext({
      peerStates: [
        makeAgentState({ agentId: 1, name: 'Known' }),
      ],
    });
    expect(resolveField('peer.Unknown.balance', ctx)).toBe(0);
    warnSpy.mockRestore();
  });

  it('returns 0 for malformed peer field (too few parts)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeContext();
    expect(resolveField('peer.onlyTwo', ctx)).toBe(0);
    warnSpy.mockRestore();
  });

  it('returns 0 when no peerStates available', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeContext({ peerStates: [] });
    expect(resolveField('peer.Agent.balance', ctx)).toBe(0);
    warnSpy.mockRestore();
  });

  it('returns 0 for unknown peer subField', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeContext({
      peerStates: [makeAgentState({ agentId: 1, name: 'Agent' })],
    });
    expect(resolveField('peer.Agent.unknown_field', ctx)).toBe(0);
    warnSpy.mockRestore();
  });

  it('resolves peer.Name.last_action from lastAction field', () => {
    const ctx = makeContext({
      peerStates: [
        makeAgentState({ agentId: 1, name: 'Peer1', lastAction: 'sell 0.5 SOL' }),
      ],
    });
    expect(resolveField('peer.Peer1.last_action', ctx)).toBe('sell');
  });

  it('resolves peer.Name.consecutive_wins', () => {
    const ctx = makeContext({
      peerStates: [
        makeAgentState({ agentId: 1, name: 'Winner', consecutiveWins: 7 }),
      ],
    });
    expect(resolveField('peer.Winner.consecutive_wins', ctx)).toBe(7);
  });
});

// Agent.tick() integration tests are in agent.test.ts
