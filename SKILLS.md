# SKILLS.md — Autarch API Reference

Machine-readable and human-readable API documentation for the Autarch monorepo.

## How to Use This File

**For humans:** Read the sections below organized by package. Each function, class, and interface includes parameter tables, return types, and usage examples.

**For AI agents / programmatic consumers:** Scroll to [Machine-Readable API Reference](#machine-readable-api-reference) and extract the fenced `json` code block. It contains a structured JSON object describing every public export with signatures, parameters, return types, error codes, and examples.

**Packages documented:**

| Package | Purpose |
|---------|---------|
| `@autarch/core` | Wallet SDK — HD derivation, closure-based key isolation, resilient RPC client |
| `@autarch/agent` | Agent runtime — rule engine, decision modules, market data, file watching |

> `@autarch/demo` is an internal consumer and is not documented here. See `packages/demo/` for demo scripts and dashboard code.

---

## Quick Start

Typical integration flow: load a seed, create a wallet, get an agent handle, and sign a transaction.

```typescript
import { loadSeed, createAutarchWallet } from '@autarch/core';
import type { TransactionToSign } from '@autarch/core';

// 1. Load seed from environment (MASTER_SEED or DEMO_MODE=true)
const seed = loadSeed();

// 2. Create the wallet factory — all keys trapped in closure scope
const wallet = createAutarchWallet({ seed });

// 3. Get an agent handle (no key material exposed)
const agent = await wallet.getAgent(1);
console.log(agent.address); // Solana public key

// 4. Check balance
const balance = await wallet.getBalance(1);
console.log(`${balance.sol} SOL`);

// 5. Sign and submit a transaction
const tx: TransactionToSign = { instructions: [/* your instructions */] };
const result = await agent.signTransaction(tx);
console.log(result.signature, result.status); // 'confirmed' | 'failed' | 'simulated'

// 6. Clean up (stops health check timers)
wallet.cleanup();
```

Agent runtime quick start:

```typescript
import { loadAgentConfig, AgentRuntime } from '@autarch/agent';
import { loadSeed, createAutarchWallet } from '@autarch/core';

const seed = loadSeed();
const wallet = createAutarchWallet({ seed });

const config = await loadAgentConfig('examples/rules/conservative.json');
const agentWallet = await wallet.getAgent(1);

const runtime = new AgentRuntime({
  agents: [{
    agentId: 1,
    config,
    configPath: 'examples/rules/conservative.json', // enables hot-reload
    wallet: agentWallet,
    getBalance: () => wallet.getBalance(1),
  }],
});

runtime.on('stateUpdate', (state) => console.log(state.name, state.status));
runtime.on('rulesReloaded', (event) => console.log('Rules reloaded:', event.success));

runtime.start();
```

---

## @autarch/core

### createAutarchWallet(config)

Create an AutarchWallet with closure-based key isolation. Private keys are trapped in closure scope — the returned frozen object exposes only address, balance, and signing methods. No prototype chain leads to key material.

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `WalletConfig` | Wallet configuration (seed, optional RPC settings) |

**Returns:** `AutarchWallet` — Frozen object with wallet operations.

**Errors:**

| Error | When |
|-------|------|
| `Failed to derive agent wallet for agentId N` | Invalid seed or agentId |
| `Failed to submit transaction` | Network failure during transaction |
| `Transaction failed` | On-chain transaction error |
| `Cannot distribute SOL to treasury` | Self-transfer attempt (agentId 0) |
| `Distribution amount must be greater than 0` | Zero/negative distribution |

**Example:**

```typescript
import { createAutarchWallet } from '@autarch/core';

const wallet = createAutarchWallet({
  seed: new Uint8Array(64), // from loadSeed()
  rpcUrl: 'https://api.devnet.solana.com',
  rpcEndpoints: ['https://rpc1.example.com', 'https://rpc2.example.com'],
  onSimulationModeChange: (active, reason) => console.log(active, reason),
});
```

### loadSeed()

Load the master seed from environment variables. Detection order: (1) `MASTER_SEED` with spaces as BIP39 mnemonic, (2) `MASTER_SEED` as hex string, (3) `DEMO_MODE=true` for built-in demo seed, (4) crash with actionable error.

| Parameter | Type | Description |
|-----------|------|-------------|
| *(none)* | — | Reads from `process.env` |

**Returns:** `Uint8Array` — Raw seed bytes (64 bytes from mnemonic, 32 or 64 from hex).

**Errors:**

| Error Pattern | When |
|---------------|------|
| `"Invalid mnemonic"` | Mnemonic checksum failed or unknown words |
| `"Invalid hex seed length"` | Hex seed wrong length (not 64 or 128 chars) |
| `"MASTER_SEED format not recognized"` | Value is neither mnemonic nor hex |
| `"MASTER_SEED environment variable is required"` | No `MASTER_SEED` and `DEMO_MODE` is not `true` |

**Example:**

```typescript
import { loadSeed } from '@autarch/core';

// Set MASTER_SEED="abandon abandon ... about" or DEMO_MODE=true
const seed = loadSeed();
```

### createRpcClient(config)

Create a resilient RPC client with automatic endpoint rotation, retry with exponential backoff, and simulation mode fallback.

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `ResilientRpcConfig` | RPC configuration (endpoints, retries, health check) |

**Returns:** `RpcClient` — Frozen object with `getBalance`, `sendAndConfirm`, `getLatestBlockhash`, `requestAirdrop`, `getConnectionMode`, `cleanup`.

> **Note:** `RpcClient` is not exported as a type — it is the return type of `createRpcClient`. Use `ReturnType<typeof createRpcClient>` to reference it in your own code.

**Errors:**

| Error Tag | When |
|-----------|------|
| `[RPC_NETWORK_ERROR]` | All retry attempts exhausted on network errors |
| `[RPC_REQUEST_ERROR]` | Non-retryable request failure (getBalance, getLatestBlockhash) |

> Simulation mode transitions are not thrown — they are delivered via the `onSimulationModeChange` callback.

**Example:**

```typescript
import { createRpcClient } from '@autarch/core';

const rpc = createRpcClient({
  rpcUrl: 'https://api.devnet.solana.com',
  endpoints: ['https://rpc1.example.com'],
  maxRetries: 3,
  baseDelayMs: 1000,
  onSimulationModeChange: (active, reason) => console.log(active, reason),
});

const balance = await rpc.getBalance('So11111111111111111111111111111111');
console.log(balance.sol);
rpc.cleanup();
```

### AutarchWallet Interface

Top-level wallet factory result. All key material is trapped in closure scope.

| Method | Signature | Description |
|--------|-----------|-------------|
| `getAgent` | `(agentId: number) => Promise<AgentWallet>` | Get a frozen agent wallet handle |
| `getAddress` | `(agentId: number) => Promise<string>` | Get the Solana address for an agent |
| `getBalance` | `(agentId: number) => Promise<Balance>` | Get SOL balance for an agent |
| `signTransaction` | `(agentId: number, tx: TransactionToSign) => Promise<TransactionResult>` | Sign and submit a transaction |
| `distributeSol` | `(toAgentId: number, amountLamports: bigint) => Promise<TransactionResult>` | Transfer SOL from treasury to agent |
| `requestAirdrop` | `(agentId: number, amountLamports?: bigint) => Promise<string>` | Request devnet airdrop |
| `cleanup` | `() => void` | Stop health check timers |

### AgentWallet Interface

Frozen wallet handle exposed to agent code. No key material accessible — only `address` and `signTransaction`.

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `address` | `string` (readonly) | Solana public key (base58) |
| `signTransaction` | `(tx: TransactionToSign) => Promise<TransactionResult>` | Sign and submit a transaction |

### Types & Constants

**Types:**

| Type | Definition |
|------|-----------|
| `SeedConfig` | `{ seed: Uint8Array; isDemo: boolean }` |
| `Balance` | `{ lamports: bigint; sol: number }` |
| `TransactionToSign` | `{ instructions: ReadonlyArray<Instruction> }` |
| `TransactionResult` | `{ signature: string; status: 'confirmed' \| 'failed' \| 'simulated'; mode: ConnectionMode }` |
| `WalletConfig` | `{ seed: Uint8Array; rpcUrl?: string; rpcEndpoints?: readonly string[]; onSimulationModeChange?: (active: boolean, reason: string) => void }` |
| `RpcConfig` | `{ rpcUrl?: string; rpcEndpoints?: readonly string[] }` |
| `ResilientRpcConfig` | `RpcConfig & { endpoints?: readonly string[]; maxRetries?: number; baseDelayMs?: number; healthCheckIntervalMs?: number; onSimulationModeChange?: ... }` |
| `ConnectionMode` | `'normal' \| 'degraded' \| 'simulation'` |

**Constants:**

| Constant | Type | Value | Description |
|----------|------|-------|-------------|
| `SOLANA_BIP44_COIN_TYPE` | `number` | `501` | Solana coin type for BIP44 derivation |
| `DERIVATION_PURPOSE` | `number` | `44` | BIP44 purpose field |
| `DEFAULT_CHANGE` | `number` | `0` | BIP44 change field |
| `TREASURY_AGENT_ID` | `number` | `0` | Treasury is always agentId 0 |
| `MAX_RETRY_ATTEMPTS` | `number` | `3` | Max RPC retry attempts |
| `BASE_RETRY_DELAY_MS` | `number` | `1000` | Base delay for exponential backoff |
| `HEALTH_CHECK_INTERVAL_MS` | `number` | `5000` | Health check interval (normal mode) |
| `HEALTH_CHECK_POLL_INTERVAL_MS` | `number` | `30000` | Health check polling in simulation mode |
| `MAX_ENDPOINTS` | `number` | `10` | Maximum RPC endpoints |
| `SIMULATION_FAILURE_THRESHOLD` | `number` | `3` | Consecutive failures before simulation mode |
| `TREASURY_MIN_BALANCE_LAMPORTS` | `bigint` | `500000000n` | Skip airdrop if treasury has >= 0.5 SOL |

---

## @autarch/agent

### Agent Class

A single autonomous agent with independent lifecycle and error boundary. Runs a decision loop at configurable intervals, evaluates rules via a pluggable `DecisionModule`, and tracks state including balance, traces, and errors.

**Constructor:**

```typescript
new Agent(
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
  ownsDecisionModule?: boolean,
)
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `() => void` | Start the agent's decision loop |
| `stop` | `() => void` | Stop the agent's decision loop |
| `updateConfig` | `(newConfig: AgentConfig) => void` | Hot-swap configuration (next tick) |
| `isRunning` | `() => boolean` | Whether the agent has an active interval |
| `collectState` | `() => Promise<AgentState>` | Refresh balance and return state snapshot |
| `getState` | `() => AgentState` | Return frozen state snapshot |

### AgentRuntime Class

Orchestrates multiple agents with independent lifecycles and fault isolation. Extends `EventEmitter`.

**Constructor:**

```typescript
new AgentRuntime(options: AgentRuntimeOptions)
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `() => void` | Start all agents and file watchers |
| `stop` | `(agentId?: number) => void` | Stop one or all agents |
| `getStates` | `() => AgentState[]` | Return cached states |
| `collectStates` | `() => Promise<AgentState[]>` | Refresh all states with fault isolation |
| `injectDip` | `(percent: number) => void` | Inject price dip + emit marketUpdate |
| `injectRally` | `(percent: number) => void` | Inject price rally + emit marketUpdate |
| `resetMarket` | `() => void` | Reset market to baseline + emit marketUpdate |
| `reportSimulationMode` | `(active: boolean, reason: string) => void` | Emit simulationMode event |
| `getAgent` | `(agentId: number) => Agent \| undefined` | Retrieve agent by ID |

**Events:**

| Event | Payload Type | Description |
|-------|-------------|-------------|
| `stateUpdate` | `AgentState` | Agent state changed |
| `agentLifecycle` | `AgentLifecycleEvent` | Agent started/stopped/error |
| `rulesReloaded` | `RulesReloadedEvent` | Config file hot-reloaded |
| `marketUpdate` | `MarketUpdateEvent` | Market data changed via inject/reset |
| `simulationMode` | `SimulationModeEvent` | Simulation mode toggled |

### RuleBasedDecisionModule Class

Built-in decision module implementing compound conditions, weighted scoring, cooldown tracking, and balance pre-checks (FR15–FR23). Default module used by `AgentRuntime` when no custom module is provided.

**Constructor:**

```typescript
new RuleBasedDecisionModule(executionThreshold?: number)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `executionThreshold` | `number` | `70` | Minimum weighted score to execute an action |

| Method | Signature | Description |
|--------|-----------|-------------|
| `evaluate` | `(context: EvaluationContext) => Promise<DecisionResult>` | Evaluate rules and return decision |
| `reset` | `() => void` | Clear cooldown timers |

### FileWatcher Class

Watches a JSON rule config file for changes, debounces filesystem events, validates the new config, and invokes callbacks on success or failure.

**Constructor:**

```typescript
new FileWatcher(
  filePath: string,
  onReload: (config: AgentConfig) => void,
  onError: (error: string) => void,
)
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `() => void` | Start watching the file |
| `close` | `() => void` | Stop watching and clean up |
| `isWatching` | `() => boolean` | Whether the watcher is active |

**Errors:**

| Error | When |
|-------|------|
| Calls `onError(message)` callback | File system watcher encounters an error |

### SimulatedMarketDataProvider Class

Simulated market data provider using random walk price generation with manual event injection support. Implements `MarketDataProvider`.

**Constructor:**

```typescript
new SimulatedMarketDataProvider(options?: SimulatedProviderOptions)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options.baselinePrice` | `number` | `100` | Baseline price for reset |
| `options.volatility` | `number` | `0.02` | Per-tick volatility (2%) |
| `options.maxHistorySize` | `number` | `100` | Max entries in history ring buffer |

| Method | Signature | Description |
|--------|-----------|-------------|
| `getCurrentData` | `() => MarketData` | Advance random walk, return snapshot |
| `getSnapshot` | `() => MarketData` | Return latest snapshot (no mutation) |
| `getHistory` | `(minutes?: number) => MarketData[]` | Return historical entries |
| `injectDip` | `(percent: number) => void` | Inject immediate price dip |
| `injectRally` | `(percent: number) => void` | Inject immediate price rally |
| `resetToBaseline` | `() => void` | Reset price and clear history |

### CooldownTracker Class

Tracks per-rule cooldown timers based on last execution timestamps.

| Method | Signature | Description |
|--------|-----------|-------------|
| `recordExecution` | `(ruleIndex: number) => void` | Record rule execution time |
| `isOnCooldown` | `(ruleIndex: number, cooldownSeconds: number) => { active: boolean; remainingMs: number }` | Check cooldown status |
| `reset` | `() => void` | Clear all tracked times |

### Standalone Functions

#### validateAgentConfig(data)

Validate raw data against the agent config JSON Schema.

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `unknown` | Data to validate (typically parsed JSON) |

**Returns:** `{ valid: true; config: AgentConfig } | { valid: false; errors: string[] }`

**Errors:**

| Error | When |
|-------|------|
| Returns `{ valid: false; errors: string[] }` | Schema validation fails (not thrown — returned in union) |

#### loadAgentConfig(filePath)

Load an agent configuration from a JSON file. Reads, parses, validates, and applies defaults.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Path to JSON config file |

**Returns:** `Promise<AgentConfig>` — Validated config with defaults applied.

**Errors:**

| Error Pattern | When |
|---------------|------|
| `"Cannot read config file"` | File unreadable or unparseable JSON |
| `"Invalid agent config"` | Config fails JSON Schema validation |

#### evaluateAllRules(context, cooldownTracker, executionThreshold?)

Evaluate all rules and determine the winning action via weighted scoring.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `context` | `EvaluationContext` | — | Agent state, market data, rules, peer states |
| `cooldownTracker` | `CooldownTracker` | — | Cooldown tracker instance |
| `executionThreshold` | `number` | `70` | Minimum score to execute |

**Returns:** `EngineResult` — All evaluations and the final decision.

#### evaluateConditions(conditions, context)

Evaluate all conditions for a rule with compound logic (AND/OR/NOT).

| Parameter | Type | Description |
|-----------|------|-------------|
| `conditions` | `readonly Condition[]` | Conditions to evaluate |
| `context` | `EvaluationContext` | Current evaluation context |

**Returns:** `{ results: ConditionResult[]; matched: boolean }`

#### evaluateCondition(condition, context)

Evaluate a single condition against the current context.

| Parameter | Type | Description |
|-----------|------|-------------|
| `condition` | `Condition` | The condition to evaluate |
| `context` | `EvaluationContext` | Current evaluation context |

**Returns:** `ConditionResult`

#### resolveField(field, context)

Resolve a condition field name to its actual value from the evaluation context.

| Parameter | Type | Description |
|-----------|------|-------------|
| `field` | `string` | Field name (e.g., `'price_drop'`, `'balance'`, `'peer.AgentA.status'`) |
| `context` | `EvaluationContext` | Current evaluation context |

**Returns:** `number | string`

#### buildDecisionTrace(agentId, engineResult, marketData, execution?)

Build a complete frozen DecisionTrace from a rule engine result and context.

| Parameter | Type | Description |
|-----------|------|-------------|
| `agentId` | `number` | Agent that produced this evaluation |
| `engineResult` | `EngineResult` | Rule engine output |
| `marketData` | `MarketData` | Market snapshot at evaluation time |
| `execution` | `TraceExecution` | Optional transaction execution result |

**Returns:** `DecisionTrace` — Frozen audit record.

### DecisionModule Interface — Extension Guide

`DecisionModule` is the plug-in boundary for custom decision logic. The built-in `RuleBasedDecisionModule` implements rule evaluation with compound conditions, weighted scoring, and cooldown tracking. You can replace or wrap it with any custom implementation.

**Interface:**

```typescript
interface DecisionModule {
  /** Evaluate context and decide what action to take. */
  evaluate(context: EvaluationContext): Promise<DecisionResult>;
  /** Optional: reset internal state on agent stop/restart. */
  reset?(): void;
}
```

**Implementation contract:**

1. `evaluate()` must return a `DecisionResult` with `action`, `reason`, and a complete `trace` (DecisionTrace).
2. `reset()` is optional — implement it if your module tracks internal state (cooldowns, history, etc.).
3. The `trace` field must be a valid `DecisionTrace` — consumers (dashboard, logging) depend on its structure.
4. The `action` must be one of: `'buy'`, `'sell'`, `'transfer'`, `'none'`.

**EvaluationContext provided to your module:**

```typescript
interface EvaluationContext {
  readonly agentState: AgentState;    // Current agent snapshot
  readonly marketData: MarketData;     // Latest market data
  readonly rules: readonly Rule[];     // Agent's configured rules
  readonly peerStates?: readonly AgentState[];  // Sibling agents' states
}
```

**LLM wrapper stub example:**

```typescript
import type { DecisionModule, DecisionResult, EvaluationContext } from '@autarch/agent';
import { buildDecisionTrace } from '@autarch/agent';

const llmDecisionModule: DecisionModule = {
  async evaluate(context: EvaluationContext): Promise<DecisionResult> {
    // Format context for your LLM
    const prompt = `Market price: ${context.marketData.price}, ` +
      `Balance: ${context.agentState.balance} SOL, ` +
      `Rules: ${JSON.stringify(context.rules)}`;

    // Call your LLM (replace with actual implementation)
    const llmResponse = await callLLM(prompt);

    // Build a trace for audit trail
    const engineResult = {
      evaluations: [],
      decision: {
        action: llmResponse.action as 'buy' | 'sell' | 'none',
        reason: llmResponse.reasoning,
        amount: llmResponse.amount,
      },
    };

    const trace = buildDecisionTrace(
      context.agentState.agentId,
      engineResult,
      context.marketData,
    );

    return {
      action: engineResult.decision.action,
      amount: llmResponse.amount,
      reason: llmResponse.reasoning,
      trace,
    };
  },

  reset(): void {
    // Clear any LLM conversation history or cached state
  },
};

// Use with AgentRuntime:
const runtime = new AgentRuntime({
  agents: [/* ... */],
  decisionModule: llmDecisionModule,
});
```

### Types & Constants

**Types:**

| Type | Definition |
|------|-----------|
| `DecisionModule` | Interface with `evaluate(context) => Promise<DecisionResult>` and optional `reset()` |
| `DecisionResult` | `{ action: RuleAction; amount?: number; reason: string; trace: DecisionTrace }` |
| `AgentConfig` | `{ name: string; strategy: string; intervalMs?: number; rules: readonly Rule[] }` |
| `AgentConfigFile` | Alias for `AgentConfig` |
| `Rule` | `{ name: string; conditions: readonly Condition[]; action: RuleAction; amount: number; weight: number; cooldownSeconds: number }` |
| `Condition` | `{ field: string; operator: ConditionOperator; threshold: number \| string; logic?: LogicalOperator }` |
| `RuleAction` | `'buy' \| 'sell' \| 'transfer' \| 'none'` |
| `ConditionOperator` | `'>' \| '<' \| '>=' \| '<=' \| '==' \| '!='` |
| `LogicalOperator` | `'AND' \| 'OR' \| 'NOT'` |
| `AgentState` | Agent snapshot: agentId, name, strategy, status, address, balance, lastAction, traceHistory, etc. |
| `AgentStatus` | `'idle' \| 'active' \| 'cooldown' \| 'error' \| 'stopped'` |
| `AgentLifecycleEvent` | `{ agentId: number; event: 'started' \| 'stopped' \| 'auto-stopped' \| 'error'; timestamp: number; reason?: string }` |
| `AgentRuntimeOptions` | `{ agents: ReadonlyArray<{...}>; marketProvider?: MarketDataProvider; decisionModule?: DecisionModule }` |
| `MarketData` | `{ price: number; priceChange1m: number; priceChange5m: number; volumeChange1m: number; timestamp: number; source: MarketDataSource }` |
| `MarketDataProvider` | Interface: `getCurrentData()`, `getSnapshot()`, `getHistory()`, `injectDip()`, `injectRally()`, `resetToBaseline()` |
| `MarketDataSource` | `'simulated' \| 'injected'` |
| `EvaluationContext` | `{ agentState: AgentState; marketData: MarketData; rules: readonly Rule[]; peerStates?: readonly AgentState[] }` |
| `ConditionResult` | `{ field: string; operator: ConditionOperator; threshold: number \| string; actual: number \| string; passed: boolean; peerDataStale?: boolean }` |
| `RuleEvaluation` | `{ ruleIndex: number; ruleName: string; conditions: ConditionResult[]; matched: boolean; score: number; cooldown?: ...; blocked?: ... }` |
| `EngineResult` | `{ evaluations: RuleEvaluation[]; decision: { action: RuleAction; reason: string; amount?: number; ... } }` |
| `DecisionTrace` | `{ timestamp: number; agentId: number; marketData: MarketData; evaluations: readonly RuleEvaluation[]; decision: {...}; execution?: TraceExecution }` |
| `TraceExecution` | `{ status: 'confirmed' \| 'simulated' \| 'failed'; signature?: string; mode: ConnectionMode; error?: string }` |
| `RulesReloadedEvent` | `{ agentId: number; success: boolean; error?: string; timestamp: number }` |
| `MarketUpdateEvent` | `{ marketData: MarketData; timestamp: number }` |
| `SimulationModeEvent` | `{ active: boolean; reason: string; timestamp: number }` |
| `SimulatedProviderOptions` | `{ baselinePrice?: number; volatility?: number; maxHistorySize?: number }` |

**Constants:**

| Constant | Type | Value | Description |
|----------|------|-------|-------------|
| `DEFAULT_INTERVAL_MS` | `number` | `60000` | Default agent decision cycle (60s) |
| `DEFAULT_EXECUTION_THRESHOLD` | `number` | `70` | Minimum weighted score to execute |
| `MAX_TRACE_HISTORY` | `number` | `50` | Max traces in memory ring buffer |

> For complete rule configuration schema (conditions, operators, weighted scoring, cooldowns, inter-agent dependencies), see [`examples/rules/README.md`](examples/rules/README.md).

---

## Error Reference

All functions throw standard `Error` objects with descriptive messages. RPC operations prefix messages with bracket tags (e.g., `[RPC_NETWORK_ERROR]`) for programmatic matching. Other errors use descriptive messages without formal codes.

**RPC error tags** (matchable via `error.message.includes('[TAG]')`):

| Tag | Package | When |
|-----|---------|------|
| `[RPC_NETWORK_ERROR]` | `@autarch/core` | All retry attempts exhausted on network errors |
| `[RPC_REQUEST_ERROR]` | `@autarch/core` | Non-retryable RPC request failure (getBalance, getLatestBlockhash) |
| `[RPC_TRANSACTION_ERROR]` | `@autarch/core` | Transaction submission failure (program error, simulation failed) |
| `[RPC_AIRDROP_FAILED]` | `@autarch/core` | Airdrop request failure |
| `[RPC_AIRDROP_RATE_LIMITED]` | `@autarch/core` | Devnet faucet rate-limited after retries |

**Other error patterns** (matchable via message substring):

| Pattern | Package | When |
|---------|---------|------|
| `"MASTER_SEED environment variable is required"` | `@autarch/core` | No `MASTER_SEED` env var and `DEMO_MODE` is not `true` |
| `"Invalid mnemonic"` | `@autarch/core` | Mnemonic checksum failed or unknown words |
| `"Invalid hex seed length"` | `@autarch/core` | Hex seed not 64 or 128 characters |
| `"MASTER_SEED format not recognized"` | `@autarch/core` | Value is neither mnemonic nor hex |
| `"Failed to derive agent wallet"` | `@autarch/core` | Invalid seed or agentId for derivation |
| `"Cannot distribute SOL to treasury"` | `@autarch/core` | Self-transfer attempt (agentId 0) |
| `"Cannot read config file"` | `@autarch/agent` | Config file unreadable or unparseable |
| `"Invalid agent config"` | `@autarch/agent` | Config fails JSON Schema validation |

> Simulation mode transitions are not thrown — they are delivered via the `onSimulationModeChange` callback in `WalletConfig` / `ResilientRpcConfig`, and via the `simulationMode` event on `AgentRuntime`.

**Error handling example:**

```typescript
import { loadSeed, createAutarchWallet } from '@autarch/core';

try {
  const seed = loadSeed();
  const wallet = createAutarchWallet({ seed });
  const result = await wallet.signTransaction(1, { instructions: [] });
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('MASTER_SEED environment variable is required')) {
      // No seed configured — set MASTER_SEED or DEMO_MODE=true
    } else if (error.message.includes('Invalid mnemonic')) {
      // Bad mnemonic — check BIP39 word list and checksum
    } else if (error.message.includes('[RPC_NETWORK_ERROR]')) {
      // All RPC retries exhausted — check endpoint configuration
    } else if (error.message.includes('[RPC_TRANSACTION_ERROR]')) {
      // Transaction rejected — check instructions and account state
    } else if (error.message.includes('Failed to derive agent wallet')) {
      // Derivation error — verify seed and agentId
    }
  }
}
```

---

## Machine-Readable API Reference

```json
{
  "version": "1.0.0",
  "packages": {
    "@autarch/core": {
      "description": "Wallet SDK — HD derivation, closure-based key isolation, resilient RPC client",
      "exports": {
        "functions": [
          {
            "name": "createAutarchWallet",
            "signature": "(config: WalletConfig) => AutarchWallet",
            "description": "Create an AutarchWallet with closure-based key isolation. Private keys are trapped in closure scope.",
            "params": [
              { "name": "config", "type": "WalletConfig", "description": "Wallet configuration with seed and optional RPC settings" }
            ],
            "returns": { "type": "AutarchWallet", "description": "Frozen object with wallet operations" },
            "errors": ["Failed to derive agent wallet", "[RPC_NETWORK_ERROR]", "[RPC_TRANSACTION_ERROR]"],
            "example": "const wallet = createAutarchWallet({ seed: loadSeed() });"
          },
          {
            "name": "loadSeed",
            "signature": "() => Uint8Array",
            "description": "Load the master seed from environment variables (MASTER_SEED or DEMO_MODE).",
            "params": [],
            "returns": { "type": "Uint8Array", "description": "Raw seed bytes (64 bytes from mnemonic, 32 or 64 from hex)" },
            "errors": ["MASTER_SEED environment variable is required", "Invalid mnemonic", "Invalid hex seed length", "MASTER_SEED format not recognized"],
            "example": "const seed = loadSeed();"
          },
          {
            "name": "createRpcClient",
            "signature": "(config: ResilientRpcConfig) => RpcClient",
            "description": "Create a resilient RPC client with endpoint rotation, retry, and simulation fallback.",
            "params": [
              { "name": "config", "type": "ResilientRpcConfig", "description": "RPC configuration with endpoints and retry settings" }
            ],
            "returns": { "type": "RpcClient", "description": "Frozen RPC client with getBalance, sendAndConfirm, requestAirdrop, cleanup" },
            "errors": ["[RPC_NETWORK_ERROR]", "[RPC_REQUEST_ERROR]", "[RPC_TRANSACTION_ERROR]", "[RPC_AIRDROP_FAILED]", "[RPC_AIRDROP_RATE_LIMITED]"],
            "example": "const rpc = createRpcClient({ rpcUrl: 'https://api.devnet.solana.com' });"
          }
        ],
        "interfaces": [
          {
            "name": "AutarchWallet",
            "description": "Top-level wallet factory result. All key material trapped in closure scope.",
            "methods": [
              { "name": "getAgent", "signature": "(agentId: number) => Promise<AgentWallet>", "description": "Get a frozen agent wallet handle" },
              { "name": "getAddress", "signature": "(agentId: number) => Promise<string>", "description": "Get Solana address for an agent" },
              { "name": "getBalance", "signature": "(agentId: number) => Promise<Balance>", "description": "Get SOL balance" },
              { "name": "signTransaction", "signature": "(agentId: number, tx: TransactionToSign) => Promise<TransactionResult>", "description": "Sign and submit a transaction" },
              { "name": "distributeSol", "signature": "(toAgentId: number, amountLamports: bigint) => Promise<TransactionResult>", "description": "Transfer SOL from treasury to agent" },
              { "name": "requestAirdrop", "signature": "(agentId: number, amountLamports?: bigint) => Promise<string>", "description": "Request devnet airdrop" },
              { "name": "cleanup", "signature": "() => void", "description": "Stop health check timers" }
            ]
          },
          {
            "name": "AgentWallet",
            "description": "Frozen wallet handle exposed to agent code. No key material accessible.",
            "properties": [
              { "name": "address", "type": "string", "description": "Solana public key (base58)" }
            ],
            "methods": [
              { "name": "signTransaction", "signature": "(tx: TransactionToSign) => Promise<TransactionResult>", "description": "Sign and submit a transaction" }
            ]
          },
          {
            "name": "Balance",
            "description": "SOL balance for an agent wallet.",
            "properties": [
              { "name": "lamports", "type": "bigint", "description": "Balance in lamports" },
              { "name": "sol", "type": "number", "description": "Balance in SOL" }
            ]
          },
          {
            "name": "TransactionResult",
            "description": "Result of signing and submitting a transaction.",
            "properties": [
              { "name": "signature", "type": "string", "description": "Transaction signature" },
              { "name": "status", "type": "'confirmed' | 'failed' | 'simulated'", "description": "Transaction outcome" },
              { "name": "mode", "type": "ConnectionMode", "description": "RPC connection mode at time of submission" }
            ]
          },
          {
            "name": "WalletConfig",
            "description": "Configuration for creating an AutarchWallet.",
            "properties": [
              { "name": "seed", "type": "Uint8Array", "description": "Raw seed bytes" },
              { "name": "rpcUrl", "type": "string | undefined", "description": "Primary RPC endpoint" },
              { "name": "rpcEndpoints", "type": "readonly string[] | undefined", "description": "Fallback RPC endpoints" },
              { "name": "onSimulationModeChange", "type": "((active: boolean, reason: string) => void) | undefined", "description": "Callback for simulation mode transitions" }
            ]
          },
          {
            "name": "RpcConfig",
            "description": "Base configuration for the RPC client.",
            "properties": [
              { "name": "rpcUrl", "type": "string | undefined", "description": "Primary RPC endpoint" },
              { "name": "rpcEndpoints", "type": "readonly string[] | undefined", "description": "Fallback RPC endpoints" }
            ]
          },
          {
            "name": "ResilientRpcConfig",
            "description": "Extended RPC configuration with retry and health check settings.",
            "properties": [
              { "name": "rpcUrl", "type": "string | undefined", "description": "Primary RPC endpoint (from RpcConfig)" },
              { "name": "rpcEndpoints", "type": "readonly string[] | undefined", "description": "Fallback endpoints (from RpcConfig)" },
              { "name": "endpoints", "type": "readonly string[] | undefined", "description": "Alternative endpoint list" },
              { "name": "maxRetries", "type": "number | undefined", "description": "Max retry attempts" },
              { "name": "baseDelayMs", "type": "number | undefined", "description": "Base delay for exponential backoff" },
              { "name": "healthCheckIntervalMs", "type": "number | undefined", "description": "Health check polling interval" },
              { "name": "onSimulationModeChange", "type": "((active: boolean, reason: string) => void) | undefined", "description": "Simulation mode callback" }
            ]
          }
        ],
        "types": [
          { "name": "SeedConfig", "definition": "{ readonly seed: Uint8Array; readonly isDemo: boolean }" },
          { "name": "TransactionToSign", "definition": "{ readonly instructions: ReadonlyArray<Instruction> }" },
          { "name": "ConnectionMode", "definition": "'normal' | 'degraded' | 'simulation'" }
        ],
        "constants": [
          { "name": "SOLANA_BIP44_COIN_TYPE", "type": "number", "value": 501, "description": "Solana coin type for BIP44 derivation" },
          { "name": "DERIVATION_PURPOSE", "type": "number", "value": 44, "description": "BIP44 purpose field" },
          { "name": "DEFAULT_CHANGE", "type": "number", "value": 0, "description": "BIP44 change field" },
          { "name": "TREASURY_AGENT_ID", "type": "number", "value": 0, "description": "Treasury is always agentId 0" },
          { "name": "MAX_RETRY_ATTEMPTS", "type": "number", "value": 3, "description": "Max RPC retry attempts" },
          { "name": "BASE_RETRY_DELAY_MS", "type": "number", "value": 1000, "description": "Base delay for exponential backoff (ms)" },
          { "name": "HEALTH_CHECK_INTERVAL_MS", "type": "number", "value": 5000, "description": "Health check interval in normal mode (ms)" },
          { "name": "HEALTH_CHECK_POLL_INTERVAL_MS", "type": "number", "value": 30000, "description": "Health check polling in simulation mode (ms)" },
          { "name": "MAX_ENDPOINTS", "type": "number", "value": 10, "description": "Maximum RPC endpoints" },
          { "name": "SIMULATION_FAILURE_THRESHOLD", "type": "number", "value": 3, "description": "Consecutive failures before simulation mode" },
          { "name": "TREASURY_MIN_BALANCE_LAMPORTS", "type": "bigint", "value": "500000000n", "description": "Skip airdrop threshold (0.5 SOL)" }
        ]
      }
    },
    "@autarch/agent": {
      "description": "Agent runtime — rule engine, decision modules, market data, file watching",
      "exports": {
        "functions": [
          {
            "name": "validateAgentConfig",
            "signature": "(data: unknown) => { valid: true; config: AgentConfig } | { valid: false; errors: string[] }",
            "description": "Validate raw data against the agent config JSON Schema.",
            "params": [
              { "name": "data", "type": "unknown", "description": "Data to validate (typically parsed JSON)" }
            ],
            "returns": { "type": "{ valid: true; config: AgentConfig } | { valid: false; errors: string[] }", "description": "Discriminated union with validated config or error messages" },
            "errors": [],
            "example": "const result = validateAgentConfig(JSON.parse(raw)); if (result.valid) { /* use result.config */ }"
          },
          {
            "name": "loadAgentConfig",
            "signature": "(filePath: string) => Promise<AgentConfig>",
            "description": "Load an agent configuration from a JSON file. Reads, parses, validates, and applies defaults.",
            "params": [
              { "name": "filePath", "type": "string", "description": "Path to JSON config file" }
            ],
            "returns": { "type": "Promise<AgentConfig>", "description": "Validated config with defaults applied" },
            "errors": ["Cannot read config file", "Invalid agent config"],
            "example": "const config = await loadAgentConfig('examples/rules/conservative.json');"
          },
          {
            "name": "evaluateAllRules",
            "signature": "(context: EvaluationContext, cooldownTracker: CooldownTracker, executionThreshold?: number) => EngineResult",
            "description": "Evaluate all rules and determine the winning action via weighted scoring.",
            "params": [
              { "name": "context", "type": "EvaluationContext", "description": "Agent state, market data, rules, peer states" },
              { "name": "cooldownTracker", "type": "CooldownTracker", "description": "Cooldown tracker instance" },
              { "name": "executionThreshold", "type": "number", "description": "Minimum score to execute (default: 70)" }
            ],
            "returns": { "type": "EngineResult", "description": "All evaluations and final decision" },
            "errors": [],
            "example": "const result = evaluateAllRules(context, new CooldownTracker());"
          },
          {
            "name": "evaluateConditions",
            "signature": "(conditions: readonly Condition[], context: EvaluationContext) => { results: ConditionResult[]; matched: boolean }",
            "description": "Evaluate all conditions for a rule with compound logic (AND/OR/NOT).",
            "params": [
              { "name": "conditions", "type": "readonly Condition[]", "description": "Conditions to evaluate" },
              { "name": "context", "type": "EvaluationContext", "description": "Current evaluation context" }
            ],
            "returns": { "type": "{ results: ConditionResult[]; matched: boolean }", "description": "Individual results and aggregate match" },
            "errors": [],
            "example": "const { results, matched } = evaluateConditions(rule.conditions, context);"
          },
          {
            "name": "evaluateCondition",
            "signature": "(condition: Condition, context: EvaluationContext) => ConditionResult",
            "description": "Evaluate a single condition against the current context.",
            "params": [
              { "name": "condition", "type": "Condition", "description": "The condition to evaluate" },
              { "name": "context", "type": "EvaluationContext", "description": "Current evaluation context" }
            ],
            "returns": { "type": "ConditionResult", "description": "Condition result with actual value and pass/fail" },
            "errors": [],
            "example": "const result = evaluateCondition({ field: 'price_drop', operator: '>', threshold: 5 }, context);"
          },
          {
            "name": "resolveField",
            "signature": "(field: string, context: EvaluationContext) => number | string",
            "description": "Resolve a condition field name to its actual value from the evaluation context.",
            "params": [
              { "name": "field", "type": "string", "description": "Field name (e.g., 'price_drop', 'balance', 'peer.AgentA.status')" },
              { "name": "context", "type": "EvaluationContext", "description": "Current evaluation context" }
            ],
            "returns": { "type": "number | string", "description": "Resolved field value" },
            "errors": [],
            "example": "const price = resolveField('price', context);"
          },
          {
            "name": "buildDecisionTrace",
            "signature": "(agentId: number, engineResult: EngineResult, marketData: MarketData, execution?: TraceExecution) => DecisionTrace",
            "description": "Build a complete frozen DecisionTrace from a rule engine result and context.",
            "params": [
              { "name": "agentId", "type": "number", "description": "Agent that produced this evaluation" },
              { "name": "engineResult", "type": "EngineResult", "description": "Rule engine output" },
              { "name": "marketData", "type": "MarketData", "description": "Market snapshot at evaluation time" },
              { "name": "execution", "type": "TraceExecution | undefined", "description": "Optional transaction execution result" }
            ],
            "returns": { "type": "DecisionTrace", "description": "Frozen audit record" },
            "errors": [],
            "example": "const trace = buildDecisionTrace(1, engineResult, marketData);"
          }
        ],
        "classes": [
          {
            "name": "Agent",
            "description": "A single autonomous agent with independent lifecycle and error boundary.",
            "constructor": "new Agent(agentId, config, wallet, getBalance, marketProvider, getPeerStates, onStateChange, onAutoStop, onError, decisionModule, ownsDecisionModule?)",
            "methods": [
              { "name": "start", "signature": "() => void", "description": "Start the agent's decision loop" },
              { "name": "stop", "signature": "() => void", "description": "Stop the agent's decision loop" },
              { "name": "updateConfig", "signature": "(newConfig: AgentConfig) => void", "description": "Hot-swap configuration (next tick)" },
              { "name": "isRunning", "signature": "() => boolean", "description": "Whether the agent has an active interval" },
              { "name": "collectState", "signature": "() => Promise<AgentState>", "description": "Refresh balance and return state snapshot" },
              { "name": "getState", "signature": "() => AgentState", "description": "Return frozen state snapshot" }
            ]
          },
          {
            "name": "AgentRuntime",
            "description": "Orchestrates multiple agents with independent lifecycles and fault isolation. Extends EventEmitter.",
            "constructor": "new AgentRuntime(options: AgentRuntimeOptions)",
            "methods": [
              { "name": "start", "signature": "() => void", "description": "Start all agents and file watchers" },
              { "name": "stop", "signature": "(agentId?: number) => void", "description": "Stop one or all agents" },
              { "name": "getStates", "signature": "() => AgentState[]", "description": "Return cached states" },
              { "name": "collectStates", "signature": "() => Promise<AgentState[]>", "description": "Refresh all states with fault isolation" },
              { "name": "injectDip", "signature": "(percent: number) => void", "description": "Inject price dip and emit marketUpdate" },
              { "name": "injectRally", "signature": "(percent: number) => void", "description": "Inject price rally and emit marketUpdate" },
              { "name": "resetMarket", "signature": "() => void", "description": "Reset market to baseline and emit marketUpdate" },
              { "name": "reportSimulationMode", "signature": "(active: boolean, reason: string) => void", "description": "Emit simulationMode event" },
              { "name": "getAgent", "signature": "(agentId: number) => Agent | undefined", "description": "Retrieve agent by ID" }
            ],
            "events": [
              { "name": "stateUpdate", "payload": "AgentState", "description": "Agent state changed" },
              { "name": "agentLifecycle", "payload": "AgentLifecycleEvent", "description": "Agent started/stopped/error" },
              { "name": "rulesReloaded", "payload": "RulesReloadedEvent", "description": "Config file hot-reloaded" },
              { "name": "marketUpdate", "payload": "MarketUpdateEvent", "description": "Market data changed" },
              { "name": "simulationMode", "payload": "SimulationModeEvent", "description": "Simulation mode toggled" }
            ]
          },
          {
            "name": "RuleBasedDecisionModule",
            "description": "Built-in decision module with compound conditions, weighted scoring, and cooldown tracking.",
            "constructor": "new RuleBasedDecisionModule(executionThreshold?: number)",
            "methods": [
              { "name": "evaluate", "signature": "(context: EvaluationContext) => Promise<DecisionResult>", "description": "Evaluate rules and return decision" },
              { "name": "reset", "signature": "() => void", "description": "Clear cooldown timers" }
            ]
          },
          {
            "name": "FileWatcher",
            "description": "Watches a JSON config file for changes with debounce and validation.",
            "constructor": "new FileWatcher(filePath: string, onReload: (config: AgentConfig) => void, onError: (error: string) => void)",
            "methods": [
              { "name": "start", "signature": "() => void", "description": "Start watching the file" },
              { "name": "close", "signature": "() => void", "description": "Stop watching and clean up" },
              { "name": "isWatching", "signature": "() => boolean", "description": "Whether the watcher is active" }
            ]
          },
          {
            "name": "SimulatedMarketDataProvider",
            "description": "Random walk market data provider with manual event injection. Implements MarketDataProvider.",
            "constructor": "new SimulatedMarketDataProvider(options?: SimulatedProviderOptions)",
            "methods": [
              { "name": "getCurrentData", "signature": "() => MarketData", "description": "Advance random walk and return snapshot" },
              { "name": "getSnapshot", "signature": "() => MarketData", "description": "Return latest snapshot (no mutation)" },
              { "name": "getHistory", "signature": "(minutes?: number) => MarketData[]", "description": "Return historical entries" },
              { "name": "injectDip", "signature": "(percent: number) => void", "description": "Inject immediate price dip" },
              { "name": "injectRally", "signature": "(percent: number) => void", "description": "Inject immediate price rally" },
              { "name": "resetToBaseline", "signature": "() => void", "description": "Reset price and clear history" }
            ]
          },
          {
            "name": "CooldownTracker",
            "description": "Tracks per-rule cooldown timers based on last execution timestamps.",
            "constructor": "new CooldownTracker()",
            "methods": [
              { "name": "recordExecution", "signature": "(ruleIndex: number) => void", "description": "Record rule execution time" },
              { "name": "isOnCooldown", "signature": "(ruleIndex: number, cooldownSeconds: number) => { active: boolean; remainingMs: number }", "description": "Check cooldown status" },
              { "name": "reset", "signature": "() => void", "description": "Clear all tracked times" }
            ]
          }
        ],
        "interfaces": [
          {
            "name": "DecisionModule",
            "description": "Pluggable interface for agent decision-making. Implement to create custom decision logic (e.g., LLM-based).",
            "methods": [
              { "name": "evaluate", "signature": "(context: EvaluationContext) => Promise<DecisionResult>", "description": "Evaluate context and decide action" },
              { "name": "reset", "signature": "() => void", "description": "Optional: reset internal state on stop/restart" }
            ]
          },
          {
            "name": "MarketDataProvider",
            "description": "Swappable interface for any market data source.",
            "methods": [
              { "name": "getCurrentData", "signature": "() => MarketData", "description": "Advance and return current data" },
              { "name": "getSnapshot", "signature": "() => MarketData", "description": "Return latest without advancing" },
              { "name": "getHistory", "signature": "(minutes?: number) => MarketData[]", "description": "Return historical entries" },
              { "name": "injectDip", "signature": "(percent: number) => void", "description": "Inject price dip" },
              { "name": "injectRally", "signature": "(percent: number) => void", "description": "Inject price rally" },
              { "name": "resetToBaseline", "signature": "() => void", "description": "Reset to baseline" }
            ]
          }
        ],
        "types": [
          { "name": "DecisionResult", "definition": "{ readonly action: RuleAction; readonly amount?: number; readonly reason: string; readonly trace: DecisionTrace }" },
          { "name": "AgentConfig", "definition": "{ readonly name: string; readonly strategy: string; readonly intervalMs?: number; readonly rules: readonly Rule[] }" },
          { "name": "AgentConfigFile", "definition": "AgentConfig (alias)" },
          { "name": "Rule", "definition": "{ readonly name: string; readonly conditions: readonly Condition[]; readonly action: RuleAction; readonly amount: number; readonly weight: number; readonly cooldownSeconds: number }" },
          { "name": "Condition", "definition": "{ readonly field: string; readonly operator: ConditionOperator; readonly threshold: number | string; readonly logic?: LogicalOperator }" },
          { "name": "RuleAction", "definition": "'buy' | 'sell' | 'transfer' | 'none'" },
          { "name": "ConditionOperator", "definition": "'>' | '<' | '>=' | '<=' | '==' | '!='" },
          { "name": "LogicalOperator", "definition": "'AND' | 'OR' | 'NOT'" },
          { "name": "AgentState", "definition": "{ readonly agentId: number; readonly name: string; readonly strategy: string; readonly status: AgentStatus; readonly address: string; readonly balance: number; readonly lastAction: string | null; readonly lastActionTimestamp: number | null; readonly consecutiveErrors: number; readonly tickCount: number; readonly lastError: string | null; readonly positionSize: number; readonly consecutiveWins: number; readonly lastTradeAmount: number; readonly lastDecision?: DecisionTrace; readonly traceHistory: readonly DecisionTrace[] }" },
          { "name": "AgentStatus", "definition": "'idle' | 'active' | 'cooldown' | 'error' | 'stopped'" },
          { "name": "AgentLifecycleEvent", "definition": "{ readonly agentId: number; readonly event: 'started' | 'stopped' | 'auto-stopped' | 'error'; readonly timestamp: number; readonly reason?: string }" },
          { "name": "AgentRuntimeOptions", "definition": "{ readonly agents: ReadonlyArray<{ readonly agentId: number; readonly config: AgentConfig; readonly configPath?: string; readonly wallet: AgentWallet; readonly getBalance: () => Promise<Balance> }>; readonly marketProvider?: MarketDataProvider; readonly decisionModule?: DecisionModule }" },
          { "name": "MarketData", "definition": "{ readonly price: number; readonly priceChange1m: number; readonly priceChange5m: number; readonly volumeChange1m: number; readonly timestamp: number; readonly source: MarketDataSource }" },
          { "name": "MarketDataSource", "definition": "'simulated' | 'injected'" },
          { "name": "EvaluationContext", "definition": "{ readonly agentState: AgentState; readonly marketData: MarketData; readonly rules: readonly Rule[]; readonly peerStates?: readonly AgentState[] }" },
          { "name": "ConditionResult", "definition": "{ readonly field: string; readonly operator: ConditionOperator; readonly threshold: number | string; readonly actual: number | string; readonly passed: boolean; readonly peerDataStale?: boolean }" },
          { "name": "RuleEvaluation", "definition": "{ readonly ruleIndex: number; readonly ruleName: string; readonly conditions: ConditionResult[]; readonly matched: boolean; readonly score: number; readonly cooldown?: 'active' | 'clear'; readonly cooldownRemaining?: number; readonly blocked?: 'insufficient_balance' }" },
          { "name": "EngineResult", "definition": "{ readonly evaluations: RuleEvaluation[]; readonly decision: { readonly action: RuleAction; readonly reason: string; readonly amount?: number; readonly ruleIndex?: number; readonly ruleName?: string; readonly score?: number } }" },
          { "name": "DecisionTrace", "definition": "{ readonly timestamp: number; readonly agentId: number; readonly marketData: MarketData; readonly evaluations: readonly RuleEvaluation[]; readonly decision: { readonly action: RuleAction; readonly reason: string; readonly amount?: number; readonly ruleIndex?: number; readonly ruleName?: string; readonly score?: number }; readonly execution?: TraceExecution }" },
          { "name": "TraceExecution", "definition": "{ readonly status: 'confirmed' | 'simulated' | 'failed'; readonly signature?: string; readonly mode: ConnectionMode | 'degraded' | 'simulation'; readonly error?: string }" },
          { "name": "RulesReloadedEvent", "definition": "{ readonly agentId: number; readonly success: boolean; readonly error?: string; readonly timestamp: number }" },
          { "name": "MarketUpdateEvent", "definition": "{ readonly marketData: MarketData; readonly timestamp: number }" },
          { "name": "SimulationModeEvent", "definition": "{ readonly active: boolean; readonly reason: string; readonly timestamp: number }" },
          { "name": "SimulatedProviderOptions", "definition": "{ readonly baselinePrice?: number; readonly volatility?: number; readonly maxHistorySize?: number }" }
        ],
        "constants": [
          { "name": "DEFAULT_INTERVAL_MS", "type": "number", "value": 60000, "description": "Default agent decision cycle interval (ms)" },
          { "name": "DEFAULT_EXECUTION_THRESHOLD", "type": "number", "value": 70, "description": "Minimum weighted score to execute an action" },
          { "name": "MAX_TRACE_HISTORY", "type": "number", "value": 50, "description": "Max decision traces in memory ring buffer" }
        ]
      }
    }
  }
}
```
