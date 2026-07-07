import { optimizedImageUrl } from './data.js';
import { configureInlineVideo } from './lazy.js';

const PREFERS_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const OPEN_DURATION = 700;
const CLOSE_DURATION = 600;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const LONG_VIDEO_CONTROLS_THRESHOLD = 25;

const REST_TRANSFORM = 'none';
const SHADOW_REST = 'drop-shadow(4px 4px 8px rgba(0, 0, 0, 0.3))';

function shadowFilter(flyer) {
  return flyer.classList.contains('bgm__flyer--video') ? 'none' : SHADOW_REST;
}

let root = null;
let backdrop = null;
let slot = null;
let closeBtn = null;
let panel = null;
let isAnimating = false;
let isOpen = false;
let current = null;
let layoutObserver = null;
let layoutFrame = null;
let upgradeTimer = null;

function ensureRoot() {
  if (root) return;

  root = document.createElement('div');
  root.className = 'bgm';

  backdrop = document.createElement('div');
  backdrop.className = 'bgm__backdrop';

  slot = document.createElement('div');
  slot.className = 'bgm__slot';

  closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'bgm__close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = 'esc';

  root.append(backdrop, slot, closeBtn);
  document.body.appendChild(root);

  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }

    if (!isOpen || isAnimating || !current?.collection) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigateCollection(1);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigateCollection(-1);
    }
  });
}

function clearCollectionPanel() {
  panel?.remove();
  panel = null;
  root?.classList.remove('bgm--collection');
}

function formatCollectionTitle(title) {
  return title.replace(/\*(.*?)\*/g, '<em>$1</em>');
}

function buildCollectionPanel(collection, activeMedia) {
  clearCollectionPanel();

  panel = document.createElement('div');
  panel.className = 'bgm__panel';

  const info = document.createElement('div');
  info.className = 'bgm__info';

  const title = document.createElement('h2');
  title.className = 'bgm__title';
  title.innerHTML = formatCollectionTitle(collection.title);

  const desc = document.createElement('p');
  desc.className = 'bgm__desc';
  desc.textContent = collection.description;

  const descWrap = document.createElement('div');
  descWrap.className = 'bgm__desc-wrap';
  descWrap.appendChild(desc);

  info.append(title, descWrap);

  const thumbs = document.createElement('div');
  thumbs.className = 'bgm__thumbs';

  const activeIndex = collection.mediaItems.findIndex((item) => item.id === activeMedia.id);

  collection.mediaItems.forEach((item, index) => {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = `bgm__thumb${index === activeIndex ? ' is-active' : ''}`;
    thumb.style.setProperty('--thumb-ratio', String(item.aspectRatio || 1));
    thumb.setAttribute('aria-label', item.title || `View item ${index + 1}`);
    thumb.addEventListener('click', () => switchCollectionMedia(index));

    if (item.isVideo) {
      const vid = document.createElement('video');
      vid.src = item.url;
      vid.muted = true;
      vid.playsInline = true;
      vid.setAttribute('playsinline', '');
      vid.setAttribute('webkit-playsinline', '');
      vid.preload = 'metadata';
      thumb.appendChild(vid);
    } else {
      const img = document.createElement('img');
      img.src = optimizedImageUrl(item, 160);
      img.alt = item.title || '';
      img.decoding = 'async';
      thumb.appendChild(img);
    }

    thumbs.appendChild(thumb);
  });

  info.append(thumbs);

  const stage = document.createElement('div');
  stage.className = 'bgm__stage';

  panel.append(info, stage);
  root.insertBefore(panel, closeBtn);
  root.classList.add('bgm--collection');

  return { stage };
}

/** Unrotated geometry + viewport center of the grid item. */
function sourceGeometry(el) {
  const rect = el.getBoundingClientRect();
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    w: el.offsetWidth,
    h: el.offsetHeight,
  };
}

/** Layout box for the CSS-sized frame (used only for fly animation + hi-res). */
function frameGeometry(frameEl) {
  const rect = frameEl.getBoundingClientRect();
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    w: rect.width,
    h: rect.height,
  };
}

/** Transform that maps the resting flyer back onto the source rect. */
function transformFromSource(source, target, rotation) {
  const tx = source.cx - target.cx;
  const ty = source.cy - target.cy;
  const sx = source.w / target.w;
  const sy = source.h / target.h;
  return `translate(${tx}px, ${ty}px) rotate(${rotation}deg) scale(${sx}, ${sy})`;
}

