import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireEnv } from './load-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const config = {
  spaceId: requireEnv('CONTENTFUL_SPACE_ID'),
  accessToken: requireEnv('CONTENTFUL_DELIVERY_TOKEN'),
  environment: process.env.CONTENTFUL_ENVIRONMENT || 'master',
  contentType: 'collection',
  mediaField: 'media',
};

const outPath = path.join(root, 'contentful.config.mjs');
fs.writeFileSync(outPath, `export default ${JSON.stringify(config, null, 2)};\n`);
console.log(`Wrote ${path.relative(root, outPath)}`);
