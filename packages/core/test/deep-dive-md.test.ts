import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const DEEP_DIVE_PATH = resolve(ROOT, 'DEEP-DIVE.md');

/** Read a file relative to project root. */
function readProject(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8');
}

/**
 * Extract a fenced code block from DEEP-DIVE.md that starts with a specific
 * source comment (e.g., "// packages/agent/src/types.ts:213-227").
 * Returns the code content inside the fences.
 */
function extractCodeBlock(markdown: string, sourceComment: string): string {
  const idx = markdown.indexOf(sourceComment);
  if (idx === -1) {
    throw new Error(`Source comment not found in DEEP-DIVE.md: ${sourceComment}`);
  }

  // Walk backward to find the opening ``` fence
  const beforeComment = markdown.slice(0, idx);
  const fenceStart = beforeComment.lastIndexOf('```');
  if (fenceStart === -1) {
    throw new Error(`No opening fence found before: ${sourceComment}`);
  }

  // Find the closing ``` fence after the source comment
  const afterComment = markdown.slice(idx);
  const fenceEnd = afterComment.indexOf('```');
  if (fenceEnd === -1) {
    throw new Error(`No closing fence found after: ${sourceComment}`);
  }

  // Content starts after the opening fence line
  const fenceLineEnd = markdown.indexOf('\n', fenceStart);
  return markdown.slice(fenceLineEnd + 1, idx + fenceEnd).trim();
}

let deepDive: string;

beforeAll(() => {
  deepDive = readFileSync(DEEP_DIVE_PATH, 'utf-8');
});

// ─── Document Existence & Structure (AC#1) ────────────────────────────────

describe('DEEP-DIVE.md — existence and structure', () => {
  it('DEEP-DIVE.md exists at project root', () => {
    expect(existsSync(DEEP_DIVE_PATH)).toBe(true);
  });

  it('has a table of contents with anchor links', () => {
    expect(deepDive).toContain('## Table of Contents');
    expect(deepDive).toContain('(#architecture-overview)');
    expect(deepDive).toContain('(#why-not-llms)');
    expect(deepDive).toContain('(#production-hardening-path)');
    expect(deepDive).toContain('(#decision-system)');
    expect(deepDive).toContain('(#security-model)');
  });

  it('has all required top-level sections', () => {
    const requiredSections = [
      '## Overview',
      '## Architecture Overview',
      '## Security Model',
      '## Decision System',
      '## Why Not LLMs?',
      '## Production Hardening Path',
    ];
    for (const section of requiredSections) {
      expect(deepDive, `Missing section: ${section}`).toContain(section);
    }
  });

  it('cross-references SECURITY.md and SKILLS.md', () => {
    expect(deepDive).toContain('[SECURITY.md](SECURITY.md)');
    expect(deepDive).toContain('[SKILLS.md](SKILLS.md)');
  });
});

// ─── Architecture Section (AC#2) ──────────────────────────────────────────

describe('DEEP-DIVE.md — Architecture section', () => {
  it('explains 3-package monorepo boundaries', () => {
    expect(deepDive).toContain('### Three-Package Monorepo');
    expect(deepDive).toContain('@autarch/core');
    expect(deepDive).toContain('@autarch/agent');
    expect(deepDive).toContain('@autarch/demo');
  });

  it('includes import restriction table', () => {
    expect(deepDive).toContain('| Package | CAN Import');
    expect(deepDive).toContain('CANNOT Import');
    expect(deepDive).toContain('no-restricted-imports');
  });

  it('explains closure-based key isolation', () => {
    expect(deepDive).toContain('### Closure-Based Key Isolation');
    expect(deepDive).toContain('Object.freeze');
    expect(deepDive).toContain('factory function');
  });

  it('explains unidirectional state flow', () => {
    expect(deepDive).toContain('### Unidirectional State Flow');
    expect(deepDive).toContain('Agent Decision');
    expect(deepDive).toContain('SSE Broadcast');
    expect(deepDive).toContain('Dashboard Render');
  });

  it('explains two-tier event system', () => {
    expect(deepDive).toContain('### Two-Tier Event System');
    expect(deepDive).toContain('EventEmitter');
    expect(deepDive).toContain('agentLifecycle');
  });

  it('explains RPC state machine with three modes', () => {
    expect(deepDive).toContain('### RPC State Machine');
    expect(deepDive).toContain('normal');
    expect(deepDive).toContain('degraded');
    expect(deepDive).toContain('simulation');
    expect(deepDive).toContain('ConnectionMode');
  });

  it('includes seed-to-dashboard data flow diagram', () => {
    expect(deepDive).toContain('### Seed-to-Dashboard Data Flow');
    expect(deepDive).toContain('MASTER_SEED');
    expect(deepDive).toContain('BIP44 Derivation');
    expect(deepDive).toContain('AgentWallet Interface');
    expect(deepDive).toContain('DecisionTrace');
    expect(deepDive).toContain('Dashboard Render');
  });
});