function isLongVideo(duration) {
  return Number.isFinite(duration) && duration > LONG_VIDEO_CONTROLS_THRESHOLD;
}

function configureModalVideo(mediaEl, flyer) {
  const configureLongVideo = () => {
    if (!isLongVideo(mediaEl.duration)) return;
    mediaEl.controls = true;
    mediaEl.muted = false;
    mediaEl.removeAttribute('muted');
    flyer.classList.add('bgm__flyer--controls');
  };

  if (mediaEl.readyState >= HTMLMediaElement.HAVE_METADATA) {
    configureLongVideo();
  } else {
    mediaEl.addEventListener('loadedmetadata', configureLongVideo, { once: true });
  }
}

function releaseGridVideo(mediaEl, sourceFrame, lazy, media) {
  if (!mediaEl || !sourceFrame || mediaEl.parentElement === sourceFrame) return;

  mediaEl.className = 'bg-item__media';
  mediaEl.controls = false;
  configureInlineVideo(mediaEl);
  sourceFrame.appendChild(mediaEl);
  lazy?.observe(mediaEl, media);
  mediaEl.play().catch(() => {});
}

function adoptGridVideo(sourceMediaEl, flyer, lazy) {
  lazy?.unobserve(sourceMediaEl);
  const sourceFrame = sourceMediaEl.parentElement;
  sourceMediaEl.className = 'bgm__media';
  flyer.appendChild(sourceMediaEl);
  configureModalVideo(sourceMediaEl, flyer);
  sourceMediaEl.play().catch(() => {});
  return { mediaEl: sourceMediaEl, sourceFrame };
}

function setFlyerMedia(flyer, media, sourceMediaEl, borrowedVideo = null, lazy = null) {
  if (borrowedVideo) {
    releaseGridVideo(
      borrowedVideo.mediaEl,
      borrowedVideo.sourceFrame,
      lazy,
      borrowedVideo.media,
    );
  }

  flyer.querySelector('.bgm__media')?.remove();
  flyer.classList.remove('bgm__flyer--controls');

  let mediaEl;
  let borrowed = null;

  if (media.isVideo && sourceMediaEl?.tagName === 'VIDEO') {
    borrowed = adoptGridVideo(sourceMediaEl, flyer, lazy);
    mediaEl = borrowed.mediaEl;
    borrowed.media = media;
  } else if (media.isVideo) {
    mediaEl = document.createElement('video');
    configureInlineVideo(mediaEl);
    mediaEl.src = media.url;
    configureModalVideo(mediaEl, flyer);
    mediaEl.className = 'bgm__media';
    flyer.appendChild(mediaEl);
  } else {
    mediaEl = document.createElement('img');
    mediaEl.src = sourceMediaEl?.currentSrc || sourceMediaEl?.src || media.url;
    mediaEl.alt = media.title || '';
    mediaEl.decoding = 'async';
    mediaEl.className = 'bgm__media';
    flyer.appendChild(mediaEl);
  }

  watchIntrinsicAspect(mediaEl);

  if (media.isVideo && !borrowed) {
    requestAnimationFrame(() => mediaEl.play().catch(() => {}));
  }

  return { mediaEl, borrowed };
}

function setFrameAspect(frame, aspect) {
  frame.style.setProperty('--bgm-aspect', String(aspect));
}

function buildFlyer(media, aspect, sourceMediaEl, parentEl, lazy) {
  const frame = document.createElement('div');
  frame.className = 'bgm__frame is-preparing';
  setFrameAspect(frame, aspect);

  const flyer = document.createElement('figure');
  flyer.className = media.isVideo ? 'bgm__flyer bgm__flyer--video' : 'bgm__flyer';

  const { mediaEl, borrowed } = setFlyerMedia(flyer, media, sourceMediaEl, null, lazy);
  frame.appendChild(flyer);
  parentEl.appendChild(frame);

  return { frame, flyer, mediaEl, borrowed };
}

function mediaAspect(media, fallback = 1) {
  return media.aspectRatio || fallback;
}

