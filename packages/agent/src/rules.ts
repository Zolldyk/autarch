import { DEFAULT_EXECUTION_THRESHOLD } from './constants.js';
import type {
  AgentState,
  Condition,
  ConditionResult,
  ConditionOperator,
  EvaluationContext,
  EngineResult,
  Rule,
  RuleAction,
  RuleEvaluation,
} from './types.js';

/**
 * Resolve a peer.* field reference from peerStates in the evaluation context.
 * Format: peer.<nameOrId>.<subField>
 *
 * @param field - The full field string (e.g., 'peer.AgentA.balance').
 * @param context - The evaluation context with peerStates.
 * @returns An object with the resolved value and whether the data is stale.
 * @internal
 */
function resolvePeerField(
  field: string,
  context: EvaluationContext,
): { value: number | string; stale: boolean } {
  const parts = field.split('.');
  if (parts.length !== 3) {
    console.warn(`resolvePeerField: malformed peer field "${field}", expected peer.<name>.<subField>`);
    return { value: 0, stale: false };
  }

  const [, identifier, subField] = parts as [string, string, string];
  const peers = context.peerStates;

  if (!peers || peers.length === 0) {
    console.warn(`resolvePeerField: no peerStates available for "${field}"`);
    return { value: 0, stale: false };
  }

  // Find peer: case-insensitive name match first, then agentId fallback
  let peer: AgentState | undefined = peers.find(
    p => p.name.toLowerCase() === identifier.toLowerCase(),
  );
  if (!peer) {
    const numericId = Number(identifier);
    if (!Number.isNaN(numericId)) {
      peer = peers.find(p => p.agentId === numericId);
    }
  }

  if (!peer) {
    console.warn(`resolvePeerField: peer "${identifier}" not found in peerStates`);
    return { value: 0, stale: false };
  }

  const stale = peer.status === 'error';

  switch (subField) {
    case 'last_action':
    case 'last_trade_result':
      return { value: extractLastTradeResult(peer.lastAction), stale };
    case 'balance':
      return { value: peer.balance, stale };
    case 'status':
      return { value: peer.status, stale };
    case 'consecutive_errors':
      return { value: peer.consecutiveErrors, stale };
    case 'position_size':
      return { value: peer.positionSize, stale };
    case 'consecutive_wins':
      return { value: peer.consecutiveWins, stale };
    case 'last_trade_amount':
      return { value: peer.lastTradeAmount, stale };
    case 'tick_count':
      return { value: peer.tickCount, stale };
    default:
      console.warn(`resolvePeerField: unknown subField "${subField}" for peer "${identifier}"`);
      return { value: 0, stale: false };
  }
}

/**
 * Resolve a field with metadata (staleness info for peer fields).
 *
 * @param field - The field name from a rule condition.
 * @param context - The current evaluation context.
 * @returns An object with the resolved value and optional peerDataStale flag.
 * @internal
 */
function resolveFieldWithMeta(
  field: string,
  context: EvaluationContext,
): { value: number | string; peerDataStale?: boolean } {
  if (field.startsWith('peer.')) {
    const result = resolvePeerField(field, context);
    return { value: result.value, peerDataStale: result.stale || undefined };
  }
  return { value: resolveFieldInternal(field, context) };
}

/**
 * Internal field resolution — the original switch-based resolver.
 *
 * @param field - The field name from a rule condition.
 * @param context - The current evaluation context.
 * @returns The resolved value — a number or string.
 * @internal
 */
function resolveFieldInternal(field: string, context: EvaluationContext): number | string {
  const { agentState, marketData } = context;

  switch (field) {
    // Market data fields
    case 'price':
      return marketData.price;
    case 'price_change':
    case 'price_change_1m':
      return marketData.priceChange1m;
    case 'price_change_5m':
      return marketData.priceChange5m;
    case 'price_drop':
      return Math.abs(Math.min(0, marketData.priceChange1m));
    case 'price_rise':
      return Math.max(0, marketData.priceChange1m);
    case 'volume_change':
    case 'volume_change_1m':
      return marketData.volumeChange1m;
    case 'volume_spike':
      return Math.max(0, marketData.volumeChange1m);

    // Agent self-state fields
    case 'balance':
      return agentState.balance;
    case 'last_trade_result':
      return extractLastTradeResult(agentState.lastAction);
    case 'consecutive_errors':
      return agentState.consecutiveErrors;
    case 'tick_count':
      return agentState.tickCount;
    case 'status':
      return agentState.status;

    // Custom agent state fields
    case 'position_size':
      return agentState.positionSize;
    case 'consecutive_wins':
      return agentState.consecutiveWins;
    case 'last_trade_amount':
      return agentState.lastTradeAmount;

    default:
      console.warn(`resolveField: unknown field "${field}", returning 0`);
      return 0;
  }
}

/**
 * Resolve a condition field name to its actual value from the evaluation context.
 *
 * @param field - The field name from a rule condition (e.g., 'price_drop', 'balance').
 * @param context - The current evaluation context containing agent state and market data.
 * @returns The resolved value — a number or string.
 */
