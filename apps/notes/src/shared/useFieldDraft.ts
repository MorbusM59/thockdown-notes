import { useLayoutEffect, useState } from 'react'

/**
 * The value a controlled text field shows when what it edits lives somewhere
 * that learns of a change only after a render or two -- a slot's find query,
 * which App reads off the slot's reported handle, a passive effect later.
 *
 * A controlled input whose value prop is still the OLD text after its change
 * handler is reset to that old text by React, and a key typed before the new
 * text arrived lands on the old one: typing "chapter" quickly came out "ctr".
 * So while the field is being edited it shows its own draft, which every
 * change writes at once; while it is not, it follows the source, so a change
 * made elsewhere (another slot made active, a clear) still shows.
 */
export function useFieldDraft(source: string, isEditing: boolean): [string, (value: string) => void] {
  const [draft, setDraft] = useState(source)
  useLayoutEffect(() => {
    if (!isEditing) setDraft(source)
  }, [isEditing, source])
  return [isEditing ? draft : source, setDraft]
}