/** Prefer loaded intrinsic dimensions over metadata or grid slot geometry. */
function resolveAspect(mediaEl, media, fallback = 1) {
  if (mediaEl?.tagName === 'IMG' && mediaEl.naturalWidth > 0 && mediaEl.naturalHeight > 0) {
    return mediaEl.naturalWidth / mediaEl.naturalHeight;
  }
  if (mediaEl?.tagName === 'VIDEO' && mediaEl.videoWidth > 0 && mediaEl.videoHeight > 0) {
    return mediaEl.videoWidth / mediaEl.videoHeight;
  }
  return mediaAspect(media, fallback);
}

function watchIntrinsicAspect(mediaEl) {
  if (!mediaEl || mediaEl.tagName !== 'IMG' || mediaEl.complete) return;
  mediaEl.addEventListener('load', () => scheduleLayoutSync(), { once: true });
}

function syncFlyerLayout() {
  if (!isOpen || isAnimating || !current?.frame) return;

  const mediaEl = current.flyer.querySelector('.bgm__media');
  const aspect = resolveAspect(mediaEl, current.displayMedia, current.aspect);
  if (aspect !== current.aspect) {
    setFrameAspect(current.frame, aspect);
    current.aspect = aspect;
  }

  current.target = frameGeometry(current.frame);
}

function scheduleLayoutSync() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    syncFlyerLayout();

    clearTimeout(upgradeTimer);
    upgradeTimer = setTimeout(() => {
      if (!current?.flyer) return;
      const mediaEl = current.flyer.querySelector('.bgm__media');
      if (mediaEl) upgradeResolution(mediaEl, current.displayMedia, current.target);
    }, 150);
  });
}

function startLayoutObserver() {
  stopLayoutObserver();

  layoutObserver = new ResizeObserver(() => scheduleLayoutSync());
  layoutObserver.observe(document.documentElement);
  if (current?.frame) layoutObserver.observe(current.frame);
  if (panel) layoutObserver.observe(panel);
}

function stopLayoutObserver() {
  layoutObserver?.disconnect();
  layoutObserver = null;

  if (layoutFrame) {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
  }

  clearTimeout(upgradeTimer);
  upgradeTimer = null;
}

/** Once settled, swap the cheap thumbnail for a crisp fullscreen source. */
function upgradeResolution(mediaEl, media, target) {
  if (media.isVideo || isAnimating) return;

  const hiRes = optimizedImageUrl(media, Math.round(target.w));
  if (!hiRes || hiRes === mediaEl.src) return;

  const preload = new Image();
  preload.onload = async () => {
    if (!mediaEl.isConnected || isAnimating) return;
    try {
      await preload.decode();
    } catch {
      // decode() unsupported or failed; swap anyway once loaded.
    }
    if (!mediaEl.isConnected || isAnimating) return;
    mediaEl.src = hiRes;
  };
  preload.src = hiRes;
}

function revealCollectionExtras() {
  if (!panel) return;
  panel.classList.add('is-revealed');
}

function hideCollectionExtras() {
  panel?.classList.remove('is-revealed');
}

function switchCollectionMedia(index) {
  if (!current?.collection || isAnimating) return;

  const { collection, flyer, grid } = current;
  const media = collection.mediaItems[index];
  if (!media || media.id === current.displayMedia.id) return;

  grid.drop(current.displayMedia.id);
  const record = grid.getRecord(media.id);
  if (record) grid.lift(media.id);

  const { mediaEl, borrowed } = setFlyerMedia(
    flyer,
    media,
    record?.el.querySelector('img, video'),
    current.borrowedVideo,
    grid.lazy,
  );
  current.borrowedVideo = borrowed;
  current.displayMedia = media;

  syncFlyerLayout();
  upgradeResolution(mediaEl, media, current.target);

  panel.querySelectorAll('.bgm__thumb').forEach((thumb, i) => {
    thumb.classList.toggle('is-active', i === index);
  });
}

function navigateCollection(step) {
  if (!current?.collection || isAnimating) return;

  const items = current.collection.mediaItems;
  if (!Array.isArray(items) || items.length < 2) return;

  const currentIndex = items.findIndex((item) => item.id === current.displayMedia.id);
  if (currentIndex < 0) return;

  const nextIndex = (currentIndex + step + items.length) % items.length;
  switchCollectionMedia(nextIndex);
}

function finishOpen(flyer) {
  flyer.style.transform = REST_TRANSFORM;
  flyer.style.filter = shadowFilter(flyer);
  backdrop.style.opacity = '1';
  closeBtn.classList.add('is-visible');
  revealCollectionExtras();
  isAnimating = false;
  isOpen = true;
  startLayoutObserver();

  const mediaEl = current?.flyer?.querySelector('.bgm__media');
  if (mediaEl) upgradeResolution(mediaEl, current.displayMedia, current.target);
}

