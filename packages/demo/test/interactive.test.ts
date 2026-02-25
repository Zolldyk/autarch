import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { validateAgentConfig } from '@autarch/agent';

const ROOT_PKG = path.resolve(import.meta.dirname, '..', '..', '..', 'package.json');
const DEMO_PKG = path.resolve(import.meta.dirname, '..', 'package.json');
const RULES_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'examples', 'rules');

// --- Task 6.1: interactive.ts exists (cannot dynamic-import: top-level side effect) ---

describe('interactive mode module', () => {
  it('interactive.ts source file exists (side-effect module — not importable in tests)', () => {
    const interactiveSrc = path.resolve(import.meta.dirname, '..', 'src', 'interactive.ts');
    expect(existsSync(interactiveSrc)).toBe(true);
  });
});

// --- Task 6.2: root package.json contains interactive script ---

describe('root package.json interactive script', () => {
  it('contains interactive script with DEMO_MODE=true', () => {
    const pkg = JSON.parse(readFileSync(ROOT_PKG, 'utf-8'));
    expect(pkg.scripts.interactive).toBeDefined();
    expect(pkg.scripts.interactive).toContain('DEMO_MODE=true');
  });

  it('interactive script uses @autarch/demo start:interactive', () => {
    const pkg = JSON.parse(readFileSync(ROOT_PKG, 'utf-8'));
    expect(pkg.scripts.interactive).toContain('start:interactive');
  });
});

// --- Task 6.3: demo package.json contains start:interactive script ---

describe('demo package.json start:interactive script', () => {
  it('contains start:interactive script', () => {
    const pkg = JSON.parse(readFileSync(DEMO_PKG, 'utf-8'));
    expect(pkg.scripts['start:interactive']).toBeDefined();
  });

  it('start:interactive runs dist/interactive.js', () => {
    const pkg = JSON.parse(readFileSync(DEMO_PKG, 'utf-8'));
    expect(pkg.scripts['start:interactive']).toContain('interactive.js');
  });
});

// --- Task 6.4: DemoOptions type is exported from barrel ---

describe('DemoOptions barrel export', () => {
  it('DemoOptions type is exported from @autarch/demo barrel', async () => {
    const barrel = await import('../src/index.js');
    // Type exports don't appear at runtime, but the export statement must exist in source
    const barrelSrc = readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'index.ts'),
      'utf-8',
    );
    expect(barrelSrc).toContain('DemoOptions');
    // runDemo should still be exported
    expect(typeof barrel.runDemo).toBe('function');
  });
});

// --- Task 6.5: example configs present and valid ---

describe('example rule configs (re-verify)', () => {
  const configs = ['conservative.json', 'dip-buyer.json', 'momentum.json'];

  for (const file of configs) {
    it(`${file} exists in examples/rules/`, () => {
      expect(existsSync(path.join(RULES_DIR, file))).toBe(true);
    });

    it(`${file} passes JSON Schema validation`, () => {
      const raw = JSON.parse(readFileSync(path.join(RULES_DIR, file), 'utf-8'));
      const result = validateAgentConfig(raw);
      expect(result.valid).toBe(true);
    });
  }
});

// --- Task 6.6: runDemo accepts options parameter ---

describe('runDemo options parameter', () => {
  it('runDemo function accepts an options parameter (source check)', () => {
    const src = readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'demo-scenario.ts'),
      'utf-8',
    );
    expect(src).toContain('DemoOptions');
    expect(src).toContain('options: DemoOptions');
    expect(src).toContain('options.interactive');
  });

  it('DemoOptions interface has interactive property', () => {
    const src = readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'demo-scenario.ts'),
      'utf-8',
    );
    expect(src).toContain('interactive?: boolean');
  });

  it('printInteractiveInstructions is called when interactive is true', () => {
    const src = readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'demo-scenario.ts'),
      'utf-8',
    );
    expect(src).toContain('printInteractiveInstructions');
    expect(src).toContain('if (options.interactive)');
  });
});

// --- AC1: interactive.ts calls runDemo({ interactive: true }) ---

describe('interactive.ts entry point content', () => {
  const interactiveSrc = () =>
    readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'interactive.ts'),
      'utf-8',
    );

  it('imports runDemo from demo-scenario', () => {
    expect(interactiveSrc()).toContain("import { runDemo } from './demo-scenario.js'");
  });

  it('calls runDemo with interactive: true', () => {
    expect(interactiveSrc()).toContain('runDemo({ interactive: true })');
  });

  it('has .catch error handler with process.exit', () => {
    const src = interactiveSrc();
    expect(src).toContain('.catch(');
    expect(src).toContain('process.exit(1)');
  });
});

// --- AC2: printInteractiveInstructions content references ---

describe('printInteractiveInstructions content', () => {
  const demoSrc = () =>
    readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'demo-scenario.ts'),
      'utf-8',
    );

  it('references dashboard URL', () => {
    expect(demoSrc()).toContain('Dashboard:');
  });

  it('references hot-reload hint for examples/rules/', () => {
    const src = demoSrc();
    expect(src).toContain('Hot-Reload');
    expect(src).toContain('examples/rules/');
  });

  it('includes curl commands for market endpoints', () => {
    const src = demoSrc();
    expect(src).toContain('/api/market/dip');
    expect(src).toContain('/api/market/rally');
    expect(src).toContain('/api/market/reset');
  });
});

// --- AC4: Dashboard hot-reload rendering pipeline ---

describe('dashboard hot-reload rendering (AC4)', () => {
  const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', 'public');

  it('app.js handles hotReload systemEvent type', () => {
    const appJs = readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    expect(appJs).toContain("data.type === 'hotReload'");
    expect(appJs).toContain('renderHotReloadEntry');
  });

  it('app.js renderHotReloadEntry applies log-entry-hotreload class', () => {
    const appJs = readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    expect(appJs).toContain('log-entry-hotreload');
  });

  it('styles.css has blue tint for hot-reload entries', () => {
    const css = readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf-8');
    expect(css).toContain('.log-entry-hotreload');
    expect(css).toContain('.agent-tag-hotreload');
  });
});

// --- Anti-pattern guard: barrel does NOT re-export interactive module ---

describe('barrel safety', () => {
  it('barrel does not re-export interactive module (side-effect guard)', () => {
    const barrelSrc = readFileSync(
      path.resolve(import.meta.dirname, '..', 'src', 'index.ts'),
      'utf-8',
    );
    // Should NOT have: export { ... } from './interactive.js'
    // Should NOT have: export * from './interactive.js'
    expect(barrelSrc).not.toMatch(/export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]\.\/interactive/);
  });
});
