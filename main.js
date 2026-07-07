import './flower-pop.js';
import { fetchGalleryMedia, fetchDetails, optimizedImageUrl } from './gallery/data.js';
import { MasonryGrid } from './gallery/grid.js';
import { configureInlineVideo, LazyMedia } from './gallery/lazy.js';
import { openModal } from './gallery/modal.js';
import { initGalleryFilters } from './gallery/nav.js';
import { LOOP_MIN_COPIES, pageLoop } from './scroll.js';

const scrollArea = document.querySelector('.scroll-area');

function mountAboutMedia(lazy, container, media) {
  if (!container) return;

  if (!media) {
    container.remove();
    return;
  }

  container.replaceChildren();

  if (media.isVideo) {
    const el = document.createElement('video');
    el.className = 'about__media about__media--video';
    configureInlineVideo(el);
    el.dataset.src = media.url;
    el.preload = 'none';
    container.appendChild(el);
    lazy.observe(el, media);
    return;
  }

  const el = document.createElement('img');
  el.className = 'about__media';
  el.src = optimizedImageUrl(media, 560);
  el.alt = media.title || '';
  el.decoding = 'async';
  container.appendChild(el);
}

function decorateAboutBio(bioEl) {
  const rotations = [-2, 3];
  bioEl.querySelectorAll('a').forEach((link, i) => {
    link.style.setProperty('--link-rotation', `${rotations[i % 2]}deg`);
  });

  const walker = document.createTreeWalker(bioEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  for (const textNode of textNodes) {
    const { nodeValue } = textNode;
    if (!nodeValue?.includes('@')) continue;

    const fragment = document.createDocumentFragment();
    const parts = nodeValue.split('@');
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i]) fragment.appendChild(document.createTextNode(parts[i]));
      if (i < parts.length - 1) {
        const at = document.createElement('span');
        at.className = 'about__at';
        at.textContent = '@';
        fragment.appendChild(at);
      }
    }
    textNode.parentNode.replaceChild(fragment, textNode);
  }
}

async function populateDetails(root = document) {
  const sections = root.querySelectorAll('.about');
  if (!sections.length) return;

  const lazy = new LazyMedia({
    root: document.querySelector('.scroll-area'),
    rootMargin: '400px 0px',
  });

  const details = await fetchDetails();
  if (!details) {
    sections.forEach((section) => { section.hidden = true; });
    return;
  }

  for (const section of sections) {
    const bioEl = section.querySelector('.about__bio');
    if (bioEl) {
      bioEl.innerHTML = details.bioHtml;
      decorateAboutBio(bioEl);
    }
    mountAboutMedia(lazy, section.querySelector('.about__image'), details.image);
  }
}

function buildGallery(gridEl, { onAspectRatio } = {}) {
  const GAP = 24;

  const lazy = new LazyMedia({
    root: scrollArea,
    rootMargin: '400px 0px',
    onAspectRatio,
  });

  function estimateRenderWidth() {
    const page = gridEl.closest('.page');
    const available = page?.clientWidth ?? window.innerWidth;
    const columns = grid.columnCount || 3;
    return Math.ceil((available - GAP * (columns - 1)) / columns);
  }

  function renderItem(media) {
    const renderWidth = estimateRenderWidth();
    const frame = document.createElement('div');
    frame.className = media.isVideo ? 'bg-item__frame bg-item__frame--video' : 'bg-item__frame';

    const el = media.isVideo ? document.createElement('video') : document.createElement('img');
    el.className = 'bg-item__media';

    if (media.isVideo) {
      configureInlineVideo(el);
      el.dataset.src = media.url;
      el.preload = 'none';
    } else {
      el.dataset.src = optimizedImageUrl(media, renderWidth);
      el.alt = media.title || '';
      el.decoding = 'async';
    }

    frame.appendChild(el);
    frame.addEventListener('click', () => openModal(media, grid));
    lazy.observe(el, media);
    return frame;
  }

  const grid = new MasonryGrid(gridEl, { gap: GAP, renderItem });
  grid.lazy = lazy;
  return grid;
}

async function initGallery() {
  const page = document.querySelector('.page');
  const firstGrid = page?.querySelector('.bg-grid');
  if (!firstGrid) return;

  try {
    const pages = [page];
    for (let i = 1; i < LOOP_MIN_COPIES; i += 1) {
      const clone = page.cloneNode(true);
      clone.querySelector('.bg-grid').innerHTML = '';
      scrollArea.appendChild(clone);
      pages.push(clone);
    }

    await populateDetails(scrollArea);
    const catalog = await fetchGalleryMedia();
    if (!catalog.length) throw new Error('no media');

    const grids = [];
    const syncAspectRatio = (id, ratio) => {
      for (const grid of grids) grid.setAspectRatio(id, ratio);
    };
    for (const p of pages) {
      grids.push(buildGallery(p.querySelector('.bg-grid'), { onAspectRatio: syncAspectRatio }));
    }
    grids.forEach((grid) => grid.add(catalog));
    await initGalleryFilters(catalog, grids);

    // Start inside the loop band once layout is ready; pin scroll while media
    // and iOS viewport chrome finish settling.
    await document.fonts.ready;
    pageLoop.enterLoopBand();
  } catch {
    firstGrid.innerHTML = '<p class="gallery-error">Gallery could not be loaded from Contentful. Check your connection and that media is published.</p>';
  }
}

initGallery();
