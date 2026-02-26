import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const CORE_SRC = join(ROOT, 'packages', 'core', 'src');

/** Read a file relative to project root. */
function readProject(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

/** List all .ts source files in core/src. */
function coreSrcFiles(): string[] {
  return readdirSync(CORE_SRC).filter((f) => f.endsWith('.ts'));
}

// ─── Claim 2: No Key Logging ─────────────────────────────────────────────────

describe('SECURITY.md Claim 2: No key logging', () => {
  it('no console statement in core/src references key-derived variables', () => {
    const files = coreSrcFiles();
    const keyTerms = /key|seed|private|secret|mnemonic/i;
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(join(CORE_SRC, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/console\.(log|warn|error|info|debug)/.test(line) && keyTerms.test(line)) {
          violations.push(`${file}:${String(i + 1)}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('the only console.log in core/src is the treasury balance message', () => {
    const files = coreSrcFiles();
    const consoleCalls: string[] = [];

    for (const file of files) {
      const content = readFileSync(join(CORE_SRC, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/console\.(log|warn|error|info|debug)/.test(lines[i])) {
          consoleCalls.push(`${file}:${String(i + 1)}: ${lines[i].trim()}`);
        }
      }
    }

    // Exactly one console statement — the treasury balance log
    expect(consoleCalls.length).toBe(1);
    expect(consoleCalls[0]).toContain('Treasury already funded');
  });
});

// ─── Claim 3: Key Isolation Boundary ─────────────────────────────────────────

describe('SECURITY.md Claim 3: Key isolation boundary', () => {
  const cryptoLibs = [
    '@solana/kit', '@solana/', '@scure/', 'micro-key-producer',
    'node:crypto', 'tweetnacl', '@noble/', 'elliptic', 'bn.js', 'ed2curve',
  ];

  it('agent package.json has zero crypto dependencies', () => {
    const pkg = readProject('packages/agent/package.json');
    for (const lib of cryptoLibs) {
      expect(pkg).not.toContain(lib);
    }
  });

  it('demo package.json has zero crypto dependencies', () => {
    const pkg = readProject('packages/demo/package.json');
    for (const lib of cryptoLibs) {
      expect(pkg).not.toContain(lib);
    }
  });

  it('agent package.json depends only on @autarch/core and ajv', () => {
    const pkg = JSON.parse(readProject('packages/agent/package.json'));
    const deps = Object.keys(pkg.dependencies ?? {}).sort();
    expect(deps).toEqual(['@autarch/core', 'ajv']);
  });

  it('demo package.json depends only on @autarch/agent, @autarch/core, and express', () => {
    const pkg = JSON.parse(readProject('packages/demo/package.json'));
    const deps = Object.keys(pkg.dependencies ?? {}).sort();
    expect(deps).toEqual(['@autarch/agent', '@autarch/core', 'express']);
  });

  it('ESLint config has no-restricted-imports rules for agent package', () => {
    const config = readProject('eslint.config.ts');
    expect(config).toContain("files: ['packages/agent/src/**/*.ts']");
    expect(config).toContain('no-restricted-imports');
    expect(config).toContain('@solana/kit');
    expect(config).toContain('@scure/*');
    expect(config).toContain('micro-key-producer');
  });

  it('ESLint config has no-restricted-imports rules for demo package', () => {
    const config = readProject('eslint.config.ts');
    expect(config).toContain("files: ['packages/demo/src/**/*.ts']");
    expect(config).toContain('no-restricted-imports');
    // Both agent and demo blocks exist with crypto restrictions
    const demoBlock = config.indexOf("files: ['packages/demo/src/**/*.ts']");
    const afterDemo = config.substring(demoBlock);
    expect(afterDemo).toContain('@solana/kit');
    expect(afterDemo).toContain('@scure/*');
  });
});

// ─── Claim 4: Memory-Only Keys ───────────────────────────────────────────────

describe('SECURITY.md Claim 4: Memory-only keys', () => {
  it('core/src has zero file-write operations (writeFile, writeFileSync, appendFile, createWriteStream)', () => {
    const files = coreSrcFiles();
    const writePatterns = /writeFile|writeFileSync|appendFile|createWriteStream/;
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(join(CORE_SRC, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (writePatterns.test(lines[i])) {
          violations.push(`${file}:${String(i + 1)}: ${lines[i].trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('core/src has zero imports of fs write functions', () => {
    const files = coreSrcFiles();
    const fsImportPattern = /import.*(?:writeFile|appendFile|createWriteStream)/;
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(join(CORE_SRC, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (fsImportPattern.test(lines[i])) {
          violations.push(`${file}:${String(i + 1)}: ${lines[i].trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// ─── Seed Handling ───────────────────────────────────────────────────────────

describe('SECURITY.md Seed handling', () => {
  it('loadSeed reads seed exclusively from process.env.MASTER_SEED', () => {
    const config = readProject('packages/core/src/config.ts');
    expect(config).toContain('process.env.MASTER_SEED');
    // No other env vars for seed, no CLI args, no file reads
    expect(config).not.toContain('process.argv');
    expect(config).not.toContain('readFileSync');
    expect(config).not.toContain('readline');
  });

  it('.env is excluded from git', () => {
    const gitignore = readProject('.gitignore');
    expect(gitignore).toContain('.env');
  });

  it('demo seed constant is clearly marked as demo-only', () => {
    const constants = readProject('packages/core/src/constants.ts');
    expect(constants).toContain('DEMO ONLY');
    expect(constants).toContain('DO NOT USE WITH REAL FUNDS');
    expect(constants).toContain('publicly known');
  });

  it('DEMO_SEED is not re-exported from core public API', () => {
    const indexFile = readProject('packages/core/src/index.ts');
    expect(indexFile).not.toContain('DEMO_SEED');
  });

  it('loadSeed falls back to demo seed only when DEMO_MODE=true', () => {
    const config = readProject('packages/core/src/config.ts');
    expect(config).toContain("process.env.DEMO_MODE === 'true'");
  });

  it('loadSeed crashes with descriptive error when no seed and no demo mode', () => {
    const config = readProject('packages/core/src/config.ts');
    expect(config).toContain('MASTER_SEED environment variable is required');
  });
});

// ─── Core Public API Surface ─────────────────────────────────────────────────

describe('SECURITY.md Core public API surface', () => {
  it('index.ts exports exactly 3 functions: createAutarchWallet, loadSeed, createRpcClient', () => {
    const indexFile = readProject('packages/core/src/index.ts');
    const functionExports = indexFile.match(/export \{ \w+ \} from/g) ?? [];
    const exportedNames = functionExports.map((line: string) => {
      const match = line.match(/export \{ (\w+) \}/);
      return match ? match[1] : '';
    });
    expect(exportedNames.sort()).toEqual(['createAutarchWallet', 'createRpcClient', 'loadSeed']);
  });

  it('index.ts does not export deriveKeypair', () => {
    const indexFile = readProject('packages/core/src/index.ts');
    expect(indexFile).not.toContain('deriveKeypair');
  });

  it('AgentWallet interface has exactly 2 members: address and signTransaction', () => {
    const types = readProject('packages/core/src/types.ts');
    // Extract the AgentWallet interface block
    const agentWalletMatch = types.match(/interface AgentWallet \{([^}]+)\}/);
    expect(agentWalletMatch).not.toBeNull();
    const body = agentWalletMatch![1];
    const members = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('*') && !l.startsWith('/'));
    expect(members.length).toBe(2);
    expect(members.some((m) => m.includes('address'))).toBe(true);
    expect(members.some((m) => m.includes('signTransaction'))).toBe(true);
  });

  it('wallet-core.ts uses Object.freeze on both AgentWallet and AutarchWallet returns', () => {
    const walletCore = readProject('packages/core/src/wallet-core.ts');
    const freezeCount = (walletCore.match(/Object\.freeze\(/g) ?? []).length;
    expect(freezeCount).toBeGreaterThanOrEqual(2);
  });
});
