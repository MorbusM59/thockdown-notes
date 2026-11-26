/**
 * The health log (`@thockdown/audio/healthLog`) in a Debugging section: the
 * failures newest first, a copy button and a clear button. Shared by the
 * desktop's Options > Advanced > Debugging and the phone dashboard's
 * Debugging, so the two read the same log the same way. It re-renders only
 * when a failure is written, never on a timer.
 */
import { useSyncExternalStore } from 'react'
import { clearHealthLog, healthLogText, readHealthLog, subscribeHealthLog } from '@thockdown/audio/healthLog'

function snapshot(): number {
  const log = readHealthLog()
  const last = log[log.length - 1]
  // Changes whenever an entry is added, repeated or the log is cleared.
  return last ? log.length * 1e13 + last.time + last.count : 0
}

export function HealthLogPanel() {
  useSyncExternalStore(subscribeHealthLog, snapshot)
  const text = healthLogText()
  return (<>
    <div className="options-loadout-grid" role="group" aria-label="Failure log">
      <button
        type="button"
        className="btn-icon options-color-swatch options-loadout-btn"
        data-tooltip="Copy the failure log"
        aria-label="Copy the failure log"
        disabled={!text}
        onClick={() => { void navigator.clipboard?.writeText(text) }}
      >
        <span className="fa-solid fa-copy" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn-icon options-color-swatch options-loadout-btn"
        data-tooltip="Clear the failure log"
        aria-label="Clear the failure log"
        disabled={!text}
        onClick={clearHealthLog}
      >
        <span className="fa-solid fa-broom" aria-hidden="true" />
      </button>
    </div>
    <pre className="health-log">{text || 'No failures'}</pre>
  </>)
}
