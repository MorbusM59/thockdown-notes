/**
 * A PRESET LIST: named, iconed sets of settings, the factory ones shipped and
 * the reader's own beside them, one of which is always the ACTIVE one.
 *
 * There is no unsaved or pending preset. An edit is written into the active
 * preset (`editActivePreset`); a factory preset keeps its edits (name, icon
 * and settings, as one whole entry in `factoryEdits`) until it is restored
 * (`restoreFactoryPreset`), and an unedited one is always exactly as shipped,
 * so a change to the shipped preset reaches it. A new preset is a copy of the
 * active one under the first free "<Noun> A/B/..." name (`createPreset`).
 *
 * Pure and generic over the settings: what a preset HOLDS is the kind's
 * business (`PresetKind`), how a list of them behaves is this module's. It
 * is the rule the soundstage presets follow (apps/notes shared/soundstages.ts);
 * the soundscapes follow the same rule in their own module
 * (packages/soundscape/soundscape.ts), written first.
 */

export interface Preset<S> {
  id: string
  name: string
  /** A solid Font Awesome icon without its style class (`fa-cube`), or null to draw the name's initials. */
  icon: string | null
  settings: S
}

/** What is persisted of a list; the factory presets themselves are the kind's. */
export interface PresetList<S> {
  activeId: string
  custom: Preset<S>[]
  /** Factory presets as the reader left them, whole; absent means as shipped. */
  factoryEdits: Preset<S>[]
}

export interface PresetKind<S> {
  /** As shipped, in their order. At least one. */
  factory: readonly Preset<S>[]
  /** The factory preset a list starts on, and falls back to. */
  defaultId: string
  /** The word new presets are named with: "Soundstage" makes "Soundstage A". */
  noun: string
  /** Not a design limit, only a bound on a list nobody should reach. */
  maxCustom: number
  clone: (settings: S) => S
  /** Checks stored settings, falling back where they are malformed. */
  sanitizeSettings: (value: unknown) => S
}

export const PRESET_NAME_MAX_LENGTH = 40
export const PRESET_ICON_PATTERN = /^fa-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Every preset, factory first (each as the reader left it) and then the reader's own. */
export function presetsOf<S>(kind: PresetKind<S>, list: Pick<PresetList<S>, 'custom' | 'factoryEdits'>): Preset<S>[] {
  const edits = new Map(list.factoryEdits.map((preset) => [preset.id, preset]))
  return [...kind.factory.map((preset) => edits.get(preset.id) ?? preset), ...list.custom]
}

export function isFactoryPreset<S>(kind: PresetKind<S>, id: string): boolean {
  return kind.factory.some((preset) => preset.id === id)
}

/** A factory preset that differs from how it shipped: one restoring would change. */
export function isEditedFactoryPreset<S>(list: Pick<PresetList<S>, 'factoryEdits'>, id: string): boolean {
  return list.factoryEdits.some((preset) => preset.id === id)
}

/** The preset that is active. */
export function activePreset<S>(kind: PresetKind<S>, list: PresetList<S>): Preset<S> {
  const presets = presetsOf(kind, list)
  return presets.find((preset) => preset.id === list.activeId) ?? presets.find((preset) => preset.id === kind.defaultId) ?? presets[0]
}

/** What a preset is drawn with: its icon, else its name's initials. */
/** An empty list on the kind's default preset, nothing edited. */
export function emptyPresetList<S>(kind: PresetKind<S>): PresetList<S> {
  return { activeId: kind.defaultId, custom: [], factoryEdits: [] }
}

/** An id for a new preset of the reader's own. */
export function newPresetId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function presetMarkOf<S>(preset: Pick<Preset<S>, 'name' | 'icon'>): { iconClass: string } | { letters: string } {
  if (preset.icon) return { iconClass: `fa-solid ${preset.icon}` }
  const words = preset.name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length >= 2 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] ?? '')].slice(0, 2).join('')
  return { letters: letters.toUpperCase() }
}

/** The icon a preset goes back to when its icon is reset: a factory preset's own, else none. */
export function defaultPresetIcon<S>(kind: PresetKind<S>, id: string): string | null {
  return kind.factory.find((preset) => preset.id === id)?.icon ?? null
}

/** The first free "<Noun> A", "<Noun> B", ... "<Noun> AA" among `names`, case aside. */
export function firstFreePresetName(noun: string, names: Iterable<string>): string {
  const used = new Set([...names].map((name) => name.trim().toLowerCase()))
  for (let index = 1; ; index += 1) {
    let value = index
    let letters = ''
    while (value > 0) {
      value -= 1
      letters = String.fromCharCode(65 + (value % 26)) + letters
      value = Math.floor(value / 26)
    }
    const name = `${noun} ${letters}`
    if (!used.has(name.toLowerCase())) return name
  }
}

/** The first free "<Noun> A", "<Noun> B", ... "<Noun> AA". */
export function defaultPresetName<S>(kind: PresetKind<S>, list: Pick<PresetList<S>, 'custom' | 'factoryEdits'>): string {
  return firstFreePresetName(kind.noun, presetsOf(kind, list).map((preset) => preset.name))
}

/** One preset replaced, wherever it is kept: a factory one becomes (or stays) an edit. */
function withPreset<S>(kind: PresetKind<S>, list: PresetList<S>, next: Preset<S>): PresetList<S> {
  if (isFactoryPreset(kind, next.id)) {
    return { ...list, factoryEdits: [...list.factoryEdits.filter((preset) => preset.id !== next.id), next] }
  }
  return { ...list, custom: list.custom.map((preset) => (preset.id === next.id ? next : preset)) }
}

