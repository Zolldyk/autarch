import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');

// --- Root package.json: start script exists ---

describe('package.json', () => {
  it('contains a "start" script', () => {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
    expect(pkg.scripts.start).toBeDefined();
    expect(typeof pkg.scripts.start).toBe('string');
  });
});

// --- .env.example: env var names, security warnings, defaults ---

describe('.env.example', () => {
  const envExamplePath = path.join(projectRoot, '.env.example');
  const content = () => readFileSync(envExamplePath, 'utf-8');

  it('exists at project root', () => {
    expect(existsSync(envExamplePath)).toBe(true);
  });

  it('contains all 5 required env var names (AC5)', () => {
    expect(content()).toContain('MASTER_SEED');
    expect(content()).toContain('DEMO_MODE');
    expect(content()).toContain('RPC_URL');
    expect(content()).toContain('RPC_ENDPOINTS');
    expect(content()).toContain('PORT');
  });

  it('contains security warnings (AC5)', () => {
    expect(content()).toContain('NEVER');
    expect(content()).toContain('DEMO ONLY');
  });

  it('documents safe defaults for RPC_URL and PORT (AC5)', () => {
    expect(content()).toMatch(/devnet\.solana/);
    expect(content()).toMatch(/3000/);
  });

  it('documents MASTER_SEED priority over DEMO_MODE (AC6)', () => {
    expect(content()).toMatch(/MASTER_SEED.*prior|prior.*MASTER_SEED/is);
  });

  it('does NOT contain outdated var names', () => {
    expect(content()).not.toContain('SOLANA_RPC_URL');
    expect(content()).not.toContain('SEED_PHRASE');
  });
});

// --- README.md: onboarding paths and content ---

describe('README.md', () => {
  const readmePath = path.join(projectRoot, 'README.md');
  const content = () => readFileSync(readmePath, 'utf-8');

  it('exists at project root and is non-empty (AC1)', () => {
    expect(existsSync(readmePath)).toBe(true);
    expect(content().length).toBeGreaterThan(0);
  });

  it('contains the three time-based path labels (AC1)', () => {
    expect(content()).toMatch(/2[- ]minute/i);
    expect(content()).toMatch(/5[- ]minute/i);
    expect(content()).toMatch(/10[- ]minute/i);
  });

  it('contains key commands (AC2, AC3, AC4)', () => {
    expect(content()).toMatch(/(?:npm|pnpm) run demo/);
    expect(content()).toMatch(/(?:npm|pnpm) run interactive/);
    expect(content()).toMatch(/(?:npm|pnpm) start/);
  });

  it('2-min path: zero config messaging (AC2)', () => {
    expect(content()).toMatch(/no\s+config/i);
  });

  it('5-min path: reasoning traces and hot-reload (AC3)', () => {
    expect(content()).toMatch(/reason/i);
    expect(content()).toMatch(/hot[- ]reload/i);
  });

  it('5-min path: on-chain verification via Explorer link (AC3)', () => {
    expect(content()).toMatch(/explorer/i);
  });

  it('10-min path: own seed and custom rules (AC4)', () => {
    expect(content()).toMatch(/your own.*seed|your.*mnemonic/i);
    expect(content()).toMatch(/custom.*rules|rules.*custom/i);
  });

  it('10-min path: references SKILLS.md (AC4)', () => {
    expect(content()).toContain('SKILLS.md');
  });

  it('references .env.example (AC5)', () => {
    expect(content()).toContain('.env.example');
  });

  it('documents cp .env.example .env workflow (AC6)', () => {
    expect(content()).toMatch(/cp\s+\.env\.example\s+\.env/);
  });
});
