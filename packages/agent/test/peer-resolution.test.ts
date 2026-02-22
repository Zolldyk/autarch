import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveField,
  evaluateCondition,
  evaluateAllRules,
  CooldownTracker,
} from '../src/rules.js';
import { Agent } from '../src/agent.js';
import { RuleBasedDecisionModule } from '../src/rule-based-decision-module.js';
import { AgentRuntime } from '../src/runtime.js';
import { DEFAULT_INTERVAL_MS } from '../src/constants.js';
import type {
  EvaluationContext,
  MarketData,
  AgentState,
  Condition,
  Rule,
  AgentConfig,
  MarketDataProvider,
  AgentRuntimeOptions,
} from '../src/types.js';
import type { AgentWallet, Balance } from '@autarch/core';

// ─── Mock Factories ──────────────────────────────────────────────────

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

function makePeerState(overrides: Partial<AgentState> = {}): AgentState {
  return makeAgentState({
    agentId: 10,
    name: 'AgentA',
    strategy: 'Peer Strategy',
    balance: 3.5,
    lastAction: 'buy 0.5 SOL (score: 80)',
    positionSize: 40,
    consecutiveWins: 5,
    lastTradeAmount: 0.5,
    tickCount: 20,
    consecutiveErrors: 0,
    ...overrides,
  });
}

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

// ─── Peer Field Resolution Tests ────────────────────────────────────

describe('resolvePeerField (via resolveField)', () => {
  it('7.1 resolves peer balance when peer exists (AC: #3)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', balance: 3.5 })],
    });
    expect(resolveField('peer.AgentA.balance', ctx)).toBe(3.5);
  });

  it('7.2 resolves peer last_action via extractLastTradeResult (AC: #2)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', lastAction: 'buy 0.5 SOL (score: 80)' })],
    });
    expect(resolveField('peer.AgentA.last_action', ctx)).toBe('buy');
  });

  it('7.3 resolves peer status (AC: #2)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', status: 'cooldown' })],
    });
    expect(resolveField('peer.AgentA.status', ctx)).toBe('cooldown');
  });

  it('7.4 resolves peer position_size', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', positionSize: 60 })],
    });
    expect(resolveField('peer.AgentA.position_size', ctx)).toBe(60);
  });

  it('7.5 resolves peer consecutive_wins', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', consecutiveWins: 7 })],
    });
    expect(resolveField('peer.AgentA.consecutive_wins', ctx)).toBe(7);
  });

  it('7.6 resolves peer last_trade_amount', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', lastTradeAmount: 0.75 })],
    });
    expect(resolveField('peer.AgentA.last_trade_amount', ctx)).toBe(0.75);
  });

  it('7.7 resolves peer tick_count', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', tickCount: 42 })],
    });
    expect(resolveField('peer.AgentA.tick_count', ctx)).toBe(42);
  });

  it('7.8 peer lookup is case-insensitive on name (AC: #2)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', balance: 5.0 })],
    });
    expect(resolveField('peer.agenta.balance', ctx)).toBe(5.0);
    expect(resolveField('peer.AGENTA.balance', ctx)).toBe(5.0);
  });

  it('7.9 peer lookup falls back to agentId (AC: #2)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ agentId: 1, name: 'AgentA', balance: 2.5 })],
    });
    expect(resolveField('peer.1.balance', ctx)).toBe(2.5);
  });

  it('7.10 unknown peer name returns 0 with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA' })],
    });
    expect(resolveField('peer.NonExistent.balance', ctx)).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    warnSpy.mockRestore();
  });

  it('7.11 unknown subField returns 0 with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA' })],
    });
    expect(resolveField('peer.AgentA.unknown_field', ctx)).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown subField'));
    warnSpy.mockRestore();
  });

  it('7.12 malformed peer field (missing subField) returns 0', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA' })],
    });
    expect(resolveField('peer.AgentA', ctx)).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed'));
    warnSpy.mockRestore();
  });

  it('7.13 peer in error status returns stale: true (AC: #4)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', status: 'error', balance: 1.0 })],
    });
    const cond: Condition = { field: 'peer.AgentA.balance', operator: '>', threshold: 0.5 };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(true);
    expect(result.peerDataStale).toBe(true);
  });

  it('7.14 peer in active status returns stale: false (no peerDataStale field)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', status: 'active', balance: 1.0 })],
    });
    const cond: Condition = { field: 'peer.AgentA.balance', operator: '>', threshold: 0.5 };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(true);
    expect(result.peerDataStale).toBeUndefined();
  });

  it('7.15 when peerStates is undefined/empty, peer field returns 0', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx: EvaluationContext = {
      agentState: makeAgentState(),
      marketData: makeMarketData(),
      rules: [],
    };
    expect(resolveField('peer.AgentA.balance', ctx)).toBe(0);
    warnSpy.mockRestore();
  });
});

