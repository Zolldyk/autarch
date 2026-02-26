import { describe, it, expect } from 'vitest';
import { validateAgentConfig, formatValidationErrors } from '../src/schema.js';
import type { ErrorObject } from 'ajv';

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

// ─── formatValidationErrors Tests ─────────────────────────────────────

describe('formatValidationErrors', () => {
  /** Helper to create a minimal ajv ErrorObject for testing. */
  function makeError(overrides: Partial<ErrorObject> & { keyword: string; params: Record<string, unknown> }): ErrorObject {
    return {
      instancePath: '',
      schemaPath: '#/required',
      message: 'is invalid',
      ...overrides,
    } as ErrorObject;
  }

  it('formats "required" keyword at root level', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'required', instancePath: '', params: { missingProperty: 'name' } }),
    ]);
    expect(errors).toEqual(['Missing required property: name']);
  });

  it('formats "required" keyword at nested path', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'required', instancePath: '/rules/0', params: { missingProperty: 'action' } }),
    ]);
    expect(errors).toEqual(['Missing required property: rules[0].action']);
  });

  it('formats "enum" keyword with allowed values', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'enum', instancePath: '/rules/0/action', params: { allowedValues: ['buy', 'sell', 'none'] } }),
    ]);
    expect(errors).toEqual(['rules[0].action must be one of: buy, sell, none']);
  });

  it('formats "minItems" keyword', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'minItems', instancePath: '/rules', params: { limit: 1 } }),
    ]);
    expect(errors).toEqual(['rules must have at least 1 item(s)']);
  });

  it('formats "minLength" keyword', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'minLength', instancePath: '/name', params: { limit: 1 } }),
    ]);
    expect(errors).toEqual(['name must not be empty']);
  });

  it('formats "minimum" keyword', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'minimum', instancePath: '/intervalMs', params: { limit: 1000 } }),
    ]);
    expect(errors).toEqual(['intervalMs must be >= 1000']);
  });

  it('formats "exclusiveMinimum" keyword', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'exclusiveMinimum', instancePath: '/rules/0/amount', params: { limit: 0 } }),
    ]);
    expect(errors).toEqual(['rules[0].amount must be > 0']);
  });

  it('formats "maximum" keyword', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'maximum', instancePath: '/rules/0/weight', params: { limit: 100 } }),
    ]);
    expect(errors).toEqual(['rules[0].weight must be <= 100']);
  });

  it('formats "type" keyword', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'type', instancePath: '/name', params: { type: 'string' } }),
    ]);
    expect(errors).toEqual(['name must be of type string']);
  });

  it('formats "additionalProperties" keyword', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'additionalProperties', instancePath: '', params: { additionalProperty: 'extra' } }),
    ]);
    expect(errors).toEqual([' has unknown property: extra']);
  });

  it('formats "oneOf" keyword', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'oneOf', instancePath: '/rules/0/conditions/0/threshold', params: {} }),
    ]);
    expect(errors).toEqual(['rules[0].conditions[0].threshold must be a number or string']);
  });

  it('uses fallback for unknown keyword', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'pattern', instancePath: '/name', params: { pattern: '^[a-z]+$' }, message: 'must match pattern' }),
    ]);
    expect(errors).toEqual(['name must match pattern']);
  });

  it('handles fallback when message is undefined', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'custom', instancePath: '/field', params: {}, message: undefined }),
    ]);
    expect(errors).toEqual(['field is invalid']);
  });

  it('formats multiple errors at once', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'required', instancePath: '', params: { missingProperty: 'name' } }),
      makeError({ keyword: 'minItems', instancePath: '/rules', params: { limit: 1 } }),
      makeError({ keyword: 'type', instancePath: '/strategy', params: { type: 'string' } }),
    ]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('Missing required property: name');
    expect(errors[1]).toContain('rules must have at least 1 item');
    expect(errors[2]).toContain('strategy must be of type string');
  });

  it('formats deeply nested condition paths correctly', () => {
    const errors = formatValidationErrors([
      makeError({ keyword: 'enum', instancePath: '/rules/2/conditions/1/operator', params: { allowedValues: ['>', '<'] } }),
    ]);
    expect(errors).toEqual(['rules[2].conditions[1].operator must be one of: >, <']);
  });
});
