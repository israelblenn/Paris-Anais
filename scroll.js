// Minimum stacked page copies needed for a seamless two-way loop (one full
// period of headroom on each side of the anchor band).
export const LOOP_MIN_COPIES = 3;

/**
 * Map an arbitrary scrollTop back into the anchor band [period, 2*period).
 * Because every period is identical content, teleporting by a whole number of
 * periods is invisible. Returns the target scrollTop, or null when looping does
 * not apply (too few copies / unknown period).
 */
function loopNormalize(scrollTop, period, copies = LOOP_MIN_COPIES) {
  if (!(period > 0) || copies < LOOP_MIN_COPIES) return null;
  const rel = (((scrollTop - period) % period) + period) % period;
  return period + rel;
}

export const pageLoop = {};

initScroll();

function initScroll() {
  const animationConfig = {
    totalFrames: 12,
    frameWidth: 100,
    frameHeight: 100,
    pixelsPerCycle: 1000,
  };

  const scrollArea = document.querySelector('.scroll-area');
  const scrollThumbWrapper = document.querySelector('.scroll-thumb-wrapper');
  const scrollThumbs = document.querySelectorAll('.scroll-thumb');
  const mainThumb = scrollThumbs[0];
  const ghostThumb = scrollThumbs[1];
  const topWheel = document.querySelector('.scroll-wheel--top');
  const bottomWheel = document.querySelector('.scroll-wheel--bottom');
  const spriteContainer = document.querySelector('.scroll-animation__sprites');
  const scrollAnimation = document.querySelector('.scroll-animation');

  if (!scrollArea) return;

  function getScrollAnimationScale() {
    if (!scrollAnimation) return 1;
    const scale = parseFloat(
      getComputedStyle(scrollAnimation).getPropertyValue('--scroll-animation-scale'),
    );
    return Number.isFinite(scale) ? scale : 1;
  }

  let isDragging = false;
  let suppressClickAfterThumbDrag = false;
  let scrollStartY = 0;
  let initialScrollTop = 0;
  let currentFrame = -1;
  let scrollScheduled = false;
  let suppressWrap = false;
  let settleTimer = null;
  let aboutScrollFrame = null;
  let pinObserver = null;
  let stabilizeAnchor = null;
  let stabilizeTargetTop = 0;
  let wrapDebounceTimer = null;
  let pinAdjusting = false;
  let userScrollPending = false;
  let isUserScrolling = false;
  let activePeriod = 0;

  function measurePeriod() {
    const pages = scrollArea.querySelectorAll('.page');
    if (pages.length < LOOP_MIN_COPIES) return 0;
    const height = pages[0].offsetHeight;
    return height > 0 ? height : 0;
  }

  function initActivePeriod() {
    const measured = measurePeriod();
    if (measured > 0) activePeriod = measured;
    return activePeriod;
  }

  function refreshActivePeriod() {
    const measured = measurePeriod();
    if (measured > 0) activePeriod = measured;
    return activePeriod;
  }

  // Rewriting scrollTop during active scroll causes jitter at the loop seam.
  const hasScrollEnd = 'onscrollend' in window;

  function pageCount() {
    return scrollArea.querySelectorAll('.page').length;
  }

  function getPeriod() {
    return activePeriod > 0 ? activePeriod : measurePeriod();
  }

  function applyLoopWrap() {
    const period = getPeriod();
    const target = loopNormalize(scrollArea.scrollTop, period, pageCount());
    if (target !== null && Math.abs(target - scrollArea.scrollTop) > 0.5) {
      scrollArea.scrollTop = Math.round(target);
    }
  }

  function loopWrapNow() {
    if (!suppressWrap) applyLoopWrap();
  }

  function scheduleLoopWrap() {
    if (suppressWrap) return;

    // Wait for scroll to settle; scrollend handles wrap when supported.
    if (hasScrollEnd) return;

    clearTimeout(wrapDebounceTimer);
    wrapDebounceTimer = setTimeout(loopWrapNow, 120);
  }

  function nearestPageBreak() {
    const areaTop = scrollArea.getBoundingClientRect().top;
    let nearest = null;
    let nearestDist = Infinity;

    for (const page of scrollArea.querySelectorAll('.page')) {
      const dist = Math.abs(page.getBoundingClientRect().top - areaTop);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = page;
      }
    }

    return nearest;
  }

  function pinSync(refPage, fn) {
    if (!refPage) { fn(); return; }
    const areaTop = scrollArea.getBoundingClientRect().top;
    const before = refPage.getBoundingClientRect().top - areaTop;
    fn();
    const after = refPage.getBoundingClientRect().top - areaTop;
    scrollArea.scrollTop += after - before;
  }

  function compensateAnchorDrift() {
    if (!stabilizeAnchor || isUserScrolling || userScrollPending) return;
    const areaTop = scrollArea.getBoundingClientRect().top;
    const drift = stabilizeAnchor.getBoundingClientRect().top - areaTop - stabilizeTargetTop;
    if (Math.abs(drift) > 0.25) {
      pinAdjusting = true;
      scrollArea.scrollTop += drift;
    }
  }

  function stopPinObserver() {
    pinObserver?.disconnect();
    pinObserver = null;
    stabilizeAnchor = null;
  }

  function endStabilize() {
    if (isUserScrolling) {
      settleTimer = setTimeout(endStabilize, 400);
      return;
    }
    clearTimeout(settleTimer);
    settleTimer = null;
    stopPinObserver();
    suppressWrap = false;
    applyLoopWrap();
    handleScroll();
  }

  // Keep the nearest page break fixed in the viewport while any copy
  // resizes (instant clone updates or the primary gallery height animation).
  function pinAnchorDuringResize(anchor) {
    stopPinObserver();
    if (!anchor) return;

    stabilizeAnchor = anchor;
    stabilizeTargetTop = anchor.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top;

    pinObserver = new ResizeObserver(() => compensateAnchorDrift());

    for (const page of scrollArea.querySelectorAll('.page')) {
      pinObserver.observe(page);
    }
  }

  // Enter the loop band after first paint and hold scroll steady while media,
  // fonts, and iOS viewport chrome settle (often 1–4s after load).
  pageLoop.enterLoopBand = (holdMs = 6000) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const period = initActivePeriod();
      if (period <= 0) return;

      clearTimeout(settleTimer);
      suppressWrap = true;
      clearTimeout(wrapDebounceTimer);

      const target = loopNormalize(scrollArea.scrollTop, period, pageCount()) ?? period;
      if (Math.abs(scrollArea.scrollTop - target) > 0.5) {
        scrollArea.scrollTop = target;
      }
      pinAnchorDuringResize(nearestPageBreak());
      compensateAnchorDrift();

      settleTimer = setTimeout(endStabilize, holdMs);
    }));
  };

  pageLoop.applyFilter = (primaryPage, ops) => {
    if (getPeriod() <= 0) {
      ops.forEach((op) => op.apply(op.page === primaryPage));
      return;
    }

    clearTimeout(settleTimer);
    suppressWrap = true;
    clearTimeout(wrapDebounceTimer);

    const anchor = nearestPageBreak();
    pinSync(anchor, () => {
      ops.forEach((op) => op.apply(op.page === primaryPage));
    });
    pinAnchorDuringResize(anchor);

    settleTimer = setTimeout(endStabilize, 900);
  };

  function updateScrollAnimation() {
    if (!spriteContainer) return;

    const scrollY = scrollArea.scrollTop;
    const scrollPosition = scrollY % animationConfig.pixelsPerCycle;
    const scrollProgress = scrollPosition / animationConfig.pixelsPerCycle;
    const frameIndex = Math.floor(scrollProgress * animationConfig.totalFrames);

    if (frameIndex === currentFrame) return;

    currentFrame = frameIndex;
    const frameWidth = animationConfig.frameWidth * getScrollAnimationScale();
    spriteContainer.style.transform = `translateX(${-(currentFrame * frameWidth)}px)`;
  }

  function updateScrollbar() {
    if (!mainThumb) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollArea;
    const period = getPeriod();

    let thumbHeight;
    let mainTop;
    let ghostTop;
    let progress;
    const looping = period > 0;

    if (looping) {
      progress = (((scrollTop % period) + period) % period) / period;
      thumbHeight = Math.max(5, Math.min(100, (clientHeight / period) * 100));
      mainTop = progress * 100;
      ghostTop = mainTop - 100;
    } else {
      const maxScroll = scrollHeight - clientHeight;
      thumbHeight = Math.max(scrollHeight > 0 ? (clientHeight / scrollHeight) * 100 : 100, 5);
      progress = maxScroll > 0 ? scrollTop / maxScroll : 0;
      mainTop = progress * (100 - thumbHeight);
    }

    mainThumb.style.height = `${thumbHeight}%`;
    mainThumb.style.top = `${mainTop}%`;

    if (ghostThumb) {
      ghostThumb.style.display = looping ? '' : 'none';
      if (looping) {
        ghostThumb.style.height = `${thumbHeight}%`;
        ghostThumb.style.top = `${ghostTop}%`;
      }
    }

    if (topWheel && bottomWheel) {
      const rotation = progress * 360;
      topWheel.style.transform = `rotate(-${rotation}deg)`;
      bottomWheel.style.transform = `rotate(-${rotation}deg)`;
    }
  }

  function handleScroll() {
    if (scrollScheduled) return;

    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      updateScrollbar();
      updateScrollAnimation();
    });
  }

  function snapAboutToTop(about) {
    const delta = about.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top;
    if (Math.abs(delta) >= 0.5) scrollArea.scrollTop += delta;
  }

  function cancelAboutScroll() {
    if (aboutScrollFrame) {
      cancelAnimationFrame(aboutScrollFrame);
      aboutScrollFrame = null;
    }
  }

  function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
  }

  function animateToAbout(about, done) {
    cancelAboutScroll();
    const start = scrollArea.scrollTop;
    const startedAt = performance.now();
    const duration = 900;

    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const areaTop = scrollArea.getBoundingClientRect().top;
      const aboutTop = about.getBoundingClientRect().top - areaTop;
      const target = scrollArea.scrollTop + aboutTop;

      scrollArea.scrollTop = start + (target - start) * easeOutCubic(progress);

      if (progress < 1) {
        aboutScrollFrame = requestAnimationFrame(tick);
      } else {
        aboutScrollFrame = null;
        done();
      }
    };

    aboutScrollFrame = requestAnimationFrame(tick);
  }

  function snapNearestAboutToTop() {
    const areaTop = scrollArea.getBoundingClientRect().top;
    let nearest = null;
    let nearestDist = Infinity;

    for (const el of scrollArea.querySelectorAll('.about')) {
      const dist = Math.abs(el.getBoundingClientRect().top - areaTop);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = el;
      }
    }

    if (nearest) snapAboutToTop(nearest);
  }

  function scrollToAbout(fromPage) {
    const pages = [...scrollArea.querySelectorAll('.page')];
    const index = pages.indexOf(fromPage);
    if (index < 0) return;

    const prevPage = pages[index - 1] ?? pages[pages.length - 1];
    const about = prevPage?.querySelector('.about');
    if (!about) return;

    const areaTop = scrollArea.getBoundingClientRect().top;
    const aboutTop = about.getBoundingClientRect().top - areaTop;

    if (Math.abs(aboutTop) < 2) return;

    clearTimeout(settleTimer);
    stopPinObserver();
    suppressWrap = true;
    clearTimeout(wrapDebounceTimer);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;

      snapAboutToTop(about);
      suppressWrap = false;
      applyLoopWrap();
      snapNearestAboutToTop();
      handleScroll();
    };

    const target = scrollArea.scrollTop + aboutTop;

    if (Math.abs(aboutTop) <= 48) {
      cancelAboutScroll();
      scrollArea.scrollTop = target;
      finish();
      return;
    }

    animateToAbout(about, finish);
  }

  scrollThumbs.forEach((thumb) => {
    thumb.addEventListener('mousedown', (event) => {
      event.preventDefault();
      isDragging = true;
      scrollStartY = event.clientY;
      initialScrollTop = scrollArea.scrollTop;
      document.body.classList.add('scroll-thumb-dragging');
    });
  });

  document.addEventListener('mousemove', (event) => {
    if (!isDragging) return;

    const deltaY = event.clientY - scrollStartY;
    const period = getPeriod();
    const scrollRatio = period > 0
      ? period / (scrollThumbWrapper?.clientHeight || scrollArea.clientHeight)
      : scrollArea.scrollHeight / scrollArea.clientHeight;
    scrollArea.scrollTop = initialScrollTop + deltaY * scrollRatio;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) suppressClickAfterThumbDrag = true;
    isDragging = false;
    document.body.classList.remove('scroll-thumb-dragging');
  });

  document.addEventListener('click', (event) => {
    if (!suppressClickAfterThumbDrag) return;
    suppressClickAfterThumbDrag = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  function onViewportChange() {
    refreshActivePeriod();
    compensateAnchorDrift();
    applyLoopWrap();
    handleScroll();
  }

  function markUserScroll() {
    userScrollPending = true;
    isUserScrolling = true;
    stopPinObserver();
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(endStabilize, 400);
    }
  }

  scrollArea.addEventListener('scroll', () => {
    pinAdjusting = false;
    scheduleLoopWrap();
    handleScroll();
  }, { passive: true });
  scrollArea.addEventListener('touchstart', markUserScroll, { passive: true });
  scrollArea.addEventListener('wheel', markUserScroll, { passive: true });
  scrollArea.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      markUserScroll();
    }
  });
  scrollArea.addEventListener('scrollend', () => {
    isUserScrolling = false;
    userScrollPending = false;
    refreshActivePeriod();
    loopWrapNow();
  }, { passive: true });
  window.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('resize', onViewportChange);

  document.addEventListener('click', (event) => {
    const item = event.target.closest('.site-nav li[data-scroll-to="about"]');
    if (!item) return;
    const page = item.closest('.page');
    if (page) scrollToAbout(page);
  });

  const observer = new MutationObserver(handleScroll);
  observer.observe(scrollArea, {
    childList: true,
    subtree: true,
  });

  handleScroll();
}
