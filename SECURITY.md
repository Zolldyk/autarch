# SECURITY.md — Autarch Security Model

> Line numbers are accurate as of commit `f04ce4e`. If lines have shifted, the patterns and verification commands remain valid.

## Overview

Autarch is a multi-agent Solana wallet system where agents sign transactions but never see private keys. This document makes four verifiable claims about the security model. Each claim includes specific file paths, line numbers, and a reproducible shell command so you can prove — not trust — that the isolation holds.

**How to verify:** Every claim below includes a "Verify It Yourself" section with a copy-paste shell command. Clone the repo, run the command, and confirm the output matches what this document states. All commands use standard POSIX tools (`grep`, `cat`) plus `pnpm` (already in the project). A fresh `git clone && pnpm install` is sufficient.

## Security Architecture

Autarch is a pnpm monorepo with three packages. The package boundary **is** the security boundary:

| Package | Role | Crypto Access |
|---------|------|---------------|
| `@autarch/core` | Owns all cryptography: seed loading, key derivation, signing | Full — imports `@solana/kit`, `@scure/bip39`, `micro-key-producer` |
| `@autarch/agent` | Agent runtime: configuration, rules, lifecycle | None — depends only on `@autarch/core` and `ajv` |
| `@autarch/demo` | Demo orchestration and dashboard | None — depends on `@autarch/agent`, `@autarch/core`, `express` |

`@autarch/core` exports three functions, eleven configuration constants, and a set of type-only interfaces. The three functions are the only callable API surface:

```
createAutarchWallet   — factory returning a frozen wallet object
loadSeed              — reads MASTER_SEED from env vars
createRpcClient       — Solana RPC connection
```

Source: `packages/core/src/index.ts:14-16`

The eleven constants (`SOLANA_BIP44_COIN_TYPE`, `DERIVATION_PURPOSE`, `DEFAULT_CHANGE`, `TREASURY_AGENT_ID`, `MAX_RETRY_ATTEMPTS`, `BASE_RETRY_DELAY_MS`, `HEALTH_CHECK_INTERVAL_MS`, `HEALTH_CHECK_POLL_INTERVAL_MS`, `MAX_ENDPOINTS`, `SIMULATION_FAILURE_THRESHOLD`, `TREASURY_MIN_BALANCE_LAMPORTS`) are numeric configuration values re-exported from `constants.js` (`index.ts:1-13`). None contain key material.

## Claim 1: No Key Exposure in Public API

Agents cannot access private keys. The `AgentWallet` interface exposes only an address string and a signing method. No method exists to retrieve, export, or serialize key material.

### The Closure Pattern

`createAutarchWallet` is a factory function — not a class. Private keys, the seed, and all caches are captured in closure scope. The returned object is frozen. There is no prototype chain leading to key material.

```typescript
// packages/core/src/wallet-core.ts:27-33
export function createAutarchWallet(config: WalletConfig): AutarchWallet {
  // Snapshot seed bytes to prevent post-construction external mutation.
  const seed = new Uint8Array(config.seed);
  const keypairCache = new Map<number, CryptoKeyPair>();
  const keypairPromiseCache = new Map<number, Promise<CryptoKeyPair>>();
  const agentCache = new Map<number, AgentWallet>();
  const agentPromiseCache = new Map<number, Promise<AgentWallet>>();
```

The seed and all keypair caches are local variables inside the function body. They are unreachable from outside the closure.

Why closures instead of private class fields (`#key`)? A class instance has an inspectable shape — `Object.getOwnPropertyNames`, prototype chain traversal, and debugger access can reveal private field names. A frozen plain object returned from a factory function has none of these attack surfaces. The returned object's prototype is `Object.prototype` and its constructor is `Object`.

### AgentWallet Interface

This is the entire surface area an agent receives:

```typescript
// packages/core/src/types.ts:32-36
/** Frozen wallet handle exposed to agent code. No key material accessible. */
export interface AgentWallet {
  readonly address: string;
  signTransaction(tx: TransactionToSign): Promise<TransactionResult>;
}
```

Two properties. No key-returning method exists to call.

### Proof

The `AgentWallet` object is frozen at construction:

```typescript
// packages/core/src/wallet-core.ts:152-157
const agentWallet: AgentWallet = Object.freeze({
  address: addressStr,
  async signTransaction(tx: TransactionToSign): Promise<TransactionResult> {
    return walletSignTransaction(agentId, tx);
  },
});
```

The `AutarchWallet` factory result is also frozen:

```typescript
// packages/core/src/wallet-core.ts:277-287
return Object.freeze({
  getAgent,
  getAddress,
  getBalance,
  signTransaction: walletSignTransaction,
  distributeSol,
  requestAirdrop: walletRequestAirdrop,
  cleanup(): void {
    rpcClient.cleanup();
  },
});
```

