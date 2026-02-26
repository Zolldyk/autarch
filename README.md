# Autarch

Secure, deterministic agent wallets for Solana with transparent decision-making.

Autarch derives isolated wallets from a single master seed (BIP44) so autonomous agents can trade on-chain without ever seeing private keys. A JSON rule engine drives every decision, and a real-time dashboard lets you watch reasoning traces as they happen.

## Choose Your Path

| Time | What You'll Do | What You'll See |
|------|---------------|-----------------|
| **[2 minutes](#2-minute-quick-look)** | Run one command | Live agents trading on devnet |
| **[5 minutes](#5-minute-guided-demo)** | Explore the dashboard | Reasoning traces, on-chain transactions, hot-reload |
| **[10 minutes](#10-minute-developer-path)** | Set up your own seed | Agents you control with custom rules |

---

### 2-Minute Quick Look

**Prerequisites:** Node >= 22, pnpm

```bash
git clone https://github.com/YOUR_ORG/autarch.git
cd autarch
pnpm install
pnpm run demo
```

Your browser opens to a live dashboard with 3 agents — Conservative, Dip Buyer, and Momentum — each running a different strategy on Solana devnet. No configuration needed; the demo uses a built-in seed.

---

### 5-Minute Guided Demo

Start with the 2-minute steps above, then explore:

1. **Agent cards** — Each card shows the agent name, wallet balance, and current status. Click an agent card to expand its reasoning trace — a structured tree showing exactly which rules fired and why.

2. **Verify on-chain** — When an agent executes a trade, the activity log shows a Solana Explorer link. Click it to verify the transaction on devnet.

3. **Hot-reload rules** — Open `examples/rules/conservative.json` in your editor. Change the `cooldownSeconds` value (e.g., from `120` to `30`) and save. The dashboard activity log shows a hot-reload event, and the agent immediately uses the new config.

4. **Interactive mode** — For more control, try the interactive demo:

   ```bash
   pnpm run interactive
   ```

   This adds market control commands (inject price changes via curl) and a hot-reload hint on startup.

---

### 10-Minute Developer Path

1. **Set up your environment:**

   ```bash
   cp .env.example .env
   ```

2. **Add your own seed** — Open `.env`, uncomment the `MASTER_SEED` line, and replace the placeholder with your own BIP39 mnemonic:

   ```
   MASTER_SEED=your twelve or twenty-four word mnemonic goes here
   ```

   > **Warning:** Never use the same seed for devnet and mainnet. Never use a seed that holds real funds.

3. **Start Autarch:**

   ```bash
   pnpm start
   ```

   With `MASTER_SEED` set, Autarch derives agent wallets from your seed (`MASTER_SEED` always takes priority over demo mode). The dashboard opens automatically.

4. **Customize agent rules** — Edit the JSON configs in `examples/rules/` to define your own strategies. See [`examples/rules/README.md`](examples/rules/README.md) for the full field reference — conditions, weighted scoring, compound logic, and inter-agent dependencies.

5. **Go deeper** — See [SKILLS.md](SKILLS.md) for full API documentation.

---

## How It Works

- **HD wallet derivation (BIP44)** — All agent wallets are derived from a single master seed using standard derivation paths. Each agent gets its own keypair deterministically.
- **Agent-blind key isolation** — Agents never see private keys. The core wallet SDK signs transactions on their behalf, enforcing security boundaries.
- **Rule engine** — JSON config files define agent behavior with compound conditions (AND/OR/NOT), weighted scoring, cooldowns, and optional inter-agent dependencies. Configs hot-reload on file change.
- **Real-time dashboard (SSE)** — A server-sent events stream pushes agent state, reasoning traces, and trade activity to the browser in real time.

## Project Structure

```
autarch/
├── packages/
│   ├── core/          # @autarch/core — wallet SDK, HD derivation, RPC client
│   ├── agent/         # @autarch/agent — rule engine, agent runtime, market data
│   └── demo/          # @autarch/demo — dashboard server, demo scripts
├── examples/
│   └── rules/         # Agent JSON configs (conservative, dip-buyer, momentum)
├── .env.example       # Environment template — start here
└── package.json       # Monorepo root (pnpm workspaces)
```

## Configuration

All configuration is via environment variables. See `.env.example` for the full template.

| Variable | Purpose | Default |
|----------|---------|---------|
| `MASTER_SEED` | BIP39 mnemonic or hex seed for wallet derivation | *(required outside demo mode)* |
| `DEMO_MODE` | Set to `true` for zero-config demo with built-in seed | unset |
| `RPC_URL` | Solana RPC endpoint | `https://api.devnet.solana.com` |
| `RPC_ENDPOINTS` | Comma-separated fallback RPC endpoints (overrides `RPC_URL`) | unset |
| `PORT` | Dashboard server port | `3000` |

## Development

```bash
pnpm install          # Install dependencies
pnpm run build        # TypeScript compilation
pnpm run test         # Run all tests (Vitest)
pnpm run lint         # ESLint across packages
pnpm run typecheck    # Type checking without emit
```

## Further Reading

- [SKILLS.md](SKILLS.md) — Machine-readable API documentation
- [SECURITY.md](SECURITY.md) — Verifiable security claims with proofs
- [DEEP-DIVE.md](DEEP-DIVE.md) — Architecture, "Why Not LLMs?", and production path