export async function openModal(media, grid) {
  if (isAnimating || isOpen) return;

  const record = grid.getRecord(media.id);
  if (!record || record.removing) return;

  ensureRoot();
  clearCollectionPanel();

  const source = sourceGeometry(record.el);
  if (source.w === 0 || source.h === 0) return;

  const collection = media.collection || null;
  let collectionPanel = null;

  if (collection) {
    collectionPanel = buildCollectionPanel(collection, media);
    root.classList.add('is-active');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  const sourceMediaEl = record.el.querySelector('img, video');
  const aspect = resolveAspect(sourceMediaEl, media, source.w / source.h);
  const parentEl = collection ? collectionPanel.stage : slot;
  const { frame, flyer, mediaEl, borrowed } = buildFlyer(media, aspect, sourceMediaEl, parentEl, grid.lazy);

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const target = frameGeometry(frame);

  current = {
    displayMedia: media,
    collection,
    aspect,
    grid,
    frame,
    flyer,
    target,
    borrowedVideo: borrowed,
  };

  const startTransform = transformFromSource(source, target, record.rotation);
  const filterRest = shadowFilter(flyer);
  flyer.style.transform = startTransform;
  flyer.style.filter = filterRest;

  if (!collection) {
    root.classList.add('is-active');
  }

  document.body.classList.add('bgm-open');
  grid.lift(media.id);
  frame.classList.remove('is-preparing');

  if (PREFERS_REDUCED_MOTION) {
    flyer.style.transform = REST_TRANSFORM;
    backdrop.style.opacity = '1';
    closeBtn.classList.add('is-visible');
    revealCollectionExtras();
    isOpen = true;
    startLayoutObserver();
    upgradeResolution(mediaEl, media, target);
    return;
  }

  isAnimating = true;

  const flyerAnim = flyer.animate(
    [
      { transform: startTransform, filter: filterRest },
      { transform: REST_TRANSFORM, filter: filterRest },
    ],
    { duration: OPEN_DURATION, easing: EASING, fill: 'forwards' },
  );

  backdrop.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: OPEN_DURATION, easing: 'ease-out', fill: 'forwards' },
  );

  try {
    await flyerAnim.finished;
  } catch {
    // Interrupted; final state is applied below regardless.
  }

  finishOpen(flyer);
}

function teardown() {
  stopLayoutObserver();
  if (current?.borrowedVideo) {
    releaseGridVideo(
      current.borrowedVideo.mediaEl,
      current.borrowedVideo.sourceFrame,
      current.grid?.lazy,
      current.displayMedia,
    );
  }
  if (current?.grid && current.displayMedia) current.grid.drop(current.displayMedia.id);
  current?.frame?.remove();
  hideCollectionExtras();
  clearCollectionPanel();
  backdrop.style.removeProperty('opacity');
  closeBtn.classList.remove('is-visible');
  root.classList.remove('is-active');
  document.body.classList.remove('bgm-open');
  current = null;
  isOpen = false;
}

async function close() {
  if (!isOpen || isAnimating) return;

  stopLayoutObserver();
  syncFlyerLayout();

  const { displayMedia, grid, flyer, target } = current;
  const record = grid.getRecord(displayMedia.id);
  closeBtn.classList.remove('is-visible');
  closeBtn.blur();
  hideCollectionExtras();

  if (!current.borrowedVideo) {
    flyer.querySelectorAll('video').forEach((video) => video.pause());
  }

  if (PREFERS_REDUCED_MOTION || !record) {
    teardown();
    return;
  }

  const source = sourceGeometry(record.el);
  const endTransform = transformFromSource(source, target, record.rotation);
  const filterRest = shadowFilter(flyer);

  isAnimating = true;

  const flyerAnim = flyer.animate(
    [
      { transform: REST_TRANSFORM, filter: filterRest },
      { transform: endTransform, filter: filterRest },
    ],
    { duration: CLOSE_DURATION, easing: EASING, fill: 'forwards' },
  );

  backdrop.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: CLOSE_DURATION, easing: 'ease-in', fill: 'forwards' },
  );

  try {
    await flyerAnim.finished;
  } catch {
    // Interrupted.
  }

  teardown();
  isAnimating = false;
}