### Verify It Yourself

```bash
grep -n "Object.freeze" packages/core/src/wallet-core.ts
```

Expected output:

```
152:      const agentWallet: AgentWallet = Object.freeze({
277:  return Object.freeze({
```

## Claim 2: No Key Logging

No `console.log`, `console.warn`, or `console.error` call in `@autarch/core` source code operates on key-derived variables (seed, private key, mnemonic, secret).

### Proof

A codebase-wide grep for console statements referencing key material returns zero matches:

```
$ grep -rn "console\." packages/core/src/ | grep -i "key\|seed\|private\|secret\|mnemonic"
(no output)
```

The only `console.log` in `packages/core/src/` is a treasury balance message at `wallet-core.ts:258`:

```typescript
console.log(`Treasury already funded (${solBalance.toFixed(2)} SOL), skipping airdrop`);
```

This logs a SOL balance amount — not key material.

### Verify It Yourself

```bash
grep -rn "console\." packages/core/src/ | grep -i "key\|seed\|private\|secret\|mnemonic"
```

Expected output: (none — zero matches)

To see all console statements in core and confirm none reference keys:

```bash
grep -rn "console\." packages/core/src/
```

Expected output:

```
packages/core/src/wallet-core.ts:258:          console.log(`Treasury already funded (${solBalance.toFixed(2)} SOL), skipping airdrop`);
```

## Claim 3: Key Isolation Boundary

The `@autarch/agent` package has zero direct imports of any cryptographic library. It depends only on `@autarch/core` (which mediates all crypto) and `ajv` (JSON schema validation). The `@autarch/demo` package similarly imports no crypto libraries.

### Package Dependencies

**`packages/agent/package.json` dependencies:**

```json
{
  "dependencies": {
    "@autarch/core": "workspace:*",
    "ajv": "^8"
  }
}
```

**`packages/demo/package.json` dependencies:**

```json
{
  "dependencies": {
    "@autarch/agent": "workspace:*",
    "@autarch/core": "workspace:*",
    "express": "^5"
  }
}
```

Zero crypto libraries in either package.

### ESLint Enforcement

Import restrictions are enforced at build time via ESLint `no-restricted-imports` rules. Any attempt to import a crypto library from agent or demo source code is a lint error.

**Agent package rules** (`eslint.config.ts:13-19`):

```typescript
'no-restricted-imports': ['error', {
  patterns: [
    { group: ['@solana/kit', '@solana/*'], message: 'Agent package cannot import Solana SDK directly — use @autarch/core' },
    { group: ['@scure/*', 'micro-key-producer*'], message: 'Agent package cannot import crypto libraries — use @autarch/core' },
    { group: ['node:crypto', 'crypto', 'tweetnacl', 'tweetnacl-util', '@noble/*', 'elliptic', 'bn.js', 'ed2curve'], message: 'Agent package cannot import crypto libraries — use @autarch/core' },
  ],
}],
```

**Demo package rules** (`eslint.config.ts:25-31`):

```typescript
'no-restricted-imports': ['error', {
  patterns: [
    { group: ['@solana/kit', '@solana/*'], message: 'Demo package cannot import Solana SDK directly' },
    { group: ['@scure/*', 'micro-key-producer*'], message: 'Demo package cannot import crypto libraries' },
    { group: ['node:crypto', 'crypto', 'tweetnacl', 'tweetnacl-util', '@noble/*', 'elliptic', 'bn.js', 'ed2curve'], message: 'Demo package cannot import crypto libraries' },
  ],
}],
```

### Verify It Yourself

Check that agent and demo package.json files contain no crypto dependencies:

```bash
grep -E "solana|scure|crypto|nacl|noble|elliptic|ed25519|bip39" packages/agent/package.json packages/demo/package.json
```

Expected output: (none — zero matches)

Confirm ESLint rules are in place:

```bash
grep -A5 "no-restricted-imports" eslint.config.ts
```

Run the linter to confirm no violations:

```bash
pnpm -r lint
```

## Claim 4: Memory-Only Keys

No production code in `@autarch/core` writes key material to disk. There are zero calls to `writeFile`, `writeFileSync`, `appendFile`, or `createWriteStream` in the core source directory.

### Proof

```
$ grep -rn "writeFile\|writeFileSync\|appendFile\|createWriteStream" packages/core/src/
(no output)
```

Zero matches. The seed is loaded from an environment variable (`process.env.MASTER_SEED`), derived into keypairs in memory, and never persisted.

**Caller responsibility:** `createAutarchWallet` snapshots the seed at construction (`wallet-core.ts:29`: `new Uint8Array(config.seed)`), creating an independent copy in closure scope. However, the caller's original `config.seed` reference remains live until the caller zeros it or it is garbage collected. Callers should overwrite their seed bytes after wallet construction:

