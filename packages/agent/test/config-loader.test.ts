import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAgentConfig } from '../src/config-loader.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `autarch-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Write a JSON config to a temp file and return the path. */
async function writeConfig(filename: string, data: unknown): Promise<string> {
  const filePath = join(tmpDir, filename);
  await writeFile(filePath, JSON.stringify(data), 'utf-8');
  return filePath;
}

/** Minimal valid config object. */
function validConfig() {
  return {
    name: 'Test Agent',
    strategy: 'Test Strategy',
    rules: [
      {
        name: 'rule-1',
        conditions: [
          { field: 'price_drop', operator: '>', threshold: 5 },
        ],
        action: 'buy',
        amount: 0.1,
        weight: 50,
        cooldownSeconds: 60,
      },
    ],
  };
}

describe('loadAgentConfig', () => {
  // 7.2 — loads valid JSON file and returns parsed AgentConfig
  it('loads a valid JSON file and returns parsed AgentConfig', async () => {
    const filePath = await writeConfig('valid.json', validConfig());
    const config = await loadAgentConfig(filePath);
    expect(config.name).toBe('Test Agent');
    expect(config.strategy).toBe('Test Strategy');
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].name).toBe('rule-1');
  });

  // 7.3 — applies default intervalMs when not specified
  it('applies default intervalMs (60000) when not specified', async () => {
    const filePath = await writeConfig('no-interval.json', validConfig());
    const config = await loadAgentConfig(filePath);
    expect(config.intervalMs).toBe(60000);
  });

  // 7.4 — applies default logic: 'AND' to conditions
  it('applies default logic AND to conditions without explicit logic', async () => {
    const filePath = await writeConfig('no-logic.json', validConfig());
    const config = await loadAgentConfig(filePath);
    expect(config.rules[0].conditions[0].logic).toBe('AND');
  });

  // 7.5 — preserves explicit intervalMs
  it('preserves explicit intervalMs when specified', async () => {
    const data = { ...validConfig(), intervalMs: 30000 };
    const filePath = await writeConfig('explicit-interval.json', data);
    const config = await loadAgentConfig(filePath);
    expect(config.intervalMs).toBe(30000);
  });

  // 7.6 — invalid JSON throws with file path
  it('throws on invalid JSON with file path in message', async () => {
    const filePath = join(tmpDir, 'bad.json');
    await writeFile(filePath, '{ broken json !!!', 'utf-8');
    await expect(loadAgentConfig(filePath)).rejects.toBeInstanceOf(SyntaxError);
    await expect(loadAgentConfig(filePath)).rejects.toThrow(/Invalid JSON in config file/);
    await expect(loadAgentConfig(filePath)).rejects.toThrow(filePath);
    await expect(loadAgentConfig(filePath)).rejects.toThrow(/Unexpected|JSON/);
  });

  // 7.7 — file not found
  it('throws on file not found with clear path in message', async () => {
    const filePath = join(tmpDir, 'nonexistent.json');
    await expect(loadAgentConfig(filePath)).rejects.toThrow(/Cannot read config file/);
    await expect(loadAgentConfig(filePath)).rejects.toThrow(filePath);
  });

  // 7.8 — valid JSON but invalid schema
  it('throws on valid JSON but invalid schema with all validation errors', async () => {
    const filePath = await writeConfig('invalid-schema.json', { name: 'X' });
    await expect(loadAgentConfig(filePath)).rejects.toThrow(/Invalid agent config/);
    await expect(loadAgentConfig(filePath)).rejects.toThrow(/strategy/);
    await expect(loadAgentConfig(filePath)).rejects.toThrow(/rules/);
  });

  // 7.9 — returned config is structurally correct
  it('returns structurally correct config with all required fields after defaults', async () => {
    const filePath = await writeConfig('full.json', validConfig());
    const config = await loadAgentConfig(filePath);

    // Top-level fields
    expect(typeof config.name).toBe('string');
    expect(typeof config.strategy).toBe('string');
    expect(typeof config.intervalMs).toBe('number');
    expect(Array.isArray(config.rules)).toBe(true);

    // Rule fields
    const rule = config.rules[0];
    expect(typeof rule.name).toBe('string');
    expect(Array.isArray(rule.conditions)).toBe(true);
    expect(typeof rule.action).toBe('string');
    expect(typeof rule.amount).toBe('number');
    expect(typeof rule.weight).toBe('number');
    expect(typeof rule.cooldownSeconds).toBe('number');

    // Condition fields
    const cond = rule.conditions[0];
    expect(typeof cond.field).toBe('string');
    expect(typeof cond.operator).toBe('string');
    expect(cond.threshold).toBeDefined();
    expect(typeof cond.logic).toBe('string');
  });
});
