const PREFERS_REDUCED_MOTION = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function shortestColumn(heights) {
  let index = 0;
  for (let i = 1; i < heights.length; i += 1) {
    if (heights[i] < heights[index]) index = i;
  }
  return index;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultColumnCount(width) {
  if (width < 560) return 1;
  if (width < 920) return 2;
  return 3;
}

function itemTransform(x, y, rotation) {
  return `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg)`;
}

function stableRotation(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 400) / 100 - 2;
}

export class MasonryGrid {
  constructor(container, options = {}) {
    this.container = container;
    this.gap = options.gap ?? 16;
    this.getColumnCount = options.getColumnCount ?? defaultColumnCount;
    this.renderItem = options.renderItem ?? (() => null);

    this.moveDuration = options.moveDuration ?? 520;
    this.enterDuration = options.enterDuration ?? 420;
    this.exitDuration = options.exitDuration ?? 320;
    this.stagger = options.stagger ?? 24;
    this.easing = options.easing ?? 'cubic-bezier(0.22, 1, 0.36, 1)';

    this.motion = !PREFERS_REDUCED_MOTION;
    this.records = [];

    this._contentHeight = 0;
    this._heightAnim = null;
    this._frame = null;
    this._pendingAnimate = false;
    this._deferEnter = false;
    this._lastWidth = container.clientWidth;
    this._columnCount = this.getColumnCount(this._lastWidth);

    this._resizeObserver = new ResizeObserver(() => {
      const width = this.container.clientWidth;
      if (width === this._lastWidth) return;
      this._lastWidth = width;
      this.requestLayout(false);
    });
    this._resizeObserver.observe(this.container);
  }

  get columnCount() {
    return this._columnCount;
  }

  has(id) {
    return this.records.some((rec) => rec.id === id && !rec.removing);
  }

  getRecord(id) {
    return this.records.find((rec) => rec.id === id);
  }

  add(mediaList, { at } = {}) {
    const list = Array.isArray(mediaList) ? mediaList : [mediaList];
    if (!list.length) return [];

    const newRecords = list.map((media) => this._createRecord(media));
    const index = at == null ? this.records.length : clamp(at, 0, this.records.length);
    const existingCount = this.records.length;
    this.records.splice(index, 0, ...newRecords);

    const fragment = document.createDocumentFragment();
    for (const rec of newRecords) {
      rec.awaitingEnter = existingCount > 0;
      fragment.appendChild(rec.el);
    }
    this.container.appendChild(fragment);

    this._deferEnter = existingCount > 0 && this.motion;
    this.requestLayout(this.motion);
    return newRecords.map((rec) => rec.id);
  }

  remove(ids) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    const targets = this.records.filter((rec) => idSet.has(rec.id) && !rec.removing);
    if (!targets.length) return;

    let exitsRemaining = targets.length;

