import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSeed, createAutarchWallet } from '@autarch/core';
import type { AutarchWallet, Balance, MintInfo } from '@autarch/core';
import { AgentRuntime, loadAgentConfig, SimulatedMarketDataProvider } from '@autarch/agent';
import type { TraceExecution, ExecuteAction } from '@autarch/agent';
import { createServer } from './server.js';

const AGENT_DISTRIBUTION_LAMPORTS = 100_000_000n; // 0.1 SOL
const AIRDROP_AMOUNT_LAMPORTS = 2_000_000_000n; // 2 SOL
const INITIAL_TOKEN_AMOUNT = 1_000_000_000_000n; // 1000 tokens (9 decimals)
const LAMPORTS_PER_SOL = 1_000_000_000;
const FIRST_INJECT_DELAY_MS = 10_000;
const PERIODIC_INJECT_INTERVAL_MS = 30_000;
const DEFAULT_DEMO_PORT = 3000;
const SIMULATED_BALANCE: Balance = { lamports: 1_000_000_000n, sol: 1.0 };

export interface DemoOptions {
  interactive?: boolean;
}

const AGENT_DEFS = [
  { agentId: 1, configFile: 'conservative.json', label: 'Conservative' },
  { agentId: 2, configFile: 'dip-buyer.json', label: 'Dip Buyer' },
  { agentId: 3, configFile: 'momentum.json', label: 'Momentum' },
] as const;

function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], () => {});
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execFile(cmd, [url], () => {});
  }
}

function createExecuteAction(
  wallet: AutarchWallet,
  agentId: number,
  treasuryAddr: string,
  mint: MintInfo | undefined,
): ExecuteAction {
  return async (execution): Promise<TraceExecution> => {
    try {
      const agentAddr = await wallet.getAddress(agentId);
      const amountLamports = BigInt(Math.floor(execution.amount * LAMPORTS_PER_SOL));

      if (execution.action === 'buy') {
        // Agent sends SOL to treasury
        const result = await wallet.transferSol(agentId, treasuryAddr, amountLamports);
        // If tokens available, transfer tokens to agent
        if (mint) {
          const tokenAmount = BigInt(Math.floor(execution.amount * 10 ** mint.decimals));
          await wallet.transferTokens(mint.mintAddress, 0, agentId, tokenAmount, mint.decimals);
        }
        return { status: result.status === 'simulated' ? 'simulated' : 'confirmed', signature: result.signature, mode: result.mode };
      } else if (execution.action === 'sell') {
        // If tokens available, transfer tokens to treasury
        if (mint) {
          const tokenAmount = BigInt(Math.floor(execution.amount * 10 ** mint.decimals));
          await wallet.transferTokens(mint.mintAddress, agentId, 0, tokenAmount, mint.decimals);
        }
        // Treasury sends SOL to agent
        const result = await wallet.transferSol(0, agentAddr, amountLamports);
        return { status: result.status === 'simulated' ? 'simulated' : 'confirmed', signature: result.signature, mode: result.mode };
      }

      return { status: 'simulated', mode: 'simulation' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'failed', error: message, mode: 'degraded' };
    }
  };
}

function createSimulatedExecuteAction(): ExecuteAction {
  return async (): Promise<TraceExecution> => {
    const sig = randomBytes(64).toString('hex');
    return { status: 'simulated', signature: sig, mode: 'simulation' };
  };
}

function resolveRulesDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '..', '..', '..', 'examples', 'rules');
}

function printInteractiveInstructions(port: number): void {
  const url = `http://localhost:${String(port)}`;
  console.log('');
  console.log('🎮 Interactive Mode — Explore at your own pace');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`📊 Dashboard: ${url}`);
  console.log('');
  console.log('🔄 Hot-Reload:');
  console.log('   Edit files in examples/rules/ and save — agents reload instantly');
  console.log('   Try: Change cooldownSeconds in examples/rules/conservative.json');
  console.log('');
  console.log('📡 Market Controls (dashboard buttons OR curl):');
  console.log(`   curl -X POST ${url}/api/market/dip -H 'Content-Type: application/json' -d '{"percent": 5}'`);
  console.log(`   curl -X POST ${url}/api/market/rally -H 'Content-Type: application/json' -d '{"percent": 10}'`);
  console.log(`   curl -X POST ${url}/api/market/reset`);
  console.log('');
  console.log('   Auto-injection is active — market events fire every ~30s to keep things lively.');
}

