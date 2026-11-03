/**
 * What the window must write before the app quits, and the one place that
 * writes it. The main process's quit routine (electron/quitRoutine.ts) asks
 * the window to settle and waits for the answer, so a participant's promise
 * should resolve when its write has RETURNED from the main process, not
 * when it has merely been sent: sending is all an unloading page could ever
 * do, and is how writes used to be lost on quit.
 *
 * Anything that keeps state in the window and saves it later (a debounce, a
 * queue) registers here, beside the code that owns that state, so quitting
 * reaches it without a list somewhere else that has to remember it.
 *
 * Reloading the page (development, or after the page crashed) runs the
 * same participants from `beforeunload`, where only what is sent before
 * the page goes can arrive.
 */
type Participant = () => Promise<unknown> | void

const participants = new Map<string, Participant>()

/** Registers `settle` under `name`, replacing an earlier one of that name. Returns the unregister. */
export function registerQuitParticipant(name: string, settle: Participant): () => void {
  participants.set(name, settle)
  return () => {
    if (participants.get(name) === settle) participants.delete(name)
  }
}

/** Runs every participant at once and resolves when all have finished, failed or not. */
export async function settleForQuit(): Promise<void> {
  await Promise.all([...participants].map(async ([name, settle]) => {
    try {
      await settle()
    } catch (error) {
      console.error(`[quit] ${name} failed to settle`, error)
    }
  }))
}
