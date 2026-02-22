import { DEFAULT_EXECUTION_THRESHOLD } from './constants.js';
import { evaluateAllRules, CooldownTracker } from './rules.js';
import { buildDecisionTrace } from './trace.js';
import type { DecisionModule, DecisionResult, EvaluationContext } from './types.js';

/**
 * Built-in decision module that evaluates rules with compound conditions,
 * weighted scoring, cooldown tracking, and balance pre-checks.
 * Implements all FR15–FR23 features.
 *
 * This is the default decision module used by AgentRuntime when no custom
 * module is provided. It wraps the existing rule engine (evaluateAllRules)
 * and trace builder (buildDecisionTrace) into the DecisionModule interface.
 *
 * @param executionThreshold - Minimum weighted score to execute an action (default: 70).
 */
export class RuleBasedDecisionModule implements DecisionModule {
  private readonly cooldownTracker = new CooldownTracker();
  private readonly executionThreshold: number;

  constructor(executionThreshold?: number) {
    this.executionThreshold = executionThreshold ?? DEFAULT_EXECUTION_THRESHOLD;
  }

  /**
   * Evaluate the current context using the rule engine and return a decision.
   *
   * @param context - Agent state, market data, rules, and peer states.
   * @returns The decision result including action, reason, and audit trace.
   */
  evaluate(context: EvaluationContext): Promise<DecisionResult> {
    const result = evaluateAllRules(context, this.cooldownTracker, this.executionThreshold);
    const trace = buildDecisionTrace(context.agentState.agentId, result, context.marketData);

    // Record cooldown if an action was taken
    if (result.decision.action !== 'none' && result.decision.ruleIndex !== undefined) {
      this.cooldownTracker.recordExecution(result.decision.ruleIndex);
    }

    return Promise.resolve({
      action: result.decision.action,
      amount: result.decision.amount,
      reason: result.decision.reason,
      trace,
    });
  }

  /**
   * Reset internal state (cooldown timers). Called on agent stop/restart.
   */
  reset(): void {
    this.cooldownTracker.reset();
  }
}
