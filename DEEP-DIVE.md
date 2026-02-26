# DEEP-DIVE.md — Architecture, "Why Not LLMs?" & Production Path

> Estimated read time: ~10 minutes. For the complete API reference see [SKILLS.md](SKILLS.md). For verifiable security proofs see [SECURITY.md](SECURITY.md).

## Table of Contents

- [Overview](#overview)
- [Architecture Overview](#architecture-overview)
  - [Three-Package Monorepo](#three-package-monorepo)
  - [Closure-Based Key Isolation](#closure-based-key-isolation)
  - [Unidirectional State Flow](#unidirectional-state-flow)
  - [Two-Tier Event System](#two-tier-event-system)
  - [RPC State Machine](#rpc-state-machine)
  - [Seed-to-Dashboard Data Flow](#seed-to-dashboard-data-flow)
- [Security Model](#security-model)
- [Decision System](#decision-system)
  - [Rule Engine](#rule-engine)
  - [DecisionModule Interface](#decisionmodule-interface)
  - [DecisionTrace](#decisiontrace)
  - [EvaluationContext](#evaluationcontext)
  - [Custom LLM Wrapper Example](#custom-llm-wrapper-example)
- [Why Not LLMs?](#why-not-llms)
  - [The Problem with LLM-Driven Financial Execution](#the-problem-with-llm-driven-financial-execution)
  - [Industry Evidence](#industry-evidence)
  - [Side-by-Side: Rule-Based vs LLM](#side-by-side-rule-based-vs-llm)
  - [The Hybrid Architecture](#the-hybrid-architecture)
- [Production Hardening Path](#production-hardening-path)
  - [Upgrade Path](#upgrade-path)
  - [What Doesn't Change](#what-doesnt-change)

## Overview

Autarch is a multi-agent Solana wallet system where autonomous agents trade on-chain using deterministic rules — and never see private keys. A single master seed derives isolated wallets via BIP44. A JSON rule engine drives every decision, producing a complete audit trace. A real-time dashboard renders reasoning as it happens.

This document explains the architectural decisions behind Autarch, makes the case for deterministic agents in financial execution, and maps the path from devnet prototype to production deployment.

## Architecture Overview

### Three-Package Monorepo

Autarch is a pnpm monorepo with three packages. The dependency graph is strict and unidirectional:

```
┌──────────────────────────────────────────────────────────┐
│                     @autarch/demo                        │
│           Dashboard, SSE server, demo scripts            │
│                   depends on ↓ ↓                         │
│    ┌───────────────────┐  ┌───────────────────┐          │
│    │  @autarch/agent   │─►│   @autarch/core   │          │
│    │  Runtime, rules,  │  │  Wallet, crypto,  │          │
│    │  decision modules │  │  RPC client       │          │
│    └───────────────────┘  └───────────────────┘          │
└──────────────────────────────────────────────────────────┘
```

Import restrictions are enforced at two levels — ESLint `no-restricted-imports` for agent and demo, and the package dependency graph for core:

| Package | CAN Import | CANNOT Import | Enforcement |
|---------|------------|---------------|-------------|
| `@autarch/core` | `@solana/kit`, `@scure/bip39`, `micro-key-producer`, Node.js built-ins | `@autarch/agent`, `@autarch/demo` | Structural (not in `package.json` dependencies) |
| `@autarch/agent` | `@autarch/core` (public API only), `ajv` | `@solana/kit`, any crypto library, `@autarch/demo` | ESLint `no-restricted-imports` |
| `@autarch/demo` | `@autarch/core`, `@autarch/agent`, `express` | `@solana/kit`, any crypto library | ESLint `no-restricted-imports` |

Any import of a crypto library in `@autarch/agent` or `@autarch/demo` is a lint error. The package boundary **is** the security boundary.

### Closure-Based Key Isolation

`createAutarchWallet` is a factory function — not a class. Private keys are trapped in closure scope:

```typescript
// packages/core/src/wallet-core.ts:34-40
export function createAutarchWallet(config: WalletConfig): AutarchWallet {
  // Snapshot seed bytes to prevent post-construction external mutation.
  const seed = new Uint8Array(config.seed);
  const keypairCache = new Map<number, CryptoKeyPair>();
  const keypairPromiseCache = new Map<number, Promise<CryptoKeyPair>>();
  const agentCache = new Map<number, AgentWallet>();
  const agentPromiseCache = new Map<number, Promise<AgentWallet>>();
```

The returned object is frozen with `Object.freeze`. Agents receive an `AgentWallet` — two properties, no key access:

```typescript
// packages/core/src/types.ts:32-36
/** Frozen wallet handle exposed to agent code. No key material accessible. */
export interface AgentWallet {
  readonly address: string;
  signTransaction(tx: TransactionToSign): Promise<TransactionResult>;
}
```

Why closures over private class fields (`#key`)? A class instance has an inspectable shape — `Object.getOwnPropertyNames`, prototype chain traversal, and debugger access can reveal private field names. A frozen plain object returned from a factory function has none of these attack surfaces. See [SECURITY.md](SECURITY.md) for 14 executable isolation tests proving this claim.

### Unidirectional State Flow

State flows in one direction:

```
Agent Decision → State Update → SSE Broadcast → Dashboard Render
```

`AgentState` is the contract type between the agent runtime and all consumers. The dashboard is stateless — it receives state updates via SSE on every agent state change and re-renders. No client-side state management, no WebSocket sync logic, no polling interval. This pattern eliminates synchronization bugs and enables a 1-day dashboard build.

### Two-Tier Event System

**Tier 1 — Agent → Runtime:** Callback injection. Agents produce `AgentState` via `onStateChange` callbacks. Agents have zero knowledge of SSE, dashboard, or runtime internals — they stay pure and testable.

**Tier 2 — Runtime → Consumers:** `AgentRuntime extends EventEmitter` for system-level events where multiple listeners make sense: `agentLifecycle` (started/stopped/error), `rulesReloaded`, `marketUpdate`, `simulationMode`. The SSE server, activity log, and any future monitoring tools subscribe as listeners without coupling to agent internals.

### RPC State Machine

Solana devnet is unreliable. The RPC client implements a three-mode state machine with automatic recovery:

```
         ┌──────────────┐
  ┌──────│    normal     │◄──── health check succeeds
  │      │ (primary RPC) │
  │      └───────┬───────┘
  │   primary fails,     │
  │   fallback works     │
  │      ┌───────▼───────┐
  │      │   degraded     │──── endpoint rotation,
  │      │ (fallback RPC) │     exponential backoff
  │      └───────┬───────┘
  │   3 consecutive      │
  │   network failures   │
  │      ┌───────▼───────┐
  └─────►│  simulation    │──── transactions logged,
         │  (log-only)    │     not sent
         └───────────────┘
```

`ConnectionMode` type: `'normal' | 'degraded' | 'simulation'` (`packages/core/src/types.ts:17`).

**normal** — Primary RPC endpoint operating. **degraded** — Primary failed, using fallback with endpoint rotation and exponential backoff retries. **simulation** — All endpoints exhausted; transactions are logged but not submitted. Auto-recovery: health checks every 30s attempt the primary endpoint; on success, mode returns to normal.

Agents are unaware of connection mode. They call `signTransaction()` and receive a result with a `mode` field. Decision traces record `confirmed` vs `simulated`.

### Seed-to-Dashboard Data Flow

```
MASTER_SEED (env var)
    │
    ▼
BIP44 Derivation (m/44'/501'/agentId'/0')
    │
    ▼
Closure-Scoped Keypairs (trapped in factory function)
    │
    ▼
AgentWallet Interface (address + signTransaction only)
    │
    ▼
Agent Loop (evaluate rules → decide → execute)
    │
    ▼
DecisionTrace (complete audit record of every cycle)
    │
    ▼
SSE Broadcast (AgentState + traces every 500ms)
    │
    ▼
Dashboard Render (stateless HTML, reads SSE stream)
```

## Security Model

Autarch's security rests on three verification layers:

1. **Type-level:** The `AgentWallet` interface exposes only `address` and `signTransaction`. No key-returning method exists to call.
2. **Runtime-level:** 14 isolation tests verify that no introspection technique — property enumeration, JSON serialization, prototype traversal, type inspection — can extract key material from wallet objects.
3. **Static analysis:** ESLint `no-restricted-imports` proves that `@autarch/agent` and `@autarch/demo` have zero crypto library imports. The dependency graph enforces this at build time.

The monorepo boundary **is** the security boundary. `@autarch/core` owns all cryptography. Agent and demo packages cannot even import the libraries needed to touch keys. This is enforced by tooling, not convention.

For full details — including verbatim code excerpts, reproducible shell commands, and all 14 executable test descriptions — see [SECURITY.md](SECURITY.md).

## Decision System

### Rule Engine

The built-in `RuleBasedDecisionModule` evaluates agent rules with:

- **Compound conditions** — AND/OR/NOT logical operators combining field comparisons against thresholds
- **Weighted scoring** — Rules carry weights (0–100); the highest-scoring match above the execution threshold fires
- **Cooldown tracking** — Per-rule cooldown prevents rapid repeated execution of the same action
- **Inter-agent dependencies** — Rules can reference peer agent states via `peer.agentName.field` conditions
- **Balance pre-checks** — Rules requiring funds exceeding available balance are blocked before execution

### DecisionModule Interface

The `DecisionModule` interface is the pluggable entry point for all decision-making. The built-in rule engine is one implementation; custom modules (including LLM wrappers) implement the same contract:

```typescript
// packages/agent/src/types.ts:213-227
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
```

### DecisionTrace

Every evaluation cycle produces a `DecisionTrace` — the complete audit record of a single decision:

```typescript
// packages/agent/src/types.ts:161-175
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
```

Every field is deterministic. Given the same inputs, the same trace is produced. This is the transparent reasoning record — the exact market data, every rule evaluated, every condition checked against its threshold, every score computed, and the final action taken with its execution result.

### EvaluationContext

The input contract for any decision module:

```typescript
// packages/agent/src/types.ts:107-112
export interface EvaluationContext {
  readonly agentState: AgentState;
  readonly marketData: MarketData;
  readonly rules: readonly Rule[];
  readonly peerStates?: readonly AgentState[];
}
```

### Custom LLM Wrapper Example

The `DecisionModule` interface makes LLM integration composable. Here is how a custom module would receive context, call an LLM API, parse the response, build a `DecisionTrace`, and return a `DecisionResult`:

```typescript
import type {
  DecisionModule,
  DecisionResult,
  EvaluationContext,
  DecisionTrace,
  RuleAction,
} from '@autarch/agent';

const llmDecisionModule: DecisionModule = {
  async evaluate(context: EvaluationContext): Promise<DecisionResult> {
    // 1. Format context for the LLM
    const prompt = `Market price: $${context.marketData.price}, ` +
      `1m change: ${context.marketData.priceChange1m}%, ` +
      `5m change: ${context.marketData.priceChange5m}%, ` +
      `agent balance: ${context.agentState.balance} SOL, ` +
      `last action: ${context.agentState.lastAction ?? 'none'}. ` +
      `Respond with JSON: { "action": "buy"|"sell"|"none", ` +
      `"amount": number, "reasoning": string }`;

    // 2. Call LLM API
    const response = await fetch('https://api.example.com/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const llmResult = await response.json();

    // 3. Build the audit trace (required for transparency)
    const trace: DecisionTrace = {
      timestamp: Date.now(),
      agentId: context.agentState.agentId,
      marketData: context.marketData,
      evaluations: [], // LLM modules produce no rule evaluations
      decision: {
        action: llmResult.action as RuleAction,
        reason: `LLM: ${llmResult.reasoning}`,
        amount: llmResult.amount,
      },
    };

    // 4. Return the decision result
    return {
      action: llmResult.action as RuleAction,
      amount: llmResult.amount,
      reason: `LLM: ${llmResult.reasoning}`,
      trace,
    };
  },

  reset() {
    // No internal state to reset
  },
};
```

This module plugs into `AgentRuntime` via the `decisionModule` option — no changes to agent code, no changes to the dashboard, no changes to the trace viewer. The interface makes this composable, not either/or.

## Why Not LLMs?

In DeFi, transparent determinism beats black-box complexity. When money is at stake, you need to know *why* decisions were made.

### The Problem with LLM-Driven Financial Execution

Large language models are probabilistic token predictors. This creates fundamental problems for financial execution:

- **Hallucination** — Research documents LLM hallucination rates up to 27% for long-horizon financial predictions ([arxiv:2311.15548](https://arxiv.org/abs/2311.15548)). A 27% error rate is unacceptable when the output is "send 5 SOL to this address."
- **Non-determinism** — The same prompt produces different responses across runs. Audit trails become impossible: you cannot reproduce a decision path.
- **Regulatory compliance** — Financial regulators require explainable, reproducible decision paths. An LLM's chain-of-thought is a post-hoc rationalization, not a verifiable audit trail.

### Industry Evidence

The case for bounded autonomy in financial AI is growing:

- **ACM ICAIF proceedings** — LLM agent papers at the International Conference on AI in Finance acknowledge that "building trustworthy and coherent LLM agents is both a critical opportunity and responsibility" ([ICAIF'25](https://dl.acm.org/doi/proceedings/10.1145/3768292)).
- **FinRegLab "The Next Wave Arrives"** (Sep 2025) — This agentic AI market scan recommends "bounded autonomy" architectures with clear operational limits and escalation paths ([FinRegLab](https://finreglab.org/wp-content/uploads/2025/09/FinRegLab_09-04-2025_The-Next-Wave-Arrives-Main.pdf)). Autarch's rule engine is bounded autonomy by design.
- **BizTech Magazine** (Aug 2025) — Documents hallucination implications for financial institutions: compliance violations, fiduciary duty failures, and audit trail gaps ([BizTech](https://biztechmagazine.com/article/2025/08/llm-hallucinations-what-are-implications-financial-institutions)).
- **OpenPaper "The Hallucination Premium"** — Argues that "Black Box AI Trading is Uninvestable" — probabilistic outputs are fundamentally incompatible with fiduciary requirements ([OpenPaper](https://openpaper.com/hallucination-premium/)).

### Side-by-Side: Rule-Based vs LLM

| Aspect | Autarch `DecisionTrace` | Hypothetical LLM Output |
|--------|------------------------|-------------------------|
| **Input** | `{ price: 98.5, priceChange1m: -3.2%, balance: 2.1 }` | Same market context as natural language prompt |
| **Process** | 3 rules evaluated, conditions checked against thresholds, weighted scores computed | Token prediction across ~4096 tokens |
| **Output** | `{ action: "buy", amount: 0.5, rule: "dip_buyer", score: 85, reason: "price_drop > 3% AND balance > 1 SOL" }` | `"I recommend buying 0.5 SOL because the price dropped significantly"` |
| **Reproducible?** | Yes — same inputs always produce same trace | No — temperature, sampling, model version all affect output |
| **Auditable?** | Every condition, threshold, and score recorded | Natural language reasoning, no formal verification path |
| **Latency** | < 1ms (local computation) | 200–2000ms (API round-trip) |
| **Cost per decision** | Zero | $0.01–0.10 (token costs) |

### The Hybrid Architecture

This is not an anti-LLM argument. The position is architectural: **deterministic rules for execution safety, LLMs for optional inspiration.**

The `DecisionModule` interface is the bridge. The built-in `RuleBasedDecisionModule` handles execution with full determinism and auditability. A custom LLM module can suggest strategies, analyze market sentiment, or generate rule configurations — then feed those through the same deterministic pipeline.

The interface makes this composable:

- **Rules for execution** — Deterministic, auditable, reproducible. Every decision has a complete trace.
- **LLMs for inspiration** — Strategy suggestions, market analysis, parameter tuning. Optional, not in the critical execution path.
- **Same contract** — Both implement `DecisionModule`. The runtime doesn't know or care which is active.

## Production Hardening Path

Autarch is a devnet prototype. Every prototype-scale choice has a documented upgrade path.

### Upgrade Path

| Current (Prototype) | Production Target | Effort | Priority |
|---------------------|-------------------|--------|----------|
| Memory-only keys (closure scope) | HSM/TEE — hardware security modules or trusted execution environments | High | Critical |
| Single-sig transactions | Multi-sig threshold — governance-level approval for high-value transactions | High | Critical |
| No rate limiting | Per-agent transaction rate caps at the wallet-core level | Medium | High |
| Local logs (in-memory) | Blockchain-anchored tamper-proof audit trail | High | High |
| Self-audited security | Third-party professional security audit | Medium | High |
| `SimulatedMarketDataProvider` | Real market data (Pyth/CoinGecko) via the same `MarketDataProvider` interface | Low | Medium |
| SOL transfers only | DEX swap integration (Orca/Raydium) via the same `signTransaction` interface | Medium | Medium |

**Memory-only keys → HSM/TEE.** The closure pattern isolates keys in process memory. For production, keys should live in hardware security modules or trusted execution environments that resist even host-level compromise. The `AgentWallet` interface doesn't change — only the implementation behind `signTransaction`.

**Single-sig → Multi-sig threshold.** High-value transactions should require multiple signers. This is a governance layer above the existing wallet, not a replacement. The `signTransaction` method becomes the first signature in a multi-sig scheme.

**No rate limiting → Per-agent transaction caps.** Devnet has no economic risk. Production needs configurable rate limits — maximum transactions per minute, maximum SOL per hour — enforced at the wallet-core level before transactions reach the network.

**Local logs → Blockchain-anchored audit.** In-memory decision traces are sufficient for demos. Production requires tamper-proof persistence — writing trace hashes to an immutable ledger so audit trails cannot be altered after the fact.

**Self-audited → Third-party audit.** [SECURITY.md](SECURITY.md) provides 14 executable tests and grep-verifiable claims. For production, an independent security firm should verify the isolation model, review the closure pattern, and assess the attack surface.

**Simulated market data → Real data.** The `MarketDataProvider` interface abstracts the data source. Swapping `SimulatedMarketDataProvider` for a Pyth or CoinGecko implementation requires implementing `getCurrentData()`, `getHistory()`, and the injection methods (which become no-ops for real data). No agent code changes.

**SOL transfers → DEX swaps.** Agents already sign transactions via `signTransaction`. DEX integration (Orca, Raydium) means constructing different instructions — the signing path is identical. The `TransactionToSign` interface accepts any Solana instruction array.

### What Doesn't Change

These are production-ready architectural decisions, not prototyping shortcuts:

- **Closure-based key isolation** — The pattern scales. HSMs change where keys live, not how agents access them.
- **Module boundaries** — The three-package structure with ESLint enforcement is the security model. It doesn't weaken at scale.
- **DecisionModule interface** — The pluggable contract supports any decision strategy. Production modules implement the same `evaluate()` method.
- **Event-driven architecture** — The two-tier event system (callbacks + EventEmitter) decouples components. Adding consumers (monitoring, alerting, compliance logging) means adding listeners, not modifying agents.
- **Unidirectional state flow** — `AgentState` remains the contract type. Dashboards, monitoring systems, and audit tools all consume the same SSE stream.
