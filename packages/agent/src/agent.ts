import type { AgentWallet, Balance } from '@autarch/core';
import type { AgentConfig, AgentState, AgentStatus, AgentLifecycleEvent, MarketDataProvider, DecisionModule, DecisionTrace, EvaluationContext } from './types.js';
import { DEFAULT_INTERVAL_MS, MAX_CONSECUTIVE_ERRORS, MAX_TRACE_HISTORY } from './constants.js';

/**
 * A single autonomous agent with independent lifecycle and error boundary.
 *
 * @param agentId - Unique numeric identifier for this agent.
 * @param config - Agent configuration (name, strategy, rules, intervalMs).
 * @param wallet - Frozen wallet handle (address + signTransaction).
 * @param getBalance - Bound callback returning the agent's SOL balance.
 * @param marketProvider - Market data provider for rule evaluation.
 * @param getPeerStates - Callback returning frozen snapshots of all sibling agents' state.
 * @param onStateChange - Called whenever agent state changes.
 * @param onAutoStop - Called when agent auto-stops after consecutive errors.
 * @param onError - Called when tick execution fails.
 * @param decisionModule - Pluggable decision module for rule evaluation.
 */
export class Agent {
  private readonly agentId: number;
  private config: AgentConfig;
  private readonly wallet: AgentWallet;
  private readonly getBalance: () => Promise<Balance>;
  private readonly marketProvider: MarketDataProvider;
  private readonly getPeerStates: () => readonly AgentState[];
  private readonly decisionModule: DecisionModule;
  private readonly onStateChange: (state: AgentState) => void;
  private readonly onAutoStop: (event: AgentLifecycleEvent) => void;
  private readonly onError: (event: AgentLifecycleEvent) => void;
  private readonly ownsDecisionModule: boolean;

  private status: AgentStatus = 'idle';
  private balance = 0;
  private lastAction: string | null = null;
  private lastActionTimestamp: number | null = null;
  private consecutiveErrors = 0;
  private tickCount = 0;
  private lastError: string | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private positionSize = 0;
  private consecutiveWins = 0;
  private lastTradeAmount = 0;
  private lastDecision: DecisionTrace | undefined = undefined;
  private traceHistory: DecisionTrace[] = [];

  constructor(
    agentId: number,
    config: AgentConfig,
    wallet: AgentWallet,
    getBalance: () => Promise<Balance>,
    marketProvider: MarketDataProvider,
    getPeerStates: () => readonly AgentState[],
    onStateChange: (state: AgentState) => void,
    onAutoStop: (event: AgentLifecycleEvent) => void,
    onError: (event: AgentLifecycleEvent) => void,
    decisionModule: DecisionModule,
    ownsDecisionModule: boolean = true,
  ) {
    this.agentId = agentId;
    this.config = config;
    this.wallet = wallet;
    this.getBalance = getBalance;
    this.marketProvider = marketProvider;
    this.getPeerStates = getPeerStates;
    this.onStateChange = onStateChange;
    this.onAutoStop = onAutoStop;
    this.onError = onError;
    this.decisionModule = decisionModule;
    this.ownsDecisionModule = ownsDecisionModule;
  }

