import { useCallback, useEffect, useState } from 'react'

/**
 * Shared "pill becomes an input in place" edit mechanism -- right-click (or
 * similar) a pill and it swaps to an autoFocus <input> carrying the same
 * classes, committing on blur/Enter and cancelling on Escape, then swapping
 * back. Extracted after the third independent copy of this exact shape
 * (chapter id, note tab id, tag name). Each call site keeps its own
 * domain-specific commit logic (the actual IPC call and any surrounding
 * guards) -- this only owns the editing/draft state machine and the
 * keyboard/blur wiring (see InlinePillOrInput for the matching JSX half).
 */
export function useInlinePillEdit<K>(options: {
  commit: (key: K, value: string) => void | Promise<void>
  /**
   * Optional: cancels the in-progress edit if the key it's editing stops
   * existing (the underlying item was deleted, or pruned elsewhere) --
   * the input would otherwise just unmount without ever firing blur,
   * leaving the edit state dangling on a key nothing renders anymore.
   * Re-checked whenever this function identity changes, so callers should
   * derive it from whatever collection it checks against (useCallback with
   * that collection as a dependency).
   */
  keyExists?: (key: K) => boolean
}) {
  const { commit: commitFn, keyExists } = options
  const [editingKey, setEditingKey] = useState<K | null>(null)
  const [draft, setDraft] = useState('')

  const start = useCallback((key: K, seedValue: string) => {
    setDraft(seedValue)
    setEditingKey(key)
  }, [])

  const cancel = useCallback(() => {
    setEditingKey(null)
  }, [])

  const commit = useCallback(() => {
    const key = editingKey
    setEditingKey(null)
    if (key === null) return
    void commitFn(key, draft)
  }, [editingKey, draft, commitFn])

  useEffect(() => {
    if (editingKey === null || !keyExists) return
    if (!keyExists(editingKey)) setEditingKey(null)
  }, [editingKey, keyExists])

  return { editingKey, draft, setDraft, start, cancel, commit }
}
