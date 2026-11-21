import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const spec = resolve(root, 'apps/web/src/shared/api/openapi.json');
const output = resolve(root, 'apps/web/src/shared/api/generated.ts');
mkdirSync(dirname(output), { recursive: true });
execFileSync('uv', ['run', '--project', resolve(root, 'apps/server'), 'python', resolve(root, 'scripts/export_openapi.py')], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync('pnpm', ['exec', 'openapi-typescript', spec, '-o', output], {
  cwd: resolve(root, 'apps/web'),
  stdio: 'inherit',
});
