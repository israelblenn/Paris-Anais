import { requireEnv } from './load-env.mjs';

const spaceId = requireEnv('CONTENTFUL_SPACE_ID');
const accessToken = requireEnv('CONTENTFUL_DELIVERY_TOKEN');
const environment = process.env.CONTENTFUL_ENVIRONMENT || 'master';

const base = `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}`;

async function get(path) {
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}access_token=${accessToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

const types = await get('/content_types');
console.log('Content types:');
for (const ct of types.items) {
  console.log(`  - ${ct.sys.id} (${ct.name})`);
  for (const f of ct.fields) {
    console.log(`      ${f.id}: ${f.type}${f.linkType ? ` -> ${f.linkType}` : ''}`);
  }
}

const allEntries = await get('/entries?include=10&limit=10');
console.log(`\nAll entries: ${allEntries.total}`);
for (const entry of allEntries.items) {
  console.log(`  ${entry.sys.contentType.sys.id} / ${entry.sys.id}: ${JSON.stringify(entry.fields).slice(0, 120)}...`);
}

const assets = await get('/assets?limit=10');
console.log(`\nAssets: ${assets.total}`);
for (const asset of assets.items) {
  const file = asset.fields?.file;
  console.log(`  ${asset.sys.id}: ${file?.url} (${file?.contentType})`);
}
