import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public');

const config = spawnSync('node', ['scripts/generate-contentful-config.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
if (config.status !== 0) process.exit(config.status ?? 1);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

const items = [
  'index.html',
  'main.js',
  'scroll.js',
  'flower-pop.js',
  'contentful.js',
  'style.css',
  'contentful.config.mjs',
  'assets',
  'gallery',
];

for (const item of items) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(out, item), { recursive: true });
}

console.log(`Wrote ${path.relative(root, out)}/`);