// ─── Code Excerpt Accuracy (AC#2, AC#5) ───────────────────────────────────

describe('DEEP-DIVE.md — code excerpt accuracy', () => {
  it('DecisionModule interface excerpt matches source (types.ts:213-227)', () => {
    const source = readProject('packages/agent/src/types.ts');
    const sourceLines = source.split('\n');
    // Lines 213-227 (1-indexed)
    const sourceExcerpt = sourceLines.slice(212, 227).join('\n').trim();

    const docBlock = extractCodeBlock(deepDive, '// packages/agent/src/types.ts:213-227');
    // Strip the source comment line from the doc block
    const docContent = docBlock
      .split('\n')
      .filter(l => !l.startsWith('// packages/agent/src/types.ts:213-227'))
      .join('\n')
      .trim();

    expect(docContent).toBe(sourceExcerpt);
  });

  it('DecisionTrace interface excerpt matches source (types.ts:161-175)', () => {
    const source = readProject('packages/agent/src/types.ts');
    const sourceLines = source.split('\n');
    const sourceExcerpt = sourceLines.slice(160, 175).join('\n').trim();

    const docBlock = extractCodeBlock(deepDive, '// packages/agent/src/types.ts:161-175');
    const docContent = docBlock
      .split('\n')
      .filter(l => !l.startsWith('// packages/agent/src/types.ts:161-175'))
      .join('\n')
      .trim();

    expect(docContent).toBe(sourceExcerpt);
  });

  it('EvaluationContext interface excerpt matches source (types.ts:107-112)', () => {
    const source = readProject('packages/agent/src/types.ts');
    const sourceLines = source.split('\n');
    const sourceExcerpt = sourceLines.slice(106, 112).join('\n').trim();

    const docBlock = extractCodeBlock(deepDive, '// packages/agent/src/types.ts:107-112');
    const docContent = docBlock
      .split('\n')
      .filter(l => !l.startsWith('// packages/agent/src/types.ts:107-112'))
      .join('\n')
      .trim();

    expect(docContent).toBe(sourceExcerpt);
  });

  it('AgentWallet interface excerpt matches source (core/types.ts:32-36)', () => {
    const source = readProject('packages/core/src/types.ts');
    const sourceLines = source.split('\n');
    const sourceExcerpt = sourceLines.slice(31, 36).join('\n').trim();

    const docBlock = extractCodeBlock(deepDive, '// packages/core/src/types.ts:32-36');
    const docContent = docBlock
      .split('\n')
      .filter(l => !l.startsWith('// packages/core/src/types.ts:32-36'))
      .join('\n')
      .trim();

    expect(docContent).toBe(sourceExcerpt);
  });

  it('createAutarchWallet excerpt matches source (wallet-core.ts:34-40)', () => {
    const source = readProject('packages/core/src/wallet-core.ts');
    const sourceLines = source.split('\n');
    const sourceExcerpt = sourceLines.slice(33, 40).join('\n').trim();

    const docBlock = extractCodeBlock(deepDive, '// packages/core/src/wallet-core.ts:34-40');
    const docContent = docBlock
      .split('\n')
      .filter(l => !l.startsWith('// packages/core/src/wallet-core.ts:34-40'))
      .join('\n')
      .trim();

    expect(docContent).toBe(sourceExcerpt);
  });

  it('ConnectionMode type reference is accurate', () => {
    const source = readProject('packages/core/src/types.ts');
    expect(source).toContain("export type ConnectionMode = 'normal' | 'degraded' | 'simulation'");
    // DEEP-DIVE.md references this type
    expect(deepDive).toContain("'normal' | 'degraded' | 'simulation'");
  });
});

// ─── "Why Not LLMs?" Section (AC#3) ──────────────────────────────────────

