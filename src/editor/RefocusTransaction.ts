interface RefocusState {
  active: boolean;
  clearFrame: number | null;
}

const refocusStateByScroller = new WeakMap<HTMLElement, RefocusState>();

function getOrCreateState(scroller: HTMLElement): RefocusState {
  const existing = refocusStateByScroller.get(scroller);
  if (existing) return existing;

  const created: RefocusState = { active: false, clearFrame: null };
  refocusStateByScroller.set(scroller, created);
  return created;
}

export function isRefocusTransactionActive(scroller: HTMLElement): boolean {
  return getOrCreateState(scroller).active;
}

function cancelPendingDeactivation(state: RefocusState): void {
  if (state.clearFrame !== null) {
    cancelAnimationFrame(state.clearFrame);
    state.clearFrame = null;
  }
}

export function activateRefocusTransaction(scroller: HTMLElement): void {
  const state = getOrCreateState(scroller);
  cancelPendingDeactivation(state);
  state.active = true;
}

export function deactivateRefocusTransaction(scroller: HTMLElement): void {
  const state = getOrCreateState(scroller);
  cancelPendingDeactivation(state);
  state.active = false;
}

export function scheduleRefocusTransactionDeactivation(scroller: HTMLElement): void {
  const state = getOrCreateState(scroller);
  cancelPendingDeactivation(state);
  state.clearFrame = requestAnimationFrame(() => {
    const latest = getOrCreateState(scroller);
    latest.clearFrame = null;
    latest.active = false;
  });
}

export function clearRefocusTransaction(scroller: HTMLElement): void {
  const state = refocusStateByScroller.get(scroller);
  if (state) {
    cancelPendingDeactivation(state);
  }
  refocusStateByScroller.delete(scroller);
}
