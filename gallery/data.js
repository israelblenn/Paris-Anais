import config from '../contentful.config.mjs';

const CDN_BASE = `https://cdn.contentful.com/spaces/${config.spaceId}/environments/${config.environment}`;
const PAGE_LIMIT = 100;
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|m4v)$/i;
const DEFAULT_VIDEO_RATIO = 16 / 9;

async function cdnFetch(path) {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${CDN_BASE}${path}${separator}access_token=${config.accessToken}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Contentful request failed (${response.status})`);
  }

  return response.json();
}

function absoluteUrl(url) {
  if (!url) return null;
  return url.startsWith('//') ? `https:${url}` : url;
}

function isVideoAsset(contentType, url) {
  return Boolean(contentType?.startsWith('video/')) || VIDEO_EXTENSIONS.test(url || '');
}

function normalizeAsset(asset) {
  const file = asset.fields?.file;
  const url = absoluteUrl(file?.url);
  if (!url) return null;

  const contentType = file?.contentType || '';
  const isVideo = isVideoAsset(contentType, url);
  const image = file?.details?.image;

  const width = image?.width ?? null;
  const height = image?.height ?? null;
  const aspectRatio = width && height ? width / height : DEFAULT_VIDEO_RATIO;

  return {
    id: asset.sys.id,
    url,
    title: asset.fields?.title || '',
    aspectRatio,
    isVideo,
  };
}

/**
 * Build an optimized Contentful Images API URL for a given render width.
 * Videos are returned untouched (the Images API only applies to images).
 */
export function optimizedImageUrl(media, renderWidth) {
  if (media.isVideo) return media.url;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetWidth = Math.round(renderWidth * dpr);
  const params = new URLSearchParams({
    w: String(targetWidth),
    fm: 'webp',
    q: '80',
    fit: 'fill',
  });

  return `${media.url}?${params.toString()}`;
}

async function attachCollections(media) {
  const data = await cdnFetch(
    `/entries?content_type=${encodeURIComponent(config.contentType)}&include=10&limit=100`,
  );

  const assetMap = new Map(media.map((item) => [item.id, item]));

  for (const entry of data.items || []) {
    const links = entry.fields?.[config.mediaField] || [];
    const collection = {
      title: entry.fields?.title || '',
      description: entry.fields?.description || '',
      mediaItems: [],
    };

    for (const link of links) {
      const asset = assetMap.get(link.sys?.id);
      if (asset) {
        collection.mediaItems.push(asset);
        asset.collection = collection;
      }
    }
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyMarks(text, marks) {
  let html = escapeHtml(text);
  for (const mark of marks || []) {
    if (mark.type === 'bold') html = `<strong>${html}</strong>`;
    else if (mark.type === 'italic') html = `<em>${html}</em>`;
    else if (mark.type === 'underline') html = `<u>${html}</u>`;
  }
  return html;
}

function renderRichTextNode(node) {
  if (node.nodeType === 'text') {
    return applyMarks(node.value, node.marks);
  }

  const children = (node.content || []).map(renderRichTextNode).join('');

  switch (node.nodeType) {
    case 'document':
      return children;
    case 'paragraph':
      return `<p>${children}</p>`;
    case 'heading-1':
      return `<h2>${children}</h2>`;
    case 'heading-2':
      return `<h3>${children}</h3>`;
    case 'heading-3':
      return `<h4>${children}</h4>`;
    case 'unordered-list':
      return `<ul>${children}</ul>`;
    case 'ordered-list':
      return `<ol>${children}</ol>`;
    case 'list-item':
      return `<li>${children}</li>`;
    case 'hyperlink':
      return `<a href="${escapeHtml(node.data?.uri || '#')}">${children}</a>`;
    default:
      return children;
  }
}

function richTextToHtml(document) {
  if (!document?.content) return '';
  return renderRichTextNode(document);
}

function resolveIncludedAsset(includes, link) {
  const id = link?.sys?.id;
  if (!id) return null;
  return (includes?.Asset || []).find((asset) => asset.sys.id === id) || null;
}

export async function fetchDetails() {
  const data = await cdnFetch('/entries?content_type=details&include=2&limit=1');
  const entry = data.items?.[0];
  if (!entry) return null;

  const imageAsset = resolveIncludedAsset(data.includes, entry.fields?.image);
  const image = imageAsset ? normalizeAsset(imageAsset) : null;

  return {
    bioHtml: richTextToHtml(entry.fields?.bio),
    image,
  };
}

export async function fetchGalleryMedia() {
  const media = [];
  let skip = 0;

  while (true) {
    const data = await cdnFetch(`/assets?limit=${PAGE_LIMIT}&skip=${skip}`);
    const batch = (data.items || []).map(normalizeAsset).filter(Boolean);
    media.push(...batch);

    if (!data.items || data.items.length < PAGE_LIMIT) break;
    skip += PAGE_LIMIT;
  }

  media.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

  await attachCollections(media);
  return media;
}