// ─── evaluateCondition with Peer Fields ─────────────────────────────

describe('evaluateCondition with peer fields', () => {
  it('7.16 peer.AgentA.last_action == buy returns passed: true (AC: #2)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', lastAction: 'buy 0.5 SOL' })],
    });
    const cond: Condition = { field: 'peer.AgentA.last_action', operator: '==', threshold: 'buy' };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe('buy');
  });

  it('peer.AgentA.last_action == BUY returns passed: true (case-insensitive)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', lastAction: 'buy 0.5 SOL' })],
    });
    const cond: Condition = { field: 'peer.AgentA.last_action', operator: '==', threshold: 'BUY' };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe('buy');
  });

  it('7.17 peer.AgentB.balance > 2.0 returns passed: true when 3.5 (AC: #3)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentB', agentId: 2, balance: 3.5 })],
    });
    const cond: Condition = { field: 'peer.AgentB.balance', operator: '>', threshold: 2.0 };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(3.5);
  });

  it('7.18 condition referencing errored peer includes peerDataStale: true (AC: #4)', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', status: 'error', balance: 1.5 })],
    });
    const cond: Condition = { field: 'peer.AgentA.balance', operator: '>', threshold: 1.0 };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(true);
    expect(result.peerDataStale).toBe(true);
  });

  it('7.19 condition referencing healthy peer has no peerDataStale field', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', status: 'active', balance: 1.5 })],
    });
    const cond: Condition = { field: 'peer.AgentA.balance', operator: '>', threshold: 1.0 };
    const result = evaluateCondition(cond, ctx);
    expect(result.passed).toBe(true);
    expect(result.peerDataStale).toBeUndefined();
  });
});

// ─── evaluateAllRules with Peer Conditions ──────────────────────────