export function resolveField(field: string, context: EvaluationContext): number | string {
  return resolveFieldWithMeta(field, context).value;
}

/**
 * Evaluate a single condition against the current context.
 *
 * @param condition - The condition to evaluate.
 * @param context - The current evaluation context.
 * @returns A ConditionResult with the actual value, comparison outcome, and pass/fail status.
 */
export function evaluateCondition(condition: Condition, context: EvaluationContext): ConditionResult {
  const { value, peerDataStale } = resolveFieldWithMeta(condition.field, context);
  let actual: number | string = value;
  const { threshold, operator } = condition;

  let passed: boolean;

  if (typeof threshold === 'number') {
    // Numeric comparison — coerce actual to number if needed
    const numActual = typeof actual === 'number' ? actual : Number(actual);
    if (Number.isNaN(numActual)) {
      passed = false;
    } else {
      actual = numActual;
      passed = compareNumeric(numActual, operator, threshold);
    }
  } else {
    // String comparison
    const strActual = String(actual);
    actual = strActual;
    passed = compareString(strActual, operator, threshold);
  }

  return {
    field: condition.field, operator, threshold, actual, passed,
    ...(peerDataStale ? { peerDataStale } : {}),
  };
}

/**
 * Evaluate all conditions for a rule and determine the aggregate match result.
 * Conditions are grouped by their `logic` field (AND/OR/NOT). All groups must pass.
 *
 * @param conditions - The array of conditions to evaluate.
 * @param context - The current evaluation context.
 * @returns An object with all individual condition results and the aggregate matched boolean.
 */
export function evaluateConditions(
  conditions: readonly Condition[],
  context: EvaluationContext,
): { results: ConditionResult[]; matched: boolean } {
  // Evaluate ALL conditions — never short-circuit (trace completeness)
  const results = conditions.map(c => evaluateCondition(c, context));

  // Group by logic operator
  const andResults: boolean[] = [];
  const orResults: boolean[] = [];
  const notResults: boolean[] = [];

  for (let i = 0; i < conditions.length; i++) {
    const logic = conditions[i]!.logic ?? 'AND';
    const passed = results[i]!.passed;

    switch (logic) {
      case 'AND':
        andResults.push(passed);
        break;
      case 'OR':
        orResults.push(passed);
        break;
      case 'NOT':
        // NOT inverts the individual result
        notResults.push(!passed);
        break;
    }
  }

  // Each group must pass: AND = all true, OR = at least one true, NOT = all inverted true
  const andPasses = andResults.length === 0 || andResults.every(Boolean);
  const orPasses = orResults.length === 0 || orResults.some(Boolean);
  const notPasses = notResults.length === 0 || notResults.every(Boolean);

  return { results, matched: andPasses && orPasses && notPasses };
}

/**
 * Tracks per-rule cooldown timers based on last execution timestamps.
 */
export class CooldownTracker {
  private lastExecutionTimes: Map<number, number> = new Map();

  /**
   * Record that a rule was executed at the current time.
   *
   * @param ruleIndex - The index of the rule that was executed.
   */
  recordExecution(ruleIndex: number): void {
    this.lastExecutionTimes.set(ruleIndex, Date.now());
  }

  /**
   * Check whether a rule is currently on cooldown.
   *
   * @param ruleIndex - The index of the rule to check.
   * @param cooldownSeconds - The cooldown duration in seconds.
   * @returns An object indicating if the cooldown is active and the remaining time in ms.
   */
  isOnCooldown(ruleIndex: number, cooldownSeconds: number): { active: boolean; remainingMs: number } {
    const lastExecution = this.lastExecutionTimes.get(ruleIndex);
    if (lastExecution === undefined) {
      return { active: false, remainingMs: 0 };
    }

    const elapsed = Date.now() - lastExecution;
    const cooldownMs = cooldownSeconds * 1000;

    if (elapsed < cooldownMs) {
      return { active: true, remainingMs: cooldownMs - elapsed };
    }

    return { active: false, remainingMs: 0 };
  }

  /**
   * Clear all tracked execution times (used on agent stop/restart).
   */
  reset(): void {
    this.lastExecutionTimes.clear();
  }
}

/**
 * Evaluate a single rule against the current context, including cooldown checks.
 *
 * @param rule - The rule to evaluate.
 * @param ruleIndex - The index of the rule in the rules array.
 * @param context - The current evaluation context.
 * @param cooldownTracker - The cooldown tracker instance.
 * @returns A RuleEvaluation with conditions, match status, score, and cooldown info.
 */
export function evaluateRule(
  rule: Rule,
  ruleIndex: number,
  context: EvaluationContext,
  cooldownTracker: CooldownTracker,
): RuleEvaluation {
  // Check cooldown first
  const cooldown = cooldownTracker.isOnCooldown(ruleIndex, rule.cooldownSeconds);
  if (cooldown.active) {
    return {
      ruleIndex,
      ruleName: rule.name,
      conditions: [],
      matched: false,
      score: 0,
      cooldown: 'active',
      cooldownRemaining: cooldown.remainingMs,
    };
  }

  // Evaluate all conditions
  const { results, matched } = evaluateConditions(rule.conditions, context);

  return {
    ruleIndex,
    ruleName: rule.name,
    conditions: results,
    matched,
    score: matched ? rule.weight : 0,
    cooldown: 'clear',
  };
}