describe('DEEP-DIVE.md — "Why Not LLMs?" section', () => {
  it('has all required subsections', () => {
    expect(deepDive).toContain('### The Problem with LLM-Driven Financial Execution');
    expect(deepDive).toContain('### Industry Evidence');
    expect(deepDive).toContain('### Side-by-Side: Rule-Based vs LLM');
    expect(deepDive).toContain('### The Hybrid Architecture');
  });

  it('cites arxiv:2311.15548 hallucination research', () => {
    expect(deepDive).toContain('arxiv:2311.15548');
    expect(deepDive).toContain('https://arxiv.org/abs/2311.15548');
    expect(deepDive).toContain('27%');
  });

  it('cites ACM ICAIF proceedings', () => {
    expect(deepDive).toContain('ACM ICAIF');
    expect(deepDive).toContain('https://dl.acm.org/doi/proceedings/10.1145/3768292');
  });

  it('cites FinRegLab "The Next Wave Arrives"', () => {
    expect(deepDive).toContain('FinRegLab');
    expect(deepDive).toContain('bounded autonomy');
    expect(deepDive).toContain('finreglab.org');
  });

  it('cites OpenPaper "The Hallucination Premium"', () => {
    expect(deepDive).toContain('OpenPaper');
    expect(deepDive).toContain('openpaper.com');
  });

  it('includes side-by-side comparison table', () => {
    expect(deepDive).toContain('| Aspect |');
    expect(deepDive).toContain('Autarch `DecisionTrace`');
    expect(deepDive).toContain('Hypothetical LLM Output');
    expect(deepDive).toContain('Reproducible?');
    expect(deepDive).toContain('Auditable?');
  });

  it('positions DecisionModule as the hybrid architecture point', () => {
    expect(deepDive).toContain('DecisionModule');
    expect(deepDive).toContain('deterministic rules for execution safety');
    expect(deepDive).toContain('LLMs for');
  });
});

// ─── Production Hardening Section (AC#4) ──────────────────────────────────

describe('DEEP-DIVE.md — Production Hardening Path', () => {
  it('has upgrade path table with required columns', () => {
    expect(deepDive).toContain('### Upgrade Path');
    expect(deepDive).toContain('| Current (Prototype)');
    expect(deepDive).toContain('Production Target');
    expect(deepDive).toContain('Effort');
    expect(deepDive).toContain('Priority');
  });

  it('documents all required upgrade paths', () => {
    const upgrades = [
      'HSM/TEE',
      'Multi-sig',
      'rate limit',
      'tamper-proof',
      'Third-party',
      'MarketDataProvider',
      'DEX swap',
    ];
    for (const upgrade of upgrades) {
      expect(deepDive, `Missing upgrade path: ${upgrade}`).toContain(upgrade);
    }
  });

  it('has "What Doesn\'t Change" subsection', () => {
    expect(deepDive).toContain("### What Doesn't Change");
    expect(deepDive).toContain('Closure-based key isolation');
    expect(deepDive).toContain('Module boundaries');
    expect(deepDive).toContain('DecisionModule interface');
    expect(deepDive).toContain('Event-driven architecture');
  });
});

// ─── DecisionModule Interface Section (AC#5) ─────────────────────────────

describe('DEEP-DIVE.md — DecisionModule interface', () => {
  it('shows complete DecisionModule interface with evaluate and reset methods', () => {
    expect(deepDive).toContain('evaluate(context: EvaluationContext): Promise<DecisionResult>');
    expect(deepDive).toContain('reset?(): void');
  });

  it('shows DecisionTrace interface with all fields', () => {
    expect(deepDive).toContain('readonly timestamp: number');
    expect(deepDive).toContain('readonly agentId: number');
    expect(deepDive).toContain('readonly marketData: MarketData');
    expect(deepDive).toContain('readonly evaluations: readonly RuleEvaluation[]');
    expect(deepDive).toContain('readonly execution?: TraceExecution');
  });

  it('shows EvaluationContext interface', () => {
    expect(deepDive).toContain('readonly agentState: AgentState');
    expect(deepDive).toContain('readonly marketData: MarketData');
    expect(deepDive).toContain('readonly rules: readonly Rule[]');
    expect(deepDive).toContain('readonly peerStates?: readonly AgentState[]');
  });

  it('includes LLM wrapper stub example (FR53.4)', () => {
    expect(deepDive).toContain('### Custom LLM Wrapper Example');
    expect(deepDive).toContain('llmDecisionModule');
    expect(deepDive).toContain("from '@autarch/agent'");
    expect(deepDive).toContain('async evaluate(context: EvaluationContext)');
  });
});
