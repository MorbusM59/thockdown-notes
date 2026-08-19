export type SpellCheckSurfaceState = {
  globalToggleEnabled: boolean
  isEditorSurface: boolean
  isActiveEditor: boolean
  isInputField: boolean
}

export function resolveSpellCheckSurfaceState({
  globalToggleEnabled,
  isEditorSurface,
  isActiveEditor,
  isInputField,
}: SpellCheckSurfaceState): boolean {
  if (!globalToggleEnabled) return false
  if (isInputField) return false
  return isEditorSurface && isActiveEditor
}
