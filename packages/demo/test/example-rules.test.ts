import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { validateAgentConfig } from '@autarch/agent';

const rulesDir = path.resolve(import.meta.dirname, '..', '..', '..', 'examples', 'rules');

function loadConfig(filename: string) {
  return JSON.parse(readFileSync(path.join(rulesDir, filename), 'utf-8'));
}

// --- 5.1: Schema validation ---

describe('schema validation (AC4)', () => {
  const configs = ['conservative.json', 'dip-buyer.json', 'momentum.json'];

  for (const file of configs) {
    it(`${file} passes validateAgentConfig()`, () => {
      const result = validateAgentConfig(loadConfig(file));
      expect(result.valid).toBe(true);
    });
  }
});

// --- 5.2: Conservative single-condition rules ---

describe('conservative.json structure (AC1)', () => {
  it('every rule has exactly 1 condition', () => {
    const config = loadConfig('conservative.json');
    for (const rule of config.rules) {
      expect(rule.conditions).toHaveLength(1);
    }
  });
});

// --- 5.3: Dip-buyer OR logic ---

describe('dip-buyer.json OR logic (AC2)', () => {
  it('at least one rule has conditions with logic "OR"', () => {
    const config = loadConfig('dip-buyer.json');
    const hasOR = config.rules.some((rule: any) =>
      rule.conditions.some((c: any) => c.logic === 'OR'),
    );
    expect(hasOR).toBe(true);
  });
});

// --- 5.4: Dip-buyer compound AND ---

describe('dip-buyer.json compound AND (AC2)', () => {
  it('at least one rule has 3+ AND conditions', () => {
    const config = loadConfig('dip-buyer.json');
    const hasCompoundAND = config.rules.some((rule: any) => {
      const andConditions = rule.conditions.filter(
        (c: any) => c.logic === 'AND' || c.logic === undefined,
      );
      return andConditions.length >= 3;
    });
    expect(hasCompoundAND).toBe(true);
  });
});

// --- 5.5: Momentum peer dependency ---

describe('momentum.json peer dependency (AC3)', () => {
  it('at least one rule has a condition field starting with "peer."', () => {
    const config = loadConfig('momentum.json');
    const hasPeer = config.rules.some((rule: any) =>
      rule.conditions.some((c: any) => c.field.startsWith('peer.')),
    );
    expect(hasPeer).toBe(true);
  });
});

// --- 5.6: Momentum NOT logic ---

describe('momentum.json NOT logic (AC3)', () => {
  it('at least one rule has a condition with logic "NOT"', () => {
    const config = loadConfig('momentum.json');
    const hasNOT = config.rules.some((rule: any) =>
      rule.conditions.some((c: any) => c.logic === 'NOT'),
    );
    expect(hasNOT).toBe(true);
  });
});

// --- 5.7: Behavioral diversity — cooldowns ---

describe('behavioral diversity: cooldowns (AC5)', () => {
  it('conservative has longest avg cooldown, momentum has shortest', () => {
    const conservative = loadConfig('conservative.json');
    const momentum = loadConfig('momentum.json');

    const avgCooldown = (config: any) => {
      const total = config.rules.reduce(
        (sum: number, r: any) => sum + r.cooldownSeconds,
        0,
      );
      return total / config.rules.length;
    };

    expect(avgCooldown(conservative)).toBeGreaterThan(avgCooldown(momentum));
  });
});

// --- 5.8: Behavioral diversity — amounts ---

describe('behavioral diversity: amounts (AC5)', () => {
  it('conservative has smallest max amount, momentum has largest', () => {
    const conservative = loadConfig('conservative.json');
    const momentum = loadConfig('momentum.json');

    const maxAmount = (config: any) =>
      Math.max(...config.rules.map((r: any) => r.amount));

    expect(maxAmount(conservative)).toBeLessThan(maxAmount(momentum));
  });
});

// --- 5.9: README exists ---

