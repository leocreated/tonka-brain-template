// Runs every *.test.mjs file in this folder with the Node test runner.
// (Listing files here keeps `npm test` portable across shells.)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !only.length || only.some((o) => f.includes(o)))
  .sort()
  .map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