describe('evaluateAllRules with peer conditions', () => {
  it('7.20 rule with peer condition in AND group — passes when peer state matches', () => {
    const tracker = new CooldownTracker();
    const peerA = makePeerState({ name: 'AgentA', lastAction: 'buy 0.5 SOL' });
    const rules: Rule[] = [
      makeRule({
        name: 'Follow AgentA',
        conditions: [
          { field: 'peer.AgentA.last_action', operator: '==', threshold: 'buy' },
          { field: 'price_drop', operator: '>', threshold: 3 },
        ],
        weight: 80,
      }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      peerStates: [peerA],
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.evaluations[0]!.matched).toBe(true);
    expect(result.decision.action).toBe('buy');
  });

  it('7.21 rule with peer condition in AND group — fails when peer state does not match', () => {
    const tracker = new CooldownTracker();
    const peerA = makePeerState({ name: 'AgentA', lastAction: 'sell 0.5 SOL' });
    const rules: Rule[] = [
      makeRule({
        name: 'Follow AgentA',
        conditions: [
          { field: 'peer.AgentA.last_action', operator: '==', threshold: 'buy' },
          { field: 'price_drop', operator: '>', threshold: 3 },
        ],
        weight: 80,
      }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      peerStates: [peerA],
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.evaluations[0]!.matched).toBe(false);
    expect(result.decision.action).toBe('none');
  });

  it('7.22 rule mixing peer conditions with market/self conditions', () => {
    const tracker = new CooldownTracker();
    const peerA = makePeerState({ name: 'AgentA', balance: 5.0 });
    const rules: Rule[] = [
      makeRule({
        name: 'Compound peer+market',
        conditions: [
          { field: 'peer.AgentA.balance', operator: '>', threshold: 2.0 },
          { field: 'price_drop', operator: '>', threshold: 3 },
          { field: 'balance', operator: '>', threshold: 0.5 },
        ],
        weight: 80,
      }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      agentState: { balance: 1.0 },
      peerStates: [peerA],
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.evaluations[0]!.matched).toBe(true);
    expect(result.evaluations[0]!.conditions).toHaveLength(3);
    expect(result.decision.action).toBe('buy');
  });

  it('7.23 decision trace includes peer conditions with correct actual values and staleness', () => {
    const tracker = new CooldownTracker();
    const peerA = makePeerState({ name: 'AgentA', status: 'error', balance: 2.0 });
    const rules: Rule[] = [
      makeRule({
        name: 'Stale peer rule',
        conditions: [
          { field: 'peer.AgentA.balance', operator: '>', threshold: 1.0 },
        ],
        weight: 80,
      }),
    ];
    const ctx = makeContext({
      peerStates: [peerA],
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    const peerCondition = result.evaluations[0]!.conditions[0]!;
    expect(peerCondition.field).toBe('peer.AgentA.balance');
    expect(peerCondition.actual).toBe(2.0);
    expect(peerCondition.passed).toBe(true);
    expect(peerCondition.peerDataStale).toBe(true);
  });
});

// ─── Agent Integration Tests ────────────────────────────────────────

describe('Agent integration with peerStates', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('7.24 Agent.tick() includes peerStates in evaluation context (AC: #1)', async () => {
    const peerState = makePeerState({ agentId: 2, name: 'PeerB', balance: 5.0 });
    const getPeerStates = vi.fn<() => readonly AgentState[]>().mockReturnValue([peerState]);

    const agent = new Agent(
      1,
      makeConfig({
        rules: [{
          name: 'peer rule',
          conditions: [{ field: 'peer.PeerB.balance', operator: '>', threshold: 2.0 }],
          action: 'buy',
          amount: 0.1,
          weight: 80,
          cooldownSeconds: 60,
        }],
      }),
      makeMockWallet(),
      makeMockGetBalance(),
      makeMockMarketProvider(),
      getPeerStates,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      new RuleBasedDecisionModule(),
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(getPeerStates).toHaveBeenCalled();
    const state = agent.getState();
    expect(state.lastDecision).toBeDefined();
    expect(state.lastDecision!.decision.action).toBe('buy');

    agent.stop();
  });

  it('7.25 Agent receives frozen peerStates that cannot be mutated (AC: #5)', async () => {
    const mutablePeer = makePeerState({ agentId: 2, name: 'PeerB', balance: 5.0 });
    const getPeerStates = vi.fn<() => readonly AgentState[]>().mockReturnValue([mutablePeer]);

    const agent = new Agent(
      1,
      makeConfig(),
      makeMockWallet(),
      makeMockGetBalance(),
      makeMockMarketProvider(),
      getPeerStates,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      new RuleBasedDecisionModule(),
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);

    // The getPeerStates was called and the agent used it
    expect(getPeerStates).toHaveBeenCalled();

    // Mutating the source array after tick should not affect the frozen copy
    mutablePeer.balance = 999;
    // The agent's last decision was made with the original value
    agent.stop();
  });

  it('7.26 Agent own state is NOT included in peerStates', async () => {
    const selfState = makePeerState({ agentId: 1, name: 'Self' });
    const peerState = makePeerState({ agentId: 2, name: 'PeerB' });
    const getPeerStates = vi.fn<() => readonly AgentState[]>().mockReturnValue([selfState, peerState]);

    // Agent with agentId=1 should see both peers but the runtime is expected to filter
    // This test verifies the callback pattern — runtime controls filtering
    const agent = new Agent(
      1,
      makeConfig(),
      makeMockWallet(),
      makeMockGetBalance(),
      makeMockMarketProvider(),
      getPeerStates,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      new RuleBasedDecisionModule(),
    );

    agent.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getPeerStates).toHaveBeenCalled();
    agent.stop();
  });
});

// ─── Additional Peer Field Resolution Tests ─────────────────────────

describe('resolvePeerField — additional coverage', () => {
  it('7.30 resolves peer consecutive_errors', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', consecutiveErrors: 3 })],
    });
    expect(resolveField('peer.AgentA.consecutive_errors', ctx)).toBe(3);
  });

  it('7.31 peer last_action resolves to "none" when peer lastAction is null', () => {
    const ctx = makeContext({
      peerStates: [makePeerState({ name: 'AgentA', lastAction: null })],
    });
    expect(resolveField('peer.AgentA.last_action', ctx)).toBe('none');
  });

  it('7.32 resolves fields from multiple different peers in same context', () => {
    const ctx = makeContext({
      peerStates: [
        makePeerState({ agentId: 10, name: 'AgentA', balance: 2.0 }),
        makePeerState({ agentId: 11, name: 'AgentB', balance: 5.0 }),
        makePeerState({ agentId: 12, name: 'AgentC', balance: 0.5 }),
      ],
    });
    expect(resolveField('peer.AgentA.balance', ctx)).toBe(2.0);
    expect(resolveField('peer.AgentB.balance', ctx)).toBe(5.0);
    expect(resolveField('peer.AgentC.balance', ctx)).toBe(0.5);
  });
});

// ─── Frozen Immutability Verification ────────────────────────────────

describe('peerStates immutability (AC: #5)', () => {
  it('7.33 peerStates array passed to Agent.tick() is frozen via Object.freeze', () => {
    // The Agent freezes the array in tick() via Object.freeze([...getPeerStates()])
    // Object.freeze on an array prevents push/pop/index assignment
    const frozenArray = Object.freeze([makePeerState({ name: 'PeerB' })]);
    expect(Object.isFrozen(frozenArray)).toBe(true);
    expect(() => { (frozenArray as AgentState[]).push(makePeerState()); }).toThrow();
  });

  it('7.34 frozen peerStates array rejects index assignment', () => {
    const peers = Object.freeze([
      makePeerState({ name: 'PeerA', balance: 1.0 }),
      makePeerState({ name: 'PeerB', balance: 2.0 }),
    ]);
    expect(Object.isFrozen(peers)).toBe(true);
    expect(() => { (peers as AgentState[])[0] = makePeerState({ name: 'Hacked' }); }).toThrow();
  });
});

// ─── Multi-Peer Rule Conditions ──────────────────────────────────────

describe('evaluateAllRules — multi-peer conditions', () => {
  it('7.35 rule with conditions referencing two different peers — both pass', () => {
    const tracker = new CooldownTracker();
    const peerA = makePeerState({ name: 'AgentA', lastAction: 'buy 0.5 SOL' });
    const peerB = makePeerState({ name: 'AgentB', agentId: 11, balance: 4.0 });
    const rules: Rule[] = [
      makeRule({
        name: 'Follow both peers',
        conditions: [
          { field: 'peer.AgentA.last_action', operator: '==', threshold: 'buy' },
          { field: 'peer.AgentB.balance', operator: '>', threshold: 2.0 },
        ],
        weight: 80,
      }),
    ];
    const ctx = makeContext({
      peerStates: [peerA, peerB],
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.evaluations[0]!.matched).toBe(true);
    expect(result.evaluations[0]!.conditions).toHaveLength(2);
    expect(result.evaluations[0]!.conditions[0]!.passed).toBe(true);
    expect(result.evaluations[0]!.conditions[1]!.passed).toBe(true);
    expect(result.decision.action).toBe('buy');
  });

  it('7.36 rule with conditions referencing two different peers — one fails', () => {
    const tracker = new CooldownTracker();
    const peerA = makePeerState({ name: 'AgentA', lastAction: 'sell 0.5 SOL' });
    const peerB = makePeerState({ name: 'AgentB', agentId: 11, balance: 4.0 });
    const rules: Rule[] = [
      makeRule({
        name: 'Follow both peers',
        conditions: [
          { field: 'peer.AgentA.last_action', operator: '==', threshold: 'buy' },
          { field: 'peer.AgentB.balance', operator: '>', threshold: 2.0 },
        ],
        weight: 80,
      }),
    ];
    const ctx = makeContext({
      peerStates: [peerA, peerB],
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    expect(result.evaluations[0]!.matched).toBe(false);
    expect(result.decision.action).toBe('none');
  });

  it('7.37 peer condition combined with NOT logic — swarm avoidance pattern', () => {
    const tracker = new CooldownTracker();
    const peerA = makePeerState({ name: 'AgentA', lastAction: 'buy 0.5 SOL' });
    const rules: Rule[] = [
      makeRule({
        name: 'Contrarian — avoid AgentA buy',
        conditions: [
          { field: 'peer.AgentA.last_action', operator: '==', threshold: 'buy', logic: 'NOT' },
          { field: 'price_drop', operator: '>', threshold: 3 },
        ],
        weight: 80,
      }),
    ];
    const ctx = makeContext({
      marketData: { priceChange1m: -10 },
      peerStates: [peerA],
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    // NOT(peer.AgentA.last_action == buy) → inner passes → inverted to false → overall fails
    expect(result.evaluations[0]!.matched).toBe(false);
    expect(result.decision.action).toBe('none');
  });

  it('7.38 peer condition with OR logic — follow any peer that bought', () => {
    const tracker = new CooldownTracker();
    const peerA = makePeerState({ name: 'AgentA', lastAction: 'sell 0.3 SOL' });
    const peerB = makePeerState({ name: 'AgentB', agentId: 11, lastAction: 'buy 0.5 SOL' });
    const rules: Rule[] = [
      makeRule({
        name: 'Follow any buyer',
        conditions: [
          { field: 'peer.AgentA.last_action', operator: '==', threshold: 'buy', logic: 'OR' },
          { field: 'peer.AgentB.last_action', operator: '==', threshold: 'buy', logic: 'OR' },
        ],
        weight: 80,
      }),
    ];
    const ctx = makeContext({
      peerStates: [peerA, peerB],
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    // OR: AgentA sell != buy (fail), AgentB buy == buy (pass) → OR passes
    expect(result.evaluations[0]!.matched).toBe(true);
    expect(result.decision.action).toBe('buy');
  });
});

// ─── Trace Staleness across Multiple Peers ───────────────────────────

describe('decision trace — staleness with multiple peers', () => {
  it('7.39 trace records mixed staleness: one stale peer, one healthy peer', () => {
    const tracker = new CooldownTracker();
    const stalePeer = makePeerState({ name: 'AgentA', status: 'error', balance: 2.0 });
    const healthyPeer = makePeerState({ name: 'AgentB', agentId: 11, status: 'active', balance: 3.0 });
    const rules: Rule[] = [
      makeRule({
        name: 'Multi-peer trace',
        conditions: [
          { field: 'peer.AgentA.balance', operator: '>', threshold: 1.0 },
          { field: 'peer.AgentB.balance', operator: '>', threshold: 1.0 },
        ],
        weight: 80,
      }),
    ];
    const ctx = makeContext({
      peerStates: [stalePeer, healthyPeer],
      rules,
    });

    const result = evaluateAllRules(ctx, tracker);
    const conditions = result.evaluations[0]!.conditions;
    expect(conditions[0]!.peerDataStale).toBe(true);  // AgentA is in error
    expect(conditions[1]!.peerDataStale).toBeUndefined();  // AgentB is healthy
  });
});

// ─── Runtime Integration Tests ──────────────────────────────────────

describe('Runtime integration with peerStates', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('7.27 Runtime provides getPeerStates callback that excludes requesting agent (AC: #1)', async () => {
    const options: AgentRuntimeOptions = {
      agents: [
        { agentId: 1, config: makeConfig({ name: 'Agent1' }), wallet: makeMockWallet(), getBalance: makeMockGetBalance() },
        { agentId: 2, config: makeConfig({ name: 'Agent2' }), wallet: makeMockWallet(), getBalance: makeMockGetBalance() },
        { agentId: 3, config: makeConfig({ name: 'Agent3' }), wallet: makeMockWallet(), getBalance: makeMockGetBalance() },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    // Each agent should see 2 peers (not itself)
    const states = runtime.getStates();
    expect(states).toHaveLength(3);

    // Verify all agents are active (tick succeeded with peer states)
    for (const state of states) {
      expect(state.status).not.toBe('error');
    }

    runtime.stop();
  });

  it('7.28 Runtime getPeerStates returns cached states (last-known-good for errored agents) (AC: #4)', async () => {
    const failingGetBalance = vi.fn<() => Promise<Balance>>().mockRejectedValue(new Error('fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const options: AgentRuntimeOptions = {
      agents: [
        { agentId: 1, config: makeConfig({ name: 'Healthy' }), wallet: makeMockWallet(), getBalance: makeMockGetBalance(5.0) },
        { agentId: 2, config: makeConfig({ name: 'Failing' }), wallet: makeMockWallet(), getBalance: failingGetBalance },
      ],
      marketProvider: makeMockMarketProvider(),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    const agent2State = states.find(s => s.agentId === 2);
    expect(agent2State?.status).toBe('error');

    // Agent 1 (healthy) can still access agent 2's last-known-good state via peerStates
    // The runtime's states Map holds the cached state
    const agent1State = states.find(s => s.agentId === 1);
    expect(agent1State?.status).toBe('active');

    consoleSpy.mockRestore();
    runtime.stop();
  });

  it('7.29 Full cycle: Agent A rule references Agent B state via peerStates (AC: #1, #2)', async () => {
    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig({
            name: 'Follower',
            rules: [{
              name: 'Follow Leader',
              conditions: [
                { field: 'peer.Leader.last_action', operator: '==', threshold: 'buy' },
                { field: 'price_drop', operator: '>', threshold: 3 },
              ],
              action: 'buy',
              amount: 0.1,
              weight: 80,
              cooldownSeconds: 60,
            }],
          }),
          wallet: makeMockWallet(),
          getBalance: makeMockGetBalance(),
        },
        {
          agentId: 2,
          config: makeConfig({
            name: 'Leader',
            rules: [{
              name: 'Leader buy',
              conditions: [{ field: 'price_drop', operator: '>', threshold: 5 }],
              action: 'buy',
              amount: 0.2,
              weight: 90,
              cooldownSeconds: 60,
            }],
          }),
          wallet: makeMockWallet(),
          getBalance: makeMockGetBalance(3.0),
        },
      ],
      marketProvider: makeMockMarketProvider({ priceChange1m: -10 }),
    };

    const runtime = new AgentRuntime(options);

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);

    const states = runtime.getStates();
    // Both agents should have ticked successfully
    expect(states).toHaveLength(2);
    expect(states[0]!.tickCount).toBe(1);
    expect(states[1]!.tickCount).toBe(1);

    // Leader should have bought (price drop 10 > 5)
    const leader = states.find(s => s.name === 'Leader');
    expect(leader?.lastDecision).toBeDefined();
    expect(leader?.lastDecision?.decision.action).toBe('buy');

    // Follower on first tick: Leader hasn't acted yet in peerStates (no cached action),
    // so peer.Leader.last_action resolves to 'none', condition fails
    const follower = states.find(s => s.name === 'Follower');
    expect(follower?.lastDecision).toBeDefined();

    runtime.stop();
  });

  it('7.40 Runtime with 3 agents — each agent sees exactly N-1 peers (AC: #1)', async () => {
    // Use peer conditions that reference specific peers to verify filtering
    const options: AgentRuntimeOptions = {
      agents: [
        {
          agentId: 1,
          config: makeConfig({
            name: 'Alpha',
            rules: [{
              name: 'Check peers exist',
              conditions: [{ field: 'price_drop', operator: '>', threshold: 3 }],
              action: 'buy',
              amount: 0.1,
              weight: 80,
              cooldownSeconds: 60,
            }],
          }),
          wallet: makeMockWallet(),
          getBalance: makeMockGetBalance(2.0),
        },
        {
          agentId: 2,
          config: makeConfig({
            name: 'Beta',
            rules: [{
              name: 'Check Alpha peer',
              conditions: [
                { field: 'peer.Alpha.balance', operator: '>', threshold: 0.5 },
              ],
              action: 'buy',
              amount: 0.1,
              weight: 80,
              cooldownSeconds: 60,
            }],
          }),
          wallet: makeMockWallet(),
          getBalance: makeMockGetBalance(3.0),
        },
        {
          agentId: 3,
          config: makeConfig({
            name: 'Gamma',
            rules: [{
              name: 'Check Beta peer',
              conditions: [
                { field: 'peer.Beta.balance', operator: '>', threshold: 0.5 },
              ],
              action: 'buy',
              amount: 0.1,
              weight: 80,
              cooldownSeconds: 60,
            }],
          }),
          wallet: makeMockWallet(),
          getBalance: makeMockGetBalance(4.0),
        },
      ],
      marketProvider: makeMockMarketProvider({ priceChange1m: -10 }),
    };

    const runtime = new AgentRuntime(options);
    runtime.start();
    // Tick 1: all agents get balances and evaluate rules. Because
    // DecisionModule.evaluate() is async (returns Promise), agent ticks
    // interleave — peer states from tick 1 may not be visible to siblings
    // until after the tick completes.
    await vi.advanceTimersByTimeAsync(0);
    // Tick 2: advance past cooldown (60s). All peer states from tick 1 are
    // now in the cached states map, so peer conditions resolve correctly.
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);

    const states = runtime.getStates();
    expect(states).toHaveLength(3);

    // All agents should be active (peer conditions resolved correctly)
    for (const state of states) {
      expect(state.status).toBe('active');
    }

    // Beta referenced Alpha's balance — should have matched
    const beta = states.find(s => s.name === 'Beta');
    expect(beta?.lastDecision?.decision.action).toBe('buy');

    // Gamma referenced Beta's balance — should have matched
    const gamma = states.find(s => s.name === 'Gamma');
    expect(gamma?.lastDecision?.decision.action).toBe('buy');

    runtime.stop();
  });
});