describe('examples/rules/README.md (AC1)', () => {
  it('README.md exists and is non-empty', () => {
    const readmePath = path.join(rulesDir, 'README.md');
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});

// --- Config identity verification (AC1, AC2, AC3) ---

describe('config identity fields', () => {
  it('conservative.json has name "Conservative" and strategy "Low Risk"', () => {
    const config = loadConfig('conservative.json');
    expect(config.name).toBe('Conservative');
    expect(config.strategy).toBe('Low Risk');
  });

  it('dip-buyer.json has name "Dip Buyer" and strategy "Buy the Dip"', () => {
    const config = loadConfig('dip-buyer.json');
    expect(config.name).toBe('Dip Buyer');
    expect(config.strategy).toBe('Buy the Dip');
  });

  it('momentum.json has name "Momentum" and strategy "Follow the Pack"', () => {
    const config = loadConfig('momentum.json');
    expect(config.name).toBe('Momentum');
    expect(config.strategy).toBe('Follow the Pack');
  });

  it('all configs set intervalMs to 5000', () => {
    for (const file of ['conservative.json', 'dip-buyer.json', 'momentum.json']) {
      const config = loadConfig(file);
      expect(config.intervalMs).toBe(5000);
    }
  });
});

// --- Field name regression guard (critical bug fix) ---

describe('field name format (regression guard)', () => {
  const VALID_FIELDS = new Set([
    'price', 'price_change', 'price_change_1m', 'price_change_5m',
    'price_drop', 'price_rise', 'volume_change', 'volume_change_1m',
    'volume_spike', 'balance', 'last_trade_result', 'consecutive_errors',
    'tick_count', 'status', 'position_size', 'consecutive_wins',
    'last_trade_amount',
  ]);

  for (const file of ['conservative.json', 'dip-buyer.json', 'momentum.json']) {
    it(`${file} uses only valid underscore-format or peer.* field names`, () => {
      const config = loadConfig(file);
      for (const rule of config.rules) {
        for (const cond of rule.conditions) {
          if (cond.field.startsWith('peer.')) {
            expect(cond.field).toMatch(/^peer\.\w+\.\w+$/);
          } else {
            expect(VALID_FIELDS.has(cond.field)).toBe(true);
          }
        }
      }
    });
  }
});

// --- Weighted scoring cooperation (AC2) ---

describe('dip-buyer.json weighted scoring (AC2)', () => {
  it('no single buy rule has weight >= 70 (requires cooperation)', () => {
    const config = loadConfig('dip-buyer.json');
    const buyRules = config.rules.filter((r: any) => r.action === 'buy');
    for (const rule of buyRules) {
      expect(rule.weight).toBeLessThan(70);
    }
  });

  it('combined buy rule weights exceed threshold of 70', () => {
    const config = loadConfig('dip-buyer.json');
    const totalBuyWeight = config.rules
      .filter((r: any) => r.action === 'buy')
      .reduce((sum: number, r: any) => sum + r.weight, 0);
    expect(totalBuyWeight).toBeGreaterThanOrEqual(70);
  });
});

// --- Action diversity (AC5) ---

describe('action diversity (AC5)', () => {
  for (const file of ['conservative.json', 'dip-buyer.json', 'momentum.json']) {
    it(`${file} has both buy and sell rules`, () => {
      const config = loadConfig(file);
      const actions = new Set(config.rules.map((r: any) => r.action));
      expect(actions.has('buy')).toBe(true);
      expect(actions.has('sell')).toBe(true);
    });
  }
});

// --- Full behavioral diversity ordering (AC5) ---

describe('behavioral diversity: full ordering (AC5)', () => {
  it('avg cooldowns: conservative > dip-buyer > momentum', () => {
    const configs = ['conservative.json', 'dip-buyer.json', 'momentum.json'].map(loadConfig);
    const avgCooldown = (config: any) =>
      config.rules.reduce((sum: number, r: any) => sum + r.cooldownSeconds, 0) / config.rules.length;
    const [conserv, dip, mom] = configs.map(avgCooldown);
    expect(conserv).toBeGreaterThan(dip);
    expect(dip).toBeGreaterThan(mom);
  });

  it('max amounts: conservative < dip-buyer < momentum', () => {
    const configs = ['conservative.json', 'dip-buyer.json', 'momentum.json'].map(loadConfig);
    const maxAmount = (config: any) => Math.max(...config.rules.map((r: any) => r.amount));
    const [conserv, dip, mom] = configs.map(maxAmount);
    expect(conserv).toBeLessThan(dip);
    expect(dip).toBeLessThan(mom);
  });
});
