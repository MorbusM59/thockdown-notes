export type ScrollTransitionKind = 'snapshot-restore' | 'geometry-settle' | 'preview-restore';

export interface BeginScrollTransitionOptions {
  kind: ScrollTransitionKind;
  settleMs: number;
  maxBlockMs?: number;
  blockUserInput?: boolean;
  transitionId?: number;
}

interface ActiveScrollTransition {
  id: number;
  kind: ScrollTransitionKind;
  settleUntilMs: number;
  maxBlockUntilMs: number;
  pendingProgrammaticScrollEvents: number;
  blockUserInput: boolean;
}

interface ClassifyResult {
  isProgrammatic: boolean;
  transitionId?: number;
}

/**
 * Deterministic scroll-transition state machine used by CM6Editor.
 *
 * This centralizes programmatic-vs-user scroll provenance and user-input
 * blocking during restore/settle windows, replacing ad hoc distributed
 * timers/counters.
 */
export class ScrollTransitionController {
  private static readonly DEFAULT_MAX_BLOCK_MS = 1200;

  private active: ActiveScrollTransition | null = null;

  private nextId = 1;

  private onSettled: ((transitionId: number) => void) | null = null;

  private settleTimeoutId: number | null = null;

  private hardStopTimeoutId: number | null = null;

  setOnSettled(callback: ((transitionId: number) => void) | null): void {
    this.onSettled = callback;
  }

  beginTransition(options: BeginScrollTransitionOptions): number {
    this.clearSettleTimeout();
    this.clearHardStopTimeout();
    const now = performance.now();
    const settleMs = Math.max(0, options.settleMs);
    const requestedMaxBlockMs = options.maxBlockMs ?? ScrollTransitionController.DEFAULT_MAX_BLOCK_MS;
    const maxBlockMs = Math.max(settleMs, requestedMaxBlockMs);
    const transitionId = options.transitionId ?? this.nextId++;
    this.active = {
      id: transitionId,
      kind: options.kind,
      settleUntilMs: now + settleMs,
      maxBlockUntilMs: now + maxBlockMs,
      pendingProgrammaticScrollEvents: 0,
      blockUserInput: options.blockUserInput !== false,
    };
    this.scheduleSettleTimer();
    this.scheduleHardStopTimer();
    return transitionId;
  }

  extendSettle(transitionId: number, settleMs: number): void {
    if (!this.active || this.active.id !== transitionId) return;
    const now = performance.now();
    const nextUntil = now + Math.max(0, settleMs);
    if (nextUntil > this.active.settleUntilMs) {
      this.active.settleUntilMs = nextUntil;
      this.scheduleSettleTimer();
    }
  }

  registerProgrammaticScrollEvent(transitionId: number): void {
    if (!this.active || this.active.id !== transitionId) return;
    this.active.pendingProgrammaticScrollEvents += 1;
  }

  classifyScrollEvent(): ClassifyResult {
    const now = performance.now();
    const active = this.active;
    if (!active) {
      return { isProgrammatic: false };
    }

    if (now >= active.maxBlockUntilMs) {
      this.completeTransition(active.id);
      return { isProgrammatic: false };
    }

    const isWithinSettleWindow = now < active.settleUntilMs;
    const hasPendingProgrammaticEvents = active.pendingProgrammaticScrollEvents > 0;
    const isProgrammatic = isWithinSettleWindow || hasPendingProgrammaticEvents;

    if (!isProgrammatic) {
      this.completeTransition(active.id);
      return { isProgrammatic: false };
    }

    if (active.pendingProgrammaticScrollEvents > 0) {
      active.pendingProgrammaticScrollEvents -= 1;
    }

    // If this was the last pending event and settle window has elapsed,
    // complete after classifying this event as programmatic.
    if (active.pendingProgrammaticScrollEvents <= 0 && now >= active.settleUntilMs) {
      this.completeTransition(active.id);
    }

    return { isProgrammatic: true, transitionId: active.id };
  }

  shouldBlockUserInput(extraBlocked: boolean): boolean {
    if (extraBlocked) return true;
    const active = this.active;
    if (!active || !active.blockUserInput) return false;

    const now = performance.now();
    if (now >= active.maxBlockUntilMs) {
      this.completeTransition(active.id);
      return false;
    }

    if (active.pendingProgrammaticScrollEvents > 0 || now < active.settleUntilMs) {
      return true;
    }

    this.completeTransition(active.id);
    return false;
  }

  getActiveTransitionId(): number | null {
    return this.active?.id ?? null;
  }

  forceComplete(transitionId?: number): void {
    if (!this.active) return;
    if (transitionId !== undefined && this.active.id !== transitionId) return;
    this.completeTransition(this.active.id);
  }

  private scheduleSettleTimer(): void {
    this.clearSettleTimeout();
    const active = this.active;
    if (!active) return;
    const delayMs = Math.max(0, Math.ceil(active.settleUntilMs - performance.now()));
    this.settleTimeoutId = window.setTimeout(() => {
      this.settleTimeoutId = null;
      const current = this.active;
      if (!current || current.id !== active.id) return;
      if (current.pendingProgrammaticScrollEvents > 0) return;
      if (performance.now() < current.settleUntilMs) {
        this.scheduleSettleTimer();
        return;
      }
      this.completeTransition(current.id);
    }, delayMs);
  }

  private scheduleHardStopTimer(): void {
    this.clearHardStopTimeout();
    const active = this.active;
    if (!active) return;
    const delayMs = Math.max(0, Math.ceil(active.maxBlockUntilMs - performance.now()));
    this.hardStopTimeoutId = window.setTimeout(() => {
      this.hardStopTimeoutId = null;
      const current = this.active;
      if (!current || current.id !== active.id) return;
      this.completeTransition(current.id);
    }, delayMs);
  }

  private clearSettleTimeout(): void {
    if (this.settleTimeoutId === null) return;
    window.clearTimeout(this.settleTimeoutId);
    this.settleTimeoutId = null;
  }

  private clearHardStopTimeout(): void {
    if (this.hardStopTimeoutId === null) return;
    window.clearTimeout(this.hardStopTimeoutId);
    this.hardStopTimeoutId = null;
  }

  private completeTransition(transitionId: number): void {
    if (!this.active || this.active.id !== transitionId) return;
    this.clearSettleTimeout();
    this.clearHardStopTimeout();
    this.active = null;
    this.onSettled?.(transitionId);
  }
}