```typescript
const wallet = createAutarchWallet({ seed });
seed.fill(0); // zero caller's copy after handoff
```

Note: Test fixtures in `packages/agent/test/` use `writeFile` for JSON config files — these contain agent configuration, not key material.

### Verify It Yourself

```bash
grep -rn "writeFile\|writeFileSync\|appendFile\|createWriteStream" packages/core/src/
```

Expected output: (none — zero matches)

## Seed Handling

### Environment-Only Loading

The master seed is loaded exclusively from the `MASTER_SEED` environment variable. There is no config file, no CLI argument, no interactive prompt.

```typescript
// packages/core/src/config.ts:14-16
export function loadSeed(): Uint8Array {
  const masterSeedRaw = process.env.MASTER_SEED;
  const masterSeed = masterSeedRaw?.trim();
```

`loadSeed()` accepts two formats:

1. **BIP39 mnemonic** — validated with `@scure/bip39` (`config.ts:20-28`)
2. **Hex string** — 64 or 128 hex characters (`config.ts:32-44`)

If neither is provided and `DEMO_MODE=true`, the built-in demo seed is used (`config.ts:56-61`). Otherwise the process crashes with a descriptive error.

### .gitignore Protection

`.env` is excluded from version control:

```
# .gitignore, line 3
.env
```

### Demo Seed

The demo seed is a publicly known BIP39 test vector, clearly marked:

```typescript
// packages/core/src/constants.ts:1-5
// FOR DEMO ONLY — DO NOT USE WITH REAL FUNDS
// This is a publicly known seed (BIP39 test vector #1) used exclusively for development and demonstration.
// Mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
export const DEMO_SEED =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';
```

### Devnet/Mainnet Warning

**Do not reuse your devnet seed on mainnet.** The demo seed is a publicly known test vector — any funds sent to its derived addresses can be taken by anyone. For mainnet deployment, generate a fresh BIP39 mnemonic with a trusted tool and store it securely. Never share a seed between devnet testing and production use.

## Executable Test Suite

`packages/core/test/security/isolation.test.ts` contains 14 tests that serve as executable proofs of key isolation. These tests verify that no introspection technique — property enumeration, JSON serialization, prototype traversal, or type inspection — can extract key material from wallet objects.

### What the Tests Prove

| # | Test | What It Proves |
|---|------|---------------|
| 1 | `Object.keys(agentWallet)` returns `["address", "signTransaction"]` | Only two properties visible |
| 2 | `Object.getOwnPropertyNames(agentWallet)` returns `["address", "signTransaction"]` | No hidden own properties |
| 3 | `JSON.stringify(agentWallet)` contains no key material | Serialization is safe |
| 4 | `Object.getPrototypeOf(agentWallet)` is `Object.prototype` | Plain object, no class chain |
| 5 | `__proto__` leads nowhere with key material | Prototype traversal is safe |
| 6 | `constructor` is `Object` | No custom constructor to inspect |
| 7 | Adding properties to frozen AgentWallet throws | Immutable — cannot attach key extractors |
| 8 | Modifying address on frozen AgentWallet throws | Immutable — cannot replace methods |
| 9 | `Object.keys(autarchWallet)` returns only public method names | Factory result has no key properties |
| 10 | `JSON.stringify(autarchWallet)` contains no key material | Factory serialization is safe |
| 11 | No property is `Uint8Array`/`ArrayBuffer`/`CryptoKey` | No raw key types exposed |
| 12 | `String(agentWallet)` reveals no key material | String coercion is safe |
| 13 | Public exports omit `deriveKeypair`/`DEMO_SEED` | Internal crypto functions not re-exported |
| 14 | `createAutarchWallet` is the only callable factory | No alternate wallet constructors |

### Run It Yourself

```bash
pnpm test -- --reporter=verbose packages/core/test/security/isolation.test.ts
```

Expected: 14 tests, 14 passed.

## Production Hardening Notes

The current security model is designed for devnet demonstration. For production deployment, consider:

- **Seed zeroization** — The `cleanup()` method (`wallet-core.ts:277-279`) closes the RPC client but does not zero the seed `Uint8Array` or clear the `keypairCache`/`agentCache` Maps. Key material persists in memory until garbage collection. For production, `cleanup()` should overwrite seed bytes (`seed.fill(0)`) and clear all caches to bound key material lifetime
- **HSM/KMS integration** — Move seed storage from environment variables to a hardware security module or cloud KMS
- **Process isolation** — Run wallet-core in a separate process with IPC, limiting the blast radius of a compromised agent
- **Audit logging** — Add tamper-evident logging for all signing operations
- **Rate limiting** — Enforce per-agent transaction rate limits at the wallet-core level
- **Seed rotation** — Implement a key rotation strategy for long-running deployments

These are design decisions for a production roadmap, not current gaps. The devnet prototype proves the isolation model works; production hardening extends it.
