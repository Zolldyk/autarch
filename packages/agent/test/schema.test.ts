import { describe, it, expect } from 'vitest';
import { validateAgentConfig } from '../src/schema.js';

/** Minimal valid config for reuse across tests. */
function validConfig() {
  return {
    name: 'Test Agent',
    strategy: 'Buy the dip',
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

describe('validateAgentConfig', () => {
  // 6.2 — valid config with all fields passes
  it('accepts a valid config with all fields', () => {
    const config = {
      name: 'Dip Buyer',
      strategy: 'Buy on significant dips',
      intervalMs: 30000,
      rules: [
        {
          name: 'Smart dip buyer',
          conditions: [
            { field: 'price_drop', operator: '>', threshold: 5, logic: 'AND' },
            { field: 'volume_spike', operator: '>', threshold: 200, logic: 'OR' },
          ],
          action: 'buy',
          amount: 0.12,
          weight: 85,
          cooldownSeconds: 120,
        },
        {
          name: 'Take profit',
          conditions: [
            { field: 'price_change', operator: '>', threshold: 10 },
          ],
          action: 'sell',
          amount: 0.05,
          weight: 70,
          cooldownSeconds: 300,
        },
      ],
    };

    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
  });

  // 6.3 — minimal required fields passes
  it('accepts a valid config with minimal required fields', () => {
    const result = validateAgentConfig(validConfig());
    expect(result.valid).toBe(true);
  });

  // 6.4 — missing name
  it('rejects missing name with error pointing to root level', () => {
    const { name: _, ...config } = validConfig();
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('Missing required property: name')]),
      );
    }
  });

  // 6.5 — missing strategy
  it('rejects missing strategy with error pointing to root level', () => {
    const { strategy: _, ...config } = validConfig();
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('Missing required property: strategy')]),
      );
    }
  });

  // 6.6 — missing rules
  it('rejects missing rules with error pointing to root level', () => {
    const { rules: _, ...config } = validConfig();
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('Missing required property: rules')]),
      );
    }
  });

  // 6.7 — empty rules array
  it('rejects empty rules array (minItems 1)', () => {
    const config = { ...validConfig(), rules: [] };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('must have at least 1 item')]),
      );
    }
  });

  // 6.8 — invalid action
  it('rejects invalid action value with allowed values in error', () => {
    const config = validConfig();
    (config.rules[0] as Record<string, unknown>).action = 'hold';
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/action must be one of.*buy.*sell.*transfer.*none/)]),
      );
    }
  });

  // 6.9 — invalid operator
  it('rejects invalid operator value with allowed operators in error', () => {
    const config = validConfig();
    (config.rules[0].conditions[0] as Record<string, unknown>).operator = '~=';
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/operator must be one of/)]),
      );
    }
  });

  // 6.10 — missing required rule fields
  it('rejects missing required rule fields with specific errors', () => {
    const config = {
      name: 'Agent',
      strategy: 'Test',
      rules: [{ name: 'incomplete' }],
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('conditions'),
          expect.stringContaining('action'),
          expect.stringContaining('amount'),
          expect.stringContaining('weight'),
          expect.stringContaining('cooldownSeconds'),
        ]),
      );
    }
  });

  // 6.11 — amount 0 or negative
  it('rejects amount of 0 (exclusiveMinimum 0)', () => {
    const config = validConfig();
    (config.rules[0] as Record<string, unknown>).amount = 0;
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('amount must be > 0')]),
      );
    }
  });

  it('rejects negative amount', () => {
    const config = validConfig();
    (config.rules[0] as Record<string, unknown>).amount = -1;
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('amount must be > 0')]),
      );
    }
  });

  // 6.12 — weight outside 0-100
  it('rejects weight above 100', () => {
    const config = validConfig();
    (config.rules[0] as Record<string, unknown>).weight = 101;
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('weight must be <= 100')]),
      );
    }
  });

  it('rejects negative weight', () => {
    const config = validConfig();
    (config.rules[0] as Record<string, unknown>).weight = -1;
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('weight must be >= 0')]),
      );
    }
  });

  // 6.13 — negative cooldownSeconds
  it('rejects negative cooldownSeconds', () => {
    const config = validConfig();
    (config.rules[0] as Record<string, unknown>).cooldownSeconds = -1;
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('cooldownSeconds must be >= 0')]),
      );
    }
  });

  // 6.14 — intervalMs below 1000
  it('rejects intervalMs below 1000', () => {
    const config = { ...validConfig(), intervalMs: 500 };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('intervalMs must be >= 1000')]),
      );
    }
  });

  // 6.15 — optional intervalMs defaults (schema sets default, loader also handles)
  it('accepts config without intervalMs (optional field)', () => {
    const config = validConfig();
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
  });

  // 6.16 — logic field accepts AND, OR, NOT
  it('accepts AND logic value', () => {
    const config = validConfig();
    (config.rules[0].conditions[0] as Record<string, unknown>).logic = 'AND';
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
  });

  it('accepts OR logic value', () => {
    const config = validConfig();
    (config.rules[0].conditions[0] as Record<string, unknown>).logic = 'OR';
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
  });

  it('accepts NOT logic value', () => {
    const config = validConfig();
    (config.rules[0].conditions[0] as Record<string, unknown>).logic = 'NOT';
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
  });

  // 6.17 — invalid logic value
  it('rejects invalid logic value with clear error', () => {
    const config = validConfig();
    (config.rules[0].conditions[0] as Record<string, unknown>).logic = 'XOR';
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/logic must be one of.*AND.*OR.*NOT/)]),
      );
    }
  });

  // 6.18 — numeric threshold
  it('accepts condition with numeric threshold', () => {
    const config = validConfig();
    expect(config.rules[0].conditions[0].threshold).toBe(5);
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
  });

  // 6.19 — string threshold
  it('accepts condition with string threshold', () => {
    const config = validConfig();
    (config.rules[0].conditions[0] as Record<string, unknown>).threshold = 'failure';
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(true);
  });

  // 6.20 — multiple validation errors returned at once
  it('returns multiple validation errors at once (allErrors: true)', () => {
    const config = {
      name: '',
      strategy: '',
      rules: [],
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  // 6.21 — deeply nested error paths are readable
  it('produces readable deeply nested error paths', () => {
    const config = {
      name: 'Agent',
      strategy: 'Test',
      rules: [
        {
          name: 'rule-1',
          conditions: [
            { field: 'a', operator: '>', threshold: 1 },
            { field: 'b', operator: 'INVALID', threshold: 2 },
          ],
          action: 'buy',
          amount: 0.1,
          weight: 50,
          cooldownSeconds: 60,
        },
      ],
    };
    const result = validateAgentConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/rules\[0\]\.conditions\[1\]\.operator/)]),
      );
    }
  });
});
