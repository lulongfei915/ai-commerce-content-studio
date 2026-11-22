import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'apps');
const ignored = new Set(['node_modules', 'dist', 'coverage', '.venv']);
const generated = resolve(root, 'web', 'src', 'shared', 'api', 'generated.ts');
const extensions = new Set(['.ts', '.tsx', '.py']);
const violations = [];

function visit(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const path = join(directory, entry);
    if (path === generated) continue; // Regenerated from the server's OpenAPI schema.
    const stats = statSync(path);
    if (stats.isDirectory()) visit(path);
    else if (extensions.has(path.slice(path.lastIndexOf('.')))) {
      const lines = readFileSync(path, 'utf8').split('\n').length - 1;
      if (lines > 500) violations.push(`${path}: ${lines} lines`);
    }
  }
}

visit(root);
if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('Source line check passed.');
