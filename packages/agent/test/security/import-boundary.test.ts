import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

const SRC_DIR = join(import.meta.dirname, '../../src');

const FORBIDDEN_PATTERNS = [
  /from\s+['"]@solana\/kit['"]/,
  /from\s+['"]@solana\//,
  /from\s+['"]@scure\/bip39['"]/,
  /from\s+['"]micro-ed25519-hdkey['"]/,
  /from\s+['"]micro-key-producer['"]/,
  /from\s+['"]crypto['"]/,
  /from\s+['"]node:crypto['"]/,
  /from\s+['"]tweetnacl['"]/,
  /from\s+['"]ed25519['"]/,
  /require\s*\(\s*['"]crypto['"]\s*\)/,
];

describe('NFR9: import boundary — zero crypto imports in @autarch/agent', () => {
  async function listTsFilesRecursively(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nestedLists = await Promise.all(
      entries.map(async (entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          return listTsFilesRecursively(full);
        }
        return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
      }),
    );
    return nestedLists.flat();
  }

  it('has no forbidden imports in any source file', async () => {
    const tsFiles = await listTsFilesRecursively(SRC_DIR);

    expect(tsFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = await readFile(file, 'utf-8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
          violations.push(`${file.replace(`${SRC_DIR}/`, '')}: forbidden import found — ${match[0]}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
