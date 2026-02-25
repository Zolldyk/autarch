import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateAgentConfig, loadAgentConfig } from '@autarch/agent';

const RULES_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'examples', 'rules');
const ROOT_PKG = path.resolve(import.meta.dirname, '..', '..', '..', 'package.json');
const DEMO_PKG = path.resolve(import.meta.dirname, '..', 'package.json');
const DEMO_SCENARIO = path.resolve(import.meta.dirname, '..', 'src', 'demo-scenario.ts');

// --- Task 1: loadSeed export ---

describe('Task 1: loadSeed export from @autarch/core', () => {
  it('loadSeed is exported from @autarch/core', async () => {
    const core = await import('@autarch/core');
    expect(typeof (core as Record<string, unknown>).loadSeed).toBe('function');
  });
});

// --- Task 2: Example rule configurations ---

describe('Task 2: example rule configurations', () => {
  it('conservative.json passes schema validation', () => {
    const raw = JSON.parse(readFileSync(path.join(RULES_DIR, 'conservative.json'), 'utf-8'));
    const result = validateAgentConfig(raw);
    expect(result.valid).toBe(true);
  });

  it('dip-buyer.json passes schema validation', () => {
    const raw = JSON.parse(readFileSync(path.join(RULES_DIR, 'dip-buyer.json'), 'utf-8'));
    const result = validateAgentConfig(raw);
    expect(result.valid).toBe(true);
  });

  it('momentum.json passes schema validation', () => {
    const raw = JSON.parse(readFileSync(path.join(RULES_DIR, 'momentum.json'), 'utf-8'));
    const result = validateAgentConfig(raw);
    expect(result.valid).toBe(true);
  });

  it('all 3 configs load successfully via loadAgentConfig', async () => {
    const configs = await Promise.all([
      loadAgentConfig(path.join(RULES_DIR, 'conservative.json')),
      loadAgentConfig(path.join(RULES_DIR, 'dip-buyer.json')),
      loadAgentConfig(path.join(RULES_DIR, 'momentum.json')),
    ]);
    expect(configs).toHaveLength(3);
    for (const config of configs) {
      expect(config.name).toBeTruthy();
      expect(config.strategy).toBeTruthy();
      expect(config.rules.length).toBeGreaterThan(0);
    }
  });

  it('conservative config has intervalMs 5000 and cooldownSeconds >= 120', async () => {
    const config = await loadAgentConfig(path.join(RULES_DIR, 'conservative.json'));
    expect(config.intervalMs).toBe(5000);
    for (const rule of config.rules) {
      expect(rule.cooldownSeconds).toBeGreaterThanOrEqual(120);
    }
  });

  it('dip-buyer config has compound conditions', async () => {
    const config = await loadAgentConfig(path.join(RULES_DIR, 'dip-buyer.json'));
    const hasCompound = config.rules.some((r) => r.conditions.length > 1);
    expect(hasCompound).toBe(true);
  });

  it('momentum config has a peer dependency condition', async () => {
    const config = await loadAgentConfig(path.join(RULES_DIR, 'momentum.json'));
    const hasPeer = config.rules.some((r) =>
      r.conditions.some((c) => c.field.startsWith('peer.')),
    );
    expect(hasPeer).toBe(true);
  });

  it('all 3 configs share intervalMs 5000 for demo visibility', async () => {
    const configs = await Promise.all([
      loadAgentConfig(path.join(RULES_DIR, 'conservative.json')),
      loadAgentConfig(path.join(RULES_DIR, 'dip-buyer.json')),
      loadAgentConfig(path.join(RULES_DIR, 'momentum.json')),
    ]);
    for (const config of configs) {
      expect(config.intervalMs).toBe(5000);
    }
  });

  it('conservative uses small trade amounts (0.01 SOL)', async () => {
    const config = await loadAgentConfig(path.join(RULES_DIR, 'conservative.json'));
    for (const rule of config.rules) {
      expect(rule.amount).toBe(0.01);
    }
  });

  it('dip-buyer uses moderate trade amounts (0.02 SOL)', async () => {
    const config = await loadAgentConfig(path.join(RULES_DIR, 'dip-buyer.json'));
    for (const rule of config.rules) {
      expect(rule.amount).toBe(0.02);
    }
  });

  it('momentum uses larger trade amounts (>= 0.03 SOL)', async () => {
    const config = await loadAgentConfig(path.join(RULES_DIR, 'momentum.json'));
    for (const rule of config.rules) {
      expect(rule.amount).toBeGreaterThanOrEqual(0.03);
    }
  });

  it('each config has both buy and sell rules', async () => {
    const configs = await Promise.all([
      loadAgentConfig(path.join(RULES_DIR, 'conservative.json')),
      loadAgentConfig(path.join(RULES_DIR, 'dip-buyer.json')),
      loadAgentConfig(path.join(RULES_DIR, 'momentum.json')),
    ]);
    for (const config of configs) {
      const actions = config.rules.map((r) => r.action);
      expect(actions).toContain('buy');
      expect(actions).toContain('sell');
    }
  });

  it('momentum config has a NOT condition logic', async () => {
    const config = await loadAgentConfig(path.join(RULES_DIR, 'momentum.json'));
    const hasNot = config.rules.some((r) =>
      r.conditions.some((c) => c.logic === 'NOT'),
    );
    expect(hasNot).toBe(true);
  });

  it('all configs have unique names', async () => {
    const configs = await Promise.all([
      loadAgentConfig(path.join(RULES_DIR, 'conservative.json')),
      loadAgentConfig(path.join(RULES_DIR, 'dip-buyer.json')),
      loadAgentConfig(path.join(RULES_DIR, 'momentum.json')),
    ]);
    const names = configs.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// --- Negative schema validation ---

describe('schema rejects invalid configs', () => {
  it('rejects config with empty rules array', () => {
    const result = validateAgentConfig({ name: 'Bad', strategy: 'None', rules: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects config missing required name field', () => {
    const result = validateAgentConfig({ strategy: 'None', rules: [{ name: 'r', conditions: [{ field: 'x', operator: '>', threshold: 1 }], action: 'buy', amount: 1, weight: 50, cooldownSeconds: 0 }] });
    expect(result.valid).toBe(false);
  });

  it('rejects config with invalid action type', () => {
    const result = validateAgentConfig({
      name: 'Bad',
      strategy: 'None',
      rules: [{
        name: 'r',
        conditions: [{ field: 'x', operator: '>', threshold: 1 }],
        action: 'invalid',
        amount: 1,
        weight: 50,
        cooldownSeconds: 0,
      }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects config with zero amount', () => {
    const result = validateAgentConfig({
      name: 'Bad',
      strategy: 'None',
      rules: [{
        name: 'r',
        conditions: [{ field: 'x', operator: '>', threshold: 1 }],
        action: 'buy',
        amount: 0,
        weight: 50,
        cooldownSeconds: 0,
      }],
    });
    expect(result.valid).toBe(false);
  });
});

// --- Task 3: demo-scenario exports ---

describe('Task 3: demo-scenario module', () => {
  it('exports runDemo function via dynamic import', async () => {
    const mod = await import('../src/demo-scenario.js');
    expect(typeof mod.runDemo).toBe('function');
  });

  it('guards top-level execution behind argv check', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain('process.argv[1]');
    expect(src).toContain('path.resolve(process.argv[1])');
  });
});

// --- Task 4 & 5: npm scripts and barrel exports ---

describe('Task 4: npm scripts', () => {
  it('root package.json contains demo script', () => {
    const pkg = JSON.parse(readFileSync(ROOT_PKG, 'utf-8'));
    expect(pkg.scripts.demo).toBeDefined();
    expect(pkg.scripts.demo).toContain('@autarch/demo');
  });

  it('runDemo sets DEMO_MODE=true in code (cross-platform)', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain("process.env['DEMO_MODE'] = 'true'");
  });

  it('packages/demo/package.json contains start script', () => {
    const pkg = JSON.parse(readFileSync(DEMO_PKG, 'utf-8'));
    expect(pkg.scripts.start).toBeDefined();
  });
});

// --- Task 5: barrel re-export ---

describe('Task 5: barrel re-export', () => {
  it('runDemo is re-exported from @autarch/demo barrel', async () => {
    const barrel = await import('../src/index.js');
    expect(typeof barrel.runDemo).toBe('function');
  });
});

// --- AC6: Graceful shutdown source checks ---

describe('AC6: graceful shutdown patterns', () => {
  it('registers SIGINT and SIGTERM handlers', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain("process.on('SIGINT'");
    expect(src).toContain("process.on('SIGTERM'");
  });

  it('uses isShuttingDown guard to prevent double shutdown', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain('isShuttingDown');
    expect(src).toContain('if (isShuttingDown) return');
  });

  it('cleans up all resources in shutdown (runtime, wallet, server, timers)', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain('runtime.stop()');
    expect(src).toContain('wallet.cleanup()');
    expect(src).toContain('server.close(');
    expect(src).toContain('clearTimeout(');
    expect(src).toContain('clearInterval(');
  });
});

// --- AC4: openBrowser safety ---

describe('AC4: openBrowser safety', () => {
  it('uses execFile (not exec) for browser opening', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain('execFile');
    // Should NOT use bare exec (command injection risk)
    expect(src).not.toMatch(/\bexec\(/);
  });
});

// --- AC2: orchestrator constants match spec ---

describe('AC2: orchestrator constants', () => {
  it('airdrop amount is 2 SOL (2_000_000_000 lamports)', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain('2_000_000_000n');
  });

  it('agent distribution is 0.1 SOL (100_000_000 lamports)', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain('100_000_000n');
  });

  it('default demo port is 3000', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain('DEFAULT_DEMO_PORT = 3000');
  });

  it('defines exactly 3 agents (Conservative, Dip Buyer, Momentum)', () => {
    const src = readFileSync(DEMO_SCENARIO, 'utf-8');
    expect(src).toContain("label: 'Conservative'");
    expect(src).toContain("label: 'Dip Buyer'");
    expect(src).toContain("label: 'Momentum'");
  });
});
