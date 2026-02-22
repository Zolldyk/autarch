import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import type { AgentConfig } from './types.js';

/** JSON Schema for agent rule configuration files. */
const agentConfigSchema = {
  type: 'object',
  required: ['name', 'strategy', 'rules'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    strategy: { type: 'string', minLength: 1 },
    intervalMs: { type: 'number', minimum: 1000, default: 60000 },
    rules: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'conditions', 'action', 'amount', 'weight', 'cooldownSeconds'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          conditions: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['field', 'operator', 'threshold'],
              additionalProperties: false,
              properties: {
                field: { type: 'string', minLength: 1 },
                operator: { type: 'string', enum: ['>', '<', '>=', '<=', '==', '!='] },
                threshold: { oneOf: [{ type: 'number' }, { type: 'string' }] },
                logic: { type: 'string', enum: ['AND', 'OR', 'NOT'], default: 'AND' },
              },
            },
          },
          action: { type: 'string', enum: ['buy', 'sell', 'transfer', 'none'] },
          amount: { type: 'number', exclusiveMinimum: 0 },
          weight: { type: 'number', minimum: 0, maximum: 100 },
          cooldownSeconds: { type: 'number', minimum: 0 },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, useDefaults: true });
const validate = ajv.compile(agentConfigSchema);

/**
 * Transform an ajv instance path from JSON pointer to dot-notation.
 *
 * @param instancePath - JSON pointer string, e.g. `/rules/0/action`
 * @returns Dot-notation string, e.g. `rules[0].action`
 */
function formatPath(instancePath: string): string {
  return instancePath
    .replace(/^\//, '')
    .replace(/\/(\d+)\//g, '[$1].')
    .replace(/\/(\d+)$/g, '[$1]')
    .replace(/\//g, '.');
}

/**
 * Transform ajv error objects into human-readable messages with instance paths.
 *
 * @param errors - Array of ajv ErrorObject entries
 * @returns Human-readable error strings pointing to the exact failing field
 */
export function formatValidationErrors(errors: ErrorObject[]): string[] {
  return errors.map((err) => {
    const path = formatPath(err.instancePath);

    if (err.keyword === 'required') {
      const missingProp = err.params.missingProperty as string;
      const prefix = path ? `${path}.` : '';
      return `Missing required property: ${prefix}${missingProp}`;
    }

    if (err.keyword === 'enum') {
      const allowed = (err.params.allowedValues as string[]).join(', ');
      return `${path} must be one of: ${allowed}`;
    }

    if (err.keyword === 'minItems') {
      return `${path} must have at least ${err.params.limit as number} item(s)`;
    }

    if (err.keyword === 'minLength') {
      return `${path} must not be empty`;
    }

    if (err.keyword === 'minimum') {
      return `${path} must be >= ${err.params.limit as number}`;
    }

    if (err.keyword === 'exclusiveMinimum') {
      return `${path} must be > ${err.params.limit as number}`;
    }

    if (err.keyword === 'maximum') {
      return `${path} must be <= ${err.params.limit as number}`;
    }

    if (err.keyword === 'type') {
      return `${path} must be of type ${err.params.type as string}`;
    }

    if (err.keyword === 'additionalProperties') {
      return `${path} has unknown property: ${err.params.additionalProperty as string}`;
    }

    if (err.keyword === 'oneOf') {
      return `${path} must be a number or string`;
    }

    return `${path} ${err.message ?? 'is invalid'}`;
  });
}

/**
 * Validate raw data against the agent config JSON Schema.
 *
 * @param data - Unknown data to validate (typically parsed JSON)
 * @returns Discriminated union: `{ valid: true, config }` or `{ valid: false, errors }`
 */
export function validateAgentConfig(
  data: unknown,
): { valid: true; config: AgentConfig } | { valid: false; errors: string[] } {
  const valid = validate(data);

  if (valid) {
    return { valid: true, config: data as AgentConfig };
  }

  const errors = formatValidationErrors(validate.errors ?? []);
  return { valid: false, errors };
}