/**
 * Evaluate all rules and determine the winning action via weighted scoring.
 *
 * @param context - The current evaluation context containing agent state, market data, and rules.
 * @param cooldownTracker - The cooldown tracker instance.
 * @param executionThreshold - Minimum score to execute an action (default: 70).
 * @returns An EngineResult with all evaluations and the final decision.
 */
export function evaluateAllRules(
  context: EvaluationContext,
  cooldownTracker: CooldownTracker,
  executionThreshold: number = DEFAULT_EXECUTION_THRESHOLD,
): EngineResult {
  // Evaluate every rule
  const evaluations = context.rules.map((rule, i) => evaluateRule(rule, i, context, cooldownTracker));

  // Group matched rules by action type
  const actionScores = new Map<RuleAction, { totalWeight: number; bestRule: { rule: Rule; index: number } }>();

  for (const evaluation of evaluations) {
    if (evaluation.matched && evaluation.cooldown !== 'active') {
      const rule = context.rules[evaluation.ruleIndex]!;
      const action = rule.action;
      if (action === 'none') {
        continue;
      }

      const existing = actionScores.get(action);
      if (existing) {
        existing.totalWeight += evaluation.score;
        if (evaluation.score > existing.bestRule.rule.weight) {
          existing.bestRule = { rule, index: evaluation.ruleIndex };
        }
      } else {
        actionScores.set(action, {
          totalWeight: evaluation.score,
          bestRule: { rule, index: evaluation.ruleIndex },
        });
      }
    }
  }

  // No rules matched
  if (actionScores.size === 0) {
    const hadMatchedRules = evaluations.some(evaluation => evaluation.matched);
    return {
      evaluations,
      decision: {
        action: 'none',
        reason: hadMatchedRules ? 'No actionable rules matched' : 'No rules matched',
      },
    };
  }

  // Select winning action (highest total weight)
  let winningAction: RuleAction = 'none';
  let winningScore = 0;
  let winningEntry: { totalWeight: number; bestRule: { rule: Rule; index: number } } | undefined;

  for (const [action, entry] of actionScores) {
    if (entry.totalWeight > winningScore) {
      winningAction = action;
      winningScore = entry.totalWeight;
      winningEntry = entry;
    }
  }

  // Check threshold
  if (winningScore < executionThreshold) {
    return {
      evaluations,
      decision: {
        action: 'none',
        reason: `Score ${winningScore} below threshold ${executionThreshold}`,
        score: winningScore,
      },
    };
  }

  // Balance pre-check for actions that require SOL
  const needsBalance = winningAction === 'buy' || winningAction === 'sell' || winningAction === 'transfer';
  if (needsBalance && winningEntry) {
    const requiredAmount = winningEntry.bestRule.rule.amount;
    if (context.agentState.balance < requiredAmount) {
      // Mark the winning rule's evaluation as blocked
      const blockedEvalIndex = evaluations.findIndex(e => e.ruleIndex === winningEntry!.bestRule.index);
      if (blockedEvalIndex >= 0) {
        evaluations[blockedEvalIndex] = {
          ...evaluations[blockedEvalIndex]!,
          blocked: 'insufficient_balance',
        };
      }
      return {
        evaluations,
        decision: {
          action: 'none',
          reason: 'insufficient_balance',
          score: winningScore,
        },
      };
    }
  }

  return {
    evaluations,
    decision: {
      action: winningAction,
      reason: `Rule "${winningEntry!.bestRule.rule.name}" matched with score ${winningScore}`,
      amount: winningEntry!.bestRule.rule.amount,
      ruleIndex: winningEntry!.bestRule.index,
      ruleName: winningEntry!.bestRule.rule.name,
      score: winningScore,
    },
  };
}

/** @internal */
function compareNumeric(actual: number, operator: ConditionOperator, threshold: number): boolean {
  switch (operator) {
    case '>': return actual > threshold;
    case '<': return actual < threshold;
    case '>=': return actual >= threshold;
    case '<=': return actual <= threshold;
    case '==': return actual === threshold;
    case '!=': return actual !== threshold;
  }
}

/** @internal */
function compareString(actual: string, operator: ConditionOperator, threshold: string): boolean {
  switch (operator) {
    case '>': return actual > threshold;
    case '<': return actual < threshold;
    case '>=': return actual >= threshold;
    case '<=': return actual <= threshold;
    case '==': return actual.toLowerCase() === threshold.toLowerCase();
    case '!=': return actual.toLowerCase() !== threshold.toLowerCase();
  }
}

/** @internal */
function extractLastTradeResult(lastAction: string | null): string {
  if (lastAction === null) {
    return 'none';
  }
  const firstToken = lastAction.trim().split(/\s+/)[0] ?? 'none';
  return firstToken.replace(/:$/, '').toLowerCase();
}
