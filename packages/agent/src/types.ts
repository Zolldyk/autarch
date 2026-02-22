import type { AgentWallet, Balance, ConnectionMode } from '@autarch/core';

/** Identifies whether a market data point was generated organically or manually injected. */
export type MarketDataSource = 'simulated' | 'injected';

/** A single market data snapshot produced by a MarketDataProvider. */
export interface MarketData {
  /** Current price in USD. */
  readonly price: number;
  /** Percentage change over ~1 minute. */
  readonly priceChange1m: number;
  /** Percentage change over ~5 minutes. */
  readonly priceChange5m: number;
  /** Percentage change in volume over ~1 minute. */
  readonly volumeChange1m: number;
  /** Date.now() when data point was generated. */
  readonly timestamp: number;
  /** 'simulated' for random walk, 'injected' for dip/rally. */
  readonly source: MarketDataSource;
}

/** Swappable interface for any market data source. */
export interface MarketDataProvider {
  /**
   * Advance the simulation and return the current market data snapshot.
   * @returns The latest MarketData point.
   */
  getCurrentData(): MarketData;
  /**
   * Return the latest market snapshot without advancing simulation state.
   * @returns The latest MarketData point.
   */
  getSnapshot(): MarketData;
  /**
   * Return historical market data entries.
   * @param minutes - If provided, only entries within the last N minutes. Otherwise all history.
   * @returns A new array of MarketData entries.
   */
  getHistory(minutes?: number): MarketData[];
  /**
   * Inject an immediate price dip.
   * @param percent - Percentage to drop the price by.
   */
  injectDip(percent: number): void;
  /**
   * Inject an immediate price rally.
   * @param percent - Percentage to increase the price by.
   */
  injectRally(percent: number): void;
  /** Reset price to the initial baseline and clear history. */
  resetToBaseline(): void;
}

/** Operators for comparing condition field values against thresholds. */
export type ConditionOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';

/** Logical operators for combining conditions within a rule. */
export type LogicalOperator = 'AND' | 'OR' | 'NOT';

/** Actions an agent rule can trigger. */
export type RuleAction = 'buy' | 'sell' | 'transfer' | 'none';

/** A single condition within a rule, evaluated against market/agent state. */
export interface Condition {
  /** Dot-notation path resolved by the rule engine (e.g., 'price_drop', 'peer.agentA.last_action'). */
  readonly field: string;
  /** Comparison operator. */
  readonly operator: ConditionOperator;
  /** Value to compare against — numeric for comparisons, string for equality checks. */
  readonly threshold: number | string;
  /** How this condition combines with others in the same rule. Defaults to 'AND'. */
  readonly logic?: LogicalOperator;
}

/** A single decision rule with conditions, action, and scoring metadata. */
export interface Rule {
  /** Human-readable rule name. */
  readonly name: string;
  /** Conditions that must be satisfied for this rule to fire. */
  readonly conditions: readonly Condition[];
  /** Action to execute when conditions are met. */
  readonly action: RuleAction;
  /** SOL amount for the action. */
  readonly amount: number;
  /** Weight for scoring (0–100). */
  readonly weight: number;
  /** Minimum seconds between consecutive executions. */
  readonly cooldownSeconds: number;
}

/** Top-level agent configuration loaded from a JSON rule file. */
export interface AgentConfig {
  /** Human-readable agent name (FR0.2). */
  readonly name: string;
  /** Strategy label (FR0.2). */
  readonly strategy: string;
  /** Decision cycle interval in milliseconds. Defaults to 60 000. */
  readonly intervalMs?: number;
  /** Rules array (FR12). */
  readonly rules: readonly Rule[];
}

/** Raw JSON file shape — identical to AgentConfig for documentation clarity. */
export type AgentConfigFile = AgentConfig;

/** Context passed to the rule engine for evaluation. */
export interface EvaluationContext {
  readonly agentState: AgentState;
  readonly marketData: MarketData;
  readonly rules: readonly Rule[];
  readonly peerStates?: readonly AgentState[];
}

/** Result of evaluating a single condition against the current context. */
export interface ConditionResult {
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly threshold: number | string;
  readonly actual: number | string;
  readonly passed: boolean;
  readonly peerDataStale?: boolean;
}

/** Result of evaluating a single rule, including all condition results and scoring. */
export interface RuleEvaluation {
  readonly ruleIndex: number;
  readonly ruleName: string;
  readonly conditions: ConditionResult[];
  readonly matched: boolean;
  readonly score: number;
  readonly cooldown?: 'active' | 'clear';
  readonly cooldownRemaining?: number;
  readonly blocked?: 'insufficient_balance';
}

/** Final result of evaluating all rules — the engine's decision. */
export interface EngineResult {
  readonly evaluations: RuleEvaluation[];
  readonly decision: {
    readonly action: RuleAction;
    readonly reason: string;
    readonly amount?: number;
    readonly ruleIndex?: number;
    readonly ruleName?: string;
    readonly score?: number;
  };
}

