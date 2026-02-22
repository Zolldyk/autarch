import { EventEmitter } from 'node:events';
import { Agent } from './agent.js';
import { FileWatcher } from './file-watcher.js';
import { RuleBasedDecisionModule } from './rule-based-decision-module.js';
import { SimulatedMarketDataProvider } from './simulated-provider.js';
import type { AgentConfig, AgentState, AgentLifecycleEvent, AgentRuntimeOptions, MarketDataProvider, MarketUpdateEvent, RulesReloadedEvent, SimulationModeEvent } from './types.js';

/**
 * Orchestrates multiple agents with independent lifecycles and fault isolation.
 * Emits `agentLifecycle` and `stateUpdate` events for consumers.
 *
 * @param options - Runtime configuration containing agent entries.
 */
export class AgentRuntime extends EventEmitter {
  private readonly agents: Map<number, Agent> = new Map();
  private readonly states: Map<number, AgentState> = new Map();
  private readonly watchers: Map<number, FileWatcher> = new Map();
  private readonly marketProvider: MarketDataProvider;

  constructor(options: AgentRuntimeOptions) {
    super();

    this.marketProvider = options.marketProvider ?? new SimulatedMarketDataProvider();
    const marketProvider = this.marketProvider;
    const sharedDecisionModule = options.decisionModule;

    for (const entry of options.agents) {
      const onStateChange = (state: AgentState): void => {
        this.states.set(entry.agentId, state);
        this.emit('stateUpdate', state);
      };

      const onAutoStop = (event: AgentLifecycleEvent): void => {
        this.emit('agentLifecycle', event);
      };

      const onError = (event: AgentLifecycleEvent): void => {
        this.emit('agentLifecycle', event);
      };

      const getPeerStates = (): readonly AgentState[] => {
        return Array.from(this.states.values()).filter(s => s.agentId !== entry.agentId);
      };

      // Per-agent module when no custom module provided
      const decisionModule = sharedDecisionModule ?? new RuleBasedDecisionModule();
      const ownsDecisionModule = sharedDecisionModule === undefined;

      const agent = new Agent(
        entry.agentId,
        entry.config,
        entry.wallet,
        entry.getBalance,
        marketProvider,
        getPeerStates,
        onStateChange,
        onAutoStop,
        onError,
        decisionModule,
        ownsDecisionModule,
      );

      this.agents.set(entry.agentId, agent);
      this.states.set(entry.agentId, agent.getState());

      if (entry.configPath) {
        const watcher = new FileWatcher(
          entry.configPath,
          (newConfig: AgentConfig) => {
            agent.updateConfig(newConfig);
            const event: RulesReloadedEvent = {
              agentId: entry.agentId,
              success: true,
              timestamp: Date.now(),
            };
            this.emit('rulesReloaded', event);
          },
          (error: string) => {
            const event: RulesReloadedEvent = {
              agentId: entry.agentId,
              success: false,
              error,
              timestamp: Date.now(),
            };
            this.emit('rulesReloaded', event);
          },
        );
        this.watchers.set(entry.agentId, watcher);
      }
    }
  }

  /**
   * Start all agents and emit lifecycle events.
   *
   * @returns void
   */
  start(): void {
    for (const [agentId, agent] of this.agents) {
      const wasRunning = agent.isRunning();
      agent.start();
      if (!wasRunning) {
        this.emit('agentLifecycle', {
          agentId,
          event: 'started',
          timestamp: Date.now(),
        } satisfies AgentLifecycleEvent);
      }
    }

    for (const watcher of this.watchers.values()) {
      watcher.start();
    }
  }

  /**
   * Stop one or all agents.
   *
   * @param agentId - If provided, stop only that agent. Otherwise stop all.
   * @returns void
   */
  stop(agentId?: number): void {
    if (agentId !== undefined) {
      const agent = this.agents.get(agentId);
      if (agent) {
        const wasRunning = agent.isRunning();
        agent.stop();
        if (wasRunning) {
          this.emit('agentLifecycle', {
            agentId,
            event: 'stopped',
            timestamp: Date.now(),
          } satisfies AgentLifecycleEvent);
        }
      }
      const watcher = this.watchers.get(agentId);
      if (watcher) {
        watcher.close();
      }
    } else {
      for (const [id, agent] of this.agents) {
        const wasRunning = agent.isRunning();
        agent.stop();
        if (wasRunning) {
          this.emit('agentLifecycle', {
            agentId: id,
            event: 'stopped',
            timestamp: Date.now(),
          } satisfies AgentLifecycleEvent);
        }
      }
      for (const watcher of this.watchers.values()) {
        watcher.close();
      }
    }
  }

  /**
   * Return current cached states from all agents.
   *
   * @returns Array of AgentState snapshots.
   */
  getStates(): AgentState[] {
    return Array.from(this.states.values());
  }

  /**
   * Collect fresh states across all agents with fault isolation.
   * If an agent refresh fails, returns its last-known-good cached state.
   *
   * @returns Refreshed states in agent registration order.
   */
  async collectStates(): Promise<AgentState[]> {
    const entries = Array.from(this.agents.entries());
    const results = await Promise.allSettled(entries.map(([, agent]) => agent.collectState()));

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const [agentId, agent] = entries[index]!;
      return this.states.get(agentId) ?? agent.getState();
    });
  }

  /**
   * Inject an immediate price dip and emit a marketUpdate event.
   *
   * @param percent - Percentage to drop the price by.
   * @returns void
   */
  injectDip(percent: number): void {
    this.marketProvider.injectDip(percent);
    this.emit('marketUpdate', {
      marketData: this.marketProvider.getSnapshot(),
      timestamp: Date.now(),
    } satisfies MarketUpdateEvent);
  }

  /**
   * Inject an immediate price rally and emit a marketUpdate event.
   *
   * @param percent - Percentage to increase the price by.
   * @returns void
   */
  injectRally(percent: number): void {
    this.marketProvider.injectRally(percent);
    this.emit('marketUpdate', {
      marketData: this.marketProvider.getSnapshot(),
      timestamp: Date.now(),
    } satisfies MarketUpdateEvent);
  }

  /**
   * Reset market to baseline and emit a marketUpdate event.
   *
   * @returns void
   */
  resetMarket(): void {
    this.marketProvider.resetToBaseline();
    this.emit('marketUpdate', {
      marketData: this.marketProvider.getSnapshot(),
      timestamp: Date.now(),
    } satisfies MarketUpdateEvent);
  }

  /**
   * Report a simulation mode transition and emit a simulationMode event.
   *
   * @param active - Whether simulation mode is now active.
   * @param reason - Human-readable reason for the transition.
   * @returns void
   */
  reportSimulationMode(active: boolean, reason: string): void {
    this.emit('simulationMode', {
      active,
      reason,
      timestamp: Date.now(),
    } satisfies SimulationModeEvent);
  }

  /**
   * Retrieve a specific agent by ID.
   *
   * @param agentId - The agent's numeric identifier.
   * @returns The Agent instance, or undefined if not found.
   */
  getAgent(agentId: number): Agent | undefined {
    return this.agents.get(agentId);
  }
}