    for (const rec of targets) {
      rec.removing = true;
      this._exit(rec, () => {
        rec.el.remove();
        const i = this.records.indexOf(rec);
        if (i >= 0) this.records.splice(i, 1);

        exitsRemaining -= 1;
        if (exitsRemaining === 0) {
          this.requestLayout(this.motion);
        }
      });
    }
  }

  setAspectRatio(id, ratio) {
    const rec = this.getRecord(id);
    if (!rec || !Number.isFinite(ratio) || ratio <= 0) return;
    const delta = Math.abs(ratio - rec.aspectRatio) / rec.aspectRatio;
    if (delta < 0.02) return;
    rec.aspectRatio = ratio;
    this.requestLayout(false);
  }

  flush(mutate) {
    if (this._frame) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    this._pendingAnimate = false;
    this._deferEnter = false;
    this._heightAnim?.cancel();

    const prevMotion = this.motion;
    this.motion = false;
    for (const rec of this.records) {
      rec._moveAnim?.cancel();
      rec._moveAnim = null;
      rec.el.style.willChange = '';
      rec.awaitingEnter = false;
    }

    mutate?.();

    if (this._frame) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    this._pendingAnimate = false;
    this._runLayout(false);

    for (const rec of this.records) {
      if (!rec.removing) rec.el.style.opacity = '1';
    }
    this.motion = prevMotion;
  }

  lift(id) {
    this.getRecord(id)?.el.classList.add('is-lifted');
  }

  drop(id) {
    this.getRecord(id)?.el.classList.remove('is-lifted');
  }

  requestLayout(animate = false) {
    this._pendingAnimate = this._pendingAnimate || animate;
    if (this._frame) return;

    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      const animateThisPass = this._pendingAnimate;
      this._pendingAnimate = false;
      this._runLayout(animateThisPass);
    });
  }

  _runLayout(animate) {
    const width = this.container.clientWidth;
    if (width <= 0) return;

    this._lastWidth = width;
    const columnCount = this.getColumnCount(width);
    this._columnCount = columnCount;

    const columnWidth = (width - this.gap * (columnCount - 1)) / columnCount;
    const columnHeights = new Array(columnCount).fill(0);

    const placements = [];
    for (const rec of this.records) {
      if (rec.removing) continue;

      const column = shortestColumn(columnHeights);
      const x = column * (columnWidth + this.gap);
      const y = columnHeights[column];
      const height = columnWidth / rec.aspectRatio;

      placements.push({
        rec,
        x,
        y,
        w: columnWidth,
        h: height,
        oldX: rec.x,
        oldY: rec.y,
        wasPlaced: rec.placed,
      });

      rec.x = x;
      rec.y = y;
      rec.w = columnWidth;
      rec.h = height;
      rec.column = column;
      columnHeights[column] += height + this.gap;
    }

    const contentHeight = Math.round(Math.max(0, ...columnHeights) - this.gap);
    this._setContentHeight(contentHeight, animate);

    const deferEnter = this._deferEnter;
    this._deferEnter = false;

    const movePromises = [];
    const pendingEnters = [];
    let enterIndex = 0;

    for (const { rec, x, y, w, h, oldX, oldY, wasPlaced } of placements) {
      rec.el.style.width = `${w}px`;
      rec.el.style.height = `${h}px`;
      const finalTransform = itemTransform(x, y, rec.rotation);

      if (rec.awaitingEnter) {
        rec.el.style.transform = finalTransform;
        rec.el.style.opacity = '0';
        rec.placed = true;
        pendingEnters.push({ rec, order: enterIndex });
        enterIndex += 1;
        continue;
      }

      if (!wasPlaced) {
        rec.el.style.transform = finalTransform;
        rec.placed = true;
        this._enter(rec, enterIndex);
        enterIndex += 1;
        continue;
      }

      const moved = oldX !== x || oldY !== y;
      if (animate && wasPlaced && this.motion && moved) {
        rec.el.style.transform = finalTransform;
        movePromises.push(this._animateMove(rec, oldX, oldY, finalTransform));
      } else {
        rec.el.style.transform = finalTransform;
      }
      rec.placed = true;
    }

    if (deferEnter && this.motion && pendingEnters.length) {
      Promise.all(movePromises).then(() => {
        for (const { rec, order } of pendingEnters) {
          rec.awaitingEnter = false;
          this._enter(rec, order);
        }
      });
      return;
    }

    for (const { rec, order } of pendingEnters) {
      rec.awaitingEnter = false;
      this._enter(rec, order);
    }
  }

  _setContentHeight(height, animate) {
    const from = this._contentHeight;
    this._contentHeight = height;
    this._heightAnim?.cancel();
    this.container.style.height = `${height}px`;

    if (!animate || !this.motion || from === height || from === 0) return;

    const anim = this.container.animate(
      [{ height: `${from}px` }, { height: `${height}px` }],
      { duration: this.moveDuration, easing: this.easing, fill: 'none' },
    );

    this._heightAnim = anim;
    const clear = () => { if (this._heightAnim === anim) this._heightAnim = null; };
    anim.onfinish = clear;
    anim.oncancel = clear;
  }

  _animateMove(rec, fromX, fromY, finalTransform) {
    rec._moveAnim?.cancel();
    rec.el.style.willChange = 'transform';

    const anim = rec.el.animate(
      [
        { transform: itemTransform(fromX, fromY, rec.rotation) },
        { transform: finalTransform },
      ],
      { duration: this.moveDuration, easing: this.easing, fill: 'none' },
    );

    rec._moveAnim = anim;
    return new Promise((resolve) => {
      const clear = () => {
        if (rec._moveAnim === anim) {
          rec._moveAnim = null;
          rec.el.style.willChange = '';
        }
        resolve();
      };
      anim.onfinish = clear;
      anim.oncancel = clear;
    });
  }

  _enter(rec, order) {
    if (!this.motion) {
      rec.el.style.opacity = '1';
      return;
    }

    const frame = rec.el.querySelector('.bg-item__frame');
    const delay = Math.min(order, 16) * this.stagger;
    const timing = { duration: this.enterDuration, delay, easing: this.easing, fill: 'both' };

    rec.el.style.willChange = 'opacity';
    const fade = rec.el.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      timing,
    );

    let scaleAnim;
    if (frame) {
      frame.style.willChange = 'transform';
      scaleAnim = frame.animate(
        [{ transform: 'scale(0.92)' }, { transform: 'scale(1)' }],
        timing,
      );
    }

    const cleanup = () => {
      rec.el.style.willChange = '';
      if (frame) {
        frame.style.willChange = '';
        frame.style.removeProperty('transform');
      }
    };

    fade.onfinish = fade.oncancel = cleanup;
    scaleAnim && (scaleAnim.onfinish = scaleAnim.oncancel = () => {});
  }

  _exit(rec, done) {
    if (!this.motion) {
      done();
      return;
    }

    rec._moveAnim?.cancel();
    const frame = rec.el.querySelector('.bg-item__frame');
    const timing = { duration: this.exitDuration, easing: this.easing, fill: 'forwards' };

    rec.el.style.willChange = 'opacity';
    const fade = rec.el.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      timing,
    );

    let scaleAnim;
    if (frame) {
      frame.style.willChange = 'transform';
      scaleAnim = frame.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.9)' }],
        timing,
      );
    }

    const finish = () => {
      rec.el.style.willChange = '';
      if (frame) {
        frame.style.willChange = '';
        frame.style.removeProperty('transform');
      }
      done();
    };

    fade.onfinish = fade.oncancel = finish;
    scaleAnim && (scaleAnim.onfinish = scaleAnim.oncancel = () => {});
  }

  _createRecord(media) {
    const el = document.createElement('figure');
    el.className = 'bg-item';
    el.dataset.id = media.id;
    const rotation = stableRotation(media.id);
    el.style.opacity = '0';
    el.style.transform = itemTransform(0, 0, rotation);

    const content = this.renderItem(media, el);
    if (content) el.appendChild(content);

    return {
      id: media.id,
      media,
      el,
      rotation,
      aspectRatio: media.aspectRatio > 0 ? media.aspectRatio : 1,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      column: 0,
      placed: false,
      awaitingEnter: false,
      removing: false,
      _moveAnim: null,
    };
  }
}
