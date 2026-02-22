import { readFile } from 'node:fs/promises';
import { validateAgentConfig } from './schema.js';
import { DEFAULT_INTERVAL_MS } from './constants.js';
import type { AgentConfig } from './types.js';

/**
 * Apply defaults to a validated agent config.
 *
 * @param config - Validated AgentConfig (may have optional fields unset)
 * @returns A new AgentConfig with all defaults applied
 */
function applyDefaults(config: AgentConfig): AgentConfig {
  return {
    ...config,
    intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
    rules: config.rules.map((rule) => ({
      ...rule,
      conditions: rule.conditions.map((cond) => ({
        ...cond,
        logic: cond.logic ?? 'AND',
      })),
    })),
  };
}

/**
 * Load an agent configuration from a JSON file on disk.
 *
 * Reads the file, parses JSON, validates against the agent config schema,
 * and applies defaults for optional fields.
 *
 * @param filePath - Absolute or relative path to the JSON config file
 * @returns Parsed and validated AgentConfig with defaults applied
 * @throws Error if the file cannot be read, contains invalid JSON, or fails schema validation
 */
export async function loadAgentConfig(filePath: string): Promise<AgentConfig> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read config file ${filePath}: ${message}`, { cause: err });
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SyntaxError(`Invalid JSON in config file ${filePath}: ${detail}`, { cause: err });
  }

  const result = validateAgentConfig(data);

  if (!result.valid) {
    const errorList = result.errors.join('\n  - ');
    throw new Error(`Invalid agent config in ${filePath}:\n  - ${errorList}`);
  }

  return applyDefaults(result.config);
}