export async function runDemo(options: DemoOptions = {}): Promise<void> {
  // Ensure DEMO_MODE is set (cross-platform — avoids Unix-only env prefix in npm script)
  process.env['DEMO_MODE'] = 'true';

  const port = Number(process.env['PORT']) || DEFAULT_DEMO_PORT;
  const url = `http://localhost:${String(port)}`;

  // 1. Load seed (MASTER_SEED takes priority over DEMO_MODE)
  console.log('🚀 Autarch Demo Starting...');
  const hasMasterSeed = process.env['MASTER_SEED'] !== undefined && process.env['MASTER_SEED'] !== '';
  console.log(`   Seed: ${hasMasterSeed ? 'custom (MASTER_SEED)' : 'demo mode (FOR DEMO ONLY)'}`);
  const seed = loadSeed();

  // 2. Create wallet
  const wallet = createAutarchWallet({ seed });

  // 3. Airdrop SOL to treasury (graceful — continues if rate-limited and treasury already has funds)
  const treasuryAddr = await wallet.getAddress(0);
  console.log('📡 Requesting airdrop to treasury...');
  let treasuryFunded = false;
  try {
    const airdropResult = await wallet.requestAirdrop(0, AIRDROP_AMOUNT_LAMPORTS);
    if (typeof airdropResult === 'string' && airdropResult.startsWith('skipped:')) {
      console.log(`   Treasury: ${treasuryAddr} (already funded)`);
    } else {
      console.log(`   Treasury: ${treasuryAddr}`);
    }
    treasuryFunded = true;
  } catch {
    // Airdrop failed (rate-limited) — check if treasury already has funds
    try {
      const balance = await wallet.getBalance(0);
      if (balance.lamports > 0n) {
        const solBalance = Number(balance.lamports) / LAMPORTS_PER_SOL;
        console.log(`   Airdrop rate-limited, but treasury already has ${solBalance.toFixed(4)} SOL — continuing`);
        console.log(`   Treasury: ${treasuryAddr}`);
        treasuryFunded = true;
      }
    } catch {
      // Balance check also failed
    }

    if (!treasuryFunded) {
      console.log('');
      console.log('⚠️  Airdrop rate-limited and treasury has no funds.');
      console.log(`   Fund treasury manually: solana airdrop 2 ${treasuryAddr} --url devnet`);
      console.log('   Or wait and try again later.');
      console.log('');
      console.log('   Continuing in simulation mode (no on-chain transactions)...');
      console.log(`   Treasury: ${treasuryAddr}`);
    }
  }

  // 4. Distribute 0.1 SOL to each agent (skip if treasury has insufficient funds)
  console.log('💰 Funding 3 agent wallets...');
  for (const def of AGENT_DEFS) {
    try {
      await wallet.distributeSol(def.agentId, AGENT_DISTRIBUTION_LAMPORTS);
      const addr = await wallet.getAddress(def.agentId);
      console.log(`   Agent ${String(def.agentId)} (${def.label}): ${addr} — 0.1 SOL`);
    } catch {
      const addr = await wallet.getAddress(def.agentId);
      console.log(`   Agent ${String(def.agentId)} (${def.label}): ${addr} — distribution skipped`);
    }
  }

  // 4b. Create SPL token mint and distribute tokens
  let mint: MintInfo | undefined;
  try {
    console.log('🪙 Creating SPL test token...');
    mint = await wallet.createTokenMint(9);
    console.log(`   Mint: ${mint.mintAddress} (${String(mint.decimals)} decimals)`);

    console.log('🪙 Minting 1000 tokens to each agent...');
    for (const def of AGENT_DEFS) {
      await wallet.mintTokens(mint.mintAddress, def.agentId, INITIAL_TOKEN_AMOUNT);
      const tokenBal = await wallet.getTokenBalance(mint.mintAddress, def.agentId);
      console.log(`   Agent ${String(def.agentId)} (${def.label}): ${String(tokenBal.uiAmount)} tokens`);
    }
    // Also mint tokens to treasury for trade execution
    await wallet.mintTokens(mint.mintAddress, 0, INITIAL_TOKEN_AMOUNT * 10n);
  } catch (tokenError: unknown) {
    const msg = tokenError instanceof Error ? tokenError.message : String(tokenError);
    console.log(`   Token setup skipped: ${msg}`);
  }

  // 5. Load configs + agent wallets in parallel
  const rulesDir = resolveRulesDir();
  const [configs, agentWallets] = await Promise.all([
    Promise.all(
      AGENT_DEFS.map((def) => loadAgentConfig(path.join(rulesDir, def.configFile))),
    ),
    Promise.all(AGENT_DEFS.map((def) => wallet.getAgent(def.agentId))),
  ]);

  // 6. Build runtime options
  const agents = AGENT_DEFS.map((def, i) => ({
    agentId: def.agentId,
    config: configs[i],
    configPath: path.join(rulesDir, def.configFile),
    wallet: agentWallets[i],
    getBalance: treasuryFunded
      ? () => wallet.getBalance(def.agentId)
      : async () => SIMULATED_BALANCE,
    executeAction: treasuryFunded
      ? createExecuteAction(wallet, def.agentId, treasuryAddr, mint)
      : createSimulatedExecuteAction(),
  }));

  const marketProvider = new SimulatedMarketDataProvider();
  const runtime = new AgentRuntime({ agents, marketProvider });

  // 7. Create server
  const { app, port: resolvedPort } = createServer({ runtime, port });

  // 8. Start server (wrap listen in a promise)
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const srv = app.listen(resolvedPort, () => {
      resolve(srv);
    });
  });

  // 9. Start agents
  console.log('🤖 Starting 3 agents...');
  runtime.start();

  // 10. Open browser
  console.log(`📊 Dashboard running at ${url}`);
  console.log('   Press Ctrl+C to stop');
  openBrowser(url);

  // 10b. Interactive instructions (after server is up, before auto-injection)
  if (options.interactive) {
    printInteractiveInstructions(resolvedPort);
  }

  // 11. Market event injection
  const firstInjectTimeout = setTimeout(() => {
    runtime.injectDip(8);
    console.log('\n🎯 Market event injected — agents should respond shortly...');
  }, FIRST_INJECT_DELAY_MS);

  let injectCount = 0;
  const marketInjectInterval = setInterval(() => {
    injectCount++;
    if (injectCount % 2 === 0) {
      runtime.injectDip(5 + Math.random() * 8);
    } else {
      runtime.injectRally(5 + Math.random() * 10);
    }
  }, PERIODIC_INJECT_INTERVAL_MS);

  // 12. Graceful shutdown
  let isShuttingDown = false;

  function shutdown(): void {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n🛑 Shutting down...');
    clearTimeout(firstInjectTimeout);
    clearInterval(marketInjectInterval);
    runtime.stop();
    wallet.cleanup();
    server.close(() => {
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Top-level execution only when run directly (not when imported via barrel)
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runDemo().catch((err: unknown) => {
    console.error('Demo failed:', err);
    process.exit(1);
  });
}
