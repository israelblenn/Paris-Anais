/**
 * Visibility-driven media loader, fully decoupled from layout.
 *
 * Images load once when they approach the viewport, then stop being observed.
 * Videos load + play in view and pause out of view. When a video reports its
 * intrinsic size, `onAspectRatio` lets the grid correct that item's slot.
 */

/** iOS/Safari autoplay checks muted/playsinline/autoplay in HTML attributes. */
export function configureInlineVideo(el) {
  el.muted = true;
  el.defaultMuted = true;
  el.loop = true;
  el.playsInline = true;
  el.autoplay = true;
  el.setAttribute('muted', '');
  el.setAttribute('loop', '');
  el.setAttribute('playsinline', '');
  el.setAttribute('webkit-playsinline', '');
  el.setAttribute('autoplay', '');
}

function setVideoSource(el, url) {
  let source = el.querySelector('source');
  if (!source) {
    source = document.createElement('source');
    source.type = 'video/mp4';
    el.append(source);
  }
  if (source.src !== url) {
    source.src = url;
    el.removeAttribute('src');
    el.load();
  }
}

/**
 * iOS often rejects the first muted-autoplay `play()` at page load (readiness /
 * decoder pressure). Persistent readiness listeners keep retrying until the
 * `playing` event confirms success, instead of giving up after one attempt.
 */
function ensureVideoPlays(el) {
  const attempt = () => {
    if (el.paused && el.isConnected && !el.closest('.bgm')) el.play().catch(() => {});
  };

  if (!el._playBound) {
    el._playBound = true;
    el.addEventListener('loadeddata', attempt);
    el.addEventListener('canplay', attempt);
    el.addEventListener('canplaythrough', attempt);
  }

  attempt();
}

export class LazyMedia {
  constructor({ root = null, rootMargin = '300px 0px', onAspectRatio } = {}) {
    this.onAspectRatio = onAspectRatio;
    this._media = new WeakMap();
    this._videos = new Set();
    this._root = root;

    this._observer = new IntersectionObserver((entries) => this._handle(entries), {
      root,
      rootMargin,
      threshold: 0,
    });

    if (root) {
      let scrollTimer;
      const resume = () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => this._resumeVisible(), 120);
      };
      root.addEventListener('scroll', resume, { passive: true });
      root.addEventListener('touchstart', () => this._resumeVisible(), { passive: true });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this._resumeVisible();
      });

      // Catch videos whose initial autoplay was rejected on load, without
      // needing a user gesture. ponytail: fixed sweep schedule, not adaptive.
      for (const delay of [400, 1000, 2000, 3500]) {
        setTimeout(() => this._resumeVisible(), delay);
      }
    }
  }

  observe(el, media) {
    this._media.set(el, media);
    if (el.tagName === 'VIDEO') this._videos.add(el);
    this._observer.observe(el);
  }

  unobserve(el) {
    this._observer.unobserve(el);
    this._media.delete(el);
    this._videos.delete(el);
  }

  _isInView(el) {
    const rect = el.getBoundingClientRect();
    if (!this._root) {
      return rect.bottom > 0 && rect.top < window.innerHeight;
    }
    const rootRect = this._root.getBoundingClientRect();
    return rect.bottom > rootRect.top && rect.top < rootRect.bottom
      && rect.right > rootRect.left && rect.left < rootRect.right;
  }

  _resumeVisible() {
    for (const el of this._videos) {
      if (el.closest('.bgm') || !el.paused || !this._isInView(el)) continue;
      this._activate(el, this._media.get(el));
    }
  }

  _handle(entries) {
    for (const entry of entries) {
      const el = entry.target;
      if (entry.isIntersecting) {
        this._activate(el, this._media.get(el));
      } else if (el.tagName === 'VIDEO' && !el.closest('.bgm')) {
        el.pause();
      }
    }
  }

  _activate(el, media) {
    if (el.tagName === 'IMG') {
      if (el.dataset.src) {
        el.src = el.dataset.src;
        delete el.dataset.src;
      }
      this.unobserve(el);
      return;
    }

    if (el.tagName === 'VIDEO') {
      if (el.dataset.src) {
        setVideoSource(el, el.dataset.src);
        delete el.dataset.src;
        el.addEventListener('loadedmetadata', () => {
          if (el.videoWidth > 0 && el.videoHeight > 0) {
            this.onAspectRatio?.(media?.id, el.videoWidth / el.videoHeight);
          }
        }, { once: true });
      }
      ensureVideoPlays(el);
    }
  }
}
