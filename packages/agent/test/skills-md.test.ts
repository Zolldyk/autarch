import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..', '..');
const skillsPath = resolve(projectRoot, 'SKILLS.md');

/** Type-only exports that won't appear in runtime Object.keys() */
const TYPE_ONLY_EXPORTS = [
  'DecisionModule',
  'DecisionResult',
  'AgentConfig',
  'AgentConfigFile',
  'Rule',
  'Condition',
  'RuleAction',
  'ConditionOperator',
  'LogicalOperator',
  'AgentState',
  'AgentStatus',
  'AgentLifecycleEvent',
  'AgentRuntimeOptions',
  'MarketData',
  'MarketDataProvider',
  'MarketDataSource',
  'EvaluationContext',
  'ConditionResult',
  'RuleEvaluation',
  'EngineResult',
  'DecisionTrace',
  'TraceExecution',
  'RulesReloadedEvent',
  'MarketUpdateEvent',
  'SimulationModeEvent',
  'SimulatedProviderOptions',
];

let skillsContent: string;
let jsonBlock: Record<string, unknown>;
let agentSection: {
  exports: {
    functions: Array<{ name: string; signature: string; params: unknown[]; returns: unknown; description: string }>;
    classes: Array<{ name: string; description: string; constructor: string; methods: Array<{ name: string; signature: string; description: string }> }>;
    interfaces: Array<{ name: string; description: string; methods: Array<{ name: string; signature: string; description: string }> }>;
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
  agentSection = (jsonBlock as any).packages['@autarch/agent'];
});

