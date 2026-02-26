# JUDGE.md — Evaluation Guide

Time-based evaluation paths for the Autarch multi-agent Solana wallet system. Each path maps to competition rubric criteria: security, autonomy, transparency, and developer experience.

**Prerequisites:** Node >= 22, pnpm

---

## 60-Second Evaluation

**Goal:** See autonomous agents trading on Solana devnet with transparent reasoning.

```bash
git clone <repo-url>   # Use the repository URL provided by the submission
cd autarch
pnpm install
pnpm run demo
```

1. **Dashboard opens** at `http://localhost:3000` with 3 agents (Conservative, Dip Buyer, Momentum) running different strategies.
2. **Watch agent cards** — each shows wallet balance, status, and current action.
3. **Click a reasoning trace** — expand any agent card to see a structured tree: which rules fired, which conditions matched, what thresholds were checked, and the final action with its score.
4. **Verify on-chain** — when an agent executes a trade, the activity log shows a Solana Explorer link. Click it to confirm the transaction on devnet.

**What you just proved:**
- Agents run autonomously (no human intervention after `pnpm run demo`)
- Every decision has a transparent, inspectable trace
- Transactions are real and verifiable on Solana devnet

---

## 5-Minute Evaluation

**Goal:** Verify hot-reload, security claims, and on-chain transactions.

Start with the 60-second steps above, then:

### Hot-Reload Rules (~1 min)

1. Open `examples/rules/conservative.json` in any editor.
2. Change `cooldownSeconds` (e.g., from `120` to `30`) and save.
3. The dashboard activity log shows a hot-reload event. The agent immediately uses the new config — no restart needed.

**What you just proved:** Live reconfiguration without downtime. Rules are the single source of truth for agent behavior.

### Security Claims (~2 min)

[SECURITY.md](SECURITY.md) makes 4 verifiable claims. Each includes a shell command you can copy-paste:

