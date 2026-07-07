import { pageLoop } from '../scroll.js';

const OPPOSITE_FILTER = {
  animation: 'illustration',
  illustration: 'animation',
};

const FILTER_MATCHES = {
  animation: (media) => !media.isVideo,
  illustration: (media) => media.isVideo,
};

const CRAYON_REDS = ['#d6362b', '#c92b22', '#e0463a'];
const CRAYON_BLACKS = ['#1a1a1a', '#000000', '#2b2b2b'];
const svgNS = 'http://www.w3.org/2000/svg';

function ensureNavCrayonFilter() {
  if (document.getElementById('nav-crayon-filter')) return;

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  svg.innerHTML =
    '<defs>' +
      '<filter id="nav-crayon-filter" x="-20%" y="-80%" width="140%" height="260%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.018 0.5" numOctaves="3" seed="11" stitchTiles="stitch" result="wob"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="wob" scale="1" xChannelSelector="R" yChannelSelector="G" result="rough"/>' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.85 0.85" numOctaves="2" seed="4" stitchTiles="stitch" result="grain"/>' +
        '<feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.7 0 0 0 -0.32" result="mask"/>' +
        '<feComposite in="rough" in2="mask" operator="in"/>' +
      '</filter>' +
    '</defs>';
  document.body.appendChild(svg);
}

function buildStrikePath(width, height, seed) {
  const center = height / 2;
  const step = 3;
  const points = [];

  for (let x = 0; x <= width; x += step) {
    const t = x / width;
    const wobble =
      1.9 * Math.sin(t * Math.PI * 5 + seed) +
      0.95 * Math.sin(t * Math.PI * 9 + seed * 1.7) +
      0.5 * Math.sin(t * Math.PI * 13 + seed * 0.5);
    points.push(`${x.toFixed(1)} ${(center + wobble).toFixed(1)}`);
  }

  return `M${points.join(' L')}`;
}

function buildCirclePath(cx, cy, rx, ry, seed, steps = 56) {
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const wobble =
      2.0 * Math.sin(angle * 4 + seed) +
      1.0 * Math.sin(angle * 7 + seed * 1.5) +
      0.5 * Math.sin(angle * 11 + seed * 0.8);
    const x = cx + (rx + wobble * 0.42) * Math.cos(angle);
    const y = cy + (ry + wobble * 0.36) * Math.sin(angle);
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  return `M${points.join(' L')} Z`;
}

function appendCrayonPaths(svg, pathForSeed, colors = CRAYON_REDS) {
  const strokes = [
    { offset: 2.0, color: colors[1], width: 1, opacity: 0.85 },
    { offset: 0, color: colors[0], width: 1, opacity: 1 },
    { offset: -2.2, color: colors[2], width: 1.6, opacity: 0.9 },
  ];

  strokes.forEach(({ offset, color, width: strokeWidth, opacity }) => {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', pathForSeed(offset));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(strokeWidth));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', String(opacity));
    path.setAttribute('filter', 'url(#nav-crayon-filter)');
    svg.appendChild(path);
  });
}

function createNavStrike(label, filter) {
  const width = Math.ceil(label.getBoundingClientRect().width);
  const height = 12;
  const seed = filter === 'animation' ? 1.3 : 2.7;
  const svg = document.createElementNS(svgNS, 'svg');

  svg.classList.add('site-nav__strike');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');

  appendCrayonPaths(
    svg,
    (offset) => buildStrikePath(width, height, seed + offset * 0.15),
    CRAYON_BLACKS,
  );

  return svg;
}

function createNavCircle(label, filter) {
  const labelWidth = Math.ceil(label.offsetWidth);
  const labelHeight = Math.ceil(label.offsetHeight);
  const padX = 8;
  const padY = 3;
  const rx = labelWidth / 2 + padX;
  const ry = labelHeight / 2 + padY;
  const width = Math.ceil(rx * 2 + 2);
  const height = Math.ceil(ry * 2 + 2);
  const cx = width / 2;
  const cy = height / 2;
  const seed = filter === 'animation' ? 3.1 : 4.8;
  const svg = document.createElementNS(svgNS, 'svg');

  svg.classList.add('site-nav__circle');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  svg.setAttribute('aria-hidden', 'true');

  appendCrayonPaths(
    svg,
    (offset) => buildCirclePath(cx, cy, rx, ry, seed + offset * 0.15),
  );

  return svg;
}

