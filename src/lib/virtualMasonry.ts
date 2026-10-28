// Virtual masonry layout engine.
// Manages column-based layout, viewport culling, scroll-driven processing,
// and idle-time thumbnail prefetching. Wire up via mount/destroy in a Svelte effect.
import type {
  LayoutItem,
  MasonryState,
  VirtualMasonryOptions,
  MediaEntry,
} from "./types.ts";

const DEFAULT_BREAKPOINTS: Record<number, number> = {
  480: 2,
  720: 3,
  1024: 4,
  1440: 5,
  Infinity: 6,
};
const DEFAULT_GAP = 10;
const DEFAULT_VIEWPORT_MARGIN = 400;
const DEFAULT_LOOKAHEAD = 800;
const DEFAULT_IDLE_DELAY = 5_000;

export function createVirtualMasonry<T extends MediaEntry = MediaEntry>(
  options: VirtualMasonryOptions<T> = {} as VirtualMasonryOptions<T>,
) {
  const {
    getItemHeight,
    getItemKey = (item: T) => item.id,
    breakpoints = DEFAULT_BREAKPOINTS,
    gap = DEFAULT_GAP,
    viewportMargin = DEFAULT_VIEWPORT_MARGIN,
    lookahead = DEFAULT_LOOKAHEAD,
    idleDelay = DEFAULT_IDLE_DELAY,
    onItemsEntered = null,
    paddingX = 32,
  } = options;

  if (typeof getItemHeight !== "function") {
    throw new Error("[createVirtualMasonry] options.getItemHeight is required");
  }

  // Breakpoints are static for the lifetime of this instance — sort once and cache.
  const _sortedBreakpoints: number[] = Object.keys(breakpoints)
    .map(Number)
    .sort((a, b) => a - b);

  // Internal layout state
  let containerEl: HTMLElement | null = null;
  let colCount = 4;
  let colWidth = 200;
  let scrollTop = 0;
  let viewportHeight = 800;
  let containerHeight = 0;
  let layoutItems: LayoutItem<T>[] = [];
  let _colHeights: number[] = [];
  let _maxHeight = 0;

  let onStateChange: (state: MasonryState<T>) => void = () => {};
  let _cachedVisible: LayoutItem<T>[] = [];
  let _visibleDirty = true;
  // Re-entrancy guard: prevents a reactive onStateChange callback from calling
  // back into setItems/refreshItems/append during notify(). Re-entrant calls
  // are coalesced and deferred to a microtask.
  let _notifying = false;
  let _pendingNotify = false;

  function _getVisible(): LayoutItem<T>[] {
    if (_visibleDirty) {
      _cachedVisible = _computeVisible();
      _visibleDirty = false;
    }
    return _cachedVisible;
  }

  function notify(): void {
    // Bail if destroy() was called before a deferred microtask fires.
    if (!containerEl) return;
    // Sync scrollTop from the live DOM so deferred microtasks never emit a stale position.
    scrollTop = containerEl.scrollTop;
    _visibleDirty = true;
    if (_notifying) {
      // Re-entrant call from inside onStateChange: coalesce and defer.
      _pendingNotify = true;
      return;
    }
    _notifying = true;
    try {
      onStateChange({
        colCount,
        colWidth,
        scrollTop,
        viewportHeight,
        containerHeight,
        visibleItems: _getVisible(),
      });
    } finally {
      _notifying = false;
      if (_pendingNotify) {
        _pendingNotify = false;
        // Defer so the current call stack fully unwinds before the next emit.
        queueMicrotask(notify);
      }
    }
  }

  function getColsForWidth(w: number): number {
    // Skip Infinity so it's only used as the fallback below.
    for (const bp of _sortedBreakpoints) {
      if (bp === Infinity) continue;
      if (w < bp) return breakpoints[bp];
    }
    return breakpoints[Infinity] ?? 1;
  }

  function buildLayout(items: T[], cols: number, cw: number): void {
    if (!cw || !cols || !items.length) {
      layoutItems = [];
      containerHeight = 0;
      _colHeights = [];
      _maxHeight = 0;
      notify();
      return;
    }
    _colHeights = new Array(cols).fill(0);
    _maxHeight = 0;
    const result: LayoutItem<T>[] = [];
    _appendItems(items, result, cols, cw);
    layoutItems = result;
    containerHeight = _maxHeight;
    notify();
  }

  function appendToLayout(newItems: T[], allItems: T[]): void {
    if (!newItems.length || !colCount || !colWidth) return;
    const needsFullBuild =
      !_colHeights.length ||
      _colHeights.length !== colCount ||
      layoutItems.length + newItems.length !== allItems.length;
    if (needsFullBuild) {
      buildLayout(allItems, colCount, colWidth);
      return;
    }
    const added: LayoutItem<T>[] = [];
    _appendItems(newItems, added, colCount, colWidth);
    layoutItems = [...layoutItems, ...added];
    containerHeight = _maxHeight;
    notify();
  }

  function _appendItems(
    items: T[],
    out: LayoutItem<T>[],
    cols: number,
    cw: number,
  ): void {
    // Mutates _colHeights[] and _maxHeight. Callers must ensure the correct
    // pre-condition: buildLayout resets _colHeights to zeros (full build),
    // appendToLayout preserves them from the previous pass (incremental).
    for (let i = 0; i < items.length; i++) {
      let col = 0;
      for (let c = 1; c < cols; c++) {
        if (_colHeights[c] < _colHeights[col]) col = c;
      }
      const item = items[i];
      const h = getItemHeight(item, cw);
      const cardHeight = Math.max(h | 0, 1);
      const x = col * (cw + gap);
      const y = _colHeights[col];
      out.push({
        key: getItemKey(item),
        item,
        x,
        y,
        width: cw,
        height: cardHeight,
      });
      _colHeights[col] += cardHeight + gap;
      const colH = _colHeights[col] - gap;
      if (colH > _maxHeight) _maxHeight = colH;
    }
  }

  function _computeVisible(): LayoutItem<T>[] {
    const top = scrollTop - viewportMargin;
    const bottom = scrollTop + viewportHeight + viewportMargin;
    return layoutItems.filter((it) => it.y + it.height > top && it.y < bottom);
  }

  function getVisibleItems(): LayoutItem<T>[] {
    return _getVisible();
  }

  function getLayoutItems(): LayoutItem<T>[] {
    return layoutItems;
  }

  let rafId: number | null = null;
  let scrollRafId: number | null = null;

  function onScroll(_e: Event): void {
    // Always read from the container element directly, not e.target, which may
    // be a nested scrollable child and would break virtual culling.
    scrollTop = containerEl?.scrollTop ?? 0;
    // Reset idle timer on scroll so prefetch anchors to last user interaction.
    schedulePipeline(true);
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      notify();
      rafId = null;
    });
  }

  let lastProcessTop = -1;
  let lastProcessBottom = -1;
  let processTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function runProcess(): void {
    if (!onItemsEntered) return;
    const top = scrollTop;
    const bottom = top + viewportHeight;
    if (
      Math.abs(top - lastProcessTop) < 50 &&
      Math.abs(bottom - lastProcessBottom) < 50
    )
      return;
    lastProcessTop = top;
    lastProcessBottom = bottom;
    // The effective lookahead must be at least as wide as viewportMargin so
    // items already in the off-screen buffer are also passed to the pipeline.
    const effectiveLookahead = Math.max(lookahead, viewportMargin);
    const visible: T[] = [];
    const lookAheadItems: T[] = [];
    for (const it of layoutItems) {
      const inViewport = it.y + it.height > top && it.y < bottom;
      const inLookahead =
        it.y + it.height > top - effectiveLookahead &&
        it.y < bottom + effectiveLookahead;
      if (inViewport) visible.push(it.item);
      else if (inLookahead) lookAheadItems.push(it.item);
    }
    if (visible.length) onItemsEntered(visible, "visible");
    if (lookAheadItems.length) onItemsEntered(lookAheadItems, "lookahead");
  }

  function runIdle(): void {
    if (!onItemsEntered) return;
    const top = scrollTop;
    const bottom = top + viewportHeight;
    // Keep the idle zone boundary consistent with the effective lookahead.
    const effectiveLookahead = Math.max(lookahead, viewportMargin);
    const idleItems: T[] = [];
    for (const it of layoutItems) {
      const inActive =
        it.y + it.height > top - effectiveLookahead &&
        it.y < bottom + effectiveLookahead;
      if (!inActive) idleItems.push(it.item);
    }
    if (idleItems.length) onItemsEntered(idleItems, "idle");
  }

  // `priority` = true (scroll): 120ms debounce; false (layout): 200ms.
  // Idle timer resets on priority calls so prefetch anchors to last user interaction.
  function schedulePipeline(priority = false): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(runIdle, { timeout: 2000 });
      } else {
        runIdle();
      }
    }, idleDelay);

    if (processTimer) clearTimeout(processTimer);
    processTimer = setTimeout(runProcess, priority ? 120 : 200);
  }

  let savedScrollTop: number | null = null;
  // Snapshot used by restoreScroll to detect user scrolling between save and restore.
  let _scrollAtSave: number | null = null;

  function saveScroll(): void {
    if (containerEl) {
      savedScrollTop = containerEl.scrollTop;
      _scrollAtSave = savedScrollTop;
    }
  }

  function restoreScroll(): void {
    scrollRafId = null;
    if (containerEl && savedScrollTop !== null) {
      // Only restore if the user hasn't scrolled since saveScroll() ran.
      const currentScroll = containerEl.scrollTop;
      if (_scrollAtSave !== null && currentScroll === _scrollAtSave) {
        containerEl.scrollTop = savedScrollTop;
      }
      savedScrollTop = null;
      _scrollAtSave = null;
    }
  }

  function updateLayout(items: T[]): void {
    if (!containerEl) return;
    saveScroll();
    const w = containerEl.clientWidth - paddingX;
    viewportHeight = containerEl.clientHeight;
    const cols = getColsForWidth(w);
    const cw = Math.floor((w - (cols - 1) * gap) / cols);
    colCount = cols;
    colWidth = cw;
    lastProcessTop = -Infinity;
    lastProcessBottom = -Infinity;
    buildLayout(items, cols, cw);
    // buildLayout calls notify() but not schedulePipeline(); kick the
    // prefetch pipeline explicitly after every layout recalculation.
    schedulePipeline(false);
    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(restoreScroll);
  }

  let resizeObserver: ResizeObserver | null = null;
  let _items: T[] = [];

  function mount(
    el: HTMLElement,
    items: T[],
    onUpdate: (state: MasonryState<T>) => void,
  ): void {
    // Guard against re-mount without an intervening destroy() (e.g. a $effect
    // re-running due to a non-element dependency change).
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    containerEl = el;
    _items = items;
    onStateChange = onUpdate;
    resizeObserver = new ResizeObserver(() => updateLayout(_items));
    resizeObserver.observe(el);
    updateLayout(_items);
  }

  function destroy(): void {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (processTimer) clearTimeout(processTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (rafId) cancelAnimationFrame(rafId);
    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    // Nullify all references so GC can collect the DOM node and item data.
    containerEl = null;
    _items = [];
    layoutItems = [];
    _colHeights = [];
    savedScrollTop = null;
    _scrollAtSave = null;
    _notifying = false;
    _pendingNotify = false;
    onStateChange = () => {};
  }

  function setItems(items: T[]): void {
    _items = items;
    updateLayout(items);
  }

  function refreshItems(items: T[]): void {
    // If the layout hasn't been built yet but items exist (metadata update
    // racing the initial mount), promote to a full setItems.
    if (!layoutItems.length) {
      if (items.length) setItems(items);
      return;
    }
    _items = items;
    const map = new Map<string, T>();
    for (const it of items) map.set(getItemKey(it), it);

    // If any item was removed from the array the layout must be fully rebuilt —
    // a missing item leaves a zombie LayoutItem that disrupts column heights.
    const hasDeletedItems =
      items.length !== layoutItems.length ||
      layoutItems.some((li) => !map.has(li.key));
    if (hasDeletedItems) {
      saveScroll();
      buildLayout(_items, colCount, colWidth);
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
      scrollRafId = requestAnimationFrame(restoreScroll);
      schedulePipeline(false);
      return;
    }

    let changed = false;
    let needsRebuild = false;
    for (let i = 0; i < layoutItems.length; i++) {
      const li = layoutItems[i];
      const fresh = map.get(li.key);
      if (fresh && fresh !== li.item) {
        if (
          fresh.width > 0 &&
          fresh.height > 0 &&
          (!(li.item.width > 0) || !(li.item.height > 0))
        ) {
          needsRebuild = true;
        }
        layoutItems[i] = { ...li, item: fresh };
        changed = true;
      }
    }
    if (needsRebuild) {
      saveScroll();
      buildLayout(_items, colCount, colWidth);
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
      scrollRafId = requestAnimationFrame(restoreScroll);
      schedulePipeline(false);
      return;
    }
    if (changed) {
      _visibleDirty = true;
      notify();
    }
  }

  return {
    mount,
    destroy,
    setItems,
    refreshItems,
    onScroll,
    getVisibleItems,
    getLayoutItems,
    appendToLayout: (newItems: T[]) => {
      // Update _items BEFORE calling the internal function so that any
      // ResizeObserver-triggered updateLayout(_items) sees the full array.
      _items = [..._items, ...newItems];
      appendToLayout(newItems, _items);
      schedulePipeline(false);
    },
    getContainerHeight: () => containerHeight,
  };
}
