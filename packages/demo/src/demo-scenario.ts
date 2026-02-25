import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSeed, createAutarchWallet } from '@autarch/core';
import { AgentRuntime, loadAgentConfig, SimulatedMarketDataProvider } from '@autarch/agent';
import { createServer } from './server.js';

const AGENT_DISTRIBUTION_LAMPORTS = 100_000_000n; // 0.1 SOL
const AIRDROP_AMOUNT_LAMPORTS = 2_000_000_000n; // 2 SOL
const FIRST_INJECT_DELAY_MS = 10_000;
const PERIODIC_INJECT_INTERVAL_MS = 30_000;
const DEFAULT_DEMO_PORT = 3000;

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

  // 1. Load seed (DEMO_MODE=true → built-in demo seed)
  console.log('🚀 Autarch Demo Starting...');
  console.log('   Seed: demo mode (FOR DEMO ONLY)');
  const seed = loadSeed();

  // 2. Create wallet
  const wallet = createAutarchWallet({ seed });

  // 3. Airdrop 2 SOL to treasury
  console.log('📡 Requesting airdrop to treasury...');
  await wallet.requestAirdrop(0, AIRDROP_AMOUNT_LAMPORTS);
  const treasuryAddr = await wallet.getAddress(0);
  console.log(`   Treasury: ${treasuryAddr}`);

  // 4. Distribute 0.1 SOL to each agent
  console.log('💰 Funding 3 agent wallets...');
  for (const def of AGENT_DEFS) {
    await wallet.distributeSol(def.agentId, AGENT_DISTRIBUTION_LAMPORTS);
    const addr = await wallet.getAddress(def.agentId);
    console.log(`   Agent ${String(def.agentId)} (${def.label}): ${addr} — 0.1 SOL`);
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
    getBalance: () => wallet.getBalance(def.agentId),
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
    runtime.injectDip(5);
    console.log('\n🎯 Market event injected — agents should respond shortly...');
  }, FIRST_INJECT_DELAY_MS);

  let injectCount = 0;
  const marketInjectInterval = setInterval(() => {
    injectCount++;
    if (injectCount % 2 === 0) {
      runtime.injectDip(3 + Math.random() * 7);
    } else {
      runtime.injectRally(3 + Math.random() * 7);
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