| # | Claim | Verify Command | Expected |
|---|-------|---------------|----------|
| 1 | [No key exposure in public API](SECURITY.md#claim-1-no-key-exposure-in-public-api) | `grep -n "Object.freeze" packages/core/src/wallet-core.ts` | Lines 152, 277 |
| 2 | [No key logging](SECURITY.md#claim-2-no-key-logging) | `grep -rn "console\." packages/core/src/ \| grep -i "key\|seed\|private\|secret\|mnemonic"` | No output |
| 3 | [Key isolation boundary](SECURITY.md#claim-3-key-isolation-boundary) | `grep -E "solana\|scure\|crypto\|nacl\|noble\|elliptic\|ed25519\|bip39" packages/agent/package.json packages/demo/package.json` | No output |
| 4 | [Memory-only keys](SECURITY.md#claim-4-memory-only-keys) | `grep -rn "writeFile\|writeFileSync\|appendFile\|createWriteStream" packages/core/src/` | No output |

**What you just proved:** Key isolation is structural, not conventional — enforced by closures, frozen objects, package boundaries, and ESLint import restrictions.

### Explorer Verification (~1 min)

1. Wait for an agent to execute a trade (or trigger one by editing a rule to lower the threshold).
2. Click the Solana Explorer link in the activity log.
3. Confirm the transaction exists on devnet with the agent's wallet address as the signer.

**What you just proved:** Agents sign and submit real Solana transactions.

---

## 10-Minute Evaluation

**Goal:** Understand the architecture, extend the system, and review the API surface.

Start with the 5-minute steps above, then:

### Architecture Deep Dive (~3 min)

Read [DEEP-DIVE.md](DEEP-DIVE.md):

- [Architecture Overview](DEEP-DIVE.md#architecture-overview) — three-package monorepo with unidirectional dependency graph
- [Closure-Based Key Isolation](DEEP-DIVE.md#closure-based-key-isolation) — why closures over private class fields, with code excerpts
- [Decision System](DEEP-DIVE.md#decision-system) — rule engine, `DecisionModule` interface, `DecisionTrace` audit records
- [Why Not LLMs?](DEEP-DIVE.md#why-not-llms) — deterministic rules for execution safety, LLMs for optional inspiration
- [Production Hardening Path](DEEP-DIVE.md#production-hardening-path) — HSM/TEE, multi-sig, rate limiting, blockchain-anchored audit

**What you'll see:** Every architectural decision is documented with rationale, code references, and upgrade paths.

### Custom Rule Creation (~2 min)

1. Copy an existing rule file:
   ```bash
   cp examples/rules/conservative.json examples/rules/custom.json
   ```
2. Edit `examples/rules/custom.json` — change the agent name, adjust conditions and thresholds, modify the action.
3. Reference the [examples/rules/README.md](examples/rules/README.md) for the full field reference: conditions, weighted scoring, compound logic, and inter-agent dependencies.

**What you just proved:** The rule system is fully configurable via JSON — no code changes required.

### DecisionModule Extensibility (~1 min)

Review the [DecisionModule Interface — Extension Guide](SKILLS.md#decisionmodule-interface--extension-guide) in SKILLS.md. The interface is the pluggable entry point for all decision-making:

- The built-in `RuleBasedDecisionModule` is one implementation
- Custom modules (including LLM wrappers) implement the same `evaluate()` contract
- See the [Custom LLM Wrapper Example](DEEP-DIVE.md#custom-llm-wrapper-example) in DEEP-DIVE.md for a complete integration pattern

**What you'll see:** The system is designed for extensibility — swap decision strategies without changing agent code or the dashboard.

### API Surface Review (~2 min)

[SKILLS.md](SKILLS.md) provides complete API documentation for both packages:

- [Quick Start](SKILLS.md#quick-start) — seed → wallet → agent → transaction in 7 lines
- [@autarch/core](SKILLS.md#autarchcore) — `createAutarchWallet`, `loadSeed`, `createRpcClient`, types, constants
- [@autarch/agent](SKILLS.md#autarchagent) — `Agent`, `AgentRuntime`, `RuleBasedDecisionModule`, `FileWatcher`, standalone functions
- [Machine-Readable API Reference](SKILLS.md#machine-readable-api-reference) — structured JSON for programmatic consumption

**What you'll see:** Every public export has parameter tables, return types, error codes, and usage examples.

---

## Rubric Mapping

| Rubric Criterion | 60s | 5min | 10min | Where to Find Proof |
|-----------------|-----|------|-------|-------------------|
| **Security** | Agents never see keys (frozen objects) | 4 verifiable claims with shell commands | Closure-based isolation architecture | [SECURITY.md](SECURITY.md), [DEEP-DIVE.md — Closure-Based Key Isolation](DEEP-DIVE.md#closure-based-key-isolation) |
| **Autonomy** | 3 agents trading independently | Hot-reload reconfiguration | Custom rule creation, DecisionModule extensibility | Dashboard, [examples/rules/](examples/rules/), [SKILLS.md — DecisionModule](SKILLS.md#decisionmodule-interface--extension-guide) |
| **Transparency** | Reasoning traces visible per decision | Explorer-verified on-chain transactions | DecisionTrace audit records, full architecture docs | Dashboard traces, [DEEP-DIVE.md — DecisionTrace](DEEP-DIVE.md#decisiontrace) |
| **Developer Experience** | One command to run (`pnpm run demo`) | Edit JSON, see changes live | Complete API docs, extension guide, machine-readable reference | [README.md](README.md#2-minute-quick-look), [SKILLS.md](SKILLS.md#quick-start) |

---

## Document Map

| Document | Purpose | Key Sections |
|----------|---------|-------------|
| [README.md](README.md) | Onboarding — three time-based paths | [2-Minute Quick Look](README.md#2-minute-quick-look), [5-Minute Guided Demo](README.md#5-minute-guided-demo), [10-Minute Developer Path](README.md#10-minute-developer-path) |
| [SECURITY.md](SECURITY.md) | 4 verifiable security claims with proofs | [Claim 1–4](SECURITY.md#claim-1-no-key-exposure-in-public-api), [Executable Test Suite](SECURITY.md#executable-test-suite) |
| [DEEP-DIVE.md](DEEP-DIVE.md) | Architecture, "Why Not LLMs?", production path | [Architecture Overview](DEEP-DIVE.md#architecture-overview), [Why Not LLMs?](DEEP-DIVE.md#why-not-llms), [Production Hardening Path](DEEP-DIVE.md#production-hardening-path) |
| [SKILLS.md](SKILLS.md) | Machine-readable API reference | [Quick Start](SKILLS.md#quick-start), [@autarch/core](SKILLS.md#autarchcore), [@autarch/agent](SKILLS.md#autarchagent) |