/** Make a preset the active one. Applying its settings is the caller's. */
export function selectPreset<S>(kind: PresetKind<S>, list: PresetList<S>, id: string): PresetList<S> {
  if (list.activeId === id || !presetsOf(kind, list).some((preset) => preset.id === id)) return list
  return { ...list, activeId: id }
}

/** New settings for the active preset: every edit goes through here. */
export function editActivePreset<S>(kind: PresetKind<S>, list: PresetList<S>, settings: S): PresetList<S> {
  return withPreset(kind, list, { ...activePreset(kind, list), settings: kind.clone(settings) })
}

/** Rename a preset. A blank name changes nothing; names are unique, case aside. */
export function renamePreset<S>(kind: PresetKind<S>, list: PresetList<S>, id: string, name: string): PresetList<S> {
  const next = name.trim().slice(0, PRESET_NAME_MAX_LENGTH)
  const presets = presetsOf(kind, list)
  const preset = presets.find((candidate) => candidate.id === id)
  if (!preset || !next || next === preset.name) return list
  if (presets.some((candidate) => candidate.id !== id && candidate.name.toLowerCase() === next.toLowerCase())) return list
  return withPreset(kind, list, { ...preset, name: next })
}

/** Give a preset a solid icon (`fa-wind`), or null for initials; a malformed one changes nothing. */
export function setPresetIcon<S>(kind: PresetKind<S>, list: PresetList<S>, id: string, icon: string | null): PresetList<S> {
  const preset = presetsOf(kind, list).find((candidate) => candidate.id === id)
  if (!preset || (icon !== null && !PRESET_ICON_PATTERN.test(icon)) || preset.icon === icon) return list
  return withPreset(kind, list, { ...preset, icon })
}

/** A new preset of the reader's own, a copy of the active one, made active. Null when the list is full. */
export function createPreset<S>(kind: PresetKind<S>, list: PresetList<S>, id: string): PresetList<S> | null {
  if (list.custom.length >= kind.maxCustom) return null
  const created: Preset<S> = { id, name: defaultPresetName(kind, list), icon: null, settings: kind.clone(activePreset(kind, list).settings) }
  return { ...list, custom: [...list.custom, created], activeId: id }
}

/**
 * Delete one of the reader's own presets. When it is the active one, the
 * preset before it becomes active (the next, when it was first); the caller
 * applies the new active preset's settings.
 */
export function deletePreset<S>(kind: PresetKind<S>, list: PresetList<S>, id: string): PresetList<S> {
  if (!list.custom.some((preset) => preset.id === id)) return list
  const order = presetsOf(kind, list)
  const index = order.findIndex((preset) => preset.id === id)
  const next = { ...list, custom: list.custom.filter((preset) => preset.id !== id) }
  if (list.activeId !== id) return next
  return { ...next, activeId: (order[index - 1] ?? order[index + 1]).id }
}

/** A factory preset as shipped again: name, icon and settings. The caller applies it when it is active. */
export function restoreFactoryPreset<S>(list: PresetList<S>, id: string): PresetList<S> {
  if (!isEditedFactoryPreset(list, id)) return list
  return { ...list, factoryEdits: list.factoryEdits.filter((preset) => preset.id !== id) }
}

function sanitizePreset<S>(kind: PresetKind<S>, value: unknown): Preset<S> | null {
  const record = (value && typeof value === 'object' ? value : null) as Record<string, unknown> | null
  if (!record || typeof record.id !== 'string' || record.id === '') return null
  const name = typeof record.name === 'string' ? record.name.trim().slice(0, PRESET_NAME_MAX_LENGTH) : ''
  const icon = typeof record.icon === 'string' && PRESET_ICON_PATTERN.test(record.icon) ? record.icon : null
  return { id: record.id, name, icon, settings: kind.sanitizeSettings(record.settings) }
}

/**
 * A stored list made whole: custom ids unique and never a factory id, names
 * filled in where missing, edits only of factory presets, and an active id
 * that names a preset (the kind's default otherwise).
 */
export function sanitizePresetList<S>(kind: PresetKind<S>, value: unknown): PresetList<S> {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const factoryEdits: Preset<S>[] = []
  for (const entry of Array.isArray(input.factoryEdits) ? input.factoryEdits : []) {
    const preset = sanitizePreset(kind, entry)
    const shipped = preset && kind.factory.find((candidate) => candidate.id === preset.id)
    if (!preset || !shipped || factoryEdits.some((edit) => edit.id === preset.id)) continue
    factoryEdits.push({ ...preset, name: preset.name || shipped.name })
  }
  let list: PresetList<S> = { activeId: '', custom: [], factoryEdits }
  for (const entry of Array.isArray(input.custom) ? input.custom : []) {
    if (list.custom.length >= kind.maxCustom) break
    const preset = sanitizePreset(kind, entry)
    if (!preset || isFactoryPreset(kind, preset.id) || list.custom.some((custom) => custom.id === preset.id)) continue
    list = { ...list, custom: [...list.custom, { ...preset, name: preset.name || defaultPresetName(kind, list) }] }
  }
  const activeId = typeof input.activeId === 'string' && presetsOf(kind, list).some((preset) => preset.id === input.activeId)
    ? input.activeId
    : kind.defaultId
  return { ...list, activeId }
}
