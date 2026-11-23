/**
 * Settings > Debugging: what the native music's output is doing (MusicSession
 * and OutputLane's `diagnostics`), read twice a second while the section is
 * open, so a fault in the output can be read on a phone without adb.
 */
import { useEffect, useState } from 'react'
import { useAccordionSectionOpen } from '@thockdown/interaction/accordionSectionOpen'
import { nativeMusic } from './nativeMusic'

const READ_MS = 500

export function MusicDiagnostics() {
  const open = useAccordionSectionOpen()
  const [text, setText] = useState('')
  useEffect(() => {
    if (!open || !nativeMusic) return undefined
    const plugin = nativeMusic
    const read = () => { void plugin.getDiagnostics().then((result) => setText(result.text)) }
    read()
    const timer = window.setInterval(read, READ_MS)
    return () => window.clearInterval(timer)
  }, [open])
  return <p className="mobile-tab-placeholder">{nativeMusic ? text : 'Only in the app.'}</p>
}