async function prepareNavFilterItems(navItems) {
  ensureNavCrayonFilter();

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  navItems.forEach((navItem) => {
    if (navItem.querySelector('.site-nav__filter-wrap')) return;

    const wrap = document.createElement('span');
    wrap.className = 'site-nav__filter-wrap';

    const label = document.createElement('span');
    label.className = 'site-nav__label';
    label.textContent = navItem.textContent.trim();
    navItem.textContent = '';
    wrap.appendChild(label);
    navItem.appendChild(wrap);
    wrap.appendChild(createNavCircle(label, navItem.dataset.filter));
    wrap.appendChild(createNavStrike(label, navItem.dataset.filter));
  });
}

function updateNavDecorations(navItems, activeFilter) {
  const strikeFilter = activeFilter ? OPPOSITE_FILTER[activeFilter] : null;

  navItems.forEach((navItem) => {
    const filter = navItem.dataset.filter;
    const strike = navItem.querySelector('.site-nav__strike');
    const circle = navItem.querySelector('.site-nav__circle');

    strike?.classList.toggle('is-visible', filter === strikeFilter);
    circle?.classList.toggle('is-visible', filter === activeFilter);
  });
}

export async function initGalleryFilters(catalog, grids) {
  const gridList = Array.isArray(grids) ? grids : [grids];
  const navItems = document.querySelectorAll('.site-nav li[data-filter]');
  await prepareNavFilterItems(navItems);

  let activeFilter = null;

  function catalogIndex(id) {
    return catalog.findIndex((item) => item.id === id);
  }

  function insertIndex(grid, id) {
    const idx = catalogIndex(id);
    let at = 0;
    for (let i = 0; i < idx; i += 1) {
      if (grid.has(catalog[i].id)) at += 1;
    }
    return at;
  }

  function planChange(grid, prevFilter, nextFilter) {
    const restore = [];
    let restoreAt = 0;

    if (prevFilter) {
      const match = FILTER_MATCHES[prevFilter];
      const toRestore = catalog.filter((media) => match(media) && !grid.has(media.id));
      toRestore.sort((a, b) => catalogIndex(a.id) - catalogIndex(b.id));
      if (toRestore.length) {
        restore.push(...toRestore);
        restoreAt = insertIndex(grid, toRestore[0].id);
      }
    }

    const removeIds = [];
    if (nextFilter) {
      const match = FILTER_MATCHES[nextFilter];
      removeIds.push(
        ...catalog.filter((media) => match(media) && grid.has(media.id)).map((media) => media.id),
      );
    }

    return { restore, restoreAt, removeIds };
  }

  function applyChange(grid, { restore, restoreAt, removeIds }, animated) {
    if (animated) {
      if (restore.length) grid.add(restore, { at: restoreAt });
      if (removeIds.length) grid.remove(removeIds);
      return;
    }

    grid.flush(() => {
      if (restore.length) grid.add(restore, { at: restoreAt });
      if (removeIds.length) grid.remove(removeIds);
    });
  }

  function gridForPage(page) {
    if (!page) return null;
    return gridList.find((grid) => grid.container.closest('.page') === page) || null;
  }

  navItems.forEach((navItem) => {
    navItem.addEventListener('click', () => {
      const { filter } = navItem.dataset;
      const prevFilter = activeFilter;
      activeFilter = filter === activeFilter ? null : filter;

      const primaryPage = navItem.closest('.page');
      const primaryGrid = gridForPage(primaryPage) || gridList[0];
      const plan = planChange(primaryGrid, prevFilter, activeFilter);
      if (!plan.restore.length && !plan.removeIds.length) {
        updateNavDecorations(navItems, activeFilter);
        return;
      }

      const ops = gridList.map((grid) => ({
        page: grid.container.closest('.page'),
        apply: (animated) => applyChange(grid, plan, animated),
      }));

      pageLoop.applyFilter(primaryPage, ops);
      updateNavDecorations(navItems, activeFilter);
    });
  });
}