  /**
   * Start the agent's decision loop.
   *
   * @returns void
   */
  start(): void {
    if (this.intervalId !== null) {
      return;
    }

    this.status = 'active';
    this.onStateChange(this.getState());

    // Call tick immediately on start
    void this.tick();

    // Start interval for subsequent ticks
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.config.intervalMs ?? DEFAULT_INTERVAL_MS);
  }

  /**
   * Stop the agent's decision loop.
   *
   * @returns void
   */
  stop(): void {
    if (this.intervalId === null) {
      if (this.status !== 'stopped') {
        if (this.ownsDecisionModule) {
          this.decisionModule.reset?.();
        }
        this.lastDecision = undefined;
        this.traceHistory = [];
        this.status = 'stopped';
        this.onStateChange(this.getState());
      }
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
    if (this.ownsDecisionModule) {
      this.decisionModule.reset?.();
    }
    this.lastDecision = undefined;
    this.traceHistory = [];
    this.status = 'stopped';
    this.onStateChange(this.getState());
  }

  /**
   * Replace the agent's configuration with a validated new config.
   * Takes effect on the next tick cycle — the current cycle is unaffected.
   * The interval timer is NOT restarted (intervalMs changes require restart).
   *
   * @param newConfig - Validated AgentConfig to apply.
   */
  updateConfig(newConfig: AgentConfig): void {
    this.config = newConfig;
  }

  /**
   * Whether the agent currently has an active interval loop.
   *
   * @returns true if running, otherwise false.
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Collect a fresh state sample by querying balance once.
   * Used by runtime fan-out collection with Promise.allSettled.
   *
   * @returns Updated AgentState snapshot.
   */
  async collectState(): Promise<AgentState> {
    const balance = await this.getBalance();
    this.balance = balance.sol;
    this.lastError = null;
    if (this.isRunning()) {
      this.status = this.lastDecision?.decision.action !== 'none' ? 'active' : 'cooldown';
    }
    const state = this.getState();
    this.onStateChange(state);
    return state;
  }

  /**
   * Return a frozen snapshot of the agent's current state.
   *
   * @returns Frozen AgentState object.
   */
  getState(): AgentState {
    return Object.freeze({
      agentId: this.agentId,
      name: this.config.name,
      strategy: this.config.strategy,
      status: this.status,
      address: this.wallet.address,
      balance: this.balance,
      lastAction: this.lastAction,
      lastActionTimestamp: this.lastActionTimestamp,
      consecutiveErrors: this.consecutiveErrors,
      tickCount: this.tickCount,
      lastError: this.lastError,
      positionSize: this.positionSize,
      consecutiveWins: this.consecutiveWins,
      lastTradeAmount: this.lastTradeAmount,
      lastDecision: this.lastDecision,
      traceHistory: Object.freeze([...this.traceHistory]),
    });
  }

  /**
   * Per-tick execution with error boundary.
   * Collects balance, evaluates rules via the rule engine, and updates state.
   */
  private async tick(): Promise<void> {
    try {
      // Step 1: Collect balance
      const balance = await this.getBalance();
      this.balance = balance.sol;

      // Step 2: Get market data
      const marketData = this.marketProvider.getCurrentData();

      // Step 3: Get peer states for inter-agent dependencies (FR18)
      const peerStates = Object.freeze([...this.getPeerStates()]) as readonly AgentState[];

      // Step 4: Build evaluation context
      const context: EvaluationContext = {
        agentState: this.getState(),
        marketData,
        rules: this.config.rules,
        peerStates,
      };

      // Step 5: Delegate to decision module
      const decision = await this.decisionModule.evaluate(context);

      // Step 6: Process decision
      if (decision.action !== 'none') {
        const score = decision.trace.decision.score;
        this.lastAction = `${decision.action} ${decision.amount ?? 0} SOL${score !== undefined ? ` (score: ${score})` : ''}`;
      } else {
        this.lastAction = `none: ${decision.reason}`;
      }

      // Step 7: Store trace and accumulate history
      this.lastDecision = decision.trace;
      this.traceHistory.push(decision.trace);
      if (this.traceHistory.length > MAX_TRACE_HISTORY) {
        this.traceHistory.shift();
      }
      this.lastActionTimestamp = Date.now();

      // Step 8: Update status
      this.status = decision.action !== 'none' ? 'active' : 'cooldown';
      this.consecutiveErrors = 0;
      this.tickCount++;
      this.onStateChange(this.getState());
    } catch (error: unknown) {
      this.consecutiveErrors++;
      const message = error instanceof Error ? error.message : String(error);
      this.status = 'error';
      this.lastError = message;
      this.onError({
        agentId: this.agentId,
        event: 'error',
        timestamp: Date.now(),
        reason: message,
      });
      // Never log key material (NFR7)
      console.error(`Agent ${this.agentId} (${this.config.name}): tick error — ${message}`);
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.autoStop();
      }
      this.onStateChange(this.getState());
    }
  }

  /**
   * Auto-stop after exceeding consecutive error threshold.
   */
  private autoStop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.ownsDecisionModule) {
      this.decisionModule.reset?.();
    }
    this.lastDecision = undefined;
    this.traceHistory = [];
    this.status = 'stopped';
    this.onAutoStop({
      agentId: this.agentId,
      event: 'auto-stopped',
      timestamp: Date.now(),
      reason: `${MAX_CONSECUTIVE_ERRORS} consecutive errors`,
    });
  }
}