/** Result of a transaction execution attempt within a decision trace. */
export interface TraceExecution {
  readonly status: 'confirmed' | 'simulated' | 'failed';
  readonly signature?: string;
  readonly mode: ConnectionMode | 'degraded' | 'simulation';
  readonly error?: string;
}

/**
 * Complete audit record of a single agent evaluation cycle.
 * Wraps EngineResult with agent context (who, when, market conditions, execution).
 */
export interface DecisionTrace {
  readonly timestamp: number;
  readonly agentId: number;
  readonly marketData: MarketData;
  readonly evaluations: readonly RuleEvaluation[];
  readonly decision: {
    readonly action: RuleAction;
    readonly reason: string;
    readonly amount?: number;
    readonly ruleIndex?: number;
    readonly ruleName?: string;
    readonly score?: number;
  };
  readonly execution?: TraceExecution;
}

/**
 * Result returned by a DecisionModule after evaluating the current context.
 * Contains the chosen action and a complete audit trace.
 */
export interface DecisionResult {
  /** The action to execute. */
  readonly action: RuleAction;
  /** SOL amount for the action (undefined if action is 'none'). */
  readonly amount?: number;
  /** Human-readable explanation of why this action was chosen. */
  readonly reason: string;
  /** Complete audit trace of the evaluation cycle. */
  readonly trace: DecisionTrace;
}

/**
 * Pluggable interface for agent decision-making.
 * The built-in RuleBasedDecisionModule implements rule evaluation with
 * compound conditions, weighted scoring, and cooldown tracking.
 * Custom implementations can replace or wrap it (e.g., LLM-based decisions).
 *
 * @example
 * // Custom LLM-based decision module stub:
 * const llmModule: DecisionModule = {
 *   async evaluate(context) {
 *     const prompt = formatContextForLLM(context);
 *     const llmResponse = await callLLM(prompt);
 *     return {
 *       action: llmResponse.action,
 *       amount: llmResponse.amount,
 *       reason: llmResponse.reasoning,
 *       trace: buildTraceFromLLMResponse(context, llmResponse),
 *     };
 *   },
 * };
 */
export interface DecisionModule {
  /**
   * Evaluate the current context and decide what action to take.
   *
   * @param context - Agent state, market data, rules, and peer states.
   * @returns The decision result including action, reason, and audit trace.
   */
  evaluate(context: EvaluationContext): Promise<DecisionResult>;

  /**
   * Reset internal state (e.g., cooldown timers). Called on agent stop/restart.
   * Optional — modules without internal state can omit this.
   */
  reset?(): void;
}

/** Possible lifecycle states of an agent. */
export type AgentStatus = 'idle' | 'active' | 'cooldown' | 'error' | 'stopped';

/** Snapshot of an agent's current state — the contract between agent runtime and all consumers. */
export interface AgentState {
  readonly agentId: number;
  readonly name: string;
  readonly strategy: string;
  readonly status: AgentStatus;
  readonly address: string;
  readonly balance: number;
  readonly lastAction: string | null;
  readonly lastActionTimestamp: number | null;
  readonly consecutiveErrors: number;
  readonly tickCount: number;
  readonly lastError: string | null;
  /** Percentage of balance allocated (0-100). */
  readonly positionSize: number;
  /** Count of successive successful actions. */
  readonly consecutiveWins: number;
  /** Amount of last trade action. */
  readonly lastTradeAmount: number;
  /** Most recent decision trace (wraps rule evaluation with context). */
  readonly lastDecision?: DecisionTrace;
  /** Recent decision trace history (ring buffer). */
  readonly traceHistory: readonly DecisionTrace[];
}

/** Event emitted when an agent's lifecycle state changes. */
export interface AgentLifecycleEvent {
  readonly agentId: number;
  readonly event: 'started' | 'stopped' | 'auto-stopped' | 'error';
  readonly timestamp: number;
  readonly reason?: string;
}

/** Event emitted when agent rules are hot-reloaded from a config file change. */
export interface RulesReloadedEvent {
  readonly agentId: number;
  readonly success: boolean;
  readonly error?: string;
  readonly timestamp: number;
}

/** Event emitted when a market control method updates market data. */
export interface MarketUpdateEvent {
  readonly marketData: MarketData;
  readonly timestamp: number;
}

/** Event emitted when simulation mode transitions occur. */
export interface SimulationModeEvent {
  readonly active: boolean;
  readonly reason: string;
  readonly timestamp: number;
}

/** Options for constructing an AgentRuntime. */
export interface AgentRuntimeOptions {
  readonly agents: ReadonlyArray<{
    readonly agentId: number;
    readonly config: AgentConfig;
    readonly configPath?: string;
    readonly wallet: AgentWallet;
    readonly getBalance: () => Promise<Balance>;
  }>;
  /** Shared market data provider for all agents. If not provided, a SimulatedMarketDataProvider is used. */
  readonly marketProvider?: MarketDataProvider;
  /**
   * Custom decision module for all agents. If not provided, each agent gets
   * its own RuleBasedDecisionModule instance (FR53.1, FR50).
   */
  readonly decisionModule?: DecisionModule;
}
