import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..', '..');
const skillsPath = resolve(projectRoot, 'SKILLS.md');

/** Type-only exports that won't appear in runtime Object.keys() */
const TYPE_ONLY_EXPORTS = [
  'SeedConfig',
  'AgentWallet',
  'AutarchWallet',
  'Balance',
  'WalletConfig',
  'RpcConfig',
  'ResilientRpcConfig',
  'TransactionToSign',
  'TransactionResult',
  'ConnectionMode',
];

let skillsContent: string;
let jsonBlock: Record<string, unknown>;
let coreSection: {
  exports: {
    functions: Array<{ name: string; signature: string; params: unknown[]; returns: unknown; description: string; example?: string; errors?: string[] }>;
    interfaces: Array<{ name: string; description: string; properties?: unknown[]; methods?: unknown[] }>;
    types: Array<{ name: string; definition: string }>;
    constants: Array<{ name: string; type: string; value: unknown; description: string }>;
  };
};

function extractJsonBlock(markdown: string): string {
  const heading = '## Machine-Readable API Reference';
  const headingIndex = markdown.indexOf(heading);
  if (headingIndex === -1) {
    throw new Error('Missing "## Machine-Readable API Reference" heading in SKILLS.md');
  }

  const afterHeading = markdown.slice(headingIndex + heading.length);
  const jsonStart = afterHeading.indexOf('```json');
  if (jsonStart === -1) {
    throw new Error('No ```json fence found after Machine-Readable API Reference heading');
  }

  const contentStart = afterHeading.indexOf('\n', jsonStart) + 1;
  const jsonEnd = afterHeading.indexOf('```', contentStart);
  if (jsonEnd === -1) {
    throw new Error('Unclosed ```json fence in SKILLS.md');
  }

  return afterHeading.slice(contentStart, jsonEnd);
}

beforeAll(async () => {
  skillsContent = await readFile(skillsPath, 'utf-8');
  const raw = extractJsonBlock(skillsContent);
  jsonBlock = JSON.parse(raw) as Record<string, unknown>;
  coreSection = (jsonBlock as any).packages['@autarch/core'];
});

describe('SKILLS.md — @autarch/core coverage', () => {
  it('JSON block is valid parseable JSON', () => {
    expect(jsonBlock).toBeDefined();
    expect(typeof jsonBlock).toBe('object');
    expect(jsonBlock).toHaveProperty('version');
    expect(jsonBlock).toHaveProperty('packages');
  });

  it('every public export from core/src/index.ts has a SKILLS.md JSON entry', async () => {
    const coreModule = await import('../src/index.js');
    const runtimeExports = Object.keys(coreModule);

    const allJsonNames = [
      ...coreSection.exports.functions.map(f => f.name),
      ...coreSection.exports.interfaces.map(i => i.name),
      ...coreSection.exports.types.map(t => t.name),
      ...coreSection.exports.constants.map(c => c.name),
    ];

    for (const exportName of runtimeExports) {
      expect(
        allJsonNames.includes(exportName),
        `Runtime export "${exportName}" is missing from SKILLS.md JSON`,
      ).toBe(true);
    }
  });

  it('type-only exports are documented in JSON interfaces or types', () => {
    const interfaceNames = coreSection.exports.interfaces.map(i => i.name);
    const typeNames = coreSection.exports.types.map(t => t.name);
    const allTypeNames = [...interfaceNames, ...typeNames];

    for (const typeName of TYPE_ONLY_EXPORTS) {
      expect(
        allTypeNames.includes(typeName),
        `Type-only export "${typeName}" is missing from SKILLS.md JSON`,
      ).toBe(true);
    }
  });

  it('no SKILLS.md @autarch/core entries reference non-existent exports', async () => {
    const coreModule = await import('../src/index.js');
    const runtimeExports = new Set(Object.keys(coreModule));
    const typeOnlySet = new Set(TYPE_ONLY_EXPORTS);

    const allJsonNames = [
      ...coreSection.exports.functions.map(f => f.name),
      ...coreSection.exports.interfaces.map(i => i.name),
      ...coreSection.exports.types.map(t => t.name),
      ...coreSection.exports.constants.map(c => c.name),
    ];

    for (const name of allJsonNames) {
      expect(
        runtimeExports.has(name) || typeOnlySet.has(name),
        `SKILLS.md JSON entry "${name}" does not exist in @autarch/core exports`,
      ).toBe(true);
    }
  });

  it('function entries have name, signature, params, returns, and description', () => {
    for (const fn of coreSection.exports.functions) {
      expect(fn.name, `Function missing name`).toBeTruthy();
      expect(fn.signature, `Function "${fn.name}" missing signature`).toBeTruthy();
      expect(fn.params, `Function "${fn.name}" missing params`).toBeDefined();
      expect(fn.returns, `Function "${fn.name}" missing returns`).toBeDefined();
      expect(fn.description, `Function "${fn.name}" missing description`).toBeTruthy();
    }
  });

  it('constant entries have name, type, value, and description', () => {
    for (const c of coreSection.exports.constants) {
      expect(c.name, 'Constant missing name').toBeTruthy();
      expect(c.type, `Constant "${c.name}" missing type`).toBeTruthy();
      expect(c.value, `Constant "${c.name}" missing value`).toBeDefined();
      expect(c.description, `Constant "${c.name}" missing description`).toBeTruthy();
    }
  });

  it('function entries include example fields (AC#3)', () => {
    for (const fn of coreSection.exports.functions) {
      expect(
        (fn as any).example,
        `Function "${fn.name}" missing example field`,
      ).toBeTruthy();
    }
  });

  it('interface entries have properties or methods defined', () => {
    for (const iface of coreSection.exports.interfaces) {
      const hasProperties = Array.isArray((iface as any).properties) && (iface as any).properties.length > 0;
      const hasMethods = Array.isArray((iface as any).methods) && (iface as any).methods.length > 0;
      expect(
        hasProperties || hasMethods,
        `Interface "${iface.name}" has no properties or methods`,
      ).toBe(true);
    }
  });

  it('human-readable sections exist for @autarch/core (AC#6)', () => {
    expect(skillsContent).toContain('## @autarch/core');
    expect(skillsContent).toContain('## Quick Start');
    expect(skillsContent).toContain('## Machine-Readable API Reference');
    expect(skillsContent).toContain('### createAutarchWallet');
    expect(skillsContent).toContain('### loadSeed');
    expect(skillsContent).toContain('### createRpcClient');
  });
});
