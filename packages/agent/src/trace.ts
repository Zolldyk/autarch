import type { DecisionTrace, EngineResult, MarketData, TraceExecution } from './types.js';

/**
 * Builds a complete DecisionTrace from a rule engine result and context.
 * The trace captures everything needed to audit an agent's decision:
 * inputs (market data), evaluation details, and outcome.
 *
 * @param agentId - The agent that produced this evaluation.
 * @param engineResult - The rule engine output (evaluations + decision).
 * @param marketData - Market data snapshot at evaluation time.
 * @param execution - Optional transaction execution result.
 * @returns A frozen DecisionTrace object.
 */
export function buildDecisionTrace(
  agentId: number,
  engineResult: EngineResult,
  marketData: MarketData,
  execution?: TraceExecution,
): DecisionTrace {
  const frozenMarketData = Object.freeze({ ...marketData });
  const frozenEvaluations = Object.freeze(engineResult.evaluations.map((evaluation) => Object.freeze({
    ...evaluation,
    conditions: Object.freeze(evaluation.conditions.map(condition => Object.freeze({ ...condition }))),
  })));
  const frozenDecision = Object.freeze({ ...engineResult.decision });
  const frozenExecution = execution === undefined ? undefined : Object.freeze({ ...execution });

  const trace: DecisionTrace = {
    timestamp: Date.now(),
    agentId,
    marketData: frozenMarketData,
    evaluations: frozenEvaluations,
    decision: frozenDecision,
    execution: frozenExecution,
  };
  return Object.freeze(trace);
}