describe('SKILLS.md — @autarch/agent coverage', () => {
  it('JSON block is valid parseable JSON', () => {
    expect(jsonBlock).toBeDefined();
    expect(typeof jsonBlock).toBe('object');
    expect(jsonBlock).toHaveProperty('version');
    expect(jsonBlock).toHaveProperty('packages');
    expect((jsonBlock as any).packages).toHaveProperty('@autarch/agent');
  });

  it('every public export from agent/src/index.ts has a SKILLS.md JSON entry', async () => {
    const agentModule = await import('../src/index.js');
    const runtimeExports = Object.keys(agentModule);

    const allJsonNames = [
      ...agentSection.exports.functions.map(f => f.name),
      ...agentSection.exports.classes.map(c => c.name),
      ...agentSection.exports.interfaces.map(i => i.name),
      ...agentSection.exports.types.map(t => t.name),
      ...agentSection.exports.constants.map(c => c.name),
    ];

    for (const exportName of runtimeExports) {
      expect(
        allJsonNames.includes(exportName),
        `Runtime export "${exportName}" is missing from SKILLS.md JSON`,
      ).toBe(true);
    }
  });

  it('type-only exports are documented in JSON interfaces or types', () => {
    const interfaceNames = agentSection.exports.interfaces.map(i => i.name);
    const typeNames = agentSection.exports.types.map(t => t.name);
    const allTypeNames = [...interfaceNames, ...typeNames];

    for (const typeName of TYPE_ONLY_EXPORTS) {
      expect(
        allTypeNames.includes(typeName),
        `Type-only export "${typeName}" is missing from SKILLS.md JSON`,
      ).toBe(true);
    }
  });

  it('no SKILLS.md @autarch/agent entries reference non-existent exports', async () => {
    const agentModule = await import('../src/index.js');
    const runtimeExports = new Set(Object.keys(agentModule));
    const typeOnlySet = new Set(TYPE_ONLY_EXPORTS);

    const allJsonNames = [
      ...agentSection.exports.functions.map(f => f.name),
      ...agentSection.exports.classes.map(c => c.name),
      ...agentSection.exports.interfaces.map(i => i.name),
      ...agentSection.exports.types.map(t => t.name),
      ...agentSection.exports.constants.map(c => c.name),
    ];

    for (const name of allJsonNames) {
      expect(
        runtimeExports.has(name) || typeOnlySet.has(name),
        `SKILLS.md JSON entry "${name}" does not exist in @autarch/agent exports`,
      ).toBe(true);
    }
  });

  it('function/class entries have name, signature, params, returns, and description', () => {
    for (const fn of agentSection.exports.functions) {
      expect(fn.name, 'Function missing name').toBeTruthy();
      expect(fn.signature, `Function "${fn.name}" missing signature`).toBeTruthy();
      expect(fn.params, `Function "${fn.name}" missing params`).toBeDefined();
      expect(fn.returns, `Function "${fn.name}" missing returns`).toBeDefined();
      expect(fn.description, `Function "${fn.name}" missing description`).toBeTruthy();
    }

    for (const cls of agentSection.exports.classes) {
      expect(cls.name, 'Class missing name').toBeTruthy();
      expect(cls.description, `Class "${cls.name}" missing description`).toBeTruthy();
      expect(cls.constructor, `Class "${cls.name}" missing constructor`).toBeTruthy();
      expect(cls.methods.length, `Class "${cls.name}" has no methods`).toBeGreaterThan(0);
      for (const method of cls.methods) {
        expect(method.name, `Class "${cls.name}" method missing name`).toBeTruthy();
        expect(method.signature, `Class "${cls.name}" method "${method.name}" missing signature`).toBeTruthy();
        expect(method.description, `Class "${cls.name}" method "${method.name}" missing description`).toBeTruthy();
      }
    }
  });

  it('DecisionModule interface entry includes evaluate method and LLM stub example', () => {
    const dm = agentSection.exports.interfaces.find(i => i.name === 'DecisionModule');
    expect(dm, 'DecisionModule not found in interfaces').toBeDefined();

    const evaluateMethod = dm!.methods.find(m => m.name === 'evaluate');
    expect(evaluateMethod, 'DecisionModule missing evaluate method').toBeDefined();
    expect(evaluateMethod!.signature).toContain('EvaluationContext');
    expect(evaluateMethod!.signature).toContain('DecisionResult');

    // Verify LLM stub example exists in the human-readable section
    expect(skillsContent).toContain('LLM wrapper stub example');
    expect(skillsContent).toContain('llmDecisionModule');
  });

  it('constant entries have name, type, value, and description', () => {
    for (const c of agentSection.exports.constants) {
      expect(c.name, 'Constant missing name').toBeTruthy();
      expect(c.type, `Constant "${c.name}" missing type`).toBeTruthy();
      expect(c.value, `Constant "${c.name}" missing value`).toBeDefined();
      expect(c.description, `Constant "${c.name}" missing description`).toBeTruthy();
    }
  });

  it('function entries include example fields (AC#3)', () => {
    for (const fn of agentSection.exports.functions) {
      expect(
        (fn as any).example,
        `Function "${fn.name}" missing example field`,
      ).toBeTruthy();
    }
  });

  it('class entries have constructor and at least one method documented', () => {
    for (const cls of agentSection.exports.classes) {
      expect(cls.constructor, `Class "${cls.name}" missing constructor`).toBeTruthy();
      expect(cls.methods.length, `Class "${cls.name}" has no methods documented`).toBeGreaterThan(0);
      for (const method of cls.methods) {
        expect(method.signature, `Class "${cls.name}" method "${method.name}" missing signature`).toBeTruthy();
      }
    }
  });

  it('interface entries have properties or methods defined', () => {
    for (const iface of agentSection.exports.interfaces) {
      const hasProperties = Array.isArray((iface as any).properties) && (iface as any).properties.length > 0;
      const hasMethods = Array.isArray((iface as any).methods) && (iface as any).methods.length > 0;
      expect(
        hasProperties || hasMethods,
        `Interface "${iface.name}" has no properties or methods`,
      ).toBe(true);
    }
  });

  it('human-readable sections exist for @autarch/agent (AC#6)', () => {
    expect(skillsContent).toContain('## @autarch/agent');
    expect(skillsContent).toContain('### Agent Class');
    expect(skillsContent).toContain('### AgentRuntime Class');
    expect(skillsContent).toContain('### DecisionModule Interface');
  });

  it('error reference section documents error tags', () => {
    expect(skillsContent).toContain('## Error Reference');
    expect(skillsContent).toContain('[RPC_NETWORK_ERROR]');
    expect(skillsContent).toContain('[RPC_REQUEST_ERROR]');
    expect(skillsContent).toContain('[RPC_TRANSACTION_ERROR]');
  });
});
