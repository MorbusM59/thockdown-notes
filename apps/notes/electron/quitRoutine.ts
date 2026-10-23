/**
 * How the app stops: ONE routine, reached from every way out (the window's
 * close button, Cmd+Q, the OS shutting down or logging off, a termination
 * signal), so the order of shutdown is designed once rather than being
 * whatever order each platform happens to raise its events in.
 *
 *   1. settle the window: it is asked to write everything it holds (note
 *      text still debouncing, each slot's caret and scroll, the app state)
 *      and answers when those writes have RETURNED, not merely been sent
 *      (src/shared/quitParticipants.ts);
 *   2. drain the main process: wait until no request from the window is
 *      still being handled, because a handler that awaits (a save writing
 *      an external file, say) can resume after its caller is gone, and must
 *      not find the database closed;
 *   3. shut down: main's own state, watchers and the database, in order;
 *   4. exit.
 *
 * Every wait is bounded. A window that hangs, or a handler that never
 * returns, costs at most its timeout: quitting is never held hostage, and
 * whatever had not arrived by then is what a kill would have lost anyway.
 * The routine runs once; every later request joins the first.
 */
export interface QuitRoutineSteps {
  settleWindow: () => Promise<void>
  drainRequests: () => Promise<void>
  shutdown: () => Promise<void>
  exit: () => void
}

export interface QuitRoutine {
  /** Starts the routine, or joins the one already running. */
  quit: (reason: string) => Promise<void>
  isQuitting: () => boolean
}

export function createQuitRoutine(steps: QuitRoutineSteps): QuitRoutine {
  let running: Promise<void> | null = null
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (error) {
      // A failed step must not stop the ones after it: the database still
      // has to close, and the process still has to exit.
      console.error(`[quit] ${name} failed`, error)
    }
  }
  return {
    quit(reason) {
      running ??= (async () => {
        console.log(`[quit] ${reason}`)
        await step('settling the window', steps.settleWindow)
        await step('draining requests', steps.drainRequests)
        await step('shutting down', steps.shutdown)
        steps.exit()
      })()
      return running
    },
    isQuitting: () => running !== null,
  }
}

/** Resolves when `promise` does, or after `ms` -- whichever is first. Never rejects. */
export function within(promise: Promise<unknown>, ms: number, label: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[quit] ${label} did not finish within ${ms}ms; going on without it`)
      resolve()
    }, ms)
    promise.then(
      () => { clearTimeout(timer); resolve() },
      (error) => { clearTimeout(timer); console.error(`[quit] ${label} failed`, error); resolve() },
    )
  })
}

/**
 * Counts the requests from the window that are still being handled. Wired
 * where every handler is registered (`registerInvokeHandlers`' `handle`), so
 * a new handler is counted without its author knowing this exists.
 */
export function createRequestTracker() {
  let inFlight = 0
  let refusing = false
  let idleWaiters: Array<() => void> = []
  const settle = () => {
    inFlight -= 1
    if (inFlight > 0) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }
  return {
    /** Wraps `listener` so each call is counted until its result settles. */
    track<Args extends unknown[]>(listener: (...args: Args) => unknown) {
      return (...args: Args): unknown => {
        if (refusing) return Promise.reject(new Error('The app is quitting'))
        inFlight += 1
        let result: unknown
        try {
          result = listener(...args)
        } catch (error) {
          settle()
          throw error
        }
        Promise.resolve(result).then(settle, settle)
        return result
      }
    },
    /** From now on, a call is refused (its promise rejects) instead of handled. */
    refuseNew(): void {
      refusing = true
    },
    /** Resolves once nothing is in flight (at once, if nothing is). */
    whenIdle(): Promise<void> {
      if (inFlight === 0) return Promise.resolve()
      return new Promise((resolve) => { idleWaiters.push(resolve) })
    },
    inFlight: () => inFlight,
  }
}
