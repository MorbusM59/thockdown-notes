import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { SidebarOptionsPanel } from './sidebar/SidebarOptionsPanel'
import { AudioControls } from './components/AudioControls'
import './App.css'
import { buildExportCss, type ExportViewStyle, type ExportFontSize, type ExportSpacing } from './exportStyles'
import {
  DEFAULT_TYPING_SOUND_SET,
  typingSoundManager,
} from './sound/TypingSoundManager'
import type { PersistedMenuState, PersistedSidebarViewState, PersistedViewportState } from './shared/appState'
import {
  DEFAULT_GLAZE_SETTINGS,
  GLAZE_GLOOM_OPACITY_MAX,
  GLAZE_LINEAR_OPACITY_MAX,
  GLAZE_RADIAL_OPACITY_MAX,
  GLAZE_SHEEN_OPACITY_MAX,
  sanitizeGlazeSettings,
  type GlazeSettings,
} from './shared/glaze'
import type { UiLayoutLoadout, UiLoadoutEntry, UiLoadoutMode } from './shared/loadouts'
import {
  idKind,
  idMode,
  modeSign,
  LOADOUT_DEFAULT_CUSTOM_ID_ABS,
  LOADOUT_FACTORY_PRESET_COUNT,
} from './shared/loadouts'
import type { NoteSummary } from './shared/noteLifecycle'
import { isArchivedNote, isDeletedNote, isExternalNote, isSameNoteSummary } from './shared/noteLifecycle'
import {
  type RgbaColor,
  type HsvaColor,
  parseCssColorToRgba,
  rgbaToCssColor,
  rgbaToHex,
  invertRgbaColor,
  rgbaToHsva,
  hsvaToRgba,
} from './shared/colorMath'
import type { HighlightColorKey, HighlightColors } from './shared/highlightColors'
import { BORDER_RADIUS_REGULAR_MIN_PX, BORDER_RADIUS_REGULAR_MAX_PX } from './shared/uiBounds'
import { DEBUG_TAG_NAME, PROTECTED_TAGS, normalizeTagName } from './shared/tags'
import { EditorSection } from './editorSection/EditorSection'
import { EditorToolbar } from './toolbar/EditorToolbar'
import { DEFAULT_EDITOR_SECTION_ID, type EditorSectionEntry } from './shared/sections'
import { computeSectionWidthsForClose, computeSectionWidthsForNewSection, type SectionWidthPx } from './shared/sectionWidths'
import type { TextureCacheRequest } from './shared/textures'
import {
  DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EDITOR_SPACING,
  DEFAULT_EDITOR_STYLE,
  EDITOR_GLYPH_PADDING_MIN_PX,
  EDITOR_GLYPH_PADDING_MAX_PX,
  resolveEditorFontFamily,
  resolveEditorRuntimeMetrics,
  type EditorFontSizeKey,
  type EditorSpacingKey,
  type EditorStyleKey,
} from './editor/EditorTypography'
import { getActiveSectionHandle, type SectionHandle } from './editorSection/sectionRegistry'
import { type TextDecorationFormat } from './editorSection/useMarkdownFormattingToolbar'
import {
  createPreviewNoteAnchorMarkerRehypePlugin,
  createPreviewMarkdownComponents,
  PREVIEW_MARKDOWN_REMARK_PLUGINS,
  PREVIEW_MARKDOWN_NOOP_NAVIGATE,
} from './editor/PreviewMarkdown'
import { normalizeInternalText } from './editor/TextPolicy'
import { isNoteSearchQueryActive, matchesNoteSearchQuery } from './shared/noteSearch'
import {
  getRenderScrollDynamic,
  getRenderScrollResponsiveness,
  getRenderScrollTotalTimeSec,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollSkew,
  RENDER_SCROLL_SKEW_MIN,
  RENDER_SCROLL_SKEW_MAX,
  setRenderScrollDynamic as applyRenderScrollDynamic,
  setRenderScrollResponsiveness as applyRenderScrollResponsiveness,
  setRenderScrollTotalTimeSec as applyRenderScrollTotalTimeSec,
  setRenderScrollMaxSpeedPxPerSec as applyRenderScrollMaxSpeedPxPerSec,
  setRenderScrollSkew as applyRenderScrollSkew,
  scrollToNonQuantizedSmooth,
} from './editor/NonQuantizedSmoothScroll'
import {
  FILTER_MONTHS,
  FILTER_YEARS,
  handleMultiSelect,
} from './shared/filterConstants'
import {
  DEFAULT_TEXTURE_MATERIALS,
  type TextureMaterialSettings,
  type TextureMaterialsBySurface,
  type TextureSurfaceKey,
  TEXTURE_GRANULARITY_MIN,
  TEXTURE_GRANULARITY_MAX,
  TEXTURE_VSTEPS_MIN,
  TEXTURE_VSTEPS_MAX,
} from './textures/types'
import { TEXTURE_ALGORITHM_VERSION, TEXTURE_REPEAT_TILE_SIZE, useTextureSurface } from './textures/useTextureSurface'

const NEW_NOTE_TEMPLATE = '# '
const FALLBACK_NEW_NOTE_TITLE = 'Untitled'
const GRID_DIVIDER_PX = 8
const SIDEBAR_WIDTH_PX = 288
const WINDOW_CONTROLS_WIDTH_PX = 380
const WINDOW_CONTROLS_COLLAPSED_WIDTH_PX = 210
const APP_WINDOW_MIN_WIDTH_PX = 840
const TOOLBAR_MIN_WIDTH_PX = APP_WINDOW_MIN_WIDTH_PX - SIDEBAR_WIDTH_PX - GRID_DIVIDER_PX - WINDOW_CONTROLS_WIDTH_PX
const APP_SHELL_MIN_WIDTH_PX = SIDEBAR_WIDTH_PX + GRID_DIVIDER_PX + TOOLBAR_MIN_WIDTH_PX + WINDOW_CONTROLS_WIDTH_PX
// Soft minimum, enforced only at section-creation time -- the "+" button
// disappearing when there isn't room for one more is the enforcement (see
// the handover doc's split-view design). Matches the same 300px figure the
// main-process window-minimum-size IPC (Phase 1) uses per extra section.
const SECTION_MIN_WIDTH_PX = 300
// Stable fallback for when no section has registered yet (e.g. the very first
// render, before <EditorSection> has mounted) -- a fresh Map() each render
// would break memo'd children comparing this prop by identity.
const EMPTY_MAP = new Map<string, NotePrimedAction>()
const DEFAULT_BORDER_RADIUS_REGULAR_PX = 6
const TEXTURE_PREVIEW_SURFACE: TextureSurfaceKey = 'appGrid'
const SCROLL_TRACK_MIN_THUMB_HEIGHT_PX = 28
const SCROLL_TRACK_EDGE_GAP_PX = 3
const COLOR_BUTTON_ARM_HOLD_MS = 300
const PENDING_UPDATE_DEBOUNCE_MS = 400
const DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {
  caret: 'rgba(120, 115, 112, 0.8)',
  search: 'rgba(255, 221, 105, 0.55)',
  selectionEdit: 'rgba(199, 94, 0, 0.49)',
  selectionRender: 'rgba(199, 94, 0, 0.49)',
  textBase: '#000000DD',
  textEmbossEdit: '#ffffff',
  textEmbossRender: '#ffffff',
  textEmbossUi: '#ffffff',
  background: '#e9e6e3',
  topBackground: 'rgba(196, 187, 182, 0.49)',
  bottomBackground: 'rgba(196, 187, 182, 0.49)',
  gridOutline: '#00000022',
  grid: '#f9f6f3',
  base: '#f9f6f4',
  inputFields: '#ffffff',
  appButtons: '#FFFFFFBB',
  markdownHeadline: 'rgba(255, 0, 255, 1)',
  markdownList: 'rgba(0, 255, 255, 1)',
  markdownBlockquote: 'rgba(255, 255, 0, 1)',
  markdownCode: 'rgba(255, 0, 127, 1)',
  markdownChecked: 'rgba(0, 255, 0, 1)',
  markdownUnchecked: 'rgba(255, 0, 0, 1)',
}

const DEFAULT_BASE_PALETTE_COLOR = '#f9f6f4'
const DEFAULT_PALETTE_LIGHT = '#f5f3f2'
const DEFAULT_PALETTE_MID = '#e9e5e2'
const DEFAULT_PALETTE_DARK = '#ece8e4'
const DEFAULT_PALETTE_INPUT = '#ffffff'
const DEFAULT_PALETTE_SHADOW_LO = '#fcf9f677'
const DEFAULT_PALETTE_SHADOW_MID = '#fcf9f6bb'
const DEFAULT_PALETTE_SHADOW_HI = '#fcf9f6ee'

const DEFAULT_EDITOR_TEXT_COLORS: Record<EditorTextColorTargetKey, string> = {
  editorEditText: '#000000DD',
  editorRenderText: '#000000DD',
}

type SidebarMode = 'date' | 'category' | 'archive' | 'trash' | 'find' | 'options'
type NotePrimedAction = 'archive' | 'deletion'
type ViewStyleKey = 'modern' | 'narrow' | 'cute' | 'xkcd' | 'print'
type ViewSizeKey = 'xs' | 's' | 'm' | 'l' | 'xl'
type ViewSpacingKey = 'tight' | 'compact' | 'cozy' | 'wide'

type EditorTextColorTargetKey = 'editorEditText' | 'editorRenderText'

type HsvaControlKey = 'h' | 's' | 'v' | 'a'
const GLAZE_RADIAL_CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'] as const

// Fallbacks for chrome reading through the section registry before any
// section has registered -- never actually hit in practice (registration
// happens earlier in the same render this is read in), but keeps the read
// side honest about what "no active section yet" looks like.
const noop = () => {}
const noopAsync = async () => {}
const EMPTY_DECORATION_FORMATS = new Set<TextDecorationFormat>()

type DarkModeKey = 'none' | 'mono' | 'red' | 'dusk' | 'neon' | 'matrix'

type DarkModePresetValues = {
  filterInvert: number
  filterSepia: number
  filterHueRotate: number
  filterBrightness: number
  filterContrast: number
  filterSaturate: number
  filterColorize: number
}

// Saturate slider: position x in [0,1] maps to CSS saturate value via
// s(x) = x / (1 - 4^(x-1)), capped at SATURATE_MAX.
// At x=0: s=0 (greyscale), x=0.5: s=1 (neutral), x→1: s→∞ (capped).
const SATURATE_MAX = 64

function saturatePosToValue(x: number): number {
  const xClamped = Math.max(0, Math.min(0.9999, x))
  if (xClamped <= 0) return 0
  const denom = 1 - Math.pow(4, xClamped - 1)
  if (Math.abs(denom) < 1e-9) return SATURATE_MAX
  const s = xClamped / denom
  return Math.max(0, Math.min(SATURATE_MAX, s))
}

const DARK_MODE_PRESET_VALUES: Record<DarkModeKey, DarkModePresetValues> = {
  none:   { filterInvert: 0, filterSepia: 0, filterHueRotate: 0,   filterBrightness: 1,    filterContrast: 1,    filterSaturate: 0.5000, filterColorize: 0 },
  mono:   { filterInvert: 1, filterSepia: 1, filterHueRotate: 0,   filterBrightness: 0.6,  filterContrast: 0.96, filterSaturate: 0.0000, filterColorize: 0 },
  red:    { filterInvert: 1, filterSepia: 0, filterHueRotate: 0,   filterBrightness: 0.3,  filterContrast: 0.95, filterSaturate: 0.45,    filterColorize: 1 },
  dusk:   { filterInvert: 1, filterSepia: 1, filterHueRotate: 150, filterBrightness: 0.55, filterContrast: 0.95, filterSaturate: 0.4690, filterColorize: 0 },
  neon:   { filterInvert: 1, filterSepia: 1, filterHueRotate: 280, filterBrightness: 0.5,  filterContrast: 1.05, filterSaturate: 0.9126, filterColorize: 0 },
  matrix: { filterInvert: 1, filterSepia: 1, filterHueRotate: 70,  filterBrightness: 0.4,  filterContrast: 1.1,  filterSaturate: 0.8633, filterColorize: 0 },
}


type HsvaDragState = {
  control: HsvaControlKey
  pointerId: number
  startY: number
  baseValue: number
}

type TextureControlKey = 'granularity' | 'smoothness'

type TextureControlDragState = {
  control: TextureControlKey
  pointerId: number
  startY: number
  baseValue: number
}

type ColorArmSource =
  | { kind: 'hsva'; key: HsvaControlKey }
  | { kind: 'active-color' }
  | { kind: 'texture-preview' }

type ElementPreviewCopySource =
  | { kind: 'element'; key: HighlightColorKey }
  | { kind: 'texture'; key: TextureSurfaceKey }
  | { kind: 'text'; key: EditorTextColorTargetKey }

type SidebarViewState = {
  scrollTop: number
  page: number
  collapsedPrimary: string[]
  collapsedSecondary: string[]
}

type SidebarViewStateByMode = Record<SidebarMode, SidebarViewState>

const SIDEBAR_MODES: Array<{ mode: SidebarMode; label: string }> = [
  { mode: 'date', label: 'Date' },
  { mode: 'category', label: 'Category' },
  { mode: 'archive', label: 'Archive' },
  { mode: 'trash', label: 'Trash' },
  { mode: 'find', label: 'Find' },
]

function sanitizeCollapsedList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(input.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function sanitizeSidebarViewState(value: PersistedSidebarViewState | undefined): SidebarViewState {
  return {
    scrollTop:
      typeof value?.scrollTop === 'number' && Number.isFinite(value.scrollTop)
        ? Math.max(0, Math.round(value.scrollTop))
        : 0,
    page:
      typeof value?.page === 'number' && Number.isFinite(value.page)
        ? Math.max(1, Math.round(value.page))
        : 1,
    collapsedPrimary: sanitizeCollapsedList(value?.collapsedPrimary),
    collapsedSecondary: sanitizeCollapsedList(value?.collapsedSecondary),
  }
}

function createDefaultSidebarViewStateByMode(): SidebarViewStateByMode {
  return {
    date: sanitizeSidebarViewState(undefined),
    category: sanitizeSidebarViewState(undefined),
    archive: sanitizeSidebarViewState(undefined),
    trash: sanitizeSidebarViewState(undefined),
    find: sanitizeSidebarViewState(undefined),
    options: sanitizeSidebarViewState(undefined),
  }
}

type TertiaryGroup = {
  name: string
  notes: NoteSummary[]
}

type SecondaryGroup = {
  name: string
  tertiary: TertiaryGroup[]
}

type PrimaryGroup = {
  name: string
  secondary: SecondaryGroup[]
}

const GENERAL_SECONDARY_NAME = 'General'

function hierarchyFromTags(tags: string[]): { primary: string; secondary: string; tertiary: string } {
  const nonProtected = tags.filter((tag) => !PROTECTED_TAGS.has(tag))
  return {
    primary: nonProtected[0] ?? 'Uncategorized',
    secondary: nonProtected[1] ?? GENERAL_SECONDARY_NAME,
    tertiary: nonProtected[2] ?? 'Notes',
  }
}

function buildHierarchyGroups(notes: NoteSummary[]): PrimaryGroup[] {
  const sortedNotes = [...notes].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  const primaryMap = new Map<string, Map<string, Map<string, NoteSummary[]>>>()

  for (const note of sortedNotes) {
    const { primary, secondary, tertiary } = hierarchyFromTags(note.tags)

    if (!primaryMap.has(primary)) {
      primaryMap.set(primary, new Map())
    }
    const secondaryMap = primaryMap.get(primary)!

    if (!secondaryMap.has(secondary)) {
      secondaryMap.set(secondary, new Map())
    }
    const tertiaryMap = secondaryMap.get(secondary)!

    if (!tertiaryMap.has(tertiary)) {
      tertiaryMap.set(tertiary, [])
    }
    tertiaryMap.get(tertiary)!.push(note)
  }

  const compareLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

  return [...primaryMap.entries()]
    .sort(([a], [b]) => compareLabel(a, b))
    .map(([primaryName, secondaryMap]) => ({
      name: primaryName,
      secondary: [...secondaryMap.entries()]
        .sort(([a], [b]) => compareLabel(a, b))
        .map(([secondaryName, tertiaryMap]) => ({
          name: secondaryName,
          tertiary: [...tertiaryMap.entries()]
            .sort(([a], [b]) => compareLabel(a, b))
            .map(([tertiaryName, groupedNotes]) => ({
              name: tertiaryName,
              notes: groupedNotes,
            })),
        })),
    }))
}

function deriveNoteTitleFromText(text: string): string {
  const lines = normalizeInternalText(text).split('\n')
  const heading = lines.find((line) => line.startsWith('# ') && line.trim().length > 2)
  if (heading) {
    return heading.slice(2).trim()
  }

  const firstContent = lines.find((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && trimmed !== '#'
  })

  return firstContent?.trim() ?? 'Untitled'
}

function sanitizeClipboardTitle(raw: string): string {
  const normalized = normalizeInternalText(raw)
  const firstLine = normalized.split('\n').map((line) => line.trim()).find((line) => line.length > 0)
  if (!firstLine) return FALLBACK_NEW_NOTE_TITLE

  const withoutHeadingPrefix = firstLine.replace(/^#+\s*/, '').trim()
  return withoutHeadingPrefix || FALLBACK_NEW_NOTE_TITLE
}

type DerivedPaletteColors = {
  parchmentLightest: string
  parchmentLight: string
  parchmentMid: string
  parchmentDark: string
  parchmentInput: string
  shadowWhiteLo: string
  shadowWhiteMid: string
  shadowWhiteHi: string
}

function derivePaletteTokensFromBaseColor(baseColorCss: string): DerivedPaletteColors {
  const fallbackBase = parseCssColorToRgba(DEFAULT_BASE_PALETTE_COLOR) ?? { r: 249, g: 246, b: 244, a: 1 }
  const baseRgba = parseCssColorToRgba(baseColorCss) ?? fallbackBase
  const baseHsva = rgbaToHsva(baseRgba)
  const defaultBaseHsva = rgbaToHsva(fallbackBase)
  const safeBaseDefaultV = Math.max(0.0001, defaultBaseHsva.v)

  const defaultLightHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_LIGHT) ?? fallbackBase)
  const defaultMidHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_MID) ?? fallbackBase)
  const defaultDarkHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_DARK) ?? fallbackBase)
  const defaultInputHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_INPUT) ?? fallbackBase)

  const defaultShadowLo = parseCssColorToRgba(DEFAULT_PALETTE_SHADOW_LO) ?? { ...fallbackBase, a: 0.466 }
  const defaultShadowMid = parseCssColorToRgba(DEFAULT_PALETTE_SHADOW_MID) ?? { ...fallbackBase, a: 0.733 }
  const defaultShadowHi = parseCssColorToRgba(DEFAULT_PALETTE_SHADOW_HI) ?? { ...fallbackBase, a: 0.933 }
  const defaultShadowLoHsva = rgbaToHsva(defaultShadowLo)
  const defaultShadowMidHsva = rgbaToHsva(defaultShadowMid)
  const defaultShadowHiHsva = rgbaToHsva(defaultShadowHi)

  const withScaledValue = (valueScale: number, alpha = 1): string => {
    const nextHsva: HsvaColor = {
      h: baseHsva.h,
      s: baseHsva.s,
      v: clamp(baseHsva.v * valueScale, 0, 1),
      a: clamp(alpha, 0, 1),
    }
    return rgbaToCssColor(hsvaToRgba(nextHsva))
  }

  return {
    parchmentLightest: rgbaToCssColor({ ...baseRgba}),
    parchmentLight: withScaledValue(defaultLightHsva.v / safeBaseDefaultV, 1),
    parchmentMid: withScaledValue(defaultMidHsva.v / safeBaseDefaultV, 1),
    parchmentDark: withScaledValue(defaultDarkHsva.v / safeBaseDefaultV, 1),
    parchmentInput: withScaledValue(defaultInputHsva.v / safeBaseDefaultV, 1),
    shadowWhiteLo: withScaledValue(defaultShadowLoHsva.v / safeBaseDefaultV, defaultShadowLo.a),
    shadowWhiteMid: withScaledValue(defaultShadowMidHsva.v / safeBaseDefaultV, defaultShadowMid.a),
    shadowWhiteHi: withScaledValue(defaultShadowHiHsva.v / safeBaseDefaultV, defaultShadowHi.a),
  }
}


function titleFromFileBasename(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, '').trim()
  if (!withoutExtension) return FALLBACK_NEW_NOTE_TITLE

  const normalized = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized || FALLBACK_NEW_NOTE_TITLE
}

function mergeNoteSummaries(previous: NoteSummary[], next: NoteSummary[]): NoteSummary[] {
  const previousById = new Map(previous.map((note) => [note.id, note]))
  const merged: NoteSummary[] = []
  let changed = previous.length !== next.length

  for (let index = 0; index < next.length; index += 1) {
    const nextNote = next[index]
    const existing = previousById.get(nextNote.id)
    const nextCandidate = (existing && existing.hasUnsavedChanges && !nextNote.hasUnsavedChanges && isExternalNote(existing))
      ? { ...nextNote, hasUnsavedChanges: existing.hasUnsavedChanges }
      : nextNote

    if (existing && isSameNoteSummary(existing, nextCandidate)) {
      merged.push(existing)
      if (previous[index] !== existing) {
        changed = true
      }
      continue
    }

    merged.push(nextCandidate)
    changed = true
  }

  return changed ? merged : previous
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) + 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildLinearGlazeLayers(settings: GlazeSettings): string[] {
  if (settings.linearStackCount <= 0 || settings.linearOpacity <= 0) return []

  const rand = mulberry32(settings.linearSeed)
  const averageDistancePx = 28 + (rand() * 128)
  const lightRatio = 0.2 + (rand() * 0.65)
  const layers: string[] = []

  for (let layerIndex = 0; layerIndex < settings.linearStackCount; layerIndex += 1) {
    const angle = 45
    const phase = rand() * averageDistancePx
    const stops: string[] = []
    let cursor = 0

    for (let stripIndex = 0; stripIndex < 18; stripIndex += 1) {
      const distance = Math.max(12, averageDistancePx * (0.55 + (rand() * 1.05)))
      const litWidth = Math.max(3, distance * lightRatio * (0.7 + (rand() * 0.65)))
      const clearWidth = Math.max(4, distance - litWidth)
      const lightAlpha = clamp(settings.linearOpacity * (0.55 + (rand() * 0.9)), 0, GLAZE_LINEAR_OPACITY_MAX)
      const warmJitter = Math.round((rand() * 22) - 11)
      const red = clamp(245 + warmJitter, 0, 255)
      const green = clamp(245 + warmJitter, 0, 255)
      const blue = clamp(255 - Math.round(rand() * 18), 0, 255)
      const clearEnd = cursor + clearWidth
      const lightEnd = clearEnd + litWidth
      stops.push(`transparent ${Math.max(0, cursor - phase).toFixed(1)}px`)
      stops.push(`transparent ${Math.max(0, clearEnd - phase).toFixed(1)}px`)
      stops.push(`rgba(${red}, ${green}, ${blue}, ${lightAlpha.toFixed(3)}) ${Math.max(0, clearEnd - phase).toFixed(1)}px`)
      stops.push(`rgba(${red}, ${green}, ${blue}, ${lightAlpha.toFixed(3)}) ${Math.max(0, lightEnd - phase).toFixed(1)}px`)
      cursor += distance
    }

    layers.push(`repeating-linear-gradient(${angle}deg, ${stops.join(', ')})`)
  }

  return layers
}

function buildRadialGlazeLayers(settings: GlazeSettings): string[] {
  if (settings.radialCount <= 0 || settings.radialOpacity <= 0) return []

  const rand = mulberry32(settings.radialSeed)
  const layers: string[] = []

  const nextPrismaticRgb = (): [number, number, number] => {
    const channels: [number, number, number] = [0, 0, 0]
    const channelOrder: [number, number, number] = [0, 1, 2]

    for (let i = channelOrder.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1))
      const temp = channelOrder[i]
      channelOrder[i] = channelOrder[j]
      channelOrder[j] = temp
    }

    channels[channelOrder[0]] = 255
    channels[channelOrder[1]] = 127 + Math.round(rand() * 128)
    channels[channelOrder[2]] = 0
    return channels
  }

  for (let index = 0; index < settings.radialCount; index += 1) {
    const corner = GLAZE_RADIAL_CORNERS[index % GLAZE_RADIAL_CORNERS.length]
    const [innerR, innerG, innerB] = nextPrismaticRgb()
    const [midR, midG, midB] = nextPrismaticRgb()
    const [outerR, outerG, outerB] = nextPrismaticRgb()
    const radiusInner = Math.round(18 + (rand() * 14))
    const radiusMid = Math.round(46 + (rand() * 20))
    const radiusOuter = Math.round(74 + (rand() * 22))
    const alphaScale = clamp(settings.radialOpacity * (0.8 + (rand() * 0.7)), 0, GLAZE_RADIAL_OPACITY_MAX)
    const alphaInner = clamp(alphaScale * (1.0 + (rand() * 0.2)), 0, GLAZE_RADIAL_OPACITY_MAX)
    const alphaMid = clamp(alphaScale * (0.8 + (rand() * 0.2)), 0, GLAZE_RADIAL_OPACITY_MAX)
    const alphaOuter = clamp(alphaScale * (0.52 + (rand() * 0.2)), 0, GLAZE_RADIAL_OPACITY_MAX)
    layers.push(
      `radial-gradient(circle at ${corner}, rgba(${innerR}, ${innerG}, ${innerB}, ${alphaInner.toFixed(3)}) ${radiusInner}%, rgba(${midR}, ${midG}, ${midB}, ${alphaMid.toFixed(3)}) ${radiusMid}%, rgba(${outerR}, ${outerG}, ${outerB}, ${alphaOuter.toFixed(3)}) ${radiusOuter}%, transparent 100%)`,
    )
  }

  return layers
}

function buildGloomGlazeLayer(settings: GlazeSettings, useLightColor: boolean): string {
  if (settings.gloomOpacity <= 0) return 'none'
  const centerPct = clamp(settings.gloomPosition, -0.5, 1.5) * 100
  const edgeScale = clamp(settings.gloomShape, 0, 2)
  const edgeAlpha = clamp(settings.gloomOpacity * edgeScale, 0, GLAZE_GLOOM_OPACITY_MAX)
  const centerAlpha = clamp(settings.gloomOpacity, 0, GLAZE_GLOOM_OPACITY_MAX)
  const channel = useLightColor ? 255 : 0
  return `linear-gradient(180deg, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) -100%, rgba(${channel}, ${channel}, ${channel}, ${centerAlpha.toFixed(3)}) ${centerPct.toFixed(1)}%, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) 200%)`
}

function buildSheenGlazeLayer(settings: GlazeSettings, useDarkColor: boolean): string {
  if (settings.sheenOpacity <= 0) return 'none'
  const centerPct = clamp(settings.sheenPosition, -0.5, 1.5) * 100
  const edgeScale = clamp(settings.sheenShape, 0, 2)
  const edgeAlpha = clamp(settings.sheenOpacity * edgeScale, 0, GLAZE_SHEEN_OPACITY_MAX)
  const centerAlpha = clamp(settings.sheenOpacity, 0, GLAZE_SHEEN_OPACITY_MAX)
  const channel = useDarkColor ? 0 : 255
  return `linear-gradient(180deg, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) -100%, rgba(${channel}, ${channel}, ${channel}, ${centerAlpha.toFixed(3)}) ${centerPct.toFixed(1)}%, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) 200%)`
}

// Converts a pixel scroll position (e.g. from the legacy per-note SQLite
// scrollTop column) to an integer line count for storage in
// PersistedViewportState/EditRestoreSnapshot.viewport.
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>
  }
  return {}
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeTextureMaterial(source: unknown, fallback: TextureMaterialSettings): TextureMaterialSettings {
  const record = toRecord(source)
  const color = toRecord(record.color)

  return {
    enabled: record.enabled !== false,
    seed: Math.max(0, Math.round(toFiniteNumber(record.seed, fallback.seed))),
    granularity: clamp(
      Math.round(toFiniteNumber(record.granularity, fallback.granularity)),
      TEXTURE_GRANULARITY_MIN,
      TEXTURE_GRANULARITY_MAX,
    ),
    vSteps: clamp(
      Math.round(toFiniteNumber(record.vSteps, fallback.vSteps)),
      TEXTURE_VSTEPS_MIN,
      TEXTURE_VSTEPS_MAX,
    ),
    color: {
      h: clamp(Math.round(toFiniteNumber(color.h, fallback.color.h)), 0, 360),
      s: clamp(toFiniteNumber(color.s, fallback.color.s), 0, 1),
      v: clamp(toFiniteNumber(color.v, fallback.color.v), 0, 1),
      a: clamp(toFiniteNumber(color.a, fallback.color.a), 0, 1),
    },
  }
}

function cloneTextureMaterials(source: Partial<TextureMaterialsBySurface> | null | undefined): TextureMaterialsBySurface {
  const record = toRecord(source)
  return {
    appGrid: normalizeTextureMaterial(record.appGrid, DEFAULT_TEXTURE_MATERIALS.appGrid),
    sidebarContent: normalizeTextureMaterial(record.sidebarContent, DEFAULT_TEXTURE_MATERIALS.sidebarContent),
    editorEditText: normalizeTextureMaterial(record.editorEditText, DEFAULT_TEXTURE_MATERIALS.editorEditText),
    editorRenderText: normalizeTextureMaterial(record.editorRenderText, DEFAULT_TEXTURE_MATERIALS.editorRenderText),
  }
}

function cloneTextureMaterial(source: unknown, fallback: TextureMaterialSettings = DEFAULT_TEXTURE_MATERIALS[TEXTURE_PREVIEW_SURFACE]): TextureMaterialSettings {
  return normalizeTextureMaterial(source, fallback)
}

function toTexturePreviewMaterial(source: unknown): TextureMaterialSettings {
  return normalizeTextureMaterial(source, DEFAULT_TEXTURE_MATERIALS[TEXTURE_PREVIEW_SURFACE])
}

function normalizeLoadoutHighlightColors(source: unknown): HighlightColors {
  const record = toRecord(source)
  const legacySelection = typeof record.selection === 'string' ? record.selection : null
  const legacyTextEmboss = typeof record.textEmboss === 'string' ? record.textEmboss : null

  return {
    caret: typeof record.caret === 'string' ? record.caret : DEFAULT_HIGHLIGHT_COLORS.caret,
    search: typeof record.search === 'string' ? record.search : DEFAULT_HIGHLIGHT_COLORS.search,
    selectionEdit: typeof record.selectionEdit === 'string'
      ? record.selectionEdit
      : (legacySelection ?? DEFAULT_HIGHLIGHT_COLORS.selectionEdit),
    selectionRender: typeof record.selectionRender === 'string'
      ? record.selectionRender
      : (legacySelection ?? DEFAULT_HIGHLIGHT_COLORS.selectionRender),
    textBase: typeof record.textBase === 'string' ? record.textBase : DEFAULT_HIGHLIGHT_COLORS.textBase,
    textEmbossEdit: typeof record.textEmbossEdit === 'string'
      ? record.textEmbossEdit
      : (legacyTextEmboss ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossEdit),
    textEmbossRender: typeof record.textEmbossRender === 'string'
      ? record.textEmbossRender
      : (legacyTextEmboss ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossRender),
    textEmbossUi: typeof record.textEmbossUi === 'string'
      ? record.textEmbossUi
      : (legacyTextEmboss ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossUi),
    background: typeof record.background === 'string' ? record.background : DEFAULT_HIGHLIGHT_COLORS.background,
    topBackground: typeof record.topBackground === 'string' ? record.topBackground : DEFAULT_HIGHLIGHT_COLORS.topBackground,
    bottomBackground: typeof record.bottomBackground === 'string' ? record.bottomBackground : DEFAULT_HIGHLIGHT_COLORS.bottomBackground,
    gridOutline: typeof record.gridOutline === 'string' ? record.gridOutline : DEFAULT_HIGHLIGHT_COLORS.gridOutline,
    grid: typeof record.grid === 'string' ? record.grid : DEFAULT_HIGHLIGHT_COLORS.grid,
    base: typeof record.base === 'string' ? record.base : DEFAULT_HIGHLIGHT_COLORS.base,
    inputFields: typeof record.inputFields === 'string' ? record.inputFields : DEFAULT_HIGHLIGHT_COLORS.inputFields,
    appButtons: typeof record.appButtons === 'string' ? record.appButtons : DEFAULT_HIGHLIGHT_COLORS.appButtons,
    markdownHeadline: typeof record.markdownHeadline === 'string' ? record.markdownHeadline : DEFAULT_HIGHLIGHT_COLORS.markdownHeadline,
    markdownList: typeof record.markdownList === 'string' ? record.markdownList : DEFAULT_HIGHLIGHT_COLORS.markdownList,
    markdownBlockquote: typeof record.markdownBlockquote === 'string' ? record.markdownBlockquote : DEFAULT_HIGHLIGHT_COLORS.markdownBlockquote,
    markdownCode: typeof record.markdownCode === 'string' ? record.markdownCode : DEFAULT_HIGHLIGHT_COLORS.markdownCode,
    markdownChecked: typeof record.markdownChecked === 'string' ? record.markdownChecked : DEFAULT_HIGHLIGHT_COLORS.markdownChecked,
    markdownUnchecked: typeof record.markdownUnchecked === 'string' ? record.markdownUnchecked : DEFAULT_HIGHLIGHT_COLORS.markdownUnchecked,
  }
}

function roundForSignature(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
  return `{${entries.join(',')}}`
}

function normalizeTextureMaterialForLoadoutSignature(source: TextureMaterialSettings): TextureMaterialSettings {
  return {
    enabled: source.enabled,
    seed: Math.max(0, Math.round(source.seed)),
    granularity: clamp(Math.round(source.granularity), TEXTURE_GRANULARITY_MIN, TEXTURE_GRANULARITY_MAX),
    vSteps: clamp(Math.round(source.vSteps), TEXTURE_VSTEPS_MIN, TEXTURE_VSTEPS_MAX),
    color: {
      h: clamp(Math.round(source.color.h), 0, 360),
      s: roundForSignature(clamp(source.color.s, 0, 1)),
      v: roundForSignature(clamp(source.color.v, 0, 1)),
      a: roundForSignature(clamp(source.color.a, 0, 1)),
    },
  }
}

function normalizeUiLoadoutForSignature(loadout: unknown): UiLayoutLoadout {
  const source = toRecord(loadout)
  const normalizedTextureMaterials = cloneTextureMaterials(source.textureMaterials as Partial<TextureMaterialsBySurface> | null | undefined)
  const normalizedHighlightColors = normalizeLoadoutHighlightColors(source.highlightColors)

  const darkMode = source.darkMode === 'none' || source.darkMode === 'mono' || source.darkMode === 'red' || source.darkMode === 'dusk' || source.darkMode === 'neon' || source.darkMode === 'matrix'
    ? source.darkMode
    : 'none'

  return {
    editorGlyphPaddingPx: clamp(
      Math.round(toFiniteNumber(source.editorGlyphPaddingPx, DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX)),
      EDITOR_GLYPH_PADDING_MIN_PX,
      EDITOR_GLYPH_PADDING_MAX_PX,
    ),
    borderRadiusRegularPx: clamp(
      Math.round(toFiniteNumber(source.borderRadiusRegularPx, DEFAULT_BORDER_RADIUS_REGULAR_PX)),
      BORDER_RADIUS_REGULAR_MIN_PX,
      BORDER_RADIUS_REGULAR_MAX_PX,
    ),
    renderScrollDynamic: roundForSignature(clamp(toFiniteNumber(source.renderScrollDynamic, getRenderScrollDynamic()), 0.1, 5)),
    renderScrollResponsiveness: roundForSignature(clamp(toFiniteNumber(source.renderScrollResponsiveness, getRenderScrollResponsiveness()), 0.1, 5)),
    renderScrollTotalTimeSec: roundForSignature(clamp(toFiniteNumber(source.renderScrollTotalTimeSec, getRenderScrollTotalTimeSec()), 0, 2)),
    renderScrollMaxSpeedPxPerSec: Math.round(clamp(toFiniteNumber(source.renderScrollMaxSpeedPxPerSec, getRenderScrollMaxSpeedPxPerSec()), 1000, 100000)),
    renderScrollSkew: roundForSignature(clamp(toFiniteNumber(source.renderScrollSkew, getRenderScrollSkew()), RENDER_SCROLL_SKEW_MIN, RENDER_SCROLL_SKEW_MAX)),
    audioKeyVolume: clamp(toFiniteNumber(source.audioKeyVolume, 1), 0, 1),
    audioKeyVariance: clamp(toFiniteNumber(source.audioKeyVariance, 0), 0, 0.5),
    audioPitch: clamp(toFiniteNumber(source.audioPitch, 0), -100, 100),
    audioBassVolume: clamp(toFiniteNumber(source.audioBassVolume, 0), 0, 1),
    audioTrebleVolume: clamp(toFiniteNumber(source.audioTrebleVolume, 0), 0, 1),
    audioReverbStrength: clamp(toFiniteNumber(source.audioReverbStrength ?? source.audioReverbAmount, 0), 0, 1),
    audioReverbSpace: clamp(toFiniteNumber(source.audioReverbSpace, 0), 0, 1),
    typingSoundEnabled: source.typingSoundEnabled === true,
    typingSoundSet: source.typingSoundSet === 'A' || source.typingSoundSet === 'B' || source.typingSoundSet === 'C'
      ? source.typingSoundSet
      : DEFAULT_TYPING_SOUND_SET,
    glaze: sanitizeGlazeSettings(source.glaze, DEFAULT_GLAZE_SETTINGS),
    darkMode,
    filterInvert: clamp(toFiniteNumber(source.filterInvert, 0), 0, 1),
    filterSepia: clamp(toFiniteNumber(source.filterSepia, 0), 0, 1),
    filterHueRotate: clamp(toFiniteNumber(source.filterHueRotate, 0), 0, 360),
    filterBrightness: clamp(toFiniteNumber(source.filterBrightness, 1), 0, 2),
    filterContrast: clamp(toFiniteNumber(source.filterContrast, 1), 0, 2),
    filterSaturate: clamp(toFiniteNumber(source.filterSaturate, 0.5), 0, 1),
    filterColorize: clamp(toFiniteNumber(source.filterColorize, 0), 0, 1),
    highlightColors: normalizedHighlightColors,
    editorTextColors: {
      editorEditText: typeof source.editorTextColors === 'object' && source.editorTextColors !== null && typeof (source.editorTextColors as Record<string, unknown>).editorEditText === 'string'
        ? String((source.editorTextColors as Record<string, unknown>).editorEditText)
        : DEFAULT_EDITOR_TEXT_COLORS.editorEditText,
      editorRenderText: typeof source.editorTextColors === 'object' && source.editorTextColors !== null && typeof (source.editorTextColors as Record<string, unknown>).editorRenderText === 'string'
        ? String((source.editorTextColors as Record<string, unknown>).editorRenderText)
        : DEFAULT_EDITOR_TEXT_COLORS.editorRenderText,
    },
    textureMaterials: {
      appGrid: normalizeTextureMaterialForLoadoutSignature(normalizedTextureMaterials.appGrid),
      sidebarContent: normalizeTextureMaterialForLoadoutSignature(normalizedTextureMaterials.sidebarContent),
      editorEditText: normalizeTextureMaterialForLoadoutSignature(normalizedTextureMaterials.editorEditText),
      editorRenderText: normalizeTextureMaterialForLoadoutSignature(normalizedTextureMaterials.editorRenderText),
    },
  }
}

function buildUiLoadoutSignature(loadout: UiLayoutLoadout): string {
  return stableStringify(normalizeUiLoadoutForSignature(loadout))
}

function areHsvaEqual(a: HsvaColor, b: HsvaColor): boolean {
  return a.h === b.h && a.s === b.s && a.v === b.v && a.a === b.a
}

function areTextureMaterialsEqual(a: TextureMaterialSettings, b: TextureMaterialSettings): boolean {
  return (
    a.enabled === b.enabled
    && a.seed === b.seed
    && a.granularity === b.granularity
    && a.vSteps === b.vSteps
    && areHsvaEqual(a.color, b.color)
  )
}

function quantizeTextureSize(value: number): number {
  return Math.max(128, Math.ceil(Math.max(0, value) / 64) * 64)
}

const syncTextureToScroll = (scrollTop: number, maskEl: HTMLElement) => {
  maskEl.style.maskPosition = `0 ${-scrollTop}px`;
  maskEl.style.webkitMaskPosition = `0 ${-scrollTop}px`;
};

function formatCreatedDate(timestampMs: number): string {
  const date = new Date(timestampMs)
  const day = pad2(date.getDate())
  const month = date.toLocaleString(undefined, { month: 'long' })
  const year2 = String(date.getFullYear()).slice(-2)
  return `${day} ${month} ${year2}`
}

function formatModifiedDate(timestampMs: number): string {
  const date = new Date(timestampMs)
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hours = pad2(date.getHours())
  const minutes = pad2(date.getMinutes())
  return `[ ${year}/${month}/${day} | ${hours}:${minutes} ]`
}

async function waitForNotesBridge(shouldStop: () => boolean): Promise<boolean> {
  while (!shouldStop()) {
    if (window.thockdownNotes) {
      return true
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  return false
}

type NoteListItemProps = {
  note: NoteSummary
  isActive: boolean
  isModified?: boolean
  onSelect: (noteId: string) => void
  onPrimedLeftClick: (noteId: string) => void
  onSaveClick?: (noteId: string) => void
  onCloseClick?: (noteId: string) => void
  onArchiveClick?: (noteId: string) => void
  onTrashClick?: (noteId: string) => void
  primedAction?: NotePrimedAction | null
  onRightPressStart: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onRightPressEnd: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (noteId: string) => void
  isTrashMode?: boolean
  variant?: 'default' | 'tree'
}

const NoteListItem = memo(function NoteListItem({
  note,
  isActive,
  isModified = false,
  onSelect,
  onPrimedLeftClick,
  onSaveClick,
  onCloseClick,
  onArchiveClick,
  onTrashClick,
  primedAction = null,
  onRightPressStart,
  onRightPressEnd,
  onMouseLeave,
  isTrashMode = false,
  variant = 'default',
}: NoteListItemProps) {
  const isTreeVariant = variant === 'tree'
  const createdDate = isTreeVariant ? '' : formatCreatedDate(note.createdAtMs)

  const handleSelect = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (primedAction) {
      event.preventDefault()
      event.stopPropagation()
      onPrimedLeftClick(note.id)
      return
    }

    onSelect(note.id)
  }, [primedAction, note.id, onPrimedLeftClick, onSelect])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(note.id)
    }
  }, [note.id, onSelect])

  const handleSaveClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onSaveClick?.(note.id)
  }, [note.id, onSaveClick])

  const handleCloseClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onCloseClick?.(note.id)
  }, [note.id, onCloseClick])

  const handleArchiveClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onArchiveClick?.(note.id)
  }, [note.id, onArchiveClick])

  const handleTrashClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onTrashClick?.(note.id)
  }, [note.id, onTrashClick])

  const isExternal = isExternalNote(note)
  const displayTitle = isExternal ? note.fileName : note.title

  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) return

    event.preventDefault()
    event.stopPropagation()
    if (isExternal) return

    onRightPressStart(note.id, event)
  }, [note.id, onRightPressStart, isExternal])

  const handleMouseUp = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) return

    event.preventDefault()
    event.stopPropagation()
    if (isExternal) return

    onRightPressEnd(note.id, event)
  }, [note.id, onRightPressEnd, isExternal])

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleMouseLeave = useCallback(() => {
    onMouseLeave?.(note.id)
  }, [note.id, onMouseLeave])

  const hasActionColumns = !isTreeVariant
  const isArchived = isArchivedNote(note)
  const isDeleted = isDeletedNote(note)
  const isArchiveButtonDisabled = !onArchiveClick || isArchived || (!isTrashMode && isDeleted)
  const isTrashButtonDisabled = !onTrashClick || (!isTrashMode && isDeleted)

  return (
    <div
      className={`note-list-item${isActive ? ' is-active' : ''}${isTreeVariant ? ' is-tree-card' : ''}${isModified ? ' is-modified' : ''}${isExternal ? ' is-external' : ''}${primedAction === 'archive' ? ' is-primed-for-archiving' : ''}${primedAction === 'deletion' ? ' is-primed-for-deletion' : ''}`}
      data-note-id={note.id}
      role="option"
      aria-selected={isActive}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      tabIndex={0}
    >
      {hasActionColumns ? (
        <div className="note-list-columns">
          <div className="note-list-column note-list-column-primary">
            <div className="note-list-content">
              <div className="note-list-title">{displayTitle || 'Untitled'}</div>
              <div className="note-list-meta-row">
                <span className="note-list-meta-left">{createdDate}</span>
                <span className="note-list-meta-right">{formatModifiedDate(note.updatedAtMs)}</span>
              </div>
            </div>
          </div>

          {isExternal ? (
            <>
              <div className={`note-list-column note-list-column-action note-list-column-save${!isModified ? ' is-disabled' : ' is-modified'}`}>
                <button
                  type="button"
                  className="note-list-action-button note-list-action-button-save"
                  disabled={!isModified}
                  aria-label={isModified ? 'Save external note' : 'Save disabled'}
                  title={isModified ? 'Save external note' : 'Save disabled'}
                  onClick={handleSaveClick}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}
                >
                  <span className="fa-solid fa-floppy-disk" aria-hidden="true" />
                </button>
              </div>

              <div className={`note-list-column note-list-column-action note-list-column-close${isModified ? ' is-modified' : ''}`}>
                <button
                  type="button"
                  className="note-list-action-button note-list-action-button-close"
                  disabled={!isExternal}
                  aria-label="Close external note"
                  title="Close external note"
                  onClick={handleCloseClick}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}
                >
                  <span className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`note-list-column note-list-column-action note-list-column-archive${isArchiveButtonDisabled ? ' is-disabled' : ''}`}>
                <button
                  type="button"
                  className="note-list-action-button note-list-action-button-archive"
                  disabled={isArchiveButtonDisabled}
                  aria-label={isArchiveButtonDisabled ? 'Archive disabled' : 'Archive note'}
                  title={isArchiveButtonDisabled ? 'Archive disabled' : 'Archive note'}
                  onClick={handleArchiveClick}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}/>
              </div>

              <div className={`note-list-column note-list-column-action note-list-column-trash${isTrashButtonDisabled ? ' is-disabled' : ''}`}>
                <button
                  type="button"
                  className="note-list-action-button note-list-action-button-trash"
                  disabled={isTrashButtonDisabled}
                  aria-label={isTrashButtonDisabled ? 'Trash disabled' : isTrashMode && isDeleted ? 'Permanently delete note' : 'Trash note'}
                  title={isTrashButtonDisabled ? 'Trash disabled' : isTrashMode && isDeleted ? 'Permanently delete note' : 'Trash note'}
                  onClick={handleTrashClick}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}/>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="note-list-content">
          <div className="note-list-title">{displayTitle || 'Untitled'}</div>
          {isTreeVariant ? null : (
            <div className="note-list-meta-row">
              <span className="note-list-meta-left">{createdDate}</span>
              <span className="note-list-meta-right">{formatModifiedDate(note.updatedAtMs)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

type CategoryTreeViewProps = {
  groups: PrimaryGroup[]
  activeNoteId: string | null
  persistedCollapsedPrimary: string[]
  persistedCollapsedSecondary: string[]
  focusNoteRequestKey: number
  onCollapseChange: (next: { collapsedPrimary: string[]; collapsedSecondary: string[] }) => void
  onSelect: (noteId: string) => void
  onPrimedLeftClick: (noteId: string) => void
  primedNoteActionById: Map<string, NotePrimedAction>
  onNoteRightPressStart: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onNoteRightPressEnd: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onNoteMouseLeave?: (noteId: string) => void
}

const CategoryTreeView = memo(function CategoryTreeView({
  groups,
  activeNoteId,
  persistedCollapsedPrimary,
  persistedCollapsedSecondary,
  focusNoteRequestKey,
  onCollapseChange,
  onSelect,
  onPrimedLeftClick,
  primedNoteActionById,
  onNoteRightPressStart,
  onNoteRightPressEnd,
  onNoteMouseLeave,
}: CategoryTreeViewProps) {
  const collapsedPrimary = useMemo(() => new Set(persistedCollapsedPrimary), [persistedCollapsedPrimary])
  const collapsedSecondary = useMemo(() => new Set(persistedCollapsedSecondary), [persistedCollapsedSecondary])
  const lastHandledFocusRequestKeyRef = useRef(focusNoteRequestKey)

  const unfoldPathForActiveNote = useCallback(() => {
    if (!activeNoteId || groups.length === 0) {
      return false
    }

    let targetPrimaryName: string | null = null
    let targetSecondaryName: string | null = null

    for (const primary of groups) {
      for (const secondary of primary.secondary) {
        for (const tertiary of secondary.tertiary) {
          if (tertiary.notes.some((note) => note.id === activeNoteId)) {
            targetPrimaryName = primary.name
            targetSecondaryName = secondary.name
            break
          }
        }

        if (targetPrimaryName) {
          break
        }
      }

      if (targetPrimaryName) {
        break
      }
    }

    if (!targetPrimaryName || !targetSecondaryName) {
      return false
    }

    const nextCollapsedPrimary = new Set(
      groups
        .map((primary) => primary.name)
        .filter((primaryName) => primaryName !== targetPrimaryName),
    )

    const nextCollapsedSecondary = new Set<string>()
    for (const primary of groups) {
      for (const secondary of primary.secondary) {
        const secondaryKey = `${primary.name}:${secondary.name}`
        const keepOpen = primary.name === targetPrimaryName && secondary.name === targetSecondaryName
        if (!keepOpen) {
          nextCollapsedSecondary.add(secondaryKey)
        }
      }
    }

    const nextCollapsedPrimaryList = [...nextCollapsedPrimary]
    const nextCollapsedSecondaryList = [...nextCollapsedSecondary]

    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return false
    }

    onCollapseChange({
      collapsedPrimary: nextCollapsedPrimaryList,
      collapsedSecondary: nextCollapsedSecondaryList,
    })
    return true
  }, [activeNoteId, groups, onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])

  const ensureActiveNoteVisible = useCallback(() => {
    if (!activeNoteId) {
      return
    }

    const selector = `.note-list-item.is-tree-card[data-note-id="${escapeAttributeSelectorValue(activeNoteId)}"]`
    const activeNoteElement = document.querySelector<HTMLElement>(selector)
    if (!activeNoteElement) {
      return
    }

    const scrollContainer =
      activeNoteElement.closest<HTMLElement>('.notes-list.tree-view')
      ?? activeNoteElement.closest<HTMLElement>('.sidebar-content')

    if (!scrollContainer) {
      return
    }

    const containerRect = scrollContainer.getBoundingClientRect()
    const noteRect = activeNoteElement.getBoundingClientRect()
    const visibilityPaddingPx = 8
    const visibleTop = containerRect.top + visibilityPaddingPx
    const visibleBottom = containerRect.bottom - visibilityPaddingPx

    if (noteRect.top < visibleTop) {
      scrollContainer.scrollTop -= (visibleTop - noteRect.top)
      return
    }

    if (noteRect.bottom > visibleBottom) {
      scrollContainer.scrollTop += (noteRect.bottom - visibleBottom)
    }
  }, [activeNoteId])

  useEffect(() => {
    if (focusNoteRequestKey <= 0) {
      return
    }

    if (focusNoteRequestKey === lastHandledFocusRequestKeyRef.current) {
      return
    }

    lastHandledFocusRequestKeyRef.current = focusNoteRequestKey

    unfoldPathForActiveNote()

    let cancelled = false
    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        if (cancelled) {
          return
        }
        ensureActiveNoteVisible()
      })

      if (cancelled) {
        cancelAnimationFrame(secondFrame)
      }
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrame)
    }
  }, [ensureActiveNoteVisible, focusNoteRequestKey, unfoldPathForActiveNote])

  const togglePrimaryCategory = useCallback((categoryName: string) => {
    const allPrimary = groups.map((group) => group.name)
    const selectedPrimary = groups.find((group) => group.name === categoryName)
    const secondaryKeys = (selectedPrimary?.secondary ?? []).map((secondary) => `${categoryName}:${secondary.name}`)
    const generalSecondaryKey = `${categoryName}:${GENERAL_SECONDARY_NAME}`

    const nextCollapsedPrimary = new Set<string>()
    const nextCollapsedSecondary = new Set(collapsedSecondary)

    if (collapsedPrimary.has(categoryName)) {
      allPrimary
        .filter((primaryName) => primaryName !== categoryName)
        .forEach((primaryName) => nextCollapsedPrimary.add(primaryName))

      // Keep the fallback/general bucket visible whenever a primary is expanded.
      nextCollapsedSecondary.delete(generalSecondaryKey)

      secondaryKeys.forEach((secondaryKey) => {
        if (secondaryKey !== generalSecondaryKey) {
          nextCollapsedSecondary.add(secondaryKey)
        }
      })
    } else {
      allPrimary
        .filter((primaryName) => primaryName !== categoryName)
        .forEach((primaryName) => nextCollapsedPrimary.add(primaryName))

      if (secondaryKeys.length > 0) {
        const allExpanded = secondaryKeys.every((secondaryKey) => !collapsedSecondary.has(secondaryKey))
        if (allExpanded) {
          secondaryKeys.forEach((secondaryKey) => nextCollapsedSecondary.add(secondaryKey))
        } else {
          secondaryKeys.forEach((secondaryKey) => nextCollapsedSecondary.delete(secondaryKey))
        }

        nextCollapsedSecondary.delete(generalSecondaryKey)
      }
    }

    const nextCollapsedPrimaryList = [...nextCollapsedPrimary]
    const nextCollapsedSecondaryList = [...nextCollapsedSecondary]
    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return
    }

    onCollapseChange({
      collapsedPrimary: nextCollapsedPrimaryList,
      collapsedSecondary: nextCollapsedSecondaryList,
    })
  }, [collapsedPrimary, collapsedSecondary, groups, onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])

  const toggleSecondaryCategory = useCallback((primaryName: string, secondaryName: string) => {
    const key = `${primaryName}:${secondaryName}`
    const allPrimary = groups.map((group) => group.name)
    const selectedPrimary = groups.find((group) => group.name === primaryName)
    const secondaryKeys = (selectedPrimary?.secondary ?? []).map((secondary) => `${primaryName}:${secondary.name}`)
    const nextCollapsedPrimary = new Set(allPrimary.filter((primary) => primary !== primaryName))
    const nextCollapsedSecondary = new Set(collapsedSecondary)

    if (nextCollapsedSecondary.has(key)) {
      secondaryKeys.forEach((secondaryKey) => {
        if (secondaryKey !== key) {
          nextCollapsedSecondary.add(secondaryKey)
        }
      })
      nextCollapsedSecondary.delete(key)
    } else {
      nextCollapsedSecondary.add(key)
    }

    const nextCollapsedPrimaryList = [...nextCollapsedPrimary]
    const nextCollapsedSecondaryList = [...nextCollapsedSecondary]
    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return
    }

    onCollapseChange({
      collapsedPrimary: nextCollapsedPrimaryList,
      collapsedSecondary: nextCollapsedSecondaryList,
    })
  }, [collapsedSecondary, groups, onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])

  if (groups.length === 0) {
    return <div className="notes-empty-state">No notes available for this category view.</div>
  }

  return (
    <div className="category-tree-root" aria-label="Category tree">
      {groups.map((primary) => (
        <details key={primary.name} className="category-primary" open={!collapsedPrimary.has(primary.name)}>
          <summary
            className="category-primary-summary"
            onClick={(event) => {
              event.preventDefault()
              togglePrimaryCategory(primary.name)
            }}
          >
            {primary.name}
          </summary>
          {primary.secondary.map((secondary) => (
            <details
              key={`${primary.name}:${secondary.name}`}
              className="category-secondary"
              open={!collapsedSecondary.has(`${primary.name}:${secondary.name}`)}
            >
              <summary
                className={`category-secondary-summary${secondary.name === GENERAL_SECONDARY_NAME ? ' is-general-secondary' : ''}`}
                aria-label={secondary.name === GENERAL_SECONDARY_NAME ? 'General' : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  toggleSecondaryCategory(primary.name, secondary.name)
                }}
              >
                {secondary.name === GENERAL_SECONDARY_NAME ? <span className="sr-only-mode-label">General</span> : secondary.name}
              </summary>
              {secondary.tertiary.map((tertiary) => (
                <div key={`${primary.name}:${secondary.name}:${tertiary.name}`} className="category-tertiary-block">
                  <div className="category-tertiary-heading">{tertiary.name}</div>
                  {tertiary.notes.map((note) => (
                    <NoteListItem
                      key={note.id}
                      note={note}
                      isActive={note.id === activeNoteId}
                      onSelect={onSelect}
                      onPrimedLeftClick={onPrimedLeftClick}
                      primedAction={primedNoteActionById.get(note.id) ?? null}
                      onRightPressStart={onNoteRightPressStart}
                      onRightPressEnd={onNoteRightPressEnd}
                      onMouseLeave={onNoteMouseLeave}
                      variant="tree"
                    />
                  ))}
                </div>
              ))}
            </details>
          ))}
        </details>
      ))}
    </div>
  )
})

function compareExternalNotesFirst(a: NoteSummary, b: NoteSummary): number {
  const aIsExternal = isExternalNote(a)
  const bIsExternal = isExternalNote(b)
  if (aIsExternal !== bIsExternal) {
    return aIsExternal ? -1 : 1
  }
  return b.updatedAtMs - a.updatedAtMs
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function hashNormalizedText(text: string): Promise<string> {
  const normalized = normalizeInternalText(text)
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function App() {
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const windowControlsGridRef = useRef<HTMLElement | null>(null)
  const sidebarContentRef = useRef<HTMLDivElement | null>(null)
  const optionsContentRef = useRef<HTMLDivElement | null>(null)
  const editorStageRef = useRef<HTMLDivElement | null>(null)
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null)
  const pageJumpInputRef = useRef<HTMLInputElement | null>(null)
  const textureSeedInputRef = useRef<HTMLInputElement | null>(null)
  const glazeLinearSeedInputRef = useRef<HTMLInputElement | null>(null)
  const glazeRadialSeedInputRef = useRef<HTMLInputElement | null>(null)
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const notesRef = useRef<NoteSummary[]>([])

  useEffect(() => {
    notesRef.current = notes
  }, [notes])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchQueryCaseSensitive, setIsSearchQueryCaseSensitive] = useState(false)
  // Mirrors useDocumentFind's isDocumentFindCaseSensitive so
  // buildMenuStateSnapshot (defined earlier than the hook call can be) can
  // read the latest value without a definition-order cycle -- same pattern
  // as tabBarModeRef.
  const documentFindCaseSensitiveRef = useRef(false)
  const [restoredDocumentFindCaseSensitive, setRestoredDocumentFindCaseSensitive] = useState<boolean | null>(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isExportingMd, setIsExportingMd] = useState(false)
  const [exportFolder, setExportFolder] = useState<string | null>(null)
  const [debuggingEnabled, setDebuggingEnabled] = useState(false)
  const [spellCheckEditEnabled, setSpellCheckEditEnabled] = useState(false)
  const [spellCheckRenderEnabled, setSpellCheckRenderEnabled] = useState(false)
  const debugNoteIdRef = useRef<string | null>(null)
  const [windowIsMaximized, setWindowIsMaximized] = useState(false)
  const [windowIsCollapsed, setWindowIsCollapsed] = useState(false)
  const [windowModeTransitionOverlayNonce, setWindowModeTransitionOverlayNonce] = useState(0)
  const [viewStyle, setViewStyle] = useState<ViewStyleKey>('modern')
  const [viewFontSize, setViewFontSize] = useState<ViewSizeKey>('m')
  const [viewSpacing, setViewSpacing] = useState<ViewSpacingKey>('cozy')
  const [editorStyle, setEditorStyle] = useState<EditorStyleKey>(DEFAULT_EDITOR_STYLE)
  const [editorFontSize, setEditorFontSize] = useState<EditorFontSizeKey>(DEFAULT_EDITOR_FONT_SIZE)
  const [editorSpacing, setEditorSpacing] = useState<EditorSpacingKey>(DEFAULT_EDITOR_SPACING)
  const [editorGlyphPaddingPx, setEditorGlyphPaddingPx] = useState<number>(DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX)
  const [borderRadiusRegularPx, setBorderRadiusRegularPx] = useState<number>(DEFAULT_BORDER_RADIUS_REGULAR_PX)
  const [editorFontLoadVersion, setEditorFontLoadVersion] = useState(0)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('date')
  const [lastSidebarModeBeforeOptions, setLastSidebarModeBeforeOptions] = useState<Exclude<SidebarMode, 'options'>>('date')
  const [sidebarViewStateByMode, setSidebarViewStateByMode] = useState<SidebarViewStateByMode>(() => createDefaultSidebarViewStateByMode())
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set())
  const [selectedYears, setSelectedYears] = useState<Set<number | 'older'>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [pageJumpInput, setPageJumpInput] = useState('1')
  const [isPageJumpEditing, setIsPageJumpEditing] = useState(false)
  const [categoryCollapsedPrimary, setCategoryCollapsedPrimary] = useState<string[]>([])
  const [categoryCollapsedSecondary, setCategoryCollapsedSecondary] = useState<string[]>([])
  const [archiveCollapsedPrimary, setArchiveCollapsedPrimary] = useState<string[]>([])
  const [archiveCollapsedSecondary, setArchiveCollapsedSecondary] = useState<string[]>([])
  const [categoryFocusRequestKey, setCategoryFocusRequestKey] = useState(0)
  const [archiveFocusRequestKey, setArchiveFocusRequestKey] = useState(0)
  const [itemsPerPage, setItemsPerPage] = useState(20)
  const [showPagination, setShowPagination] = useState(false)
  const [sidebarTreeScrollerEl, setSidebarTreeScrollerEl] = useState<HTMLDivElement | null>(null)
  // Set when the startup bootstrap (loading the note list / database) fails
  // repeatedly. Surfaced as a visible banner -- previously a failure here
  // just retried silently forever with only a console.error, leaving the
  // app looking "half broken" (no active note, so word count/timeline/tag
  // input all stayed empty) with no indication anything was wrong.
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const activeNoteExternalPathRef = useRef<string | null>(null)
  const [currentExternalNoteHash, setCurrentExternalNoteHash] = useState<string | null>(null)
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [appShellWidthPx, setAppShellWidthPx] = useState(APP_SHELL_MIN_WIDTH_PX)
  const [isSidebarVisible, setIsSidebarVisible] = useState(true)
  // The sections actually occupying a slot right now, sorted left-to-right --
  // resolved from window.thockdownSections.listSections() during bootstrap
  // (see the bootstrap effect below), filtered to position !== null. Starts
  // as a single unnamed default section so there's always something to
  // render before that async round-trip completes.
  const [editorSections, setEditorSections] = useState<EditorSectionEntry[]>(() => [
    { id: DEFAULT_EDITOR_SECTION_ID, name: null, position: 0, widthFraction: null, lastActiveNoteId: null },
  ])
  // Which note each section should activate once it first mounts and
  // registers -- populated by bootstrap, drained by the effect below as
  // each section's registry entry appears. Not app state: this is one-shot
  // bootstrap wiring, not something that should trigger a re-render itself.
  const initialNoteIdBySectionIdRef = useRef<Map<string, string>>(new Map())
  // Which section last received a caret placement, click, or keystroke.
  // Interactions that target "the current note" without a section of their
  // own -- Find & Replace today, drag-a-note-onto-a-section later -- read
  // this rather than assuming there's only one section. With a single
  // section it's always DEFAULT_EDITOR_SECTION_ID; the split-view work is
  // what gives it real values to switch between.
  const [activeSectionId, setActiveSectionId] = useState<string>(DEFAULT_EDITOR_SECTION_ID)
  const markSectionActive = useCallback((sectionId: string) => {
    setActiveSectionId((previous) => (previous === sectionId ? previous : sectionId))
  }, [])
  // Section registry (Phase 4b) -- see src/editorSection/sectionRegistry.ts.
  // The section-scoped hooks still all live inside <EditorSection> today,
  // hardcoded to one section, but that single instance publishes its results
  // here (see the registerSectionHandle call inside EditorSection) so chrome
  // (tag handlers, export, sidebar actions, the global toolbar, etc.) can
  // read through the registry instead of closing over section-owned state
  // directly.
  const sectionRegistryRef = useRef<Map<string, SectionHandle>>(new Map())
  const registerSectionHandle = useCallback((sectionId: string, handle: SectionHandle) => {
    sectionRegistryRef.current.set(sectionId, handle)
  }, [])
  const getActiveSection = useCallback((): SectionHandle | undefined => (
    getActiveSectionHandle(sectionRegistryRef, activeSectionId)
  ), [activeSectionId])
  // Reactive counterpart to the plain registry above: each <EditorSection>
  // instance calls this from its own effect every render (see its
  // reportSectionHandle prop). A plain Map read during the parent's render
  // body only works when the hooks producing the data live in the same
  // component; once they live in a child, the parent can only learn about a
  // change via an effect -- a shallow-equality guard here (not a dependency
  // array) is what keeps that from looping forever.
  const [activeSectionSnapshot, setActiveSectionSnapshot] = useState<SectionHandle | undefined>(undefined)
  const lastReportedSectionHandleRef = useRef<SectionHandle | undefined>(undefined)
  const reportSectionHandle = useCallback((sectionId: string, handle: SectionHandle) => {
    if (sectionId !== activeSectionId) return
    const previous = lastReportedSectionHandleRef.current
    const changed = !previous || (Object.keys(handle) as (keyof SectionHandle)[])
      .some((key) => previous[key] !== handle[key])
    if (!changed) return
    lastReportedSectionHandleRef.current = handle
    setActiveSectionSnapshot(handle)
  }, [activeSectionId])
  useEffect(() => {
    window.windowControls?.setSectionCount?.(editorSections.length)
  }, [editorSections.length])

  const toggleSidebarVisible = useCallback(() => {
    setIsSidebarVisible((previous) => {
      const next = !previous
      // If we're hiding the sidebar while the options panel is selected,
      // restore the last non-options sidebar mode so the gear icon isn't
      // left highlighted when the sidebar is not visible.
        if (!next && sidebarMode === 'options') {
          // Defer restoring the previous menu so we don't reference
          // `runSidebarMenuTransition` during module initialization
          // (avoids TDZ errors). The function will exist by the time
          // this callback runs.
          setTimeout(() => {
            try {
              // prefer the remembered previous mode, fallback to 'date'
              runSidebarMenuTransition(lastSidebarModeBeforeOptions ?? 'date')
            } catch (e) {
              // ignore
            }
          }, 0)
        }
      // Notify main process so it can adjust native window constraints immediately
      try {
        window.windowControls?.setSidebarVisible?.(next)
      } catch (e) {
        // ignore
      }

      // Persist app state menu snapshot with updated sidebar visibility
      if (window.thockdownState && persistenceReady) {
        const snapshot = buildMenuStateSnapshot({ isSidebarVisible: next })
        const section = getActiveSection()
        void window.thockdownState.saveAppState({
          selectedNoteId: section?.activeNoteId ?? null,
          viewport: section?.latestViewportRef.current ?? undefined,
          menu: snapshot,
        })
      }

      return next
    })
  }, [getActiveSection, persistenceReady, sidebarMode])
  const [renderScrollDynamic, setRenderScrollDynamic] = useState(() => getRenderScrollDynamic())
  const [renderScrollResponsiveness, setRenderScrollResponsiveness] = useState(() => getRenderScrollResponsiveness())
  const [renderScrollTotalTimeSec, setRenderScrollTotalTimeSec] = useState(() => getRenderScrollTotalTimeSec())
  const [renderScrollMaxSpeedPxPerSec, setRenderScrollMaxSpeedPxPerSec] = useState(() => getRenderScrollMaxSpeedPxPerSec())
  const [renderScrollSkew, setRenderScrollSkew] = useState(() => getRenderScrollSkew())
  const [uiMode, setUiMode] = useState<UiLoadoutMode>('light')
  const [uiLoadoutEntries, setUiLoadoutEntries] = useState<UiLoadoutEntry[]>([])
  const [lastCustomIdByMode, setLastCustomIdByMode] = useState<{ light: number; dark: number }>({
    light: LOADOUT_DEFAULT_CUSTOM_ID_ABS,
    dark: -LOADOUT_DEFAULT_CUSTOM_ID_ABS,
  })
  const [highlightColors, setHighlightColors] = useState<HighlightColors>(DEFAULT_HIGHLIGHT_COLORS)
  const [editorTextColors, setEditorTextColors] = useState<Record<EditorTextColorTargetKey, string>>(() => ({
    editorEditText: DEFAULT_EDITOR_TEXT_COLORS.editorEditText,
    editorRenderText: DEFAULT_EDITOR_TEXT_COLORS.editorRenderText,
  }))
  const [textureEnabled] = useState(true)
  const [textureMaterials, setTextureMaterials] = useState<TextureMaterialsBySurface>(() => cloneTextureMaterials(DEFAULT_TEXTURE_MATERIALS))
  const [texturePreviewMaterial, setTexturePreviewMaterial] = useState<TextureMaterialSettings>(() => toTexturePreviewMaterial(DEFAULT_TEXTURE_MATERIALS.appGrid))
  const [textureSeedInput, setTextureSeedInput] = useState(() => String(DEFAULT_TEXTURE_MATERIALS.appGrid.seed))
  const [isTextureSeedEditing, setIsTextureSeedEditing] = useState(false)
  const [glazeSettings, setGlazeSettings] = useState<GlazeSettings>(() => DEFAULT_GLAZE_SETTINGS)
  const [glazeLinearSeedInput, setGlazeLinearSeedInput] = useState(() => String(DEFAULT_GLAZE_SETTINGS.linearSeed))
  const [isGlazeLinearSeedEditing, setIsGlazeLinearSeedEditing] = useState(false)
  const [glazeRadialSeedInput, setGlazeRadialSeedInput] = useState(() => String(DEFAULT_GLAZE_SETTINGS.radialSeed))
  const [isGlazeRadialSeedEditing, setIsGlazeRadialSeedEditing] = useState(false)
  const [darkMode, setDarkMode] = useState<DarkModeKey>('none')
  const [filterInvert, setFilterInvert] = useState(0)
  const [filterSepia, setFilterSepia] = useState(0)
  const [filterHueRotate, setFilterHueRotate] = useState(0)
  const [filterBrightness, setFilterBrightness] = useState(1)
  const [filterContrast, setFilterContrast] = useState(1)
  const [filterSaturate, setFilterSaturate] = useState(1)
  const [filterColorize, setFilterColorize] = useState(0)
  const [audioKeyVolume, setAudioKeyVolume] = useState(0.5)
  const [audioKeyVariance, setAudioKeyVariance] = useState(0)
  const [audioPitch, setAudioPitch] = useState(0)
  const [audioBassVolume, setAudioBassVolume] = useState(0)
  const [audioTrebleVolume, setAudioTrebleVolume] = useState(0)
  const [audioReverbStrength, setAudioReverbStrength] = useState(0)
  const [audioReverbSpace, setAudioReverbSpace] = useState(0)
  const [typingSoundEnabled, setTypingSoundEnabled] = useState(false)
  const [typingSoundSet, setTypingSoundSet] = useState<'A' | 'B' | 'C'>(DEFAULT_TYPING_SOUND_SET)
  const [musicVolume, setMusicVolume] = useState(0.8)
  const [musicReverbAmount, setMusicReverbAmount] = useState(0)
  const [musicReverbRoom, setMusicReverbRoom] = useState(0.3)
  const [musicActiveSlots, setMusicActiveSlots] = useState<import('./shared/audioPlayer').PlaylistSlot[]>([])
  const [musicAccordionNonce, setMusicAccordionNonce] = useState(0)
  const [appGridTextureSize, setAppGridTextureSize] = useState({ width: 1280, height: 720 })
  const [sidebarTextureSize, setSidebarTextureSize] = useState({ width: 512, height: 720 })
  const [editorStageTextureSize, setEditorStageTextureSize] = useState({ width: 1280, height: 720 })
  const [primedColorSource, setPrimedColorSource] = useState<ColorArmSource>({ kind: 'active-color' })
  const [activeColorHsva, setActiveColorHsva] = useState<HsvaColor>(() => {
    const seed = parseCssColorToRgba(DEFAULT_HIGHLIGHT_COLORS.caret) ?? { r: 120, g: 115, b: 112, a: 0.8 }
    return rgbaToHsva(seed)
  })
  const [hsvaDragState, setHsvaDragState] = useState<HsvaDragState | null>(null)
  const [textureControlDragState, setTextureControlDragState] = useState<TextureControlDragState | null>(null)
  const colorArmTimerRef = useRef<number | null>(null)
  const pendingUpdateDebounceRef = useRef<number | null>(null)
  type ConsoleMethodName = 'log' | 'info' | 'warn' | 'error' | 'debug'
  const appStateSaveTimerRef = useRef<number | null>(null)
  const noteTransitionLockRef = useRef(false)
  // Mirrors useSectionTabs' tabBarMode so buildMenuStateSnapshot (defined
  // earlier than the hook call, since it depends on things the hook itself
  // depends on) can read the latest value without a definition-order cycle.
  const tabBarModeRef = useRef<'tags' | 'tabs'>('tags')
  const [restoredTabBarMode, setRestoredTabBarMode] = useState<'tags' | 'tabs' | null>(null)

  const originalConsoleMethodsRef = useRef<Partial<Record<ConsoleMethodName, (...args: any[]) => void>>>({})
  const isWritingDebugEntryRef = useRef(false)
  const debugNoteCreationPromiseRef = useRef<Promise<string | null> | null>(null)
  const externalNoteOriginalTextByIdRef = useRef<Map<string, string>>(new Map())
  const externalNoteOriginalHashByIdRef = useRef<Map<string, string>>(new Map())
  const pendingSidebarScrollRestoreRef = useRef<{ mode: SidebarMode; scrollTop: number } | null>(null)
  // Stay here rather than move into useEditorSectionMount: activateNote and
  // queueAppStateSave (both still in App.tsx) also read/write these, and
  // the hook receives them as injected refs, same as latestEditorTextRef.
  const pendingViewportRestoreRef = useRef<PersistedViewportState | null>(null)
  const isApplyingInitialViewportRef = useRef(false)

  const dateFilteredNotesRef = useRef<NoteSummary[]>([])
  const trashFilteredNotesRef = useRef<NoteSummary[]>([])
  const categoryTreeRef = useRef<PrimaryGroup[]>([])
  const archiveTreeRef = useRef<PrimaryGroup[]>([])
  const externalOpenQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingExternalImportPathsRef = useRef<Set<string>>(new Set())
  const sidebarScrollbarTrackRef = useRef<HTMLDivElement | null>(null)
  const sidebarScrollbarRafRef = useRef<number | null>(null)
  const sidebarScrollbarDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null)
  const sidebarScrollbarThumbRef = useRef<HTMLDivElement | null>(null)
  const sidebarScrollThumbTopRef = useRef(0)
  const sidebarScrollThumbHeightRef = useRef(0)
  const [isSidebarScrollThumbActive, setIsSidebarScrollThumbActive] = useState(false)
  const [isDraggingSidebarScrollThumb, setIsDraggingSidebarScrollThumb] = useState(false)
  const sidebarTextureRef = useRef<HTMLDivElement | null>(null)

  const editorRuntimeMetrics = useMemo(
    () => resolveEditorRuntimeMetrics(editorStyle, editorFontSize, editorSpacing, editorGlyphPaddingPx),
    [editorStyle, editorFontSize, editorSpacing, editorGlyphPaddingPx, editorFontLoadVersion],
  )

  const editorFontFamily = useMemo(() => resolveEditorFontFamily(editorStyle), [editorStyle])
  const appGridTextureCss = useTextureSurface({
    enabled: textureEnabled && textureMaterials.appGrid.enabled,
    surface: 'appGrid',
    width: appGridTextureSize.width,
    height: appGridTextureSize.height,
    material: textureMaterials.appGrid,
  })
  const sidebarTextureCss = useTextureSurface({
    enabled: textureEnabled && textureMaterials.sidebarContent.enabled,
    surface: 'sidebarContent',
    width: sidebarTextureSize.width,
    height: sidebarTextureSize.height,
    material: textureMaterials.sidebarContent,
  })
  const editorEditTextTextureCss = useTextureSurface({
    enabled: textureEnabled && textureMaterials.editorEditText.enabled,
    surface: 'editorEditText',
    width: editorStageTextureSize.width,
    height: editorStageTextureSize.height,
    material: textureMaterials.editorEditText,
  })
  const editorRenderTextTextureCss = useTextureSurface({
    enabled: textureEnabled && textureMaterials.editorRenderText.enabled,
    surface: 'editorRenderText',
    width: editorStageTextureSize.width,
    height: editorStageTextureSize.height,
    material: textureMaterials.editorRenderText,
  })
  const texturePreviewCss = useTextureSurface({
    enabled: true,
    surface: TEXTURE_PREVIEW_SURFACE,
    width: 96,
    height: 32,
    material: texturePreviewMaterial,
    usePersistentCache: false,
    useFixedTile: true,
  })
  const activeColorRgba = useMemo(() => hsvaToRgba(activeColorHsva), [activeColorHsva])
  const activeColorCss = useMemo(() => rgbaToCssColor(activeColorRgba), [activeColorRgba])
  const activeColorHex = useMemo(() => rgbaToHex(activeColorRgba), [activeColorRgba])
  const texturePreviewRgba = useMemo(() => hsvaToRgba(texturePreviewMaterial.color), [texturePreviewMaterial.color])
  const texturePreviewHex = useMemo(() => rgbaToHex(texturePreviewRgba), [texturePreviewRgba])
  const appGridTextureTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(textureMaterials.appGrid.color)), [textureMaterials.appGrid.color])
  const sidebarTextureTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(textureMaterials.sidebarContent.color)), [textureMaterials.sidebarContent.color])
  const editorEditTextureTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(textureMaterials.editorEditText.color)), [textureMaterials.editorEditText.color])
  const editorRenderTextureTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(textureMaterials.editorRenderText.color)), [textureMaterials.editorRenderText.color])
  const editorEditTextColorCss = useMemo(() => editorTextColors.editorEditText, [editorTextColors.editorEditText])
  const editorRenderTextColorCss = useMemo(() => editorTextColors.editorRenderText, [editorTextColors.editorRenderText])
  const texturePreviewTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(texturePreviewMaterial.color)), [texturePreviewMaterial.color])
  const derivedPaletteColors = useMemo(
    () => derivePaletteTokensFromBaseColor(highlightColors.base),
    [highlightColors.base],
  )
  // Opaque #RRGGBB form of the app's current root background (same color
  // driving .window-mode-transition-overlay's fill). Reported to the main
  // process so the native BrowserWindow's own paint fallback matches the
  // active theme instead of defaulting to white during native bounds changes.
  const rootBackgroundColorHex = useMemo(() => {
    const rgba = parseCssColorToRgba(derivedPaletteColors.parchmentLightest)
      ?? { r: 249, g: 246, b: 244, a: 1 }
    return rgbaToHex({ ...rgba, a: 1 }).slice(0, 7)
  }, [derivedPaletteColors.parchmentLightest])
  const textEmbossUiPrimaryRgba = useMemo(
    () => parseCssColorToRgba(highlightColors.textEmbossUi) ?? { r: 255, g: 255, b: 255, a: 1 },
    [highlightColors.textEmbossUi],
  )
  const textEmbossUiSecondaryCss = useMemo(
    () => rgbaToCssColor(invertRgbaColor(textEmbossUiPrimaryRgba, 0.22)),
    [textEmbossUiPrimaryRgba],
  )
  const textEmbossEditPrimaryRgba = useMemo(
    () => parseCssColorToRgba(highlightColors.textEmbossEdit) ?? { r: 255, g: 255, b: 255, a: 1 },
    [highlightColors.textEmbossEdit],
  )
  const textEmbossEditSecondaryCss = useMemo(
    () => rgbaToCssColor(invertRgbaColor(textEmbossEditPrimaryRgba, 0.22)),
    [textEmbossEditPrimaryRgba],
  )
  const textEmbossRenderPrimaryRgba = useMemo(
    () => parseCssColorToRgba(highlightColors.textEmbossRender) ?? { r: 255, g: 255, b: 255, a: 1 },
    [highlightColors.textEmbossRender],
  )
  const textEmbossRenderSecondaryCss = useMemo(
    () => rgbaToCssColor(invertRgbaColor(textEmbossRenderPrimaryRgba, 0.22)),
    [textEmbossRenderPrimaryRgba],
  )
  const textBaseRgba = useMemo(
    () => parseCssColorToRgba(highlightColors.textBase) ?? { r: 0, g: 0, b: 0, a: 0.867 },
    [highlightColors.textBase],
  )
  const textColorWithAlphaScale = useCallback((alphaScale: number) => rgbaToCssColor({
    ...textBaseRgba,
    a: clamp(textBaseRgba.a * alphaScale, 0, 1),
  }), [textBaseRgba])
  const textColor90 = useMemo(() => textColorWithAlphaScale(0.9), [textColorWithAlphaScale])
  const textColor80 = useMemo(() => textColorWithAlphaScale(0.8), [textColorWithAlphaScale])
  const textColor70 = useMemo(() => textColorWithAlphaScale(0.7), [textColorWithAlphaScale])
  const textColor60 = useMemo(() => textColorWithAlphaScale(0.6), [textColorWithAlphaScale])
  const textColor50 = useMemo(() => textColorWithAlphaScale(0.5), [textColorWithAlphaScale])
  const textColor40 = useMemo(() => textColorWithAlphaScale(0.4), [textColorWithAlphaScale])
  const textColor30 = useMemo(() => textColorWithAlphaScale(0.3), [textColorWithAlphaScale])
  const textColor20 = useMemo(() => textColorWithAlphaScale(0.2), [textColorWithAlphaScale])
  const textColor10 = useMemo(() => textColorWithAlphaScale(0.1), [textColorWithAlphaScale])

  useEffect(() => {
    const textureApi = window.thockdownTextures
    if (!textureApi) return

    const keep: TextureCacheRequest[] = [
      {
        surface: 'appGrid',
        width: TEXTURE_REPEAT_TILE_SIZE,
        height: TEXTURE_REPEAT_TILE_SIZE,
        seed: textureMaterials.appGrid.seed,
        granularity: textureMaterials.appGrid.granularity,
        vSteps: textureMaterials.appGrid.vSteps,
        algorithmVersion: TEXTURE_ALGORITHM_VERSION,
      },
      {
        surface: 'sidebarContent',
        width: TEXTURE_REPEAT_TILE_SIZE,
        height: TEXTURE_REPEAT_TILE_SIZE,
        seed: textureMaterials.sidebarContent.seed,
        granularity: textureMaterials.sidebarContent.granularity,
        vSteps: textureMaterials.sidebarContent.vSteps,
        algorithmVersion: TEXTURE_ALGORITHM_VERSION,
      },
      {
        surface: 'editorEditText',
        width: TEXTURE_REPEAT_TILE_SIZE,
        height: TEXTURE_REPEAT_TILE_SIZE,
        seed: textureMaterials.editorEditText.seed,
        granularity: textureMaterials.editorEditText.granularity,
        vSteps: textureMaterials.editorEditText.vSteps,
        algorithmVersion: TEXTURE_ALGORITHM_VERSION,
      },
      {
        surface: 'editorRenderText',
        width: TEXTURE_REPEAT_TILE_SIZE,
        height: TEXTURE_REPEAT_TILE_SIZE,
        seed: textureMaterials.editorRenderText.seed,
        granularity: textureMaterials.editorRenderText.granularity,
        vSteps: textureMaterials.editorRenderText.vSteps,
        algorithmVersion: TEXTURE_ALGORITHM_VERSION,
      },
    ]

    void textureApi.purgeCachedTextures({ keep, maxEntries: 96, maxAgeMs: 1000 * 60 * 60 * 24 * 14 })
  }, [
    textureMaterials,
  ])

  const hsvaDisplayColors = useMemo(() => {
    const hColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: 1, v: 1, a: 1 }))
    const sColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: activeColorHsva.s, v: 1, a: 1 }))
    const vColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: 0, v: activeColorHsva.v, a: 1 }))
    const aGhostColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: 0, v: 0, a: activeColorHsva.a }))
    return { hColor, sColor, vColor, aGhostColor }
  }, [activeColorHsva])

  const updateTextureMaterial = useCallback((surface: TextureSurfaceKey, updater: (current: TextureMaterialSettings) => TextureMaterialSettings) => {
    setTextureMaterials((previous) => {
      const next = cloneTextureMaterials(previous)
      next[surface] = updater(next[surface])
      return next
    })
  }, [])

  const applyTexturePreviewToSurface = useCallback((surface: TextureSurfaceKey) => {
    const preview = cloneTextureMaterial(texturePreviewMaterial)
    setTextureMaterials((previous) => {
      const next = cloneTextureMaterials(previous)
      next[surface] = {
        ...preview,
        enabled: true,
      }
      return next
    })
  }, [texturePreviewMaterial])

  const updateHighlightColor = useCallback((key: HighlightColorKey, color: RgbaColor) => {
    setHighlightColors((previous) => ({
      ...previous,
      [key]: rgbaToCssColor(color),
    }))
  }, [])

  const resolveEditorTextColor = useCallback((source: Record<EditorTextColorTargetKey, string>, key: EditorTextColorTargetKey): RgbaColor => {
    return parseCssColorToRgba(source[key])
      ?? parseCssColorToRgba(DEFAULT_EDITOR_TEXT_COLORS[key])
      ?? { r: 0, g: 0, b: 0, a: 1 }
  }, [])

  const updateEditorTextColor = useCallback((target: EditorTextColorTargetKey, color: RgbaColor) => {
    setEditorTextColors((previous) => ({
      ...previous,
      [target]: rgbaToCssColor(color),
    }))
  }, [])

  const applyHsvaValueToEditorText = useCallback((sourceKey: HsvaControlKey, targetKey: EditorTextColorTargetKey) => {
    setEditorTextColors((previous) => {
      const target = resolveEditorTextColor(previous, targetKey)
      const targetHsva = rgbaToHsva(target)
      const sourceValue = activeColorHsva[sourceKey]

      const nextHsva: HsvaColor = {
        ...targetHsva,
        [sourceKey]: sourceKey === 'h'
          ? Math.max(0, Math.min(360, sourceValue))
          : Math.max(0, Math.min(1, sourceValue)),
      }

      return {
        ...previous,
        [targetKey]: rgbaToCssColor(hsvaToRgba(nextHsva)),
      }
    })
  }, [activeColorHsva, resolveEditorTextColor])

  const applyActiveColorToEditorText = useCallback((targetKey: EditorTextColorTargetKey) => {
    setEditorTextColors((previous) => ({
      ...previous,
      [targetKey]: activeColorCss,
    }))
  }, [activeColorCss])

  const updateTextureColor = useCallback((surface: TextureSurfaceKey, color: RgbaColor, enabled = true) => {
    const nextHsva = rgbaToHsva(color)
    updateTextureMaterial(surface, (current) => ({
      ...current,
      enabled: enabled,
      color: {
        h: nextHsva.h,
        s: nextHsva.s,
        v: nextHsva.v,
        a: nextHsva.a,
      },
    }))
  }, [updateTextureMaterial])

  const applyDarkModePreset = useCallback((key: DarkModeKey) => {
    setDarkMode(key)
    const v = DARK_MODE_PRESET_VALUES[key]
    setFilterInvert(v.filterInvert)
    setFilterSepia(v.filterSepia)
    setFilterHueRotate(v.filterHueRotate)
    setFilterBrightness(v.filterBrightness)
    setFilterContrast(v.filterContrast)
    setFilterSaturate(v.filterSaturate)
    setFilterColorize(v.filterColorize)
  }, [])

  const captureUiLayoutLoadout = useCallback((): UiLayoutLoadout => {
    return {
      editorGlyphPaddingPx,
      borderRadiusRegularPx,
      audioKeyVolume,
      audioKeyVariance,
      audioPitch,
      audioBassVolume,
      audioTrebleVolume,
      audioReverbStrength,
      audioReverbSpace,
      typingSoundEnabled,
      typingSoundSet,
      renderScrollDynamic,
      renderScrollResponsiveness,
      renderScrollTotalTimeSec,
      renderScrollMaxSpeedPxPerSec,
      renderScrollSkew,
      glaze: glazeSettings,
      darkMode,
      filterInvert,
      filterSepia,
      filterHueRotate,
      filterBrightness,
      filterContrast,
      filterSaturate,
      filterColorize,
      highlightColors: {
        caret: highlightColors.caret,
        search: highlightColors.search,
        selectionEdit: highlightColors.selectionEdit,
        selectionRender: highlightColors.selectionRender,
        textBase: highlightColors.textBase,
        textEmbossEdit: highlightColors.textEmbossEdit,
        textEmbossRender: highlightColors.textEmbossRender,
        textEmbossUi: highlightColors.textEmbossUi,
        background: highlightColors.background,
        topBackground: highlightColors.topBackground,
        bottomBackground: highlightColors.bottomBackground,
        gridOutline: highlightColors.gridOutline,
        grid: highlightColors.grid,
        base: highlightColors.base,
        inputFields: highlightColors.inputFields,
        appButtons: highlightColors.appButtons,
        markdownHeadline: highlightColors.markdownHeadline,
        markdownList: highlightColors.markdownList,
        markdownBlockquote: highlightColors.markdownBlockquote,
        markdownCode: highlightColors.markdownCode,
        markdownChecked: highlightColors.markdownChecked,
        markdownUnchecked: highlightColors.markdownUnchecked,
      },
      editorTextColors: {
        editorEditText: editorTextColors.editorEditText,
        editorRenderText: editorTextColors.editorRenderText,
      },
      textureMaterials: cloneTextureMaterials(textureMaterials),
    }
  }, [
    editorGlyphPaddingPx,
    borderRadiusRegularPx,
    glazeSettings,
    darkMode,
    filterInvert,
    filterSepia,
    filterHueRotate,
    filterBrightness,
    filterContrast,
    filterSaturate,
    filterColorize,
    renderScrollDynamic,
    renderScrollResponsiveness,
    renderScrollTotalTimeSec,
    renderScrollMaxSpeedPxPerSec,
    renderScrollSkew,
    audioKeyVolume,
    audioKeyVariance,
    audioPitch,
    audioBassVolume,
    audioTrebleVolume,
    audioReverbStrength,
    audioReverbSpace,
    typingSoundEnabled,
    typingSoundSet,
    textureMaterials,
    highlightColors,
    editorTextColors,
  ])

  const applyUiLayoutLoadout = useCallback((loadoutInput: unknown) => {
    const loadout = normalizeUiLoadoutForSignature(loadoutInput)
    setEditorGlyphPaddingPx(
      clamp(
        Math.round(loadout.editorGlyphPaddingPx),
        EDITOR_GLYPH_PADDING_MIN_PX,
        EDITOR_GLYPH_PADDING_MAX_PX,
      ),
    )
    setBorderRadiusRegularPx(
      clamp(
        Math.round(loadout.borderRadiusRegularPx),
        BORDER_RADIUS_REGULAR_MIN_PX,
        BORDER_RADIUS_REGULAR_MAX_PX,
      ),
    )
    setRenderScrollDynamic(clamp(loadout.renderScrollDynamic, 0.1, 5))
    setRenderScrollResponsiveness(clamp(loadout.renderScrollResponsiveness, 0.1, 5))
    setRenderScrollTotalTimeSec(clamp(loadout.renderScrollTotalTimeSec, 0, 2))
    setRenderScrollMaxSpeedPxPerSec(clamp(loadout.renderScrollMaxSpeedPxPerSec, 1000, 100000))
    setRenderScrollSkew(clamp(loadout.renderScrollSkew, RENDER_SCROLL_SKEW_MIN, RENDER_SCROLL_SKEW_MAX))
    setAudioKeyVolume(clamp(loadout.audioKeyVolume, 0, 1))
    setAudioKeyVariance(clamp(loadout.audioKeyVariance, 0, 0.5))
    setAudioPitch(clamp(loadout.audioPitch, -100, 100))
    setAudioBassVolume(clamp(loadout.audioBassVolume, 0, 1))
    setAudioTrebleVolume(clamp(loadout.audioTrebleVolume, 0, 1))
    setAudioReverbStrength(clamp(loadout.audioReverbStrength, 0, 1))
    setAudioReverbSpace(clamp(loadout.audioReverbSpace, 0, 1))
    setTypingSoundEnabled(loadout.typingSoundEnabled)
    setTypingSoundSet(loadout.typingSoundSet ?? DEFAULT_TYPING_SOUND_SET)
    setGlazeSettings(sanitizeGlazeSettings(loadout.glaze, DEFAULT_GLAZE_SETTINGS))
    // Apply darkMode preset to sliders; individual filter values from the
    // loadout then override preset values if they were customised further.
    applyDarkModePreset(loadout.darkMode ?? 'none')
    setFilterInvert(loadout.filterInvert ?? 0)
    setFilterSepia(loadout.filterSepia ?? 0)
    setFilterHueRotate(loadout.filterHueRotate ?? 0)
    setFilterBrightness(loadout.filterBrightness ?? 1)
    setFilterContrast(loadout.filterContrast ?? 1)
    setFilterSaturate(loadout.filterSaturate ?? 0.5)
    setFilterColorize(loadout.filterColorize ?? 0)
    setHighlightColors({
      caret: loadout.highlightColors.caret,
      search: loadout.highlightColors.search,
      selectionEdit: loadout.highlightColors.selectionEdit,
      selectionRender: loadout.highlightColors.selectionRender,
      textBase: loadout.highlightColors.textBase,
      textEmbossEdit: loadout.highlightColors.textEmbossEdit,
      textEmbossRender: loadout.highlightColors.textEmbossRender,
      textEmbossUi: loadout.highlightColors.textEmbossUi,
      background: loadout.highlightColors.background,
      topBackground: loadout.highlightColors.topBackground,
      bottomBackground: loadout.highlightColors.bottomBackground,
      gridOutline: loadout.highlightColors.gridOutline,
      grid: loadout.highlightColors.grid,
      base: loadout.highlightColors.base,
      inputFields: loadout.highlightColors.inputFields,
      appButtons: loadout.highlightColors.appButtons,
      markdownHeadline: loadout.highlightColors.markdownHeadline,
      markdownList: loadout.highlightColors.markdownList,
      markdownBlockquote: loadout.highlightColors.markdownBlockquote,
      markdownCode: loadout.highlightColors.markdownCode,
      markdownChecked: loadout.highlightColors.markdownChecked,
      markdownUnchecked: loadout.highlightColors.markdownUnchecked,
    })
    setEditorTextColors({
      editorEditText: loadout.editorTextColors.editorEditText,
      editorRenderText: loadout.editorTextColors.editorRenderText,
    })
    setEditorTextColors({
      editorEditText: loadout.editorTextColors.editorEditText,
      editorRenderText: loadout.editorTextColors.editorRenderText,
    })
    setTextureMaterials(cloneTextureMaterials(loadout.textureMaterials))
  }, [])

  const capturedUiLayoutLoadout = useMemo(
    () => captureUiLayoutLoadout(),
    [captureUiLayoutLoadout],
  )

  const currentUiLoadoutSignature = useMemo(
    () => buildUiLoadoutSignature(capturedUiLayoutLoadout),
    [capturedUiLayoutLoadout],
  )

  // --- Loadout entry derivations (per current uiMode) -----------------------

  const entriesForCurrentMode = useMemo(() => {
    const sign = modeSign(uiMode)
    return uiLoadoutEntries.filter((entry) => entry.id * sign > 0)
  }, [uiLoadoutEntries, uiMode])

  const activeEntryForCurrentMode = useMemo(
    () => entriesForCurrentMode.find((entry) => entry.isActive) ?? null,
    [entriesForCurrentMode],
  )

  // True once the live captured state has drifted from whatever entry is
  // marked active for this mode — i.e. there are unsaved pending changes.
  const hasUnsavedUiLoadoutChanges = useMemo(() => {
    if (!activeEntryForCurrentMode) return false
    if (idKind(activeEntryForCurrentMode.id) === 'pending') return true
    return activeEntryForCurrentMode.signature !== currentUiLoadoutSignature
  }, [activeEntryForCurrentMode, currentUiLoadoutSignature])

  const factoryPresetEntriesForCurrentMode = useMemo(() => {
    const byAbsId = new Map<number, UiLoadoutEntry>(
      entriesForCurrentMode.map((entry) => [Math.abs(entry.id), entry]),
    )
    const ordered: UiLoadoutEntry[] = []
    for (let abs = 1; abs <= LOADOUT_FACTORY_PRESET_COUNT; abs += 1) {
      const entry = byAbsId.get(abs)
      if (entry) ordered.push(entry)
    }
    return ordered
  }, [entriesForCurrentMode])

  const customSlotEntriesForCurrentMode = useMemo(
    () => entriesForCurrentMode
      .filter((entry) => idKind(entry.id) === 'custom')
      .sort((a, b) => Math.abs(a.id) - Math.abs(b.id)),
    [entriesForCurrentMode],
  )

  // The id the dynamic "Custom" preset button targets: whichever custom-ish
  // id (abs >= 6) was last activated for this mode, defaulting to the
  // default-custom id.
  const dynamicCustomPresetId = lastCustomIdByMode[uiMode]

  const isDynamicCustomPresetActive = useMemo(() => {
    if (!activeEntryForCurrentMode) return false
    const kind = idKind(activeEntryForCurrentMode.id)
    if (kind === 'pending') return true
    return activeEntryForCurrentMode.id === dynamicCustomPresetId
  }, [activeEntryForCurrentMode, dynamicCustomPresetId])

  // --- Loadout actions --------------------------------------------------

  const applyEntryToLiveState = useCallback((entry: UiLoadoutEntry) => {
    applyUiLayoutLoadout(entry.payload)
    const caretColorRgba = parseCssColorToRgba(entry.payload.highlightColors.caret) ?? { r: 120, g: 115, b: 112, a: 0.8 }
    setActiveColorHsva(rgbaToHsva(caretColorRgba))
  }, [applyUiLayoutLoadout])

  const selectLoadoutPreset = useCallback(async (id: number) => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.setActive(id)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
      const sign = modeSign(idMode(id))
      const active = result.entries.find((entry) => entry.id * sign > 0 && entry.isActive)
      if (active) applyEntryToLiveState(active)
    } catch (error) {
      console.error('Failed to select UI loadout preset', error)
    }
  }, [applyEntryToLiveState])

  const selectDynamicCustomPreset = useCallback(() => {
    void selectLoadoutPreset(dynamicCustomPresetId)
  }, [selectLoadoutPreset, dynamicCustomPresetId])

  const saveCustomLoadout = useCallback(async () => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.saveCustom(uiMode)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
    } catch (error) {
      console.error('Failed to save custom UI loadout', error)
    }
  }, [uiMode])

  const resetCustomLoadout = useCallback(async () => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.resetCustom(uiMode)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
      const sign = modeSign(uiMode)
      const active = result.entries.find((entry) => entry.id * sign > 0 && entry.isActive)
      if (active) applyEntryToLiveState(active)
    } catch (error) {
      console.error('Failed to reset custom UI loadout', error)
    }
  }, [uiMode, applyEntryToLiveState])

  const [primedCustomLayoutId, setPrimedCustomLayoutId] = useState<number | null>(null)
  const customLoadoutRightClickHoldTimerRef = useRef<number | null>(null)
  const customLoadoutHoldExportEntryIdRef = useRef<number | null>(null)

  const clearCustomLoadoutRightClickHoldTimer = useCallback(() => {
    if (customLoadoutRightClickHoldTimerRef.current !== null) {
      window.clearTimeout(customLoadoutRightClickHoldTimerRef.current)
      customLoadoutRightClickHoldTimerRef.current = null
    }
  }, [])

  const triggerCustomLoadoutExport = useCallback(async (entryId: number) => {
    if (!window.thockdownLoadouts) return
    setPrimedCustomLayoutId(null)
    try {
      await window.thockdownLoadouts.exportTdlEntry(entryId)
    } catch (error) {
      console.error('Failed to export custom UI loadout', error)
    }
  }, [])

  const handleDeleteCustomLoadout = useCallback(async (entryId: number) => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.deleteCustom(entryId)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
      setPrimedCustomLayoutId(null)
    } catch (error) {
      console.error('Failed to delete custom UI loadout', error)
    }
  }, [])

  const handleCustomLoadoutSlotClick = useCallback((entryId: number) => {
    if (primedCustomLayoutId === entryId) {
      void handleDeleteCustomLoadout(entryId)
      return
    }

    setPrimedCustomLayoutId(null)
    void selectLoadoutPreset(entryId)
  }, [primedCustomLayoutId, handleDeleteCustomLoadout, selectLoadoutPreset])

  const handleCustomLoadoutSlotRightMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>, entryId: number) => {
    if (event.button !== 2) return

    setPrimedCustomLayoutId(null)
    clearCustomLoadoutRightClickHoldTimer()
    customLoadoutHoldExportEntryIdRef.current = null
    customLoadoutRightClickHoldTimerRef.current = window.setTimeout(() => {
      customLoadoutRightClickHoldTimerRef.current = null
      customLoadoutHoldExportEntryIdRef.current = entryId
      void triggerCustomLoadoutExport(entryId)
    }, 500)
  }, [clearCustomLoadoutRightClickHoldTimer, triggerCustomLoadoutExport])

  const handleCustomLoadoutSlotRightMouseUp = useCallback((event: MouseEvent<HTMLButtonElement>, entryId: number) => {
    if (event.button !== 2) return

    if (customLoadoutRightClickHoldTimerRef.current !== null) {
      clearCustomLoadoutRightClickHoldTimer()
      setPrimedCustomLayoutId(entryId)
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (customLoadoutHoldExportEntryIdRef.current === entryId) {
      event.preventDefault()
      event.stopPropagation()
      customLoadoutHoldExportEntryIdRef.current = null
    }
  }, [clearCustomLoadoutRightClickHoldTimer])

  const handleCustomLoadoutSlotMouseLeave = useCallback(() => {
    clearCustomLoadoutRightClickHoldTimer()
    setPrimedCustomLayoutId(null)
  }, [clearCustomLoadoutRightClickHoldTimer])

  const handleCustomLoadoutSlotContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>, entryId: number) => {
    if (customLoadoutHoldExportEntryIdRef.current === entryId || primedCustomLayoutId === entryId) {
      event.preventDefault()
      event.stopPropagation()
      if (customLoadoutHoldExportEntryIdRef.current === entryId) {
        customLoadoutHoldExportEntryIdRef.current = null
      }
      return
    }
  }, [primedCustomLayoutId])

  const exportLayoutsTdl = useCallback(async () => {
    if (!window.thockdownLoadouts) return
    try {
      await window.thockdownLoadouts.exportTdl()
    } catch (error) {
      console.error('Failed to export layouts', error)
    }
  }, [])

  const importLayoutsTdl = useCallback(async () => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.importTdl()
      if (result) {
        setUiLoadoutEntries(result.entries)
        setLastCustomIdByMode(result.lastCustomIdByMode)
      }
    } catch (error) {
      console.error('Failed to import layouts', error)
    }
  }, [])

  useEffect(() => {
    const handleGlobalMouseUp = (event: globalThis.MouseEvent) => {
      if (event.button !== 2) return
      if (customLoadoutHoldExportEntryIdRef.current === null) return
      event.preventDefault()
      event.stopPropagation()
      customLoadoutHoldExportEntryIdRef.current = null
    }

    window.addEventListener('mouseup', handleGlobalMouseUp, true)
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp, true)
    }
  }, [])

  const toggleUiMode = useCallback(() => {
    setUiMode((previousMode) => {
      const nextMode: UiLoadoutMode = previousMode === 'light' ? 'dark' : 'light'
      const sign = modeSign(nextMode)
      const active = uiLoadoutEntries.find((entry) => entry.id * sign > 0 && entry.isActive)
      if (active) applyEntryToLiveState(active)
      return nextMode
    })
  }, [uiLoadoutEntries, applyEntryToLiveState])

  const clearColorArmTimer = useCallback(() => {
    if (colorArmTimerRef.current === null) return
    window.clearTimeout(colorArmTimerRef.current)
    colorArmTimerRef.current = null
  }, [])

  const resolveHighlightColor = useCallback((source: HighlightColors, key: HighlightColorKey): RgbaColor => {
    return parseCssColorToRgba(source[key])
      ?? parseCssColorToRgba(DEFAULT_HIGHLIGHT_COLORS[key])
      ?? { r: 233, g: 230, b: 227, a: 1 }
  }, [])

  const resolveTextureColor = useCallback((source: TextureMaterialsBySurface, surface: TextureSurfaceKey): RgbaColor => {
    return hsvaToRgba(source[surface].color)
  }, [])

  const applyHsvaValueToElement = useCallback((sourceKey: HsvaControlKey, targetKey: HighlightColorKey) => {
    setHighlightColors((previous) => {
      const target = resolveHighlightColor(previous, targetKey)
      const targetHsva = rgbaToHsva(target)
      const sourceValue = activeColorHsva[sourceKey]

      const nextHsva: HsvaColor = {
        ...targetHsva,
        [sourceKey]: sourceKey === 'h'
          ? Math.max(0, Math.min(360, sourceValue))
          : Math.max(0, Math.min(1, sourceValue)),
      }

      return {
        ...previous,
        [targetKey]: rgbaToCssColor(hsvaToRgba(nextHsva)),
      }
    })
  }, [activeColorHsva, resolveHighlightColor])

  const applyHsvaValueToTexture = useCallback((sourceKey: HsvaControlKey, targetSurface: TextureSurfaceKey) => {
    const target = resolveTextureColor(textureMaterials, targetSurface)
    const targetHsva = rgbaToHsva(target)
    const sourceValue = activeColorHsva[sourceKey]

    const nextHsva: HsvaColor = {
      ...targetHsva,
      [sourceKey]: sourceKey === 'h'
        ? Math.max(0, Math.min(360, sourceValue))
        : Math.max(0, Math.min(1, sourceValue)),
    }

    updateTextureColor(targetSurface, hsvaToRgba(nextHsva))
  }, [activeColorHsva, resolveTextureColor, textureMaterials, updateTextureColor])

  const applyActiveColorToElement = useCallback((targetKey: HighlightColorKey) => {
    setHighlightColors((previous) => ({
      ...previous,
      [targetKey]: activeColorCss,
    }))
  }, [activeColorCss])

  const applyActiveColorToTexture = useCallback((targetSurface: TextureSurfaceKey) => {
    updateTextureColor(targetSurface, activeColorRgba, false)
  }, [activeColorRgba, updateTextureColor])

  useEffect(() => {
    setTexturePreviewMaterial((current) => ({
      ...current,
      color: areHsvaEqual(current.color, activeColorHsva)
        ? current.color
        : {
            h: activeColorHsva.h,
            s: activeColorHsva.s,
            v: activeColorHsva.v,
            a: activeColorHsva.a,
          },
    }))
  }, [activeColorHsva])

  const copyElementValuesToPreviews = useCallback((source: ElementPreviewCopySource) => {
    if (source.kind === 'element') {
      const rgba = resolveHighlightColor(highlightColors, source.key)
      const hsva = rgbaToHsva(rgba)
      setActiveColorHsva((previous) => (areHsvaEqual(previous, hsva) ? previous : hsva))
      return
    }

    if (source.kind === 'text') {
      const rgba = resolveEditorTextColor(editorTextColors, source.key)
      const hsva = rgbaToHsva(rgba)
      setActiveColorHsva((previous) => (areHsvaEqual(previous, hsva) ? previous : hsva))
      return
    }

    const material = cloneTextureMaterial(textureMaterials[source.key])
    setTexturePreviewMaterial((previous) => (areTextureMaterialsEqual(previous, material) ? previous : material))
    setActiveColorHsva((previous) => (areHsvaEqual(previous, material.color) ? previous : {
      h: material.color.h,
      s: material.color.s,
      v: material.color.v,
      a: material.color.a,
    }))
  }, [editorTextColors, highlightColors, resolveEditorTextColor, resolveHighlightColor, textureMaterials])

  const startColorArmHold = useCallback((source: ColorArmSource, event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    clearColorArmTimer()

    colorArmTimerRef.current = window.setTimeout(() => {
      setPrimedColorSource(source)
      colorArmTimerRef.current = null
    }, COLOR_BUTTON_ARM_HOLD_MS)
  }, [clearColorArmTimer])

  const startElementPreviewCopyHold = useCallback((source: ElementPreviewCopySource, event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    clearColorArmTimer()

    colorArmTimerRef.current = window.setTimeout(() => {
      copyElementValuesToPreviews(source)
      colorArmTimerRef.current = null
    }, COLOR_BUTTON_ARM_HOLD_MS)
  }, [clearColorArmTimer, copyElementValuesToPreviews])

  const updateHsvaControlValue = useCallback((control: HsvaControlKey, rawValue: number) => {
    setActiveColorHsva((previous) => {
      if (control === 'h') {
        const nextHue = Math.max(0, Math.min(360, rawValue))
        return {
          ...previous,
          h: nextHue,
        }
      }

      const normalized = Math.max(0, Math.min(1, rawValue / 255))
      return {
        ...previous,
        [control]: normalized,
      }
    })
  }, [])

  const getWheelStepDirection = useCallback((event: React.WheelEvent<HTMLElement>) => {
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (dominantDelta === 0) return 0
    return dominantDelta > 0 ? -1 : 1
  }, [])

  const wheelAdjustHsvaControl = useCallback((control: HsvaControlKey, event: React.WheelEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const stepDirection = getWheelStepDirection(event)
    if (stepDirection === 0) return

    const baseValue = control === 'h'
      ? activeColorHsva.h
      : activeColorHsva[control] * 255

    updateHsvaControlValue(control, baseValue + stepDirection)
  }, [activeColorHsva, getWheelStepDirection, updateHsvaControlValue])

  const startHsvaDrag = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return

    event.preventDefault()

    const baseValue = control === 'h'
      ? activeColorHsva.h
      : activeColorHsva[control] * 255

    event.currentTarget.setPointerCapture(event.pointerId)

    setHsvaDragState({
      control,
      pointerId: event.pointerId,
      startY: event.clientY,
      baseValue,
    })

    updateHsvaControlValue(control, baseValue)
  }, [activeColorHsva, updateHsvaControlValue])

  const handleHsvaDragMove = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = hsvaDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    event.preventDefault()
    const delta = currentDrag.startY - event.clientY
    updateHsvaControlValue(control, currentDrag.baseValue + delta)
  }, [hsvaDragState, updateHsvaControlValue])

  const stopHsvaDrag = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = hsvaDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    setHsvaDragState(null)
  }, [hsvaDragState])

  const getTextureControlBounds = useCallback((control: TextureControlKey) => {
    if (control === 'granularity') {
      return {
        min: TEXTURE_GRANULARITY_MIN,
        max: TEXTURE_GRANULARITY_MAX,
      }
    }

    return {
      min: TEXTURE_VSTEPS_MIN,
      max: TEXTURE_VSTEPS_MAX,
    }
  }, [])

  const getTextureControlValue = useCallback((control: TextureControlKey) => {
    if (control === 'granularity') {
      return texturePreviewMaterial.granularity
    }

    return texturePreviewMaterial.vSteps
  }, [texturePreviewMaterial.granularity, texturePreviewMaterial.vSteps])

  const updateTextureControlValue = useCallback((control: TextureControlKey, rawValue: number) => {
    const bounds = getTextureControlBounds(control)
    const nextValue = clamp(Math.round(rawValue), bounds.min, bounds.max)

    setTexturePreviewMaterial((current) => {
      if (control === 'granularity') {
        if (current.granularity === nextValue) return current
        return {
          ...current,
          granularity: nextValue,
        }
      }

      if (current.vSteps === nextValue) return current
      return {
        ...current,
        vSteps: nextValue,
      }
    })
  }, [getTextureControlBounds])

  const wheelAdjustTextureControl = useCallback((control: TextureControlKey, event: React.WheelEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const stepDirection = getWheelStepDirection(event)
    if (stepDirection === 0) return

    updateTextureControlValue(control, getTextureControlValue(control) + stepDirection)
  }, [getTextureControlValue, getWheelStepDirection, updateTextureControlValue])

  const startTextureControlDrag = useCallback((control: TextureControlKey, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()

    const baseValue = getTextureControlValue(control)
    event.currentTarget.setPointerCapture(event.pointerId)

    setTextureControlDragState({
      control,
      pointerId: event.pointerId,
      startY: event.clientY,
      baseValue,
    })

    updateTextureControlValue(control, baseValue)
  }, [getTextureControlValue, updateTextureControlValue])

  const handleTextureControlDragMove = useCallback((control: TextureControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = textureControlDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    event.preventDefault()
    const delta = currentDrag.startY - event.clientY
    updateTextureControlValue(control, currentDrag.baseValue + delta)
  }, [textureControlDragState, updateTextureControlValue])

  const stopTextureControlDrag = useCallback((control: TextureControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = textureControlDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    setTextureControlDragState(null)
  }, [textureControlDragState])

  useEffect(() => {
    if (!hsvaDragState && !textureControlDragState) {
      document.body.classList.remove('hsva-dragging')
      return
    }

    document.body.classList.add('hsva-dragging')
    return () => {
      document.body.classList.remove('hsva-dragging')
    }
  }, [hsvaDragState, textureControlDragState])

  useEffect(() => {
    if (sidebarMode !== 'options') return

    const optionsContentEl = optionsContentRef.current
    if (!optionsContentEl) return

    const handleOptionsWheelCapture = (event: WheelEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      if (!target.closest('.options-hsva-control, .options-texture-control-btn')) {
        return
      }

      event.preventDefault()
    }

    optionsContentEl.addEventListener('wheel', handleOptionsWheelCapture, { capture: true, passive: false })
    return () => {
      optionsContentEl.removeEventListener('wheel', handleOptionsWheelCapture, true)
    }
  }, [sidebarMode])

  useEffect(() => {
    return () => {
      clearColorArmTimer()
    }
  }, [clearColorArmTimer])

  // Runs once persistence has fully restored appState (including uiMode,
  // set deep inside the bootstrap effect further below). Firing this on
  // plain mount (`[]`) instead of `[persistenceReady]` was the bug: uiMode
  // is a state value closed over at the time this effect was created, and
  // with an empty dependency array that's permanently the initial 'light'
  // default — no matter what the bootstrap effect later restores it to.
  // That meant every launch re-applied the light-mode loadout's payload
  // (colors, filters, glaze, audio, everything — see applyEntryToLiveState)
  // over whatever appState had just correctly restored, even when the app
  // was last closed in dark mode. Gating on persistenceReady means this
  // effect's closure is freshly created on the render where uiMode already
  // holds its final restored value.
  useEffect(() => {
    if (!persistenceReady) return
    if (!window.thockdownLoadouts) return
    let cancelled = false

    void window.thockdownLoadouts.list()
      .then((result) => {
        if (cancelled) return
        setUiLoadoutEntries(result.entries)
        setLastCustomIdByMode(result.lastCustomIdByMode)
        const sign = modeSign(uiMode)
        const active = result.entries.find((entry) => entry.id * sign > 0 && entry.isActive)
        if (active) applyEntryToLiveState(active)
      })
      .catch((error) => {
        console.error('Failed to load UI loadouts', error)
      })

    return () => {
      cancelled = true
    }
    // uiMode is intentionally excluded: manual light/dark toggling already
    // applies the target mode's loadout itself (see toggleUiMode) — this
    // effect's job is only the one-time apply-on-launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistenceReady])

  useEffect(() => {
    const handleGlobalMouseDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 2) return
      clearColorArmTimer()
    }

    window.addEventListener('mousedown', handleGlobalMouseDown, true)
    return () => {
      window.removeEventListener('mousedown', handleGlobalMouseDown, true)
    }
  }, [clearColorArmTimer])

  // Debounced: whenever the live captured state drifts from the active entry
  // for the current mode, push it to the pending row (+/-7) on the backend.
  useEffect(() => {
    if (!window.thockdownLoadouts) return
    if (!activeEntryForCurrentMode) return
    if (activeEntryForCurrentMode.signature === currentUiLoadoutSignature) return

    if (pendingUpdateDebounceRef.current !== null) {
      window.clearTimeout(pendingUpdateDebounceRef.current)
    }

    pendingUpdateDebounceRef.current = window.setTimeout(() => {
      pendingUpdateDebounceRef.current = null
      void window.thockdownLoadouts?.updatePending(uiMode, capturedUiLayoutLoadout)
        .then((result) => {
          if (!result) return
          setUiLoadoutEntries(result.entries)
          setLastCustomIdByMode(result.lastCustomIdByMode)
        })
        .catch((error) => {
          console.error('Failed to update pending UI loadout', error)
        })
    }, PENDING_UPDATE_DEBOUNCE_MS)

    return () => {
      if (pendingUpdateDebounceRef.current !== null) {
        window.clearTimeout(pendingUpdateDebounceRef.current)
        pendingUpdateDebounceRef.current = null
      }
    }
  }, [activeEntryForCurrentMode, currentUiLoadoutSignature, uiMode, capturedUiLayoutLoadout])

  // The following are all defined later in this component than
  // <EditorSection> is rendered, so it receives stable ref-wrapped proxies
  // instead of the live values directly (EditorSection forwards them into
  // its own internal useEditorSectionMount call). Each ref is synced with a
  // plain assignment right after the real function's own definition,
  // further down -- not a useEffect, since refs don't need one and this
  // keeps them current within the same render rather than one render behind.
  const queueAppStateSaveRef = useRef<(selectedNoteId: string | null) => void>(() => {})
  const updateActiveNoteTitlePreviewRef = useRef<(nextText: string) => void>(() => {})
  const revealNoteInMenuRef = useRef<() => void>(() => {})
  const writeDebugEntryRef = useRef<(functionName: string, lines: string[]) => Promise<void>>(async () => {})
  const activeNoteHasDebugTagRef = useRef(false)

  const queueAppStateSaveStable = useCallback((selectedNoteId: string | null) => queueAppStateSaveRef.current(selectedNoteId), [])
  const updateActiveNoteTitlePreviewStable = useCallback((nextText: string) => updateActiveNoteTitlePreviewRef.current(nextText), [])
  const revealNoteInMenuStable = useCallback(() => revealNoteInMenuRef.current(), [])
  const writeDebugEntryStable = useCallback((functionName: string, lines: string[]) => writeDebugEntryRef.current(functionName, lines), [])

  const persistedMenuStateRef = useRef<PersistedMenuState | null>(null)

  const buildMenuStateSnapshot = useCallback((overrides?: {
    sidebarMode?: SidebarMode
    sidebarViewStateByMode?: SidebarViewStateByMode
    isSidebarVisible?: boolean
  }): PersistedMenuState => {
    const effectiveViewStateByMode = overrides?.sidebarViewStateByMode ?? sidebarViewStateByMode

    return {
      sidebarMode: overrides?.sidebarMode ?? sidebarMode,
      selectedMonths: [...selectedMonths],
      selectedYears: [...selectedYears],
      searchQuery,
      searchQueryCaseSensitive: isSearchQueryCaseSensitive,
      documentFindCaseSensitive: documentFindCaseSensitiveRef.current,
      isPreviewMode: getActiveSection()?.isPreviewMode,
      viewStyle,
      viewFontSize,
      viewSpacing,
      editorStyle,
      editorFontSize,
      editorSpacing,
      editorGlyphPaddingPx,
      borderRadiusRegularPx,

      exportFolder: exportFolder ?? undefined,
      renderScrollDynamic,
      renderScrollResponsiveness,
      renderScrollTotalTimeSec,
      renderScrollMaxSpeedPxPerSec,
      renderScrollSkew,
      glaze: glazeSettings,
      darkMode,
      uiMode,
      filterInvert,
      filterSepia,
      filterHueRotate,
      filterBrightness,
      filterContrast,
      filterSaturate,
      filterColorize,
      audioKeyVolume,
      audioKeyVariance,
      audioPitch,
      audioBassVolume,
      audioTrebleVolume,
      typingSoundSet,
      musicVolume,
      musicReverbAmount,
      musicReverbRoom,
      musicActiveSlots,
      highlightCaretColor: highlightColors.caret,
      highlightSearchColor: highlightColors.search,
      highlightSelectionColor: highlightColors.selectionEdit,
      highlightSelectionEditColor: highlightColors.selectionEdit,
      highlightSelectionRenderColor: highlightColors.selectionRender,
      highlightTextBaseColor: highlightColors.textBase,
      highlightTextEmbossColor: highlightColors.textEmbossUi,
      highlightTextEmbossEditColor: highlightColors.textEmbossEdit,
      highlightTextEmbossRenderColor: highlightColors.textEmbossRender,
      highlightTextEmbossUiColor: highlightColors.textEmbossUi,
      highlightBackgroundColor: highlightColors.background,
      highlightTopBackgroundColor: highlightColors.topBackground,
      highlightBottomBackgroundColor: highlightColors.bottomBackground,
      highlightGridOutlineColor: highlightColors.gridOutline,
      highlightGridColor: highlightColors.grid,
      highlightBaseColor: highlightColors.base,
      highlightInputFieldsColor: highlightColors.inputFields,
      highlightAppButtonsColor: highlightColors.appButtons,
      highlightMarkdownHeadlineColor: highlightColors.markdownHeadline,
      highlightMarkdownListColor: highlightColors.markdownList,
      highlightMarkdownBlockquoteColor: highlightColors.markdownBlockquote,
      highlightMarkdownCodeColor: highlightColors.markdownCode,
      highlightMarkdownCheckedColor: highlightColors.markdownChecked,
      highlightMarkdownUncheckedColor: highlightColors.markdownUnchecked,
      textureEnabled,
      editorEditTextColor: editorTextColors.editorEditText,
      editorRenderTextColor: editorTextColors.editorRenderText,
      textureMaterials,
      sidebarViewState: {
        ...effectiveViewStateByMode,
        category: {
          ...effectiveViewStateByMode.category,
          collapsedPrimary: categoryCollapsedPrimary,
          collapsedSecondary: categoryCollapsedSecondary,
        },
        archive: {
          ...effectiveViewStateByMode.archive,
          collapsedPrimary: archiveCollapsedPrimary,
          collapsedSecondary: archiveCollapsedSecondary,
        },
      },
      debuggingEnabled,
      spellCheckEditEnabled,
      spellCheckRenderEnabled,
      tabBarMode: tabBarModeRef.current,
      isSidebarVisible: overrides?.isSidebarVisible ?? isSidebarVisible,
    }
  }, [
    archiveCollapsedPrimary,
    archiveCollapsedSecondary,
    categoryCollapsedPrimary,
    categoryCollapsedSecondary,
    debuggingEnabled,
    spellCheckEditEnabled,
    spellCheckRenderEnabled,
    editorFontSize,
    editorGlyphPaddingPx,
    borderRadiusRegularPx,
    editorSpacing,
    editorStyle,
    exportFolder,
    getActiveSection,
    renderScrollDynamic,
    renderScrollResponsiveness,
    renderScrollMaxSpeedPxPerSec,
    renderScrollSkew,
    renderScrollTotalTimeSec,
    audioKeyVolume,
    audioBassVolume,
    audioTrebleVolume,
    textureEnabled,
    glazeSettings,
    musicVolume,
    musicReverbAmount,
    musicReverbRoom,
    musicActiveSlots,
    darkMode,
    uiMode,
    filterInvert,
    filterSepia,
    filterHueRotate,
    filterBrightness,
    filterContrast,
    filterSaturate,
    textureMaterials,
    highlightColors,
    editorTextColors,
    isSearchQueryCaseSensitive,
    searchQuery,
    selectedMonths,
    selectedYears,
    sidebarMode,
    sidebarViewStateByMode,
    isSidebarVisible,
    viewFontSize,
    viewSpacing,
    viewStyle,
  ])

  const getSidebarScrollerForMode = useCallback((mode: SidebarMode): HTMLDivElement | null => {
    if (mode === 'category' || mode === 'archive' || mode === 'find') {
      return sidebarTreeScrollerEl
    }

    return sidebarContentRef.current
  }, [sidebarTreeScrollerEl])

  const captureSidebarModeState = useCallback((mode: SidebarMode): SidebarViewState => {
    const baseline = sidebarViewStateByMode[mode] ?? sanitizeSidebarViewState(undefined)
    const scroller = getSidebarScrollerForMode(mode)
    const scrollTop = scroller
      ? Math.max(0, Math.round(scroller.scrollTop))
      : baseline.scrollTop

    const base: SidebarViewState = {
      scrollTop,
      page: baseline.page,
      collapsedPrimary: baseline.collapsedPrimary,
      collapsedSecondary: baseline.collapsedSecondary,
    }

    if (mode === 'date' || mode === 'trash') {
      base.page = Math.max(1, currentPage)
    }

    if (mode === 'category') {
      base.collapsedPrimary = categoryCollapsedPrimary
      base.collapsedSecondary = categoryCollapsedSecondary
    }

    if (mode === 'archive') {
      base.collapsedPrimary = archiveCollapsedPrimary
      base.collapsedSecondary = archiveCollapsedSecondary
    }

    return base
  }, [
    archiveCollapsedPrimary,
    archiveCollapsedSecondary,
    categoryCollapsedPrimary,
    categoryCollapsedSecondary,
    currentPage,
    getSidebarScrollerForMode,
    sidebarViewStateByMode,
  ])

  const restoreSidebarModeStateFrom = useCallback((
    mode: SidebarMode,
    viewStateByMode: SidebarViewStateByMode,
  ) => {
    const snapshot = viewStateByMode[mode] ?? sanitizeSidebarViewState(undefined)
    pendingSidebarScrollRestoreRef.current = {
      mode,
      scrollTop: snapshot.scrollTop,
    }

    if (mode === 'date' || mode === 'trash') {
      setCurrentPage(Math.max(1, snapshot.page || 1))
    }

    if (mode === 'category') {
      setCategoryCollapsedPrimary(snapshot.collapsedPrimary)
      setCategoryCollapsedSecondary(snapshot.collapsedSecondary)
    }

    if (mode === 'archive') {
      setArchiveCollapsedPrimary(snapshot.collapsedPrimary)
      setArchiveCollapsedSecondary(snapshot.collapsedSecondary)
    }
  }, [])

  const persistMenuStateOnce = useCallback(async (
    nextSidebarMode: SidebarMode,
    nextSidebarViewStateByMode: SidebarViewStateByMode,
  ) => {
    if (!window.thockdownState || !persistenceReady) return

    const snapshot = buildMenuStateSnapshot({
      sidebarMode: nextSidebarMode,
      sidebarViewStateByMode: nextSidebarViewStateByMode,
    })

    persistedMenuStateRef.current = snapshot

    const section = getActiveSection()
    await window.thockdownState.saveAppState({
      selectedNoteId: section?.activeNoteId ?? null,
      viewport: section?.latestViewportRef.current ?? undefined,
      menu: snapshot,
    })
  }, [buildMenuStateSnapshot, getActiveSection, persistenceReady])

  const persistMenuStateOnUnload = useCallback(() => {
    if (!window.thockdownState || !persistenceReady) return

    const currentModeSnapshot = captureSidebarModeState(sidebarMode)
    const nextSidebarViewStateByMode: SidebarViewStateByMode = {
      ...sidebarViewStateByMode,
      [sidebarMode]: currentModeSnapshot,
    }

    const snapshot = buildMenuStateSnapshot({
      sidebarMode,
      sidebarViewStateByMode: nextSidebarViewStateByMode,
    })

    persistedMenuStateRef.current = snapshot

    const section = getActiveSection()
    void window.thockdownState.saveAppState({
      selectedNoteId: section?.activeNoteId ?? null,
      viewport: section?.latestViewportRef.current ?? undefined,
      menu: snapshot,
    })
  }, [
    buildMenuStateSnapshot,
    captureSidebarModeState,
    getActiveSection,
    persistenceReady,
    sidebarMode,
    sidebarViewStateByMode,
  ])

  const focusActiveNoteInSidebarMode = useCallback((mode: SidebarMode): boolean => {
    const activeNoteId = getActiveSection()?.activeNoteId
    if (!activeNoteId) {
      return false
    }

    if (mode === 'date' || mode === 'trash') {
      const source = mode === 'date' ? dateFilteredNotesRef.current : trashFilteredNotesRef.current
      const noteIndex = source.findIndex((note) => note.id === activeNoteId)
      if (noteIndex < 0) {
        return false
      }

      // Measure itemsPerPage from the DOM directly — same calculation as the
      // useLayoutEffect compute() — so the target page always agrees with
      // the clamp that compute() applies. Using the itemsPerPage state value
      // risks a frame where state and DOM measurement disagree.
      const container = sidebarContentRef.current
      const list = container?.querySelector('.notes-list') as HTMLElement | null
      const firstItem = list?.querySelector('.note-list-item') as HTMLElement | null
      const listStyles = list ? window.getComputedStyle(list) : null
      const rowHeight = firstItem ? Math.round(firstItem.getBoundingClientRect().height) : 48
      const rowGap = listStyles ? Math.round(parseFloat(listStyles.rowGap || listStyles.gap || '8')) : 8
      const paddingTop = listStyles ? Math.round(parseFloat(listStyles.paddingTop || '10')) : 10
      const paddingBottom = listStyles ? Math.round(parseFloat(listStyles.paddingBottom || '10')) : 10
      const contentHeight = container ? container.clientHeight - paddingTop - paddingBottom : 0
      const measuredItemsPerPage = Math.max(1, Math.floor((contentHeight + rowGap) / (rowHeight + rowGap)))

      const targetPage = Math.floor(noteIndex / measuredItemsPerPage) + 1
      setCurrentPage(targetPage)
      return true
    }

    if (mode === 'category' || mode === 'archive') {
      const source = mode === 'category' ? categoryTreeRef.current : archiveTreeRef.current
      const noteExists = source.some((primary) =>
        primary.secondary.some((secondary) => secondary.tertiary.some((tertiary) => tertiary.notes.some((note) => note.id === activeNoteId))),
      )

      if (!noteExists) {
        return false
      }

      if (mode === 'category') {
        setCategoryFocusRequestKey((previous) => previous + 1)
      } else {
        setArchiveFocusRequestKey((previous) => previous + 1)
      }

      return true
    }

    return false
  }, [getActiveSection])

  function runSidebarMenuTransition(nextMode: SidebarMode) {
    if (nextMode === sidebarMode) {
      return
    }

    const leavingSnapshot = captureSidebarModeState(sidebarMode)
    const nextSidebarViewStateByMode: SidebarViewStateByMode = {
      ...sidebarViewStateByMode,
      [sidebarMode]: leavingSnapshot,
    }

    if (sidebarMode === 'options' && nextMode !== 'options') {
      setLastSidebarModeBeforeOptions(nextMode)
      // Clear one-shot music force-open intent when leaving options mode.
      setMusicAccordionNonce(0)
    }

    setSidebarViewStateByMode(nextSidebarViewStateByMode)
    setSidebarMode(nextMode)
    restoreSidebarModeStateFrom(nextMode, nextSidebarViewStateByMode)
    void persistMenuStateOnce(nextMode, nextSidebarViewStateByMode)
    // Defer focus so the new mode's render (with updated filtered notes / tree
    // state) has committed before we attempt to jump page or unfold the tree.
    requestAnimationFrame(() => {
      focusActiveNoteInSidebarMode(nextMode)
    })
  }

  const toggleSidebarOptionsMenu = useCallback(() => {
    if (sidebarMode === 'options') {
      runSidebarMenuTransition(lastSidebarModeBeforeOptions)
      return
    }

    // Ensure the sidebar is visible when opening the options panel so the
    // options content is accessible.
    setIsSidebarVisible(true)
    try {
      window.windowControls?.setSidebarVisible?.(true)
    } catch (e) {
      // ignore
    }

    // Persist the menu state with sidebar visible.
    if (window.thockdownState && persistenceReady) {
      const snapshot = buildMenuStateSnapshot({ isSidebarVisible: true })
      const section = getActiveSection()
      void window.thockdownState.saveAppState({
        selectedNoteId: section?.activeNoteId ?? null,
        viewport: section?.latestViewportRef.current ?? undefined,
        menu: snapshot,
      })
    }

    setLastSidebarModeBeforeOptions(sidebarMode)
    runSidebarMenuTransition('options')
  }, [buildMenuStateSnapshot, getActiveSection, lastSidebarModeBeforeOptions, persistenceReady, runSidebarMenuTransition, sidebarMode])

  const handleWindowMinimize = useCallback(() => {
    ;(window as any).windowControls?.minimize?.()
  }, [])

  const handleWindowUtilityCollapseToggle = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    const windowControlsEl = windowControlsGridRef.current
    if (!windowControlsEl) return

    const probe = windowControlsEl.cloneNode(true) as HTMLElement
    probe.classList.add('is-collapsed', 'is-measure-probe')
    document.body.appendChild(probe)

    const probeRect = probe.getBoundingClientRect()
    probe.remove()

    const targetWidth = Math.max(96, WINDOW_CONTROLS_COLLAPSED_WIDTH_PX)
    const targetHeight = Math.max(52, Math.ceil(probeRect.height || 160))

    // Ensure overlay is committed in the same event turn before native resize.
    flushSync(() => {
      setWindowModeTransitionOverlayNonce((previous) => previous + 1)
    })

    const toggleAfterOverlayFrame = async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      })
      await window.windowControls?.toggleUtilityCollapse?.({ width: targetWidth, height: targetHeight })
    }

    void toggleAfterOverlayFrame()
  }, [])

  const handleWindowToggleMaximize = useCallback(() => {
    ;(window as any).windowControls?.toggleMaximize?.()
  }, [])

  const handleWindowClose = useCallback(() => {
    ;(window as any).windowControls?.close?.()
  }, [])

  useEffect(() => {
    const unsubscribe = window.windowControls?.onMaximizeStateChange?.((isMaximized) => {
      setWindowIsMaximized(isMaximized)
    })
    return () => unsubscribe?.()
  }, [])

  useEffect(() => {
    const unsubscribe = window.windowControls?.onCollapsedStateChange?.((isCollapsed) => {
      setWindowIsCollapsed(isCollapsed)
      if (isCollapsed && sidebarMode === 'options') {
        runSidebarMenuTransition(lastSidebarModeBeforeOptions)
      }
    })
    return () => unsubscribe?.()
  }, [runSidebarMenuTransition, sidebarMode, lastSidebarModeBeforeOptions])

  useEffect(() => {
    window.windowControls?.reportBackgroundColor?.(rootBackgroundColorHex)
  }, [rootBackgroundColorHex])

  useEffect(() => {
    applyRenderScrollDynamic(renderScrollDynamic)
  }, [renderScrollDynamic])

  useEffect(() => {
    applyRenderScrollResponsiveness(renderScrollResponsiveness)
  }, [renderScrollResponsiveness])

  useEffect(() => {
    applyRenderScrollTotalTimeSec(renderScrollTotalTimeSec)
  }, [renderScrollTotalTimeSec])

  useEffect(() => {
    applyRenderScrollMaxSpeedPxPerSec(renderScrollMaxSpeedPxPerSec)
  }, [renderScrollMaxSpeedPxPerSec])

  useEffect(() => {
    applyRenderScrollSkew(renderScrollSkew)
  }, [renderScrollSkew])

  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return

    let cancelled = false
    const fontSpec = `400 ${editorRuntimeMetrics.fontSizePx}px ${resolveEditorFontFamily(editorStyle)}`

    const ensureEditorFontLoaded = async () => {
      try {
        await document.fonts.load(fontSpec)
      } catch {
        return
      }

      if (!cancelled) {
        setEditorFontLoadVersion((previous) => previous + 1)
      }
    }

    void ensureEditorFontLoaded()

    return () => {
      cancelled = true
    }
  }, [editorStyle, editorRuntimeMetrics.fontSizePx])

  useLayoutEffect(() => {
    const appGridEl = appShellRef.current
    const sidebarEl = sidebarContentRef.current
    const stageEl = editorStageRef.current
    if (!appGridEl || !sidebarEl || !stageEl) return

    const updateAppGrid = () => {
      const rect = appGridEl.getBoundingClientRect()
      setAppGridTextureSize({
        width: quantizeTextureSize(rect.width),
        height: quantizeTextureSize(rect.height),
      })
    }
    const updateSidebar = () => {
      const rect = sidebarEl.getBoundingClientRect()
      setSidebarTextureSize({
        width: quantizeTextureSize(rect.width),
        height: quantizeTextureSize(rect.height),
      })
    }
    const updateEditorStage = () => {
      const rect = stageEl.getBoundingClientRect()
      setEditorStageTextureSize({
        width: quantizeTextureSize(rect.width),
        height: quantizeTextureSize(rect.height),
      })
    }

    updateAppGrid()
    updateSidebar()
    updateEditorStage()

    const observer = new ResizeObserver(() => {
      updateAppGrid()
      updateSidebar()
      updateEditorStage()
    })
    observer.observe(appGridEl)
    observer.observe(sidebarEl)
    observer.observe(stageEl)

    return () => {
      observer.disconnect()
    }
  }, [activeSectionSnapshot?.isPreviewMode])

  const layout = useMemo(() => {
    const toolbarWidthPx = Math.max(
      TOOLBAR_MIN_WIDTH_PX,
      appShellWidthPx - (isSidebarVisible ? (SIDEBAR_WIDTH_PX + GRID_DIVIDER_PX) : 0) - WINDOW_CONTROLS_WIDTH_PX,
    )

    return {
      toolbarWidthPx,
      gridTemplateColumns: `${isSidebarVisible ? `${SIDEBAR_WIDTH_PX}px ${GRID_DIVIDER_PX}px` : '0px 0px'} ${Math.round(toolbarWidthPx)}px ${WINDOW_CONTROLS_WIDTH_PX}px`,
    }
  }, [appShellWidthPx, isSidebarVisible])

  // The combined 'editor' grid area (tab bar + viewer) spans the same two
  // columns the old 'toolbar'/'window_control' areas did -- its actual
  // pixel width is toolbarWidthPx's column plus the window-controls column.
  const editorSectionsRowWidthPx = Math.round(layout.toolbarWidthPx) + WINDOW_CONTROLS_WIDTH_PX
  const canCreateSection = editorSectionsRowWidthPx >= (
    (editorSections.length + 1) * SECTION_MIN_WIDTH_PX + editorSections.length * GRID_DIVIDER_PX
  )

  const appShellStyle = useMemo(() => {
    const borderRadiusRegularPxCss = `${borderRadiusRegularPx}px`
    const borderRadiusSmallPxCss = `${Math.max(0, borderRadiusRegularPx / 2)}px`
    const style: CSSProperties & Record<string, string> = {
      gridTemplateColumns: layout.gridTemplateColumns,
      '--border-radius-regular': borderRadiusRegularPxCss,
      '--border-radius-small': borderRadiusSmallPxCss,
      '--color-bg-regular': highlightColors.background,
      '--color-bg-leading': highlightColors.topBackground,
      '--color-bg-trailing': highlightColors.bottomBackground,
      '--color-grid-outline': highlightColors.gridOutline,
      '--color-grid-bg': highlightColors.grid,
      '--color-caret': highlightColors.caret,
      '--color-selection': activeSectionSnapshot?.isPreviewMode ? highlightColors.selectionRender : highlightColors.selectionEdit,
      '--color-input-backdrop': highlightColors.inputFields,
      '--canonical-scroll-track-bg': highlightColors.inputFields,
      '--btn-bg-default': highlightColors.appButtons,
      '--canonical-handle-bg': highlightColors.appButtons,
      '--text-shadow-emboss-main': highlightColors.textEmbossUi,
      '--text-shadow-emboss-secondary': textEmbossUiSecondaryCss,
      '--text-shadow-emboss-ui-main': highlightColors.textEmbossUi,
      '--text-shadow-emboss-ui-secondary': textEmbossUiSecondaryCss,
      '--text-shadow-emboss-edit-main': highlightColors.textEmbossEdit,
      '--text-shadow-emboss-edit-secondary': textEmbossEditSecondaryCss,
      '--text-shadow-emboss-render-main': highlightColors.textEmbossRender,
      '--text-shadow-emboss-render-secondary': textEmbossRenderSecondaryCss,
      '--color-text-base': highlightColors.textBase,
      '--color-text-90': textColor90,
      '--color-text-80': textColor80,
      '--color-text-70': textColor70,
      '--color-text-60': textColor60,
      '--color-text-50': textColor50,
      '--color-text-40': textColor40,
      '--color-text-30': textColor30,
      '--color-text-20': textColor20,
      '--color-text-10': textColor10,
      '--color-editor-edit-text': editorEditTextColorCss,
      '--color-editor-render-text': editorRenderTextColorCss,
      '--texture-app-grid': appGridTextureCss,
      '--texture-sidebar-content': sidebarTextureCss,
      '--texture-editor-edit': editorEditTextTextureCss,
      '--texture-editor-render': editorRenderTextTextureCss,
      '--texture-app-grid-tint': appGridTextureTintCss,
      '--texture-sidebar-content-tint': sidebarTextureTintCss,
      '--texture-editor-edit-tint': editorEditTextureTintCss,
      '--texture-editor-render-tint': editorRenderTextureTintCss,
      '--markdown-headline-color': highlightColors.markdownHeadline,
      '--markdown-list-color': highlightColors.markdownList,
      '--markdown-blockquote-color': highlightColors.markdownBlockquote,
      '--markdown-code-color': highlightColors.markdownCode,
      '--markdown-checked-color': highlightColors.markdownChecked,
      '--markdown-unchecked-color': highlightColors.markdownUnchecked,
    }
    return style
  }, [
    appGridTextureCss,
    appGridTextureTintCss,
    borderRadiusRegularPx,
    editorEditTextTextureCss,
    editorEditTextureTintCss,
    editorRenderTextTextureCss,
    editorRenderTextureTintCss,
    highlightColors,
    activeSectionSnapshot?.isPreviewMode,
    editorEditTextColorCss,
    editorRenderTextColorCss,
    layout.gridTemplateColumns,
    sidebarTextureCss,
    sidebarTextureTintCss,
    textEmbossUiSecondaryCss,
    textEmbossEditSecondaryCss,
    textEmbossRenderSecondaryCss,
    textColor90,
    textColor80,
    textColor70,
    textColor60,
    textColor50,
    textColor40,
    textColor30,
    textColor20,
    textColor10,
  ])

  // Apply all filter sliders at one wrapper level so the full composited scene
  // (base backdrop + glaze + sheen + app-shell + colorize) is filtered as one.
  const appOuterStyle = useMemo(() => {
    const filterParts: string[] = []
    if (filterInvert > 0) filterParts.push(`invert(${filterInvert})`)
    if (filterSepia > 0) filterParts.push(`sepia(${filterSepia})`)
    if (filterHueRotate !== 0) filterParts.push(`hue-rotate(${filterHueRotate}deg)`)
    if (filterBrightness !== 1) filterParts.push(`brightness(${filterBrightness})`)
    if (filterContrast !== 1) filterParts.push(`contrast(${filterContrast})`)

    const saturateCssValue = saturatePosToValue(filterSaturate)
    if (Math.abs(saturateCssValue - 1) > 0.001) {
      filterParts.push(`saturate(${saturateCssValue.toFixed(4)})`)
    }

    const style: CSSProperties = {
      backgroundColor: 'var(--palette-parchment-lightest)',
    }
    if (filterParts.length > 0) {
      style.filter = filterParts.join(' ')
    }
    return style
  }, [
    filterBrightness,
    filterContrast,
    filterHueRotate,
    filterInvert,
    filterSepia,
    filterSaturate,
  ])

  const glazeLinearBackgroundImage = useMemo(() => {
    const linearLayers = buildLinearGlazeLayers(glazeSettings)
    return linearLayers.length > 0 ? linearLayers.join(', ') : 'none'
  }, [glazeSettings])

  const glazeRadialBackgroundImage = useMemo(() => {
    const radialLayers = buildRadialGlazeLayers(glazeSettings)
    return radialLayers.length > 0 ? radialLayers.join(', ') : 'none'
  }, [glazeSettings])

  const glazeGloomBackgroundImage = useMemo(() => {
    return buildGloomGlazeLayer(glazeSettings, filterInvert > 0.5)
  }, [glazeSettings, filterInvert])

  const glazeSheenBackgroundImage = useMemo(() => {
    return buildSheenGlazeLayer(glazeSettings, filterInvert > 0.5)
  }, [glazeSettings, filterInvert])

  const appRootStyle = useMemo(() => {
    const borderRadiusRegularPxCss = `${borderRadiusRegularPx}px`
    const borderRadiusSmallPxCss = `${Math.max(0, borderRadiusRegularPx / 2)}px`
    return {
      '--border-radius-regular': borderRadiusRegularPxCss,
      '--border-radius-small': borderRadiusSmallPxCss,
      '--glaze-linear-background-image': glazeLinearBackgroundImage,
      '--glaze-radial-background-image': glazeRadialBackgroundImage,
      '--glaze-gloom-background-image': glazeGloomBackgroundImage,
      '--glaze-sheen-background-image': glazeSheenBackgroundImage,
      '--text-shadow-emboss-main': highlightColors.textEmbossUi,
      '--text-shadow-emboss-secondary': textEmbossUiSecondaryCss,
      '--text-shadow-emboss-ui-main': highlightColors.textEmbossUi,
      '--text-shadow-emboss-ui-secondary': textEmbossUiSecondaryCss,
      '--text-shadow-emboss-edit-main': highlightColors.textEmbossEdit,
      '--text-shadow-emboss-edit-secondary': textEmbossEditSecondaryCss,
      '--text-shadow-emboss-render-main': highlightColors.textEmbossRender,
      '--text-shadow-emboss-render-secondary': textEmbossRenderSecondaryCss,
      '--color-text-base': highlightColors.textBase,
      '--color-text-90': textColor90,
      '--color-text-80': textColor80,
      '--color-text-70': textColor70,
      '--color-text-60': textColor60,
      '--color-text-50': textColor50,
      '--color-text-40': textColor40,
      '--color-text-30': textColor30,
      '--color-text-20': textColor20,
      '--color-text-10': textColor10,
      '--palette-parchment-lightest': derivedPaletteColors.parchmentLightest,
      '--palette-parchment-light': derivedPaletteColors.parchmentLight,
      '--palette-parchment-mid': derivedPaletteColors.parchmentMid,
      '--palette-parchment-dark': derivedPaletteColors.parchmentDark,
      '--palette-parchment-input': derivedPaletteColors.parchmentInput,
      '--palette-shadow-white-lo': derivedPaletteColors.shadowWhiteLo,
      '--palette-shadow-white-mid': derivedPaletteColors.shadowWhiteMid,
      '--palette-shadow-white-hi': derivedPaletteColors.shadowWhiteHi,
    } as CSSProperties & Record<string, string>
  }, [
    derivedPaletteColors,
    borderRadiusRegularPx,
    glazeLinearBackgroundImage,
    glazeRadialBackgroundImage,
    glazeGloomBackgroundImage,
    glazeSheenBackgroundImage,
    highlightColors.textEmbossUi,
    highlightColors.textEmbossEdit,
    highlightColors.textEmbossRender,
    highlightColors.textBase,
    textEmbossUiSecondaryCss,
    textEmbossEditSecondaryCss,
    textEmbossRenderSecondaryCss,
    textColor90,
    textColor80,
    textColor70,
    textColor60,
    textColor50,
    textColor40,
    textColor30,
    textColor20,
    textColor10,
  ])

  useEffect(() => {
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--border-radius-regular', `${borderRadiusRegularPx}px`)
    rootStyle.setProperty('--border-radius-small', `${Math.max(0, borderRadiusRegularPx / 2)}px`)
  }, [borderRadiusRegularPx])

  // Writes a structured debug entry to a session-scoped debug note (tagged
  // "debug"). No-ops when debuggingEnabled is false. Safe to call from any
  // async or sync context — creation and tagging are fire-and-forget.
  const createDebugNote = useCallback(async (): Promise<string | null> => {
    if (!window.thockdownNotes) return null

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const title = `# Debug: ${dateStr} / ${pad(now.getHours())}:${pad(now.getMinutes())}`

    try {
      const created = await window.thockdownNotes.createNote({ initialText: `${title}\n` })
      debugNoteIdRef.current = created.id
      setNotes((previous) => {
        const index = previous.findIndex(n => n.id === created.id)
        if (index >= 0) return previous
        return [created, ...previous]
      })
      await window.thockdownNotes.addTagToNote({ id: created.id, tagName: DEBUG_TAG_NAME, position: 0 }).catch(() => {})
      return created.id
    } catch (error) {
      console.error('Failed to create debug note', error)
      return null
    }
  }, [persistenceReady])

  const findExistingDebugNoteId = useCallback(async (): Promise<string | null> => {
    if (!window.thockdownNotes) return null

    try {
      const listed = await window.thockdownNotes.listNotes()
      const existing = listed.find((note) => {
        const normalizedTags = new Set(note.tags.map((tag) => normalizeTagName(tag)))
        return normalizedTags.has(DEBUG_TAG_NAME) && !normalizedTags.has('deleted') && !normalizedTags.has('archived')
      })

      if (!existing) return null

      debugNoteIdRef.current = existing.id
      setNotes((previous) => {
        const index = previous.findIndex((note) => note.id === existing.id)
        if (index >= 0) return previous
        return [existing, ...previous]
      })
      return existing.id
    } catch {
      return null
    }
  }, [])

  const ensureDebugNoteExists = useCallback(async (): Promise<string | null> => {
    if (!debuggingEnabled || !window.thockdownNotes) return null

    if (debugNoteIdRef.current) {
      try {
        const loaded = await window.thockdownNotes.loadNote({ id: debugNoteIdRef.current })
        const normalizedTags = new Set(loaded.tags.map((tag) => normalizeTagName(tag)))
        const isDeletedOrArchived = normalizedTags.has('deleted') || normalizedTags.has('archived')
        const isDebugTagged = normalizedTags.has(DEBUG_TAG_NAME)

        if (isDebugTagged && !isDeletedOrArchived) {
          return debugNoteIdRef.current
        }
      } catch {
        // stale or deleted note id; fall through and create a fresh debug note.
      }

      debugNoteIdRef.current = null
    }

    if (debugNoteCreationPromiseRef.current) {
      return debugNoteCreationPromiseRef.current
    }

    const promise = (async (): Promise<string | null> => {
      const existingId = await findExistingDebugNoteId()
      if (existingId) {
        return existingId
      }

      return createDebugNote()
    })()

    debugNoteCreationPromiseRef.current = promise
    const result = await promise
    debugNoteCreationPromiseRef.current = null
    return result
  }, [createDebugNote, debuggingEnabled, findExistingDebugNoteId])

  useEffect(() => {
    if (!debuggingEnabled) return
    if (!persistenceReady) return

    void ensureDebugNoteExists()
  }, [ensureDebugNoteExists, debuggingEnabled, persistenceReady])

  const writeDebugEntry = useCallback(async (functionName: string, lines: string[]) => {
    if (!debuggingEnabled) return
    if (!window.thockdownNotes) return
    if (isWritingDebugEntryRef.current) return

    const noteId = await ensureDebugNoteExists()
    if (!noteId) return

    isWritingDebugEntryRef.current = true
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    const section = `\n## ${timeStr} / ${functionName}\n${lines.map(l => `- ${l}`).join('\n')}`

    try {
      const loaded = await window.thockdownNotes.loadNote({ id: noteId })
      const updated = await window.thockdownNotes.saveNote({
        id: noteId,
        text: `${loaded.text}${section}`,
      })
      setNotes((previous) => {
        const index = previous.findIndex(n => n.id === updated.id)
        if (index < 0) return previous
        const next = [...previous]
        next[index] = updated
        return next
      })
    } catch (error) {
      const originalError = originalConsoleMethodsRef.current.error ?? console.error
      originalError.call(console, 'Failed to write debug entry', error)
    } finally {
      isWritingDebugEntryRef.current = false
    }
  }, [debuggingEnabled, ensureDebugNoteExists])
  writeDebugEntryRef.current = writeDebugEntry

  useEffect(() => {
    const consoleMethods: ConsoleMethodName[] = ['log', 'info', 'warn', 'error', 'debug']

    if (!debuggingEnabled) {
      if (originalConsoleMethodsRef.current.log) {
        consoleMethods.forEach((method) => {
          const original = originalConsoleMethodsRef.current[method]
          if (original) {
            console[method] = original as any
          }
        })
        originalConsoleMethodsRef.current = {}
      }
      return
    }

    consoleMethods.forEach((method) => {
      if (!originalConsoleMethodsRef.current[method]) {
        originalConsoleMethodsRef.current[method] = console[method].bind(console)
      }
      console[method] = ((...args: any[]) => {
        const original = originalConsoleMethodsRef.current[method]
        if (original) {
          original(...args)
        }
        if (isWritingDebugEntryRef.current) {
          return
        }
        const stringified = args.map((arg) => {
          try {
            if (typeof arg === 'string') return arg
            if (arg instanceof Error) return arg.stack || arg.message
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        })
        void writeDebugEntry(`console.${method}`, stringified)
      }) as any
    })

    return () => {
      consoleMethods.forEach((method) => {
        const original = originalConsoleMethodsRef.current[method]
        if (original) {
          console[method] = original as any
        }
      })
      originalConsoleMethodsRef.current = {}
    }
  }, [debuggingEnabled, writeDebugEntry])

  const queueAppStateSave = useCallback((selectedNoteId: string | null) => {
    if (!window.thockdownState) return
    if (!persistenceReady) return
    if (isApplyingInitialViewportRef.current || pendingViewportRestoreRef.current) return

    if (appStateSaveTimerRef.current !== null) {
      window.clearTimeout(appStateSaveTimerRef.current)
    }

    appStateSaveTimerRef.current = window.setTimeout(() => {
      appStateSaveTimerRef.current = null
      const viewport = getActiveSection()?.latestViewportRef.current
      void window.thockdownState?.saveAppState({
        selectedNoteId,
        viewport: viewport ?? undefined,
        menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
      })
    }, 150)
  }, [buildMenuStateSnapshot, getActiveSection, persistenceReady])
  queueAppStateSaveRef.current = queueAppStateSave

  const chooseExportFolder = useCallback(async () => {
    const exportApi = window.thockdownExport
    const selectExportFolder = exportApi
      ? exportApi.selectExportFolder
      : () => window.ipcRenderer?.invoke('select-export-folder')

    const folderPath = await selectExportFolder()
    if (!folderPath) return null

    setExportFolder(folderPath)

    const nextMenuState = {
      ...(persistedMenuStateRef.current ?? buildMenuStateSnapshot()),
      exportFolder: folderPath,
    }
    persistedMenuStateRef.current = nextMenuState
    queueAppStateSave(getActiveSection()?.activeNoteId ?? null)
    return folderPath
  }, [buildMenuStateSnapshot, getActiveSection, queueAppStateSave])

  const buildExportHtmlContent = useCallback(async () => {
    const section = getActiveSection()
    const currentEditorText = normalizeInternalText(section?.latestEditorTextRef.current || section?.activeNoteText || '')
    const exportCss = await buildExportCss(viewStyle as ExportViewStyle, viewFontSize as ExportFontSize, viewSpacing as ExportSpacing)

    const markdownHtml = renderToStaticMarkup(
      <div className="pdf-exporter-page">
        <div className={`pdf-exporter-markdown-preview markdown-preview style-${viewStyle} size-${viewFontSize} spacing-${viewSpacing}`}>
          <ReactMarkdown
            remarkPlugins={PREVIEW_MARKDOWN_REMARK_PLUGINS}
            rehypePlugins={[createPreviewNoteAnchorMarkerRehypePlugin()]}
            components={createPreviewMarkdownComponents(PREVIEW_MARKDOWN_NOOP_NAVIGATE)}
          >
            {currentEditorText}
          </ReactMarkdown>
        </div>
      </div>,
    )

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${deriveNoteTitleFromText(section?.activeNoteText || '')}</title>
<base href="${document.location.href}">
<style>${exportCss}</style>
</head>
<body>
${markdownHtml}
</body>
</html>`
  }, [getActiveSection, viewFontSize, viewSpacing, viewStyle])

  const saveSelectedNoteState = useCallback(async (selectedNoteId: string | null) => {
    if (!window.thockdownState) return
    await window.thockdownState.saveAppState({
      selectedNoteId,
      viewport: getActiveSection()?.latestViewportRef.current ?? undefined,
      menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
    })
  }, [buildMenuStateSnapshot, getActiveSection])

  const refreshNotes = useCallback(async (preferredId?: string | null) => {
    if (!window.thockdownNotes) return null

    const listed = await window.thockdownNotes.listNotes()
    setNotes((previous) => mergeNoteSummaries(previous, listed))
    if (listed.length === 0) {
      return null
    }

    if (preferredId) {
      const preferred = listed.find((note) => note.id === preferredId)
      if (preferred) {
        return preferred.id
      }
    }

    return listed[0].id
  }, [])

  const [, setFileSyncStatus] = useState<string | null>(null)

  const syncExistingNotes = useCallback(async () => {
    const fileSyncApi = window.thockdownFileSync
    if (!fileSyncApi || !persistenceReady) return

    setFileSyncStatus('Syncing notes from storage...')
    try {
      const result = await fileSyncApi.syncExistingNotes()
      await refreshNotes()
      setFileSyncStatus(`Synced ${result.createdNoteIds.length} files.`)
    } catch (error) {
      setFileSyncStatus(`Sync failed: ${String(error)}`)
    }
  }, [persistenceReady, refreshNotes])

  const importNotes = useCallback(async () => {
    const fileSyncApi = window.thockdownFileSync
    if (!fileSyncApi || !persistenceReady) return

    setFileSyncStatus('Importing selected note files or folders...')
    try {
      const result = await fileSyncApi.importNotes()
      await refreshNotes()
      if (result.errors && result.errors.length > 0) {
        setFileSyncStatus(`Imported ${result.imported} files with ${result.errors.length} errors.`)
      } else {
        setFileSyncStatus(`Imported ${result.imported} files.`)
      }
    } catch (error) {
      setFileSyncStatus(`Import failed: ${String(error)}`)
    }
  }, [persistenceReady, refreshNotes])

  const selectNote = useCallback(async (noteId: string, options?: { forceReload?: boolean }) => {
    if (!window.thockdownNotes) return
    if (!persistenceReady) return
    const section = getActiveSection()
    const activeNoteId = section?.activeNoteId ?? null
    if (noteId === activeNoteId && !options?.forceReload) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      if (section && !section.isPreviewMode && activeNoteId && noteId !== activeNoteId) {
        section.captureEditModeSnapshotFromEditor(activeNoteId)
      }
      if (section && section.isPreviewMode && activeNoteId && noteId !== activeNoteId) {
        await section.persistRenderViewStateForNoteNow(activeNoteId)
      }
      await section?.flushPendingSaveNow()
      await section?.activateNote(noteId)
    } catch (error) {
      console.error('Failed to select note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [
    getActiveSection,
    persistenceReady,
  ])

  const handleSelectNote = useCallback((noteId: string) => {
    // Force a reload even for the active card to recover from any stale editor state.
    void selectNote(noteId, { forceReload: true })
  }, [selectNote])

  const isAllowedNonEditorFocusTarget = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false

    if (target instanceof HTMLSelectElement) {
      return true
    }

    if (
      target === sidebarSearchInputRef.current ||
      target === getActiveSection()?.tagInputRef.current ||
      target === pageJumpInputRef.current ||
      target === textureSeedInputRef.current ||
      target === glazeLinearSeedInputRef.current ||
      target === glazeRadialSeedInputRef.current
    ) {
      return true
    }

    if (target.closest('.sidebar-pagination')) {
      return true
    }

    if (target.closest('.options-seed-editor')) {
      return true
    }

    if (target.closest('.tag-pill, .tabbar-tags-display, .tabbar-suggested-tags, .tab-mode-shell')) {
      return true
    }

    if (target.closest('[draggable="true"]')) {
      return true
    }

    return false
  }, [getActiveSection])

  const updateActiveNoteTitlePreview = useCallback((nextText: string) => {
    const activeNoteId = getActiveSection()?.activeNoteId
    if (!activeNoteId) return

    const nextTitle = deriveNoteTitleFromText(nextText)
    setNotes((previous) => {
      const index = previous.findIndex((note) => note.id === activeNoteId)
      if (index < 0) return previous

      const existing = previous[index]
      if (existing.title === nextTitle) {
        return previous
      }

      const next = [...previous]
      next[index] = {
        ...existing,
        title: nextTitle,
      }
      return next
    })
  }, [getActiveSection])
  updateActiveNoteTitlePreviewRef.current = updateActiveNoteTitlePreview

  const createNote = useCallback(async (initialText = NEW_NOTE_TEMPLATE) => {
    if (!window.thockdownNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    const section = getActiveSection()
    if (section?.isPreviewMode) {
      section.toggleRenderViewMode()
    }

    noteTransitionLockRef.current = true
    try {
      await section?.flushPendingSaveNow()
      const created = await window.thockdownNotes.createNote({ initialText })
      await refreshNotes(created.id)
      await getActiveSection()?.activateNote(created.id, initialText.length)
      setSidebarMode('date')
    } catch (error) {
      console.error('Failed to create note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [getActiveSection, persistenceReady, refreshNotes])

  const createNoteFromClipboardTitle = useCallback(async () => {
    let title = FALLBACK_NEW_NOTE_TITLE

    try {
      const clipboardText = await navigator.clipboard.readText()
      title = sanitizeClipboardTitle(clipboardText)
    } catch {
      title = FALLBACK_NEW_NOTE_TITLE
    }

    await createNote(`# ${title}\n\n`)
  }, [createNote])

  const importExternalFileAsTempNote = useCallback(async (filePath: string) => {
    const externalApi = window.thockdownExternalFiles
    const notesApi = window.thockdownNotes
    if (!externalApi || !notesApi) return
    if (!persistenceReady) return

    if (noteTransitionLockRef.current) {
      return
    }

    noteTransitionLockRef.current = true
    try {
      await getActiveSection()?.flushPendingSaveNow()

      const existingTempId = await notesApi.getNoteIdByExternalPath({ externalPath: filePath })
      if (existingTempId) {
        console.debug('[external-note] external file already tracked, activating existing temp note', { filePath, noteId: existingTempId })
        await refreshNotes(existingTempId)
        await getActiveSection()?.activateNote(existingTempId)
        setSidebarMode('date')
        return
      }

      const [fileName, content] = await Promise.all([
        externalApi.getFileBasename(filePath),
        externalApi.readFileContent(filePath),
      ])

      if (content === null) {
        return
      }

      const initialTitle = titleFromFileBasename(fileName)
      const created = await notesApi.createNote({ initialText: content, externalPath: filePath, title: initialTitle })
      const noteId = created.id
      console.debug('[external-note] created temp note for external file', { noteId, filePath })

      const normalizedContent = normalizeInternalText(content)
      await notesApi.saveNote({ id: noteId, text: normalizedContent })
      console.debug('[external-note] saved imported external content into temp note', { noteId, filePath, contentLength: normalizedContent.length })
      await notesApi.saveNoteSnapshot({ id: noteId, content: normalizedContent, isManual: false })
      console.debug('[external-note] saved original external snapshot', { noteId, filePath, contentLength: normalizedContent.length })
      await notesApi.updateExternalNoteState({ id: noteId, hasUnsavedChanges: false, syncMode: true })
      console.debug('[external-note] updated temp note sync state for imported external file', { noteId, hasUnsavedChanges: false, syncMode: true })
      await refreshNotes(noteId)
      await getActiveSection()?.activateNote(noteId)
      setSidebarMode('date')
    } catch (error) {
      console.error('Failed to import external file', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [getActiveSection, persistenceReady, refreshNotes])

  const enqueueExternalFileImport = useCallback((filePath: string) => {
    const normalizedPath = filePath.trim()
    if (!normalizedPath) return
    const pending = pendingExternalImportPathsRef.current
    if (pending.has(normalizedPath)) return
    pending.add(normalizedPath)

    const queue = externalOpenQueueRef.current
    externalOpenQueueRef.current = queue
      .then(async () => {
        try {
          await importExternalFileAsTempNote(normalizedPath)
        } finally {
          pendingExternalImportPathsRef.current.delete(normalizedPath)
        }
      })
      .catch((error) => {
        console.error('External file import queue error', error)
        pendingExternalImportPathsRef.current.delete(normalizedPath)
      })
  }, [importExternalFileAsTempNote])

  const handleAppDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer?.types ?? [])
    const isFileDrag = types.includes('Files')
    if (!isFileDrag) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleAppDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer?.types ?? [])
    const isFileDrop = types.includes('Files')
    if (!isFileDrop) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const file = event.dataTransfer.files?.[0]
    if (!file || !file.path) {
      return
    }

    enqueueExternalFileImport(file.path)
  }, [enqueueExternalFileImport])

  const getCurrentExternalNoteModifiedState = useCallback((note: NoteSummary, currentHash: string | null = currentExternalNoteHash): boolean => {
    if (!isExternalNote(note)) return false
    if (note.id !== activeSectionSnapshot?.activeNoteId) {
      return Boolean(note.hasUnsavedChanges)
    }

    if (Boolean(note.hasUnsavedChanges)) {
      return true
    }

    return (
      currentHash !== null
      && currentHash !== externalNoteOriginalHashByIdRef.current.get(note.id)
    )
  }, [activeSectionSnapshot?.activeNoteId, currentExternalNoteHash])

  useEffect(() => {
    const activeNoteId = activeSectionSnapshot?.activeNoteId
    const activeNoteSummary = activeSectionSnapshot?.activeNoteSummary
    if (!activeNoteId || !activeNoteSummary || !isExternalNote(activeNoteSummary)) {
      setCurrentExternalNoteHash(null)
      return
    }

    let disposed = false
    void (async () => {
      const currentText = normalizeInternalText(activeSectionSnapshot?.latestEditorTextRef.current || activeSectionSnapshot?.activeNoteText || '')
      const hash = await hashNormalizedText(currentText)
      if (disposed) return

      setCurrentExternalNoteHash(hash)

      const updatedState = getCurrentExternalNoteModifiedState(activeNoteSummary, hash)
      setNotes((previous) => {
        const index = previous.findIndex((note) => note.id === activeNoteId)
        if (index < 0) return previous
        const existing = previous[index]
        if (existing.hasUnsavedChanges === updatedState) return previous
        const next = [...previous]
        next[index] = { ...existing, hasUnsavedChanges: updatedState }
        return next
      })
    })()

    return () => {
      disposed = true
    }
  }, [activeSectionSnapshot, getCurrentExternalNoteModifiedState])

  const updateNoteAssignedId = useCallback((noteId: string, assignedId: string) => {
    setNotes((previous) => previous.map((note) => (note.id === noteId ? { ...note, assignedId } : note)))
  }, [])

  const handleViewModeButtonClick = useCallback((mode: SidebarMode) => {
    const section = getActiveSection()
    if (mode === 'trash' && section?.isTrashViewDeletePrimed) {
      section.setIsTrashViewDeletePrimed(false)
      void section.purgeDeletedNotesPermanently()
      runSidebarMenuTransition('trash')
      return
    }

    if (mode === sidebarMode) {
      void focusActiveNoteInSidebarMode(mode)
      return
    }

    if (mode === 'trash') {
      runSidebarMenuTransition('trash')
      return
    }

    if (mode === 'find') {
      section?.setIsTrashViewDeletePrimed(false)
      section?.clearTrashButtonArmTimer()
      runSidebarMenuTransition('find')
      requestAnimationFrame(() => {
        sidebarSearchInputRef.current?.focus()
        sidebarSearchInputRef.current?.select()
      })
      return
    }

    section?.setIsTrashViewDeletePrimed(false)
    section?.clearTrashButtonArmTimer()
    runSidebarMenuTransition(mode)
  }, [
    focusActiveNoteInSidebarMode,
    getActiveSection,
    runSidebarMenuTransition,
    sidebarMode,
  ])

  useEffect(() => {
    let disposed = false

    const bootstrap = async () => {
      const hasBridge = await waitForNotesBridge(() => disposed)
      if (!hasBridge) {
        return
      }
      const thockdownNotes = window.thockdownNotes
      if (!thockdownNotes) {
        return
      }

      setPersistenceReady(false)

      let attempt = 0
      while (!disposed) {
        try {
          let listed = await thockdownNotes.listNotes()
          if (disposed) return

          if (listed.length === 0) {
            await thockdownNotes.createNote({ initialText: NEW_NOTE_TEMPLATE })
            listed = await thockdownNotes.listNotes()
            if (listed.length === 0) {
              throw new Error('Notes list remained empty after creating bootstrap note')
            }
          }

          const appState = window.thockdownState ? await window.thockdownState.loadAppState() : { selectedNoteId: null }
          if (disposed) return

          if (appState.menu) {
            const loadedSidebarViewState: SidebarViewStateByMode = {
              date: sanitizeSidebarViewState(appState.menu.sidebarViewState?.date),
              category: sanitizeSidebarViewState(appState.menu.sidebarViewState?.category),
              archive: sanitizeSidebarViewState(appState.menu.sidebarViewState?.archive),
              trash: sanitizeSidebarViewState(appState.menu.sidebarViewState?.trash),
              find: sanitizeSidebarViewState(appState.menu.sidebarViewState?.find),
              options: sanitizeSidebarViewState(appState.menu.sidebarViewState?.options),
            }

            setSidebarViewStateByMode(loadedSidebarViewState)
            setSidebarMode(appState.menu.sidebarMode)
            setSelectedMonths(new Set(appState.menu.selectedMonths))
            setSelectedYears(new Set(appState.menu.selectedYears))
            setSearchQuery(appState.menu.searchQuery)
            setIsSearchQueryCaseSensitive(appState.menu.searchQueryCaseSensitive ?? false)
            setRestoredDocumentFindCaseSensitive(appState.menu.documentFindCaseSensitive ?? false)
            getActiveSection()?.setIsPreviewMode(appState.menu.isPreviewMode ?? false)
            setViewStyle(appState.menu.viewStyle ?? 'modern')
            setViewFontSize(appState.menu.viewFontSize ?? 'm')
            setViewSpacing(appState.menu.viewSpacing ?? 'cozy')
            setEditorStyle(appState.menu.editorStyle ?? DEFAULT_EDITOR_STYLE)
            setEditorFontSize(appState.menu.editorFontSize ?? DEFAULT_EDITOR_FONT_SIZE)
            setEditorSpacing(appState.menu.editorSpacing ?? DEFAULT_EDITOR_SPACING)
            setEditorGlyphPaddingPx(
              clamp(
                Math.round(appState.menu.editorGlyphPaddingPx ?? DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX),
                EDITOR_GLYPH_PADDING_MIN_PX,
                EDITOR_GLYPH_PADDING_MAX_PX,
              ),
            )
            setBorderRadiusRegularPx(
              clamp(
                Math.round(appState.menu.borderRadiusRegularPx ?? DEFAULT_BORDER_RADIUS_REGULAR_PX),
                BORDER_RADIUS_REGULAR_MIN_PX,
                BORDER_RADIUS_REGULAR_MAX_PX,
              ),
            )
            setRenderScrollDynamic(appState.menu.renderScrollDynamic ?? appState.menu.renderScrollEaseMultiplier ?? getRenderScrollDynamic())
            setRenderScrollResponsiveness(appState.menu.renderScrollResponsiveness ?? appState.menu.renderScrollDistanceTimeInfluence ?? getRenderScrollResponsiveness())
            setRenderScrollTotalTimeSec(appState.menu.renderScrollTotalTimeSec ?? getRenderScrollTotalTimeSec())
                  setRenderScrollMaxSpeedPxPerSec(appState.menu.renderScrollMaxSpeedPxPerSec ?? getRenderScrollMaxSpeedPxPerSec())
            setRenderScrollSkew(appState.menu.renderScrollSkew ?? getRenderScrollSkew())
            setGlazeSettings(sanitizeGlazeSettings(appState.menu.glaze, DEFAULT_GLAZE_SETTINGS))
            setUiMode(appState.menu.uiMode === 'dark' ? 'dark' : 'light')
            applyDarkModePreset(appState.menu.darkMode ?? 'none')
            setFilterInvert(appState.menu.filterInvert ?? 0)
            setFilterSepia(appState.menu.filterSepia ?? 0)
            setFilterHueRotate(appState.menu.filterHueRotate ?? 0)
            setFilterBrightness(appState.menu.filterBrightness ?? 1)
            setFilterContrast(appState.menu.filterContrast ?? 1)
            setFilterSaturate(appState.menu.filterSaturate ?? 0.5)
            setFilterColorize(appState.menu.filterColorize ?? 0)
            setAudioKeyVolume(appState.menu.audioKeyVolume ?? 0.5)
            setAudioKeyVariance(appState.menu.audioKeyVariance ?? 0)
            setAudioPitch(appState.menu.audioPitch ?? 0)
            setAudioBassVolume(appState.menu.audioBassVolume ?? 0)
            setAudioTrebleVolume(appState.menu.audioTrebleVolume ?? 0)
            setAudioReverbStrength(appState.menu.audioReverbStrength ?? appState.menu.audioReverbAmount ?? 0)
            setAudioReverbSpace(appState.menu.audioReverbSpace ?? 0)
            setTypingSoundEnabled(appState.menu.typingSoundEnabled ?? false)
            setTypingSoundSet(appState.menu.typingSoundSet ?? DEFAULT_TYPING_SOUND_SET)
            if (typeof appState.menu.musicVolume === 'number') setMusicVolume(appState.menu.musicVolume)
            if (typeof appState.menu.musicReverbAmount === 'number') setMusicReverbAmount(appState.menu.musicReverbAmount)
            if (typeof appState.menu.musicReverbRoom === 'number') setMusicReverbRoom(appState.menu.musicReverbRoom)
            if (Array.isArray(appState.menu.musicActiveSlots)) {
              setMusicActiveSlots(
                (appState.menu.musicActiveSlots as number[]).filter((s) => s >= 1 && s <= 5) as import('./shared/audioPlayer').PlaylistSlot[]
              )
            }
            setHighlightColors({
              caret: appState.menu.highlightCaretColor ?? DEFAULT_HIGHLIGHT_COLORS.caret,
              search: appState.menu.highlightSearchColor ?? DEFAULT_HIGHLIGHT_COLORS.search,
              selectionEdit:
                appState.menu.highlightSelectionEditColor
                ?? appState.menu.highlightSelectionColor
                ?? DEFAULT_HIGHLIGHT_COLORS.selectionEdit,
              selectionRender:
                appState.menu.highlightSelectionRenderColor
                ?? appState.menu.highlightSelectionColor
                ?? DEFAULT_HIGHLIGHT_COLORS.selectionRender,
              textBase: appState.menu.highlightTextBaseColor ?? DEFAULT_HIGHLIGHT_COLORS.textBase,
              textEmbossEdit:
                appState.menu.highlightTextEmbossEditColor
                ?? appState.menu.highlightTextEmbossColor
                ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossEdit,
              textEmbossRender:
                appState.menu.highlightTextEmbossRenderColor
                ?? appState.menu.highlightTextEmbossColor
                ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossRender,
              textEmbossUi:
                appState.menu.highlightTextEmbossUiColor
                ?? appState.menu.highlightTextEmbossColor
                ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossUi,
              background: appState.menu.highlightBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.background,
              topBackground: appState.menu.highlightTopBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.topBackground,
              bottomBackground: appState.menu.highlightBottomBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.bottomBackground,
              gridOutline: appState.menu.highlightGridOutlineColor ?? DEFAULT_HIGHLIGHT_COLORS.gridOutline,
              grid: appState.menu.highlightGridColor ?? DEFAULT_HIGHLIGHT_COLORS.grid,
              base: appState.menu.highlightBaseColor ?? DEFAULT_HIGHLIGHT_COLORS.base,
              inputFields: appState.menu.highlightInputFieldsColor ?? DEFAULT_HIGHLIGHT_COLORS.inputFields,
              appButtons: appState.menu.highlightAppButtonsColor ?? DEFAULT_HIGHLIGHT_COLORS.appButtons,
              markdownHeadline: appState.menu.highlightMarkdownHeadlineColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownHeadline,
              markdownList: appState.menu.highlightMarkdownListColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownList,
              markdownBlockquote: appState.menu.highlightMarkdownBlockquoteColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownBlockquote,
              markdownCode: appState.menu.highlightMarkdownCodeColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownCode,
              markdownChecked: appState.menu.highlightMarkdownCheckedColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownChecked,
              markdownUnchecked: appState.menu.highlightMarkdownUncheckedColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownUnchecked,
            })
            setEditorTextColors({
              editorEditText: appState.menu.editorEditTextColor ?? DEFAULT_EDITOR_TEXT_COLORS.editorEditText,
              editorRenderText: appState.menu.editorRenderTextColor ?? DEFAULT_EDITOR_TEXT_COLORS.editorRenderText,
            })
            // Global texture enable is intentionally fixed on; per-surface alpha controls visibility.
            setTextureMaterials(cloneTextureMaterials(appState.menu.textureMaterials ?? DEFAULT_TEXTURE_MATERIALS))
            setDebuggingEnabled(appState.menu.debuggingEnabled ?? false)
            setSpellCheckEditEnabled(appState.menu.spellCheckEditEnabled ?? false)
            setSpellCheckRenderEnabled(appState.menu.spellCheckRenderEnabled ?? false)
            setRestoredTabBarMode(appState.menu.tabBarMode ?? 'tags')

            // Restore persisted sidebar visibility
            setIsSidebarVisible(appState.menu.isSidebarVisible ?? true)

            setCurrentPage(loadedSidebarViewState[appState.menu.sidebarMode].page)
            setCategoryCollapsedPrimary(loadedSidebarViewState.category.collapsedPrimary)
            setCategoryCollapsedSecondary(loadedSidebarViewState.category.collapsedSecondary)
            setArchiveCollapsedPrimary(loadedSidebarViewState.archive.collapsedPrimary)
            setArchiveCollapsedSecondary(loadedSidebarViewState.archive.collapsedSecondary)
            pendingSidebarScrollRestoreRef.current = {
              mode: appState.menu.sidebarMode,
              scrollTop: loadedSidebarViewState[appState.menu.sidebarMode].scrollTop,
            }

            persistedMenuStateRef.current = {
              ...appState.menu,
              sidebarViewState: loadedSidebarViewState,
            }
            setExportFolder(appState.menu.exportFolder ?? null)
          } else {
            persistedMenuStateRef.current = null
            setExportFolder(null)
          }

          const preferredId = appState.selectedNoteId
          const selectedSummary = (
            preferredId
              ? listed.find((note) => note.id === preferredId)
              : undefined
          ) ?? listed[0]

          if (disposed) return

          setNotes((previous) => mergeNoteSummaries(previous, listed))

          // Resolve which sections actually occupy a slot right now (sorted
          // left-to-right); fall back to the single default section if the
          // bridge isn't available or nothing is placed yet, so there's
          // never a moment with zero sections rendered.
          const rawSections = (await window.thockdownSections?.listSections()) ?? []
          const placedSections = rawSections
            .filter((entry) => entry.position !== null)
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          const resolvedSections = placedSections.length > 0
            ? placedSections
            : [{ id: DEFAULT_EDITOR_SECTION_ID, name: null, position: 0, widthFraction: null, lastActiveNoteId: null }]
          if (disposed) return

          // Each section resolves its own initial note from its own
          // lastActiveNoteId; the leftmost section falls back to the
          // legacy app-wide selectedNoteId (pre-split-view installs, or a
          // fresh one, have no per-section memory yet), every other section
          // falls back to the first note in the list.
          resolvedSections.forEach((entry, index) => {
            const persistedNoteId = (
              entry.lastActiveNoteId && listed.some((note) => note.id === entry.lastActiveNoteId)
            ) ? entry.lastActiveNoteId : null
            const fallbackNoteId = index === 0 ? selectedSummary.id : listed[0].id
            initialNoteIdBySectionIdRef.current.set(entry.id, persistedNoteId ?? fallbackNoteId)
          })
          setEditorSections(resolvedSections)
          setActiveSectionId((previous) => (
            resolvedSections.some((entry) => entry.id === previous) ? previous : resolvedSections[0].id
          ))

          setPersistenceReady(true)
          setBootstrapError(null)
          return
        } catch (error) {
          attempt += 1
          const message = error instanceof Error ? error.message : String(error)
          console.error(`Failed to initialize note lifecycle (attempt ${attempt})`, error)
          // Keep retrying (transient startup races are real -- e.g. the IPC
          // bridge not being ready yet) but stop suffering in silence after
          // a few tries: tell the user something is actually wrong instead
          // of leaving them looking at an app with no active note, no
          // timeline, and no way to tell why.
          if (attempt >= 3 && !disposed) {
            setBootstrapError(message)
          }
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(1500, 200 * attempt)))
        }
      }
    }

    void bootstrap()

    return () => {
      disposed = true
      const section = getActiveSection()
      section?.cancelPendingEditUiStatePersist()
      section?.cancelPendingSave()
      if (appStateSaveTimerRef.current !== null) {
        window.clearTimeout(appStateSaveTimerRef.current)
        appStateSaveTimerRef.current = null
      }
    }
  }, [])

  // Drains initialNoteIdBySectionIdRef (populated by the bootstrap effect
  // above) once each section it names has actually mounted and registered
  // -- registerSectionHandle runs synchronously during a section's own
  // render, so by the time this effect fires after that commit, a
  // newly-listed section is already in the registry. Re-checks whenever
  // editorSections changes, so it naturally covers a section created later
  // (the "+" button) the same way it covers bootstrap's initial list.
  useEffect(() => {
    for (const entry of editorSections) {
      const pendingNoteId = initialNoteIdBySectionIdRef.current.get(entry.id)
      if (!pendingNoteId) continue
      const handle = getActiveSectionHandle(sectionRegistryRef, entry.id)
      if (!handle) continue
      initialNoteIdBySectionIdRef.current.delete(entry.id)
      if (handle.activeNoteId !== null) continue
      void handle.activateNote(pendingNoteId)
    }
  }, [editorSections])

  const applyResolvedSections = useCallback((resolved: EditorSectionEntry[]) => {
    const placed = resolved
      .filter((entry) => entry.position !== null)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    const nextSections = placed.length > 0
      ? placed
      : [{ id: DEFAULT_EDITOR_SECTION_ID, name: null, position: 0, widthFraction: null, lastActiveNoteId: null }]
    setEditorSections(nextSections)
    return nextSections
  }, [])

  const measureSectionWidthsPx = useCallback((): SectionWidthPx[] => (
    editorSections.map((entry) => {
      const el = sectionSlotElByIdRef.current.get(entry.id)
      return { id: entry.id, widthPx: el ? el.getBoundingClientRect().width : 0 }
    })
  ), [editorSections])

  const persistSectionWidthsPx = useCallback(async (widthsPx: SectionWidthPx[]) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return null
    const totalWidthPx = widthsPx.reduce((sum, entry) => sum + entry.widthPx, 0)
    const widths = widthsPx.map((entry) => ({
      id: entry.id,
      widthFraction: totalWidthPx > 0 ? entry.widthPx / totalWidthPx : null,
    }))
    return sectionsApi.updateSectionWidths(widths)
  }, [])

  // Always creates a new section immediately to the right of the one the
  // "+" button was clicked on, per the handover doc's split-view design.
  // Sizing policy: split the immediate left neighbor in half if it's large
  // enough to give up half its width and stay above the minimum; otherwise
  // fund the new section (plus the one new divider it introduces) from that
  // neighbor first, only spilling over to the other sections -- proportionally,
  // capped at each one's own minimum -- if the neighbor alone can't cover it.
  // See sectionWidths.ts.
  const handleCreateSection = useCallback(async (afterPosition: number, sourceSectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return

    const currentWidthsPx = measureSectionWidthsPx()
    const { updatedWidths, newSectionWidthPx } = computeSectionWidthsForNewSection(
      currentWidthsPx,
      sourceSectionId,
      SECTION_MIN_WIDTH_PX,
      GRID_DIVIDER_PX,
    )

    const updated = await sectionsApi.createSection(null, afterPosition)
    const nextSections = applyResolvedSections(updated)
    const created = nextSections.find((entry) => entry.position === afterPosition + 1)
    if (created) {
      markSectionActive(created.id)
    }

    const finalized = await persistSectionWidthsPx([
      ...updatedWidths,
      ...(created ? [{ id: created.id, widthPx: newSectionWidthPx }] : []),
    ])
    if (finalized) {
      applyResolvedSections(finalized)
    }
  }, [applyResolvedSections, markSectionActive, measureSectionWidthsPx, persistSectionWidthsPx])

  // Closes a section's slot -- deletes it outright if unnamed (the only
  // kind the "+" button creates today), parks it if named. Reassigns
  // activeSectionId to a sane neighbor if the closed section was active.
  // Sizing policy: the closed section's entire width goes to its immediate
  // left neighbor; every other section stays exactly the size it was.
  const handleCloseSection = useCallback(async (sectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return

    const currentWidthsPx = measureSectionWidthsPx()
    const updatedWidths = computeSectionWidthsForClose(currentWidthsPx, sectionId)

    const updated = await sectionsApi.closeSlot(sectionId)
    sectionRegistryRef.current.delete(sectionId)
    const nextSections = applyResolvedSections(updated)
    setActiveSectionId((previous) => (previous === sectionId ? nextSections[0].id : previous))

    const finalized = await persistSectionWidthsPx(updatedWidths)
    if (finalized) {
      applyResolvedSections(finalized)
    }
  }, [applyResolvedSections, measureSectionWidthsPx, persistSectionWidthsPx])

  const handleRenameSection = useCallback(async (sectionId: string, name: string | null) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return
    const updated = await sectionsApi.renameSection(sectionId, name)
    applyResolvedSections(updated)
  }, [applyResolvedSections])

  // Fetched fresh each time the identity tab's right-click menu opens,
  // rather than kept as ongoing state -- named-but-parked sections (not in
  // editorSections, which only holds placed ones) only matter at the
  // moment the menu is actually open.
  const handleFetchSwapCandidates = useCallback(async (sectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return []
    const all = await sectionsApi.listSections()
    return all
      .filter((entry): entry is EditorSectionEntry & { name: string } => entry.name !== null && entry.id !== sectionId)
      .map((entry) => ({ id: entry.id, name: entry.name }))
  }, [])

  // Sizing policy for swap: dimensions belong to the *slot*, not whichever
  // section happens to be showing in it. Swapping never creates or removes
  // a slot -- it only ever changes what's on screen -- so no width
  // recalculation happens here at all, just reassigning each slot's
  // existing widthFraction to whatever now occupies it.
  const handleSwapSection = useCallback(async (outgoingSectionId: string, incomingSectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return

    // If the incoming section was already occupying a different slot, that
    // slot is about to be silently vacated -- swapIntoSlot only fills the
    // *destination* (outgoing's) slot, it has no notion of "what incoming
    // left behind." Capture both slots' identities and widths beforehand so
    // the vacated one can be backfilled with a fresh section afterward
    // (inheriting its width), rather than the pane count quietly shrinking.
    const incomingEntryBefore = editorSections.find((entry) => entry.id === incomingSectionId)
    const outgoingEntryBefore = editorSections.find((entry) => entry.id === outgoingSectionId)
    const incomingPreviousPosition = incomingEntryBefore?.position ?? null
    const incomingPreviousWidthFraction = incomingEntryBefore?.widthFraction ?? null
    const outgoingWidthFraction = outgoingEntryBefore?.widthFraction ?? null

    let updated = await sectionsApi.swapIntoSlot(outgoingSectionId, incomingSectionId)
    sectionRegistryRef.current.delete(outgoingSectionId)

    const widthFixups: { id: string; widthFraction: number | null }[] = [
      { id: incomingSectionId, widthFraction: outgoingWidthFraction },
    ]

    if (incomingPreviousPosition !== null && incomingPreviousPosition !== outgoingEntryBefore?.position) {
      updated = await sectionsApi.createSection(null, incomingPreviousPosition - 1)
      const backfilled = updated.find((entry) => entry.position === incomingPreviousPosition)
      if (backfilled) {
        widthFixups.push({ id: backfilled.id, widthFraction: incomingPreviousWidthFraction })
      }
    }

    updated = await sectionsApi.updateSectionWidths(widthFixups)

    const incomingEntry = updated.find((entry) => entry.id === incomingSectionId)
    if (incomingEntry?.lastActiveNoteId && notesRef.current.some((note) => note.id === incomingEntry.lastActiveNoteId)) {
      initialNoteIdBySectionIdRef.current.set(incomingSectionId, incomingEntry.lastActiveNoteId)
    }
    applyResolvedSections(updated)
    setActiveSectionId((previous) => (previous === outgoingSectionId ? incomingSectionId : previous))
  }, [applyResolvedSections, editorSections])

  const editorSectionsRowRef = useRef<HTMLDivElement | null>(null)
  const sectionSlotElByIdRef = useRef<Map<string, HTMLDivElement>>(new Map())

  // Drag-resizes exactly the two sections on either side of the divider that
  // was grabbed. Slots normally size via flex-grow weights (proportional,
  // so the row's fixed-width dividers are automatically excluded from the
  // split) -- during a drag every slot is pinned to its current pixel width
  // via a literal flex-basis instead, so only the two dragged neighbors
  // reflow as the mouse moves, not the whole row. Not routed through React
  // state per mousemove (kept as direct DOM writes) so dragging stays
  // smooth; final widths are measured and persisted as fractions on release.
  const handleDividerMouseDown = useCallback((leftSectionId: string, rightSectionId: string) => (
    event: MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()
    const leftEl = sectionSlotElByIdRef.current.get(leftSectionId)
    const rightEl = sectionSlotElByIdRef.current.get(rightSectionId)
    if (!leftEl || !rightEl) return

    const pinnedWidthsPx = editorSections.map((entry) => {
      const el = sectionSlotElByIdRef.current.get(entry.id)
      return { entry, el, widthPx: el ? el.getBoundingClientRect().width : 0 }
    })
    pinnedWidthsPx.forEach(({ el, widthPx }) => {
      if (el) {
        el.style.flexGrow = '0'
        el.style.flexShrink = '0'
        el.style.flexBasis = `${widthPx}px`
      }
    })

    const startLeftWidthPx = leftEl.getBoundingClientRect().width
    const startRightWidthPx = rightEl.getBoundingClientRect().width
    const combinedWidthPx = startLeftWidthPx + startRightWidthPx
    const startClientX = event.clientX

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const deltaX = moveEvent.clientX - startClientX
      const nextLeftWidthPx = clamp(startLeftWidthPx + deltaX, SECTION_MIN_WIDTH_PX, combinedWidthPx - SECTION_MIN_WIDTH_PX)
      const nextRightWidthPx = combinedWidthPx - nextLeftWidthPx
      leftEl.style.flexBasis = `${nextLeftWidthPx}px`
      rightEl.style.flexBasis = `${nextRightWidthPx}px`
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)

      const finalWidthsPx = pinnedWidthsPx.map(({ entry, el }) => ({
        id: entry.id,
        widthPx: el ? el.getBoundingClientRect().width : 0,
      }))
      const totalWidthPx = finalWidthsPx.reduce((sum, { widthPx }) => sum + widthPx, 0) || 1
      const widths = finalWidthsPx.map(({ id, widthPx }) => ({
        id,
        widthFraction: widthPx / totalWidthPx,
      }))
      void window.thockdownSections?.updateSectionWidths(widths).then((updated) => {
        applyResolvedSections(updated)
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [applyResolvedSections, editorSections])

  useEffect(() => {
    void typingSoundManager.load()
  }, [])

  useEffect(() => {
    typingSoundManager.setLayerGain('click', audioKeyVolume)
  }, [audioKeyVolume])

  useEffect(() => {
    typingSoundManager.setTypingSoundVariance(audioKeyVariance)
  }, [audioKeyVariance])

  useEffect(() => {
    typingSoundManager.setTypingSoundPitch(audioPitch)
  }, [audioPitch])

  useEffect(() => {
    typingSoundManager.setLayerGain('bass', audioBassVolume)
  }, [audioBassVolume])

  useEffect(() => {
    typingSoundManager.setTypingSoundSet(typingSoundSet)
  }, [typingSoundSet])

  useEffect(() => {
    typingSoundManager.setTypingSoundEnabled(typingSoundEnabled)
  }, [typingSoundEnabled])

  useEffect(() => {
    typingSoundManager.setReverbStrength(audioReverbStrength)
  }, [audioReverbStrength])

  useEffect(() => {
    typingSoundManager.setReverbSpace(audioReverbSpace)
  }, [audioReverbSpace])

  useEffect(() => {
    typingSoundManager.setLayerGain('treble', audioTrebleVolume)
  }, [audioTrebleVolume])

  const handleExportPdf = useCallback(async () => {
    const activeNoteId = getActiveSection()?.activeNoteId
    if (!activeNoteId || isExportingPdf) return
    setIsExportingPdf(true)

    try {
      const exportApi = window.thockdownExport
      const exportPdf = exportApi
        ? exportApi.exportPdf
        : (folderPath: string, fileName: string, htmlContent?: string) => window.ipcRenderer?.invoke('export-pdf', folderPath, fileName, htmlContent)

      const folderPath = exportFolder ?? await chooseExportFolder()
      if (!folderPath) return

      const fileName = `${deriveNoteTitleFromText(getActiveSection()?.activeNoteText || '')}.pdf`
      const htmlContent = await buildExportHtmlContent()
      const result = await exportPdf(folderPath, fileName, htmlContent)

      if (!result?.ok) {
        console.error('Export PDF failed', result?.error)
      }
    } catch (error) {
      console.error('Export PDF failed', error)
    } finally {
      setIsExportingPdf(false)
    }
  }, [getActiveSection, exportFolder, isExportingPdf, chooseExportFolder, buildExportHtmlContent])

  const handleExportMd = useCallback(async (forceChooseFolder = false) => {
    const activeNoteId = getActiveSection()?.activeNoteId
    if (!activeNoteId || isExportingMd) return
    setIsExportingMd(true)

    try {
      const folderPath = (!exportFolder || forceChooseFolder)
        ? await chooseExportFolder()
        : exportFolder
      if (!folderPath) return

      const fileName = `${deriveNoteTitleFromText(getActiveSection()?.activeNoteText || '')}.md`
      const result = await window.ipcRenderer?.invoke('export-md', activeNoteId, folderPath, fileName)

      if (!result?.ok) {
        console.error('Export MD failed', result?.error)
      }
    } catch (error) {
      console.error('Export MD failed', error)
    } finally {
      setIsExportingMd(false)
    }
  }, [getActiveSection, exportFolder, isExportingMd, chooseExportFolder])

  useEffect(() => {
    const activeNoteId = activeSectionSnapshot?.activeNoteId
    if (!window.thockdownState || !activeNoteId) return
    queueAppStateSave(activeNoteId)
  }, [activeSectionSnapshot?.activeNoteId, queueAppStateSave])

  useEffect(() => {
    if (!persistenceReady) return

    const externalApi = window.thockdownExternalFiles
    if (!externalApi || !window.thockdownNotes) return

    let disposed = false

    const processPending = async () => {
      const pendingPaths = await externalApi.getPendingFilePaths()
      if (disposed) return
      for (const filePath of pendingPaths) {
        enqueueExternalFileImport(filePath)
      }
    }

    void processPending()

    const unsubscribe = externalApi.onOpenFile((filePath) => {
      if (disposed) return
      enqueueExternalFileImport(filePath)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [enqueueExternalFileImport, persistenceReady])

  useEffect(() => {
    const shellElement = appShellRef.current
    if (!shellElement) return

    const effectiveMin = isSidebarVisible ? APP_SHELL_MIN_WIDTH_PX : (APP_SHELL_MIN_WIDTH_PX - (SIDEBAR_WIDTH_PX + GRID_DIVIDER_PX))

    const updateShellWidth = () => {
      setAppShellWidthPx(Math.max(effectiveMin, Math.round(shellElement.clientWidth)))
    }

    updateShellWidth()

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setAppShellWidthPx(Math.max(effectiveMin, Math.round(entry.contentRect.width)))
    })

    observer.observe(shellElement)
    return () => observer.disconnect()
  }, [isSidebarVisible])

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [notes])

  const searchedNotes = useMemo(() => {
    return sortedNotes.filter((note) => matchesNoteSearchQuery(
      {
        title: note.title,
        fileName: note.fileName,
        tags: note.tags,
        contentText: note.contentText,
      },
      searchQuery,
      isSearchQueryCaseSensitive,
    ))
  }, [isSearchQueryCaseSensitive, searchQuery, sortedNotes])

  const isFindMode = sidebarMode === 'find'
  const hasMonthFilter = selectedMonths.size > 0
  const hasYearFilter = selectedYears.size > 0
  const hasDateFilter = hasMonthFilter || hasYearFilter

  const matchesSelectedDateFilter = useCallback((timestampMs: number) => {
    const date = new Date(timestampMs)
    const noteMonth = date.getMonth() + 1
    const noteYear = date.getFullYear()
    const oldestYear = new Date().getFullYear() - 4

    const monthMatch = !hasMonthFilter || selectedMonths.has(noteMonth)

    let yearMatch = !hasYearFilter
    if (hasYearFilter) {
      if (selectedYears.has(noteYear)) {
        yearMatch = true
      } else if (selectedYears.has('older') && noteYear < oldestYear) {
        yearMatch = true
      }
    }

    return monthMatch && yearMatch
  }, [hasMonthFilter, hasYearFilter, selectedMonths, selectedYears])

  const filterNotesBySelectedDate = useCallback((source: NoteSummary[]) => {
    if (!hasDateFilter) {
      return source
    }

    return source.filter((note) => matchesSelectedDateFilter(note.updatedAtMs))
  }, [hasDateFilter, matchesSelectedDateFilter])

  const dateEligibleNotes = useMemo(() => {
    return searchedNotes.filter((note) => {
      if (isDeletedNote(note)) return false
      if (isArchivedNote(note)) return false
      return true
    })
  }, [searchedNotes])

  const categoryEligibleNotes = useMemo(() => {
    const categoryNotes = dateEligibleNotes.filter((note) => !isExternalNote(note))
    return filterNotesBySelectedDate(categoryNotes)
  }, [dateEligibleNotes, filterNotesBySelectedDate])

  const archiveEligibleNotes = useMemo(() => {
    const archiveNotes = searchedNotes.filter((note) => isArchivedNote(note) && !isDeletedNote(note) && !isExternalNote(note))
    return filterNotesBySelectedDate(archiveNotes)
  }, [filterNotesBySelectedDate, searchedNotes])

  const trashEligibleNotes = useMemo(() => {
    return searchedNotes.filter((note) => isDeletedNote(note) && !isExternalNote(note))
  }, [searchedNotes])

  const dateFilteredNotes = useMemo(() => {
    return filterNotesBySelectedDate(dateEligibleNotes).sort(compareExternalNotesFirst)
  }, [dateEligibleNotes, filterNotesBySelectedDate])

  const trashFilteredNotes = useMemo(() => {
    return trashEligibleNotes
  }, [trashEligibleNotes])

  const categoryTree = useMemo<PrimaryGroup[]>(() => {
    return buildHierarchyGroups(categoryEligibleNotes)
  }, [categoryEligibleNotes])

  const archiveTree = useMemo<PrimaryGroup[]>(() => {
    return buildHierarchyGroups(archiveEligibleNotes)
  }, [archiveEligibleNotes])

  useEffect(() => {
    dateFilteredNotesRef.current = dateFilteredNotes
  }, [dateFilteredNotes])

  useEffect(() => {
    trashFilteredNotesRef.current = trashFilteredNotes
  }, [trashFilteredNotes])

  useEffect(() => {
    categoryTreeRef.current = categoryTree
  }, [categoryTree])

  useEffect(() => {
    archiveTreeRef.current = archiveTree
  }, [archiveTree])



  const visibleNotes = useMemo(() => {
    if (sidebarMode === 'date') {
      return dateFilteredNotes
    }

    if (sidebarMode === 'trash') {
      return trashFilteredNotes
    }

    return []
  }, [dateFilteredNotes, sidebarMode, trashFilteredNotes])

  const totalPagedNotes = (sidebarMode === 'date' || sidebarMode === 'trash')
    ? visibleNotes.length
    : 0

  const isSidebarSearchActive = isNoteSearchQueryActive(searchQuery)

  // The menu is deliberately a stable "file cabinet," not something that
  // chases the active note -- browsing the sidebar (changing a filter,
  // switching views) never used to reach back into the editor and swap the
  // active note out from under the user (that used to happen here; removed).
  // The one deliberate exception is this: clicking an already-selected tab
  // explicitly asks to locate that note in the menu. Reused wholesale:
  // isDeletedNote/isArchivedNote for where a note lives, matchesNoteSearchQuery/
  // matchesSelectedDateFilter for which filter (if any) is actually hiding it,
  // and the existing runSidebarMenuTransition/focusActiveNoteInSidebarMode
  // pair for switching view + unfolding tree branches + scrolling into view --
  // all of which already exist and already operate on activeNoteId, which is
  // exactly what this reveals (the note the section that triggered this was
  // already showing).
  const revealNoteInMenu = useCallback(() => {
    const section = getActiveSection()
    const activeNoteId = section?.activeNoteId
    const activeNoteSummary = section?.activeNoteSummary
    if (!activeNoteId || !activeNoteSummary) return

    // Clear only whichever filter is actually hiding the note -- never one
    // that isn't in the way.
    if (isSidebarSearchActive && !matchesNoteSearchQuery(
      { title: activeNoteSummary.title, fileName: activeNoteSummary.fileName, tags: activeNoteSummary.tags, contentText: activeNoteSummary.contentText },
      searchQuery,
      isSearchQueryCaseSensitive,
    )) {
      setSearchQuery('')
    }
    const isDeleted = isDeletedNote(activeNoteSummary)
    const isArchived = isArchivedNote(activeNoteSummary)
    const isExternal = isExternalNote(activeNoteSummary)

    // The month/year filter never applies to trash (trashEligibleNotes skips
    // it entirely) -- clearing it there would be an unrelated side effect,
    // not "clearing whichever filter is actually hiding the note."
    if (!isDeleted && hasDateFilter && !matchesSelectedDateFilter(activeNoteSummary.updatedAtMs)) {
      setSelectedMonths(new Set())
      setSelectedYears(new Set())
    }

    const targetMode: SidebarMode = isDeleted
      ? 'trash'
      : isArchived
        ? 'archive'
        // Category/archive trees exclude external (filesystem-synced) notes
        // entirely, regardless of any filter -- 'date' is the only view
        // that can ever show one, so there's no "stay in category" option
        // for it even if that's the current mode.
        : isExternal
          ? 'date'
          : (sidebarMode === 'date' || sidebarMode === 'category')
            ? sidebarMode
            : 'category'

    const staysInCurrentMode = targetMode === sidebarMode
    const needsDatePaginationPrep = !isDeleted && !isArchived && !isExternal && targetMode === 'category' && !staysInCurrentMode

    // Deferred a frame: the filter-clearing state updates above need to
    // commit (and dateFilteredNotes/categoryTree recompute) before switching
    // mode / unfolding / paginating can find the note where it now is.
    requestAnimationFrame(() => {
      if (staysInCurrentMode) {
        focusActiveNoteInSidebarMode(sidebarMode)
      } else {
        runSidebarMenuTransition(targetMode)
      }

      // Silently prep date view's pagination so it's already positioned
      // right if the user switches there by hand later -- without actually
      // switching to date view now. This writes the *persisted* per-mode
      // page (sidebarViewStateByMode.date.page), not the live currentPage,
      // since currentPage only reflects whichever mode is presently active
      // and would just get discarded the next time date mode is entered.
      if (needsDatePaginationPrep) {
        const noteIndex = dateFilteredNotesRef.current.findIndex((note) => note.id === activeNoteId)
        if (noteIndex >= 0) {
          const container = sidebarContentRef.current
          const list = container?.querySelector('.notes-list') as HTMLElement | null
          const firstItem = list?.querySelector('.note-list-item') as HTMLElement | null
          const listStyles = list ? window.getComputedStyle(list) : null
          const rowHeight = firstItem ? Math.round(firstItem.getBoundingClientRect().height) : 48
          const rowGap = listStyles ? Math.round(parseFloat(listStyles.rowGap || listStyles.gap || '8')) : 8
          const paddingTop = listStyles ? Math.round(parseFloat(listStyles.paddingTop || '10')) : 10
          const paddingBottom = listStyles ? Math.round(parseFloat(listStyles.paddingBottom || '10')) : 10
          const contentHeight = container ? container.clientHeight - paddingTop - paddingBottom : 0
          const measuredItemsPerPage = Math.max(1, Math.floor((contentHeight + rowGap) / (rowHeight + rowGap)))
          const targetPage = Math.floor(noteIndex / measuredItemsPerPage) + 1

          setSidebarViewStateByMode((previous) => ({
            ...previous,
            date: { ...previous.date, page: targetPage },
          }))
        }
      }
    })
  }, [getActiveSection, focusActiveNoteInSidebarMode, hasDateFilter, isSearchQueryCaseSensitive, isSidebarSearchActive, matchesSelectedDateFilter, runSidebarMenuTransition, searchQuery, sidebarMode])
  revealNoteInMenuRef.current = revealNoteInMenu

  const totalPages = Math.max(1, Math.ceil(totalPagedNotes / Math.max(1, itemsPerPage)))
  const effectiveCurrentPage = Math.min(Math.max(1, currentPage), totalPages)
  const isSidebarTreeMode = sidebarMode === 'category' || sidebarMode === 'archive'
  const isSidebarCustomScrollbarMode = isSidebarTreeMode || isFindMode
  const isSidebarScrollbarMode = isSidebarCustomScrollbarMode || sidebarMode === 'options'

  // Direct-DOM helpers: per-frame scroll events would otherwise trigger React
  // state updates that re-render the entire App component (heavy for long
  // notes), starving rAF and producing slow/standstill/fast scroll artefacts.
  // We mutate thumb DOM nodes imperatively and reserve React state only for
  // visibility toggles (rare).
  const applySidebarThumbDom = useCallback((topPx: number, heightPx: number) => {
    sidebarScrollThumbTopRef.current = topPx
    sidebarScrollThumbHeightRef.current = heightPx
    const thumbEl = sidebarScrollbarThumbRef.current
    if (!thumbEl) return
    thumbEl.style.top = `${topPx}px`
    thumbEl.style.height = `${Math.max(0, heightPx)}px`
  }, [])

  const syncSidebarCustomScrollbar = useCallback(() => {
    if (!isSidebarScrollbarMode) {
      applySidebarThumbDom(0, 0)
      setIsSidebarScrollThumbActive(false)
      return
    }

    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    const track = sidebarScrollbarTrackRef.current
    if (!scroller || !track) return

    if (sidebarTextureRef.current) {
      syncTextureToScroll(scroller.scrollTop, sidebarTextureRef.current)
    }

    const viewportHeight = scroller.clientHeight
    const contentHeight = scroller.scrollHeight
    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    if (viewportHeight <= 0 || contentHeight <= 0 || trackHeight <= 0) {
      applySidebarThumbDom(0, 0)
      setIsSidebarScrollThumbActive(false)
      return
    }

    if (contentHeight <= viewportHeight) {
      applySidebarThumbDom(SCROLL_TRACK_EDGE_GAP_PX, usableTrackHeight)
      setIsSidebarScrollThumbActive(false)
      return
    }

    const visibleRatio = viewportHeight / contentHeight
    const nextThumbHeight = Math.max(
      SCROLL_TRACK_MIN_THUMB_HEIGHT_PX,
      Math.min(usableTrackHeight, Math.round(usableTrackHeight * visibleRatio)),
    )

    const maxScrollTop = contentHeight - viewportHeight
    const maxThumbTop = Math.max(0, usableTrackHeight - nextThumbHeight)
    const scrollRatio = maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0
    const nextThumbTop = SCROLL_TRACK_EDGE_GAP_PX + Math.round(maxThumbTop * scrollRatio)

    applySidebarThumbDom(nextThumbTop, nextThumbHeight)
    setIsSidebarScrollThumbActive(true)
  }, [applySidebarThumbDom, isSidebarScrollbarMode, sidebarTreeScrollerEl])

  const sidebarScrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    const track = sidebarScrollbarTrackRef.current
    if (!scroller || !track) return

    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - sidebarScrollThumbHeightRef.current)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(thumbTopPx, maxThumbTop))
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0
    scroller.scrollTop = ratio * maxScrollTop
  }, [sidebarTreeScrollerEl])

  const pagedVisibleNotes = useMemo(() => {
    if (sidebarMode !== 'date' && sidebarMode !== 'trash') {
      return visibleNotes
    }

    const startIndex = (effectiveCurrentPage - 1) * itemsPerPage
    return visibleNotes.slice(startIndex, startIndex + itemsPerPage)
  }, [effectiveCurrentPage, itemsPerPage, sidebarMode, visibleNotes])

  useEffect(() => {
    const pending = pendingSidebarScrollRestoreRef.current
    if (!pending || pending.mode !== sidebarMode) {
      return
    }

    let cancelled = false
    let attempts = 0

    const apply = () => {
      if (cancelled) return

      const scroller = getSidebarScrollerForMode(sidebarMode)
      if (!scroller) {
        if (attempts < 8) {
          attempts += 1
          requestAnimationFrame(apply)
        }
        return
      }

      scroller.scrollTop = pending.scrollTop
      pendingSidebarScrollRestoreRef.current = null
      syncSidebarCustomScrollbar()
    }

    requestAnimationFrame(apply)
    return () => {
      cancelled = true
    }
  }, [
    archiveTree,
    categoryTree,
    activeSectionSnapshot?.documentFindHits.length,
    getSidebarScrollerForMode,
    pagedVisibleNotes.length,
    sidebarMode,
    syncSidebarCustomScrollbar,
  ])

  const activeSection = activeSectionSnapshot

  const handleFindViewButtonContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    getActiveSection()?.replaceAllDocumentFindHits()
  }, [getActiveSection])

  const handleMonthToggle = useCallback((month: number, event: MouseEvent<HTMLButtonElement>) => {
    handleMultiSelect(month, event, selectedMonths, FILTER_MONTHS, setSelectedMonths)
  }, [selectedMonths])

  const handleYearToggle = useCallback((year: number | 'older', event: MouseEvent<HTMLButtonElement>) => {
    handleMultiSelect(year, event, selectedYears, FILTER_YEARS, setSelectedYears)
  }, [selectedYears])

  const handleMonthRowContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setSelectedMonths(new Set())
  }, [])

  const handleYearRowContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setSelectedYears(new Set())
  }, [])

  const handleCategoryCollapseChange = useCallback((next: { collapsedPrimary: string[]; collapsedSecondary: string[] }) => {
    setCategoryCollapsedPrimary((previous) => (
      areStringArraysEqual(previous, next.collapsedPrimary) ? previous : next.collapsedPrimary
    ))
    setCategoryCollapsedSecondary((previous) => (
      areStringArraysEqual(previous, next.collapsedSecondary) ? previous : next.collapsedSecondary
    ))
    setSidebarViewStateByMode((previous) => ({
      ...previous,
      category: {
        ...previous.category,
        collapsedPrimary: areStringArraysEqual(previous.category.collapsedPrimary, next.collapsedPrimary)
          ? previous.category.collapsedPrimary
          : next.collapsedPrimary,
        collapsedSecondary: areStringArraysEqual(previous.category.collapsedSecondary, next.collapsedSecondary)
          ? previous.category.collapsedSecondary
          : next.collapsedSecondary,
      },
    }))
  }, [])

  const handleArchiveCollapseChange = useCallback((next: { collapsedPrimary: string[]; collapsedSecondary: string[] }) => {
    setArchiveCollapsedPrimary((previous) => (
      areStringArraysEqual(previous, next.collapsedPrimary) ? previous : next.collapsedPrimary
    ))
    setArchiveCollapsedSecondary((previous) => (
      areStringArraysEqual(previous, next.collapsedSecondary) ? previous : next.collapsedSecondary
    ))
    setSidebarViewStateByMode((previous) => ({
      ...previous,
      archive: {
        ...previous.archive,
        collapsedPrimary: areStringArraysEqual(previous.archive.collapsedPrimary, next.collapsedPrimary)
          ? previous.archive.collapsedPrimary
          : next.collapsedPrimary,
        collapsedSecondary: areStringArraysEqual(previous.archive.collapsedSecondary, next.collapsedSecondary)
          ? previous.archive.collapsedSecondary
          : next.collapsedSecondary,
      },
    }))
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [isSearchQueryCaseSensitive, selectedMonths, selectedYears, searchQuery])


  useLayoutEffect(() => {
    const compute = () => {
      const container = sidebarContentRef.current
      if (!container) return

      const list = container.querySelector('.notes-list') as HTMLElement | null
      const firstItem = list?.querySelector('.note-list-item') as HTMLElement | null
      const listStyles = list ? window.getComputedStyle(list) : null

      const rowHeight = firstItem ? Math.round(firstItem.getBoundingClientRect().height) : 48
      const rowGap = listStyles ? Math.round(parseFloat(listStyles.rowGap || listStyles.gap || '8')) : 8
      const paddingTop = listStyles ? Math.round(parseFloat(listStyles.paddingTop || '10')) : 10
      const paddingBottom = listStyles ? Math.round(parseFloat(listStyles.paddingBottom || '10')) : 10

      const contentHeight = container.clientHeight - paddingTop - paddingBottom
      const nextItemsPerPage = Math.max(1, Math.floor((contentHeight + rowGap) / (rowHeight + rowGap)))

      const nextTotalPages = Math.max(1, Math.ceil(totalPagedNotes / Math.max(1, nextItemsPerPage)))
      const shouldShowPagination =
        (sidebarMode === 'date' || sidebarMode === 'trash') && nextTotalPages > 1

      if (nextItemsPerPage !== itemsPerPage) {
        setItemsPerPage(nextItemsPerPage)
      }

      if (currentPage > nextTotalPages) {
        setCurrentPage(nextTotalPages)
      }

      setShowPagination(shouldShowPagination)
    }

    const container = sidebarContentRef.current
    const resizeObserver = new ResizeObserver(compute)

    if (container) {
      compute()
      resizeObserver.observe(container)
      window.requestAnimationFrame(compute)
    }

    window.addEventListener('resize', compute)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', compute)
    }
  }, [currentPage, itemsPerPage, sidebarMode, totalPagedNotes])

  useEffect(() => {
    if (!isSidebarScrollbarMode) return
    syncSidebarCustomScrollbar()
  }, [isSidebarScrollbarMode, syncSidebarCustomScrollbar, sidebarMode, categoryTree, archiveTree, activeSection?.documentFindHits])

  useEffect(() => {
    if (!isSidebarScrollbarMode) return

    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    if (!scroller) return

    const onScroll = () => {
      syncSidebarCustomScrollbar()
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [isSidebarScrollbarMode, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

  useEffect(() => {
    if (!isSidebarScrollbarMode) return

    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    if (!scroller) return

    const scheduleSync = () => {
      if (sidebarScrollbarRafRef.current !== null) {
        cancelAnimationFrame(sidebarScrollbarRafRef.current)
      }

      sidebarScrollbarRafRef.current = requestAnimationFrame(() => {
        sidebarScrollbarRafRef.current = null
        syncSidebarCustomScrollbar()
      })
    }

    scheduleSync()
    const observedContentEl = (sidebarTreeScrollerEl?.firstElementChild as HTMLElement | null)
      ?? (sidebarMode === 'options' ? optionsContentRef.current : null)

    const resizeObserver = new ResizeObserver(() => scheduleSync())
    resizeObserver.observe(scroller)
    if (observedContentEl) {
      resizeObserver.observe(observedContentEl)
    }

    const mutationObserver = new MutationObserver(() => scheduleSync())
    mutationObserver.observe(scroller, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['open', 'style'],
    })

    const onDetailsToggle = (event: Event) => {
      if (event.target instanceof HTMLDetailsElement) {
        scheduleSync()
      }
    }

    scroller.addEventListener('toggle', onDetailsToggle, true)

    return () => {
      scroller.removeEventListener('toggle', onDetailsToggle, true)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (sidebarScrollbarRafRef.current !== null) {
        cancelAnimationFrame(sidebarScrollbarRafRef.current)
        sidebarScrollbarRafRef.current = null
      }
    }
  }, [isSidebarScrollbarMode, sidebarMode, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

  useEffect(() => {
    if (!isDraggingSidebarScrollThumb) return

    const onMouseMove = (event: globalThis.MouseEvent) => {
      const origin = sidebarScrollbarDragOriginRef.current
      if (!origin) return
      const deltaY = event.clientY - origin.pointerY
      sidebarScrollFromThumbTop(origin.thumbTopPx + deltaY)
      syncSidebarCustomScrollbar()
    }

    const onMouseUp = () => {
      setIsDraggingSidebarScrollThumb(false)
      sidebarScrollbarDragOriginRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDraggingSidebarScrollThumb, sidebarScrollFromThumbTop, syncSidebarCustomScrollbar])

  const handleSidebarTrackMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const track = sidebarScrollbarTrackRef.current
    if (!track) return

    const rect = track.getBoundingClientRect()
    const clickY = event.clientY - rect.top
    const thumbHeightPx = sidebarScrollThumbHeightRef.current
    const targetThumbTop = clickY - (thumbHeightPx / 2)
    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - thumbHeightPx)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(targetThumbTop, maxThumbTop))

    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    if (!scroller) {
      sidebarScrollFromThumbTop(clampedTop)
      syncSidebarCustomScrollbar()
      return
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0
    const targetScrollTop = ratio * maxScrollTop

    scrollToNonQuantizedSmooth(scroller, targetScrollTop)
  }, [sidebarScrollFromThumbTop, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

  const handleSidebarThumbMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingSidebarScrollThumb(true)
    sidebarScrollbarDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: sidebarScrollThumbTopRef.current,
    }
  }, [])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    if (!isPageJumpEditing) {
      setPageJumpInput(String(effectiveCurrentPage))
    }
  }, [effectiveCurrentPage, isPageJumpEditing])

  useEffect(() => {
    if (!isTextureSeedEditing) {
      setTextureSeedInput(String(texturePreviewMaterial.seed))
    }
  }, [isTextureSeedEditing, texturePreviewMaterial.seed])

  useEffect(() => {
    if (!isGlazeLinearSeedEditing) {
      setGlazeLinearSeedInput(String(glazeSettings.linearSeed))
    }
  }, [glazeSettings.linearSeed, isGlazeLinearSeedEditing])

  useEffect(() => {
    if (!isGlazeRadialSeedEditing) {
      setGlazeRadialSeedInput(String(glazeSettings.radialSeed))
    }
  }, [glazeSettings.radialSeed, isGlazeRadialSeedEditing])

  const commitPageJump = useCallback(() => {
    const parsed = Number.parseInt(pageJumpInput.trim(), 10)
    const safePage = Number.isFinite(parsed)
      ? clamp(parsed, 1, totalPages)
      : effectiveCurrentPage

    setCurrentPage(safePage)
    setPageJumpInput(String(safePage))
    setIsPageJumpEditing(false)
  }, [effectiveCurrentPage, pageJumpInput, totalPages])

  const startPageJumpEdit = useCallback(() => {
    setPageJumpInput(String(effectiveCurrentPage))
    setIsPageJumpEditing(true)
  }, [effectiveCurrentPage])

  const cancelPageJumpEdit = useCallback(() => {
    setPageJumpInput(String(effectiveCurrentPage))
    setIsPageJumpEditing(false)
  }, [effectiveCurrentPage])

  useEffect(() => {
    if (!isPageJumpEditing) return
    window.requestAnimationFrame(() => {
      pageJumpInputRef.current?.focus()
      pageJumpInputRef.current?.select()
    })
  }, [isPageJumpEditing])

  const commitTextureSeedEdit = useCallback(() => {
    const parsed = Number.parseInt(textureSeedInput.trim(), 10)
    const safeSeed = Number.isFinite(parsed)
      ? clamp(parsed, 0, 1000000)
      : clamp(texturePreviewMaterial.seed, 0, 1000000)

    setTexturePreviewMaterial((current) => ({
      ...current,
      seed: safeSeed,
    }))
    setTextureSeedInput(String(safeSeed))
    setIsTextureSeedEditing(false)
  }, [texturePreviewMaterial.seed, textureSeedInput])

  const commitGlazeLinearSeedEdit = useCallback(() => {
    const parsed = Number.parseInt(glazeLinearSeedInput.trim(), 10)
    const safeSeed = Number.isFinite(parsed)
      ? clamp(parsed, 0, 1000000)
      : clamp(glazeSettings.linearSeed, 0, 1000000)

    setGlazeSettings((current) => ({
      ...current,
      linearSeed: safeSeed,
    }))
    setGlazeLinearSeedInput(String(safeSeed))
    setIsGlazeLinearSeedEditing(false)
  }, [glazeLinearSeedInput, glazeSettings.linearSeed])

  const commitGlazeRadialSeedEdit = useCallback(() => {
    const parsed = Number.parseInt(glazeRadialSeedInput.trim(), 10)
    const safeSeed = Number.isFinite(parsed)
      ? clamp(parsed, 0, 1000000)
      : clamp(glazeSettings.radialSeed, 0, 1000000)

    setGlazeSettings((current) => ({
      ...current,
      radialSeed: safeSeed,
    }))
    setGlazeRadialSeedInput(String(safeSeed))
    setIsGlazeRadialSeedEditing(false)
  }, [glazeRadialSeedInput, glazeSettings.radialSeed])


  const cancelTextureSeedEdit = useCallback(() => {
    setTextureSeedInput(String(texturePreviewMaterial.seed))
    setIsTextureSeedEditing(false)
  }, [texturePreviewMaterial.seed])

  const cancelGlazeLinearSeedEdit = useCallback(() => {
    setGlazeLinearSeedInput(String(glazeSettings.linearSeed))
    setIsGlazeLinearSeedEditing(false)
  }, [glazeSettings.linearSeed])

  const cancelGlazeRadialSeedEdit = useCallback(() => {
    setGlazeRadialSeedInput(String(glazeSettings.radialSeed))
    setIsGlazeRadialSeedEditing(false)
  }, [glazeSettings.radialSeed])

  const randomizeTextureSeed = useCallback(() => {
    if (isTextureSeedEditing) return

    const nextSeed = Math.floor(Math.random() * 1000001)
    setTexturePreviewMaterial((current) => ({
      ...current,
      seed: nextSeed,
    }))
  }, [isTextureSeedEditing])

  const randomizeGlazeLinearSeed = useCallback(() => {
    if (isGlazeLinearSeedEditing) return

    const nextSeed = Math.floor(Math.random() * 1000001)
    setGlazeSettings((current) => ({
      ...current,
      linearSeed: nextSeed,
    }))
  }, [isGlazeLinearSeedEditing])

  const randomizeGlazeRadialSeed = useCallback(() => {
    if (isGlazeRadialSeedEditing) return

    const nextSeed = Math.floor(Math.random() * 1000001)
    setGlazeSettings((current) => ({
      ...current,
      radialSeed: nextSeed,
    }))
  }, [isGlazeRadialSeedEditing])

  const startTextureSeedEdit = useCallback(() => {
    setTextureSeedInput(String(texturePreviewMaterial.seed))
    setIsTextureSeedEditing(true)
  }, [texturePreviewMaterial.seed])

  const startGlazeLinearSeedEdit = useCallback(() => {
    setGlazeLinearSeedInput(String(glazeSettings.linearSeed))
    setIsGlazeLinearSeedEditing(true)
  }, [glazeSettings.linearSeed])

  const startGlazeRadialSeedEdit = useCallback(() => {
    setGlazeRadialSeedInput(String(glazeSettings.radialSeed))
    setIsGlazeRadialSeedEditing(true)
  }, [glazeSettings.radialSeed])

  useEffect(() => {
    if (!isTextureSeedEditing) return
    window.requestAnimationFrame(() => {
      textureSeedInputRef.current?.focus()
      textureSeedInputRef.current?.select()
    })
  }, [isTextureSeedEditing])

  useEffect(() => {
    if (!isGlazeLinearSeedEditing) return
    window.requestAnimationFrame(() => {
      glazeLinearSeedInputRef.current?.focus()
      glazeLinearSeedInputRef.current?.select()
    })
  }, [isGlazeLinearSeedEditing])

  useEffect(() => {
    if (!isGlazeRadialSeedEditing) return
    window.requestAnimationFrame(() => {
      glazeRadialSeedInputRef.current?.focus()
      glazeRadialSeedInputRef.current?.select()
    })
  }, [isGlazeRadialSeedEditing])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return

      const target = event.target instanceof HTMLElement ? event.target : null
      const isEditorTarget = Boolean(target?.closest('.editor-stage'))
      const isSearchField = target === sidebarSearchInputRef.current
      const isTagField = target === activeSection?.tagInputRef.current
      const isPageJumpField = target === pageJumpInputRef.current
      const isTextureSeedField = target === textureSeedInputRef.current
      const isGlazeLinearSeedField = target === glazeLinearSeedInputRef.current
      const isGlazeRadialSeedField = target === glazeRadialSeedInputRef.current
      const isEditorControlField = isSearchField || isTagField || isPageJumpField || isTextureSeedField || isGlazeLinearSeedField || isGlazeRadialSeedField

      if (isEditorControlField && ['Escape', 'Enter', 'Tab'].includes(event.key)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        activeSection?.scheduleFocusEditorInEditMode()
        return
      }

      if (isFindMode && event.ctrlKey && !event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        activeSection?.replaceAllDocumentFindHits()
        return
      }

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        runSidebarMenuTransition('find')
        requestAnimationFrame(() => {
          sidebarSearchInputRef.current?.focus()
          sidebarSearchInputRef.current?.select()
        })
        return
      }

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNoteFromClipboardTitle()
        return
      }

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        void activeSection?.handleAddCurrentNoteToTabs()
        return
      }

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNote()
        return
      }

      if (isEditorTarget && activeSection?.activeNoteId && event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase()

        if (!event.shiftKey && key === 'b') {
          event.preventDefault()
          activeSection.applyTextDecoration('bold')
          return
        }

        if (!event.shiftKey && key === 'i') {
          event.preventDefault()
          activeSection.applyTextDecoration('italic')
          return
        }

        if (!event.shiftKey && key === 'j') {
          event.preventDefault()
          activeSection.applyTextDecoration('strikethrough')
          return
        }

        if (!event.shiftKey && key === 'h') {
          event.preventDefault()
          activeSection.toggleCurrentLineHeading()
          return
        }

        const isOrderedListShortcut = event.key === '#' || (event.shiftKey && event.key === '3')
        if (isOrderedListShortcut) {
          event.preventDefault()
          activeSection.toggleNumberedList()
          return
        }

        if (!event.shiftKey && event.key === '-') {
          event.preventDefault()
          activeSection.toggleBulletedList()
          return
        }
      }

      if (event.key === 'Escape') {
        const activeElement = document.activeElement
        const isEditableField =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement instanceof HTMLSelectElement ||
          Boolean(activeElement && (activeElement as HTMLElement).isContentEditable)

        if (isEditableField && activeElement instanceof HTMLElement) {
          event.preventDefault()
          activeElement.blur()
          return
        }

        event.preventDefault()
        void activeSection?.toggleRenderViewMode()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeSection,
    createNote,
    createNoteFromClipboardTitle,
    isFindMode,
    runSidebarMenuTransition,
  ])

  useEffect(() => {
    if (activeSection?.isPreviewMode || !activeSection?.activeNoteId) return

    const onMouseDownCapture = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      if (target.closest('.editor-stage .editor-text[contenteditable="true"]')) {
        return
      }

      if (isAllowedNonEditorFocusTarget(target)) {
        return
      }

      event.preventDefault()
      activeSection?.scheduleFocusEditorInEditMode()
    }

    window.addEventListener('mousedown', onMouseDownCapture, true)
    return () => window.removeEventListener('mousedown', onMouseDownCapture, true)
  }, [activeSection, isAllowedNonEditorFocusTarget])

  useEffect(() => {
    const handleBeforeUnload = () => {
      // Flush any pending debounced app-state save immediately so the main
      // process receives the latest viewport/menu state before the renderer
      // is torn down. The main process will also re-save its cached copy on
      // before-quit as a belt-and-suspenders guarantee.
      if (appStateSaveTimerRef.current !== null) {
        window.clearTimeout(appStateSaveTimerRef.current)
        appStateSaveTimerRef.current = null
        const viewport = activeSection?.latestViewportRef.current
        void window.thockdownState?.saveAppState({
          selectedNoteId: activeSection?.activeNoteId ?? null,
          viewport: viewport ?? undefined,
          menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
        })
      }

      activeSection?.persistActiveNoteEditModeStateNow()
      if (activeSection?.isPreviewMode && activeSection.activeNoteId) {
        void activeSection.persistRenderViewStateForNoteNow(activeSection.activeNoteId)
      }
      persistMenuStateOnUnload()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [activeSection, buildMenuStateSnapshot, persistMenuStateOnUnload])

  const syncSidebarTexture = useCallback(() => {
    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    if (!scroller || !sidebarTextureRef.current) return
    syncTextureToScroll(scroller.scrollTop, sidebarTextureRef.current)
  }, [sidebarTreeScrollerEl])

  const handleSidebarScroll = useCallback(() => {
    syncSidebarTexture()
  }, [syncSidebarTexture])

  useEffect(() => {
    syncSidebarTexture()
  }, [syncSidebarTexture, sidebarMode, isSidebarScrollbarMode])

  return (
    <div className="app-root" style={appRootStyle} onDragOver={handleAppDragOver} onDrop={handleAppDrop}>
      {bootstrapError ? (
        <div
          role="alert"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 999999,
            padding: '10px 16px',
            background: '#b3261e',
            color: '#ffffff',
            fontSize: '13px',
            fontFamily: 'sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <span>
            Thockdown Notes couldn't load your notes ({bootstrapError}). It will keep retrying, but your notes
            and the timeline may not appear until this is resolved.
          </span>
          <button
            type="button"
            onClick={() => setBootstrapError(null)}
            style={{
              background: 'transparent',
              border: '1px solid #ffffff',
              color: '#ffffff',
              borderRadius: '4px',
              padding: '2px 8px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="app-saturate-wrapper" style={{ ...appOuterStyle, position: 'fixed', inset: 0 }}>
        <div className={`glaze-overlay-stack${glazeSettings.radialAboveLinear ? ' radial-above-linear' : ''}`} aria-hidden="true">
          <div className="glaze-overlay-layer glaze-overlay-layer-linear" />
          <div className="glaze-overlay-layer glaze-overlay-layer-radial" />
          <div className="glaze-overlay-layer glaze-overlay-layer-gloom" />
        </div>
        {windowModeTransitionOverlayNonce > 0 ? (
          <div key={windowModeTransitionOverlayNonce} className="window-mode-transition-overlay" aria-hidden="true" />
        ) : null}
        <div className="app-sheen">
          <div
            className={`app-shell app-grid${filterInvert > 0.5 ? ' shadow-flip' : ''}${windowIsCollapsed ? ' is-window-collapsed' : ''}`}
            ref={appShellRef}
            style={appShellStyle}
          >
            {isSidebarVisible ? (
            <aside className="notes-sidebar" style={{ gridArea: 'sidebar' }}>
              <div className="search-box" aria-label="Search panel">
                <div className="search-input-shell">
                <input
                  className="search-input-field has-case-toggle"
                  ref={sidebarSearchInputRef}
                  type="text"
                  placeholder={isFindMode ? 'Find in current note...' : 'Search for content or #tag...'}
                  value={isFindMode ? (activeSection?.documentFindQuery ?? '') : searchQuery}
                  onChange={(event) => {
                    const value = event.target.value
                    if (isFindMode) {
                      getActiveSection()?.setDocumentFindQuery(value)
                    } else {
                      setSearchQuery(value)
                    }
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                        getActiveSection()?.scheduleFocusEditorInEditMode()
                      }
                    }, 0)
                  }}
                />
                <button
                  type="button"
                  className={`btn-icon search-input-case-toggle${(isFindMode ? activeSection?.isDocumentFindCaseSensitive : isSearchQueryCaseSensitive) ? ' is-active' : ''}`}
                  aria-pressed={isFindMode ? activeSection?.isDocumentFindCaseSensitive : isSearchQueryCaseSensitive}
                  title="Match letter case"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (isFindMode) {
                      getActiveSection()?.setIsDocumentFindCaseSensitive((previous: boolean) => !previous)
                    } else {
                      setIsSearchQueryCaseSensitive((previous) => !previous)
                    }
                  }}
                >
                  Aa
                </button>
                </div>
              </div>

              <div className="view-toggle" role="tablist" aria-label="Note view modes">
                {SIDEBAR_MODES.map(({ mode, label }) => {
                  const isActive = sidebarMode === mode
                  const iconClassByMode: Record<SidebarMode, string> = {
                    date: 'btn-date',
                    category: 'btn-category',
                    archive: 'btn-archived',
                    trash: 'btn-deleted',
                    find: 'btn-find',
                    options: 'btn-options',
                  }
                  return (
                    <button
                      key={mode}
                      className={`toggle-btn notes-mode-button icon-btn ${iconClassByMode[mode]}${isActive ? ' is-active' : ''}${mode === 'trash' && activeSection?.isTrashViewDeletePrimed ? ' is-primed-for-deletion' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      title={label}
                      aria-label={label}
                      onClick={() => handleViewModeButtonClick(mode)}
                      onContextMenu={
                        mode === 'trash'
                          ? activeSection?.handleTrashViewButtonContextMenu
                          : mode === 'find'
                            ? handleFindViewButtonContextMenu
                            : undefined
                      }
                      onMouseDown={mode === 'trash' ? activeSection?.handleTrashViewButtonMouseDown : undefined}
                      onMouseUp={mode === 'trash' ? activeSection?.handleTrashViewButtonMouseUp : undefined}
                      onMouseLeave={mode === 'trash' ? () => {
                        activeSection?.clearTrashButtonArmTimer()
                        activeSection?.setIsTrashViewDeletePrimed(false)
                      } : undefined}
                    >
                      {mode === 'find' ? (
                        <span className="find-mode-glyph fa-solid fa-magnifying-glass" aria-hidden="true" />
                      ) : (
                        <span className="sr-only-mode-label">{label}</span>
                      )}
                    </button>
                  )
                })}
              </div>

              <div className={`sidebar-scroll-frame${isSidebarCustomScrollbarMode ? ' is-tree-mode' : ''}`}>
                <div className="sidebar-wrapper">
                  <div
                    className={`sidebar-content${(sidebarMode === 'date' || sidebarMode === 'trash') ? ' is-paged-mode' : ''}${isSidebarCustomScrollbarMode ? ' is-tree-mode' : ''}${isSidebarScrollbarMode && !isSidebarCustomScrollbarMode ? ' is-scrollbar-mode' : ''}`}
                    ref={sidebarContentRef}
                    onScroll={handleSidebarScroll}
                  >
                    <div ref={sidebarTextureRef} className="sidebar-content-texture" />
                    {(sidebarMode === 'date' || sidebarMode === 'trash') ? (
                      <div
                        className={`notes-list date-view${hasDateFilter ? ' is-filtered' : ''}`}
                        role="listbox"
                        aria-label="Note list"
                      >
                        {pagedVisibleNotes.map((note) => {
                          const isActive = note.id === activeSection?.activeNoteId
                          const isModified = isExternalNote(note) && getCurrentExternalNoteModifiedState(note)
                          return (
                            <NoteListItem
                              key={note.id}
                              note={note}
                              isActive={isActive}
                              isModified={isModified}
                              onSelect={handleSelectNote}
                              onPrimedLeftClick={(noteId) => getActiveSection()?.handlePrimedNoteLeftClick(noteId)}
                              onSaveClick={activeSection?.handleSaveButtonClick}
                              onCloseClick={activeSection?.handleCloseButtonClick}
                              onArchiveClick={activeSection?.handleArchiveClick}
                              onTrashClick={activeSection?.handleTrashClick}
                              isTrashMode={sidebarMode === 'trash'}
                              primedAction={activeSection?.primedNoteActionById.get(note.id) ?? null}
                              onRightPressStart={(noteId, event) => getActiveSection()?.handleNoteRightPressStart(noteId, event)}
                              onRightPressEnd={(noteId, event) => getActiveSection()?.handleNoteRightPressEnd(noteId, event)}
                              onMouseLeave={activeSection?.handleNoteMouseLeave}
                            />
                          )
                        })}
                        {pagedVisibleNotes.length === 0 ? (
                          <div className="notes-empty-state">
                            {searchQuery.trim()
                              ? 'No notes match the current search.'
                              : 'No notes match the current date filters.'}
                          </div>
                        ) : null}
                      </div>
                    ) : isFindMode ? (
                      <div
                        className="notes-list find-view thockdown-custom-scrollbar"
                        ref={setSidebarTreeScrollerEl}
                      >
                        {(activeSection?.documentFindHits ?? []).map((hit, index) => (
                          <button
                            key={hit.id}
                            type="button"
                            className="find-hit-item"
                            onClick={() => getActiveSection()?.handleJumpToDocumentFindHit(hit)}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              getActiveSection()?.replaceDocumentFindHit(hit)
                            }}
                            title={`Jump to occurrence ${index + 1}`}
                          >
                            <span className="find-hit-snippet">
                              {hit.hasSnippetPrefixEllipsis ? '... ' : ''}
                              {hit.snippetBefore}
                              <span className="find-hit-match">{hit.snippetMatch}</span>
                              {hit.snippetAfter}
                              {hit.hasSnippetSuffixEllipsis ? ' ...' : ''}
                            </span>
                          </button>
                        ))}
                        {(activeSection?.documentFindHits.length ?? 0) === 0 ? (
                          <div className="notes-empty-state">
                            {(activeSection?.documentFindQuery ?? '').trim()
                              ? 'No matches in the current note.'
                              : 'Type in the search field to find text in the current note.'}
                          </div>
                        ) : null}
                      </div>
                    ) : sidebarMode === 'options' ? (
                      <SidebarOptionsPanel
                        isPreviewMode={activeSection?.isPreviewMode ?? false}
                        uiMode={uiMode}
                        optionsContentRef={optionsContentRef}
                        viewStyle={viewStyle}
                        setViewStyle={setViewStyle}
                        viewFontSize={viewFontSize}
                        setViewFontSize={setViewFontSize}
                        viewSpacing={viewSpacing}
                        setViewSpacing={setViewSpacing}
                        editorStyle={editorStyle}
                        setEditorStyle={setEditorStyle}
                        editorFontSize={editorFontSize}
                        setEditorFontSize={setEditorFontSize}
                        editorSpacing={editorSpacing}
                        setEditorSpacing={setEditorSpacing}
                        scheduleFocusEditorInEditMode={() => getActiveSection()?.scheduleFocusEditorInEditMode()}
                        factoryPresetEntriesForCurrentMode={factoryPresetEntriesForCurrentMode}
                        activeEntryForCurrentMode={activeEntryForCurrentMode}
                        selectLoadoutPreset={selectLoadoutPreset}
                        isDynamicCustomPresetActive={isDynamicCustomPresetActive}
                        selectDynamicCustomPreset={selectDynamicCustomPreset}
                        customSlotEntriesForCurrentMode={customSlotEntriesForCurrentMode}
                        primedCustomLayoutId={primedCustomLayoutId}
                        handleCustomLoadoutSlotClick={handleCustomLoadoutSlotClick}
                        handleCustomLoadoutSlotRightMouseDown={handleCustomLoadoutSlotRightMouseDown}
                        handleCustomLoadoutSlotRightMouseUp={handleCustomLoadoutSlotRightMouseUp}
                        handleCustomLoadoutSlotMouseLeave={handleCustomLoadoutSlotMouseLeave}
                        handleCustomLoadoutSlotContextMenu={handleCustomLoadoutSlotContextMenu}
                        hasUnsavedUiLoadoutChanges={hasUnsavedUiLoadoutChanges}
                        saveCustomLoadout={saveCustomLoadout}
                        resetCustomLoadout={resetCustomLoadout}
                        primedColorSource={primedColorSource}
                        setPrimedColorSource={setPrimedColorSource}
                        highlightColors={highlightColors}
                        editorTextColors={editorTextColors}
                        applyActiveColorToElement={applyActiveColorToElement}
                        updateHighlightColor={updateHighlightColor}
                        applyHsvaValueToElement={applyHsvaValueToElement}
                        applyActiveColorToEditorText={applyActiveColorToEditorText}
                        updateEditorTextColor={updateEditorTextColor}
                        applyHsvaValueToEditorText={applyHsvaValueToEditorText}
                        startElementPreviewCopyHold={startElementPreviewCopyHold}
                        clearColorArmTimer={clearColorArmTimer}
                        hsvaDragState={hsvaDragState}
                        hsvaDisplayColors={hsvaDisplayColors}
                        activeColorHsva={activeColorHsva}
                        activeColorHex={activeColorHex}
                        activeColorCss={activeColorCss}
                        startHsvaDrag={startHsvaDrag}
                        handleHsvaDragMove={handleHsvaDragMove}
                        stopHsvaDrag={stopHsvaDrag}
                        startColorArmHold={startColorArmHold}
                        wheelAdjustHsvaControl={wheelAdjustHsvaControl}
                        applyActiveColorToTexture={applyActiveColorToTexture}
                        applyTexturePreviewToSurface={applyTexturePreviewToSurface}
                        applyHsvaValueToTexture={applyHsvaValueToTexture}
                        textureMaterials={textureMaterials}
                        texturePreviewMaterial={texturePreviewMaterial}
                        texturePreviewHex={texturePreviewHex}
                        texturePreviewTintCss={texturePreviewTintCss}
                        texturePreviewCss={texturePreviewCss}
                        isTextureSeedEditing={isTextureSeedEditing}
                        textureSeedInputRef={textureSeedInputRef}
                        textureSeedInput={textureSeedInput}
                        setTextureSeedInput={setTextureSeedInput}
                        commitTextureSeedEdit={commitTextureSeedEdit}
                        cancelTextureSeedEdit={cancelTextureSeedEdit}
                        randomizeTextureSeed={randomizeTextureSeed}
                        startTextureSeedEdit={startTextureSeedEdit}
                        isAllowedNonEditorFocusTarget={isAllowedNonEditorFocusTarget}
                        textureControlDragState={textureControlDragState}
                        startTextureControlDrag={startTextureControlDrag}
                        handleTextureControlDragMove={handleTextureControlDragMove}
                        stopTextureControlDrag={stopTextureControlDrag}
                        wheelAdjustTextureControl={wheelAdjustTextureControl}
                        glazeSettings={glazeSettings}
                        setGlazeSettings={setGlazeSettings}
                        isGlazeLinearSeedEditing={isGlazeLinearSeedEditing}
                        glazeLinearSeedInputRef={glazeLinearSeedInputRef}
                        glazeLinearSeedInput={glazeLinearSeedInput}
                        setGlazeLinearSeedInput={setGlazeLinearSeedInput}
                        commitGlazeLinearSeedEdit={commitGlazeLinearSeedEdit}
                        cancelGlazeLinearSeedEdit={cancelGlazeLinearSeedEdit}
                        randomizeGlazeLinearSeed={randomizeGlazeLinearSeed}
                        startGlazeLinearSeedEdit={startGlazeLinearSeedEdit}
                        isGlazeRadialSeedEditing={isGlazeRadialSeedEditing}
                        glazeRadialSeedInputRef={glazeRadialSeedInputRef}
                        glazeRadialSeedInput={glazeRadialSeedInput}
                        setGlazeRadialSeedInput={setGlazeRadialSeedInput}
                        commitGlazeRadialSeedEdit={commitGlazeRadialSeedEdit}
                        cancelGlazeRadialSeedEdit={cancelGlazeRadialSeedEdit}
                        randomizeGlazeRadialSeed={randomizeGlazeRadialSeed}
                        startGlazeRadialSeedEdit={startGlazeRadialSeedEdit}
                        filterInvert={filterInvert}
                        setFilterInvert={setFilterInvert}
                        filterSepia={filterSepia}
                        setFilterSepia={setFilterSepia}
                        filterHueRotate={filterHueRotate}
                        setFilterHueRotate={setFilterHueRotate}
                        filterBrightness={filterBrightness}
                        setFilterBrightness={setFilterBrightness}
                        filterContrast={filterContrast}
                        setFilterContrast={setFilterContrast}
                        filterSaturate={filterSaturate}
                        setFilterSaturate={setFilterSaturate}
                        filterColorize={filterColorize}
                        setFilterColorize={setFilterColorize}
                        renderScrollDynamic={renderScrollDynamic}
                        setRenderScrollDynamic={setRenderScrollDynamic}
                        renderScrollResponsiveness={renderScrollResponsiveness}
                        setRenderScrollResponsiveness={setRenderScrollResponsiveness}
                        renderScrollTotalTimeSec={renderScrollTotalTimeSec}
                        setRenderScrollTotalTimeSec={setRenderScrollTotalTimeSec}
                        renderScrollMaxSpeedPxPerSec={renderScrollMaxSpeedPxPerSec}
                        setRenderScrollMaxSpeedPxPerSec={setRenderScrollMaxSpeedPxPerSec}
                        renderScrollSkew={renderScrollSkew}
                        setRenderScrollSkew={setRenderScrollSkew}
                        typingSoundEnabled={typingSoundEnabled}
                        setTypingSoundEnabled={setTypingSoundEnabled}
                        typingSoundSet={typingSoundSet}
                        setTypingSoundSet={setTypingSoundSet}
                        audioKeyVolume={audioKeyVolume}
                        setAudioKeyVolume={setAudioKeyVolume}
                        audioKeyVariance={audioKeyVariance}
                        setAudioKeyVariance={setAudioKeyVariance}
                        audioPitch={audioPitch}
                        setAudioPitch={setAudioPitch}
                        audioBassVolume={audioBassVolume}
                        setAudioBassVolume={setAudioBassVolume}
                        audioTrebleVolume={audioTrebleVolume}
                        setAudioTrebleVolume={setAudioTrebleVolume}
                        audioReverbStrength={audioReverbStrength}
                        setAudioReverbStrength={setAudioReverbStrength}
                        audioReverbSpace={audioReverbSpace}
                        setAudioReverbSpace={setAudioReverbSpace}
                        musicAccordionNonce={musicAccordionNonce}
                        musicVolume={musicVolume}
                        setMusicVolume={setMusicVolume}
                        musicReverbAmount={musicReverbAmount}
                        setMusicReverbAmount={setMusicReverbAmount}
                        musicReverbRoom={musicReverbRoom}
                        setMusicReverbRoom={setMusicReverbRoom}
                        borderRadiusRegularPx={borderRadiusRegularPx}
                        setBorderRadiusRegularPx={setBorderRadiusRegularPx}
                        editorGlyphPaddingPx={editorGlyphPaddingPx}
                        setEditorGlyphPaddingPx={setEditorGlyphPaddingPx}
                        syncExistingNotes={syncExistingNotes}
                        importNotes={importNotes}
                        exportLayoutsTdl={exportLayoutsTdl}
                        importLayoutsTdl={importLayoutsTdl}
                        debuggingEnabled={debuggingEnabled}
                        setDebuggingEnabled={setDebuggingEnabled}
                        debugNoteIdRef={debugNoteIdRef}
                        queueAppStateSave={queueAppStateSave}
                        activeNoteId={activeSection?.activeNoteId ?? null}
                      />
                    ) : (
                      <div
                        className={`notes-list tree-view thockdown-custom-scrollbar${hasDateFilter ? ' is-filtered' : ''}`}
                        ref={setSidebarTreeScrollerEl}
                      >
                        <CategoryTreeView
                          groups={sidebarMode === 'category' ? categoryTree : archiveTree}
                          activeNoteId={activeSection?.activeNoteId ?? null}
                          persistedCollapsedPrimary={sidebarMode === 'category' ? categoryCollapsedPrimary : archiveCollapsedPrimary}
                          persistedCollapsedSecondary={sidebarMode === 'category' ? categoryCollapsedSecondary : archiveCollapsedSecondary}
                          focusNoteRequestKey={sidebarMode === 'category' ? categoryFocusRequestKey : archiveFocusRequestKey}
                          onCollapseChange={sidebarMode === 'category' ? handleCategoryCollapseChange : handleArchiveCollapseChange}
                          onSelect={handleSelectNote}
                          onPrimedLeftClick={(noteId) => getActiveSection()?.handlePrimedNoteLeftClick(noteId)}
                          primedNoteActionById={activeSection?.primedNoteActionById ?? EMPTY_MAP}
                          onNoteRightPressStart={(noteId, event) => getActiveSection()?.handleNoteRightPressStart(noteId, event)}
                          onNoteRightPressEnd={(noteId, event) => getActiveSection()?.handleNoteRightPressEnd(noteId, event)}
                          onNoteMouseLeave={activeSection?.handleNoteMouseLeave}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {isSidebarScrollbarMode ? (
                  <aside className="sidebar-scrollbar-slot" aria-hidden="true">
                    <div className="sidebar-scrollbar-slot-inner">
                      <div className="thockdown-scroll-rail sidebar-thockdown-scroll-rail">
                        <div
                          ref={sidebarScrollbarTrackRef}
                          className="thockdown-scroll-track"
                          onMouseDown={handleSidebarTrackMouseDown}
                        >
                          <div
                            ref={sidebarScrollbarThumbRef}
                            className={`thockdown-scroll-thumb${isDraggingSidebarScrollThumb ? ' is-dragging' : ''}${isSidebarScrollThumbActive ? '' : ' is-inactive'}`}
                            onMouseDown={handleSidebarThumbMouseDown}
                          />
                        </div>
                      </div>
                    </div>
                  </aside>
                ) : null}
              </div>

              {showPagination ? (
                <div className="sidebar-pagination" aria-label="Sidebar pagination">
                  <button
                    type="button"
                    className="sidebar-page-btn"
                    disabled={effectiveCurrentPage === 1}
                    onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                  >
                    &lt;
                  </button>
                  {isPageJumpEditing ? (
                    <label className="sidebar-page-number-btn" aria-label="Jump to page">
                      <input
                        ref={pageJumpInputRef}
                        type="number"
                        min={1}
                        max={totalPages}
                        step={1}
                        inputMode="numeric"
                        className="sidebar-page-number-input sidebar-page-number-input--edit"
                        value={pageJumpInput}
                        onChange={(event) => {
                          setPageJumpInput(event.target.value.replace(/[^0-9]/g, ''))
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitPageJump()
                            getActiveSection()?.scheduleFocusEditorInEditMode()
                            return
                          }

                          if (event.key === 'Escape' || event.key === 'Tab') {
                            event.preventDefault()
                            cancelPageJumpEdit()
                            getActiveSection()?.scheduleFocusEditorInEditMode()
                          }
                        }}
                        onBlur={() => {
                          window.setTimeout(() => {
                            if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                              getActiveSection()?.scheduleFocusEditorInEditMode()
                            }
                          }, 0)
                        }}
                      />
                    </label>
                  ) : (
                    <button
                      type="button"
                      className="sidebar-page-number-btn sidebar-page-number-display"
                      aria-label={`Current page ${effectiveCurrentPage} of ${totalPages}. Click to edit.`}
                      onClick={startPageJumpEdit}
                    >
                      {`${effectiveCurrentPage} / ${totalPages}`}
                    </button>
                  )}
                  <button
                    type="button"
                    className="sidebar-page-btn"
                    disabled={effectiveCurrentPage === totalPages}
                    onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                  >
                    &gt;
                  </button>
                </div>
              ) : null}

              {(sidebarMode === 'options' || isFindMode) ? (
                <div className="date-filter-rail date-filter-rail-placeholder" aria-hidden="true" />
              ) : null}

              {(sidebarMode === 'date' || sidebarMode === 'trash' || isSidebarTreeMode) ? (
                <div className="date-filter-rail" aria-label="Date filters">
                  <div
                    className="date-filter-line"
                    onContextMenu={handleMonthRowContextMenu}
                  >
                    {FILTER_MONTHS.map((month) => (
                      <button
                        key={month}
                        type="button"
                        className={`date-filter-chip${selectedMonths.has(month) ? ' is-active' : ''}`}
                        onClick={(event) => handleMonthToggle(month, event)}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        {month}
                      </button>
                    ))}
                  </div>
                  <div
                    className="date-filter-line"
                    onContextMenu={handleYearRowContextMenu}
                  >
                    {FILTER_YEARS.map((year) => (
                      <button
                        key={year}
                        type="button"
                        className={`date-filter-chip${selectedYears.has(year) ? ' is-active' : ''}`}
                        onClick={(event) => handleYearToggle(year, event)}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        {year === 'older' ? 'Older' : year}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </aside>
            ) : null}

            {isSidebarVisible ? (
            <div
              className="grid-divider divider-sidebar"
              style={{ gridArea: 'd-sidebar' }}
            />) : null}

            <section
              className={`window-controls-grid${windowIsCollapsed ? ' is-collapsed' : ''}`}
              ref={windowControlsGridRef}
              style={{ gridArea: 'window_control' }}
              aria-label="Window controls grid"
            >
              <div className="window-controls window-controls-left" aria-label="Window controls left">
                <button
                  type="button"
                  className={`toggle-btn icon-btn window-control-btn dark-mode-btn${uiMode === 'dark' ? ' is-active' : ''}`}
                  title="Toggle dark mode"
                  aria-label="Toggle dark mode"
                  onClick={toggleUiMode}
                >
                  <span
                    className={`window-control-glyph fa-solid ${uiMode === 'dark' ? 'fa-sun' : 'fa-moon'}`}
                    aria-hidden="true"
                  />
                </button>

                <button
                  type="button"
                  className={`toggle-btn icon-btn window-control-btn options-btn${sidebarMode === 'options' ? ' is-active' : ''}`}
                  title="View options"
                  aria-label="View options"
                  onClick={toggleSidebarOptionsMenu}
                >
                  <span className="window-control-glyph fa-solid fa-gear" aria-hidden="true" />
                </button>
              </div>

              <AudioControls
                volume={musicVolume}
                reverbAmount={musicReverbAmount}
                reverbRoom={musicReverbRoom}
                activeSlots={musicActiveSlots}
                onActiveSlotsChange={setMusicActiveSlots}
                isOptionsOpen={sidebarMode === 'options'}
                isMiniMode={windowIsCollapsed}
                onOpenMusicOptions={() => {
                  if (sidebarMode !== 'options') setMusicAccordionNonce((n) => n + 1)
                  toggleSidebarOptionsMenu()
                }}
                onAdjustMusicVolume={(delta) => setMusicVolume((v) => clamp(v + delta, 0, 1))}
                onAdjustMusicReverb={(delta) => setMusicReverbAmount((v) => clamp(v + delta, 0, 1))}
                onAdjustMusicRoom={(delta) => setMusicReverbRoom((v) => clamp(v + delta, 0, 1))}
              />

              <div className="window-controls window-controls-right" aria-label="Window controls right">
                <div className="window-minimize-split" role="group" aria-label="Mini mode and minimize controls">
                  <button
                    type="button"
                    className="window-control-btn btn-icon window-minimize-split-btn mini-mode"
                    title={windowIsCollapsed ? 'Exit mini mode' : 'Enter mini mode'}
                    aria-label={windowIsCollapsed ? 'Exit mini mode' : 'Enter mini mode'}
                    onClick={handleWindowUtilityCollapseToggle}
                  >
                    <span className={`fa-solid ${windowIsCollapsed ? 'fa-arrows-left-right' : 'fa-caret-up'}`} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="window-control-btn btn-icon window-minimize-split-btn minimize"
                    title="Minimize"
                    aria-label="Minimize window"
                    onClick={handleWindowMinimize}
                  >
                    <span className="fa-solid fa-caret-down" aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  className="window-control-btn btn-icon maximize-btn"
                  title={windowIsMaximized ? 'Restore' : 'Maximize'}
                  aria-label={windowIsMaximized ? 'Restore window' : 'Maximize window'}
                  onClick={handleWindowToggleMaximize}
                >
                  <span
                    className={`fa-solid ${windowIsMaximized ? 'fa-down-left-and-up-right-to-center' : 'fa-up-right-and-down-left-from-center'}`}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className="window-control-btn btn-icon close-btn"
                  title="Close"
                  aria-label="Close window"
                  onClick={handleWindowClose}
                >
                  <span className="fa-solid fa-dove" aria-hidden="true" />
                </button>
              </div>
            </section>

            <EditorToolbar
              isPreviewMode={activeSection?.isPreviewMode ?? false}
              activeNoteId={activeSection?.activeNoteId ?? null}
              toggleRenderViewMode={activeSection?.toggleRenderViewMode ?? noopAsync}
              createNote={createNote}
              spellCheckEditEnabled={spellCheckEditEnabled}
              spellCheckRenderEnabled={spellCheckRenderEnabled}
              setSpellCheckRenderEnabled={setSpellCheckRenderEnabled}
              setSpellCheckEditEnabled={setSpellCheckEditEnabled}
              queueAppStateSave={queueAppStateSave}
              handleExportPdf={handleExportPdf}
              chooseExportFolder={chooseExportFolder}
              isExportingPdf={isExportingPdf}
              handleExportMd={handleExportMd}
              isExportingMd={isExportingMd}
              activeDecorationFormats={activeSection?.activeDecorationFormats ?? EMPTY_DECORATION_FORMATS}
              activeHeadingLevel={activeSection?.activeHeadingLevel ?? 0}
              isChecklistActive={activeSection?.isChecklistActive ?? false}
              isBulletedListActive={activeSection?.isBulletedListActive ?? false}
              isNumberedListActive={activeSection?.isNumberedListActive ?? false}
              isBlockquoteActive={activeSection?.isBlockquoteActive ?? false}
              isCodeBlockActive={activeSection?.isCodeBlockActive ?? false}
              isInlineCodeActive={activeSection?.isInlineCodeActive ?? false}
              applyTextDecoration={activeSection?.applyTextDecoration ?? noop}
              applyHeading={activeSection?.applyHeading ?? noop}
              toggleCurrentLineHeading={activeSection?.toggleCurrentLineHeading ?? noop}
              toggleBulletedList={activeSection?.toggleBulletedList ?? noop}
              toggleNumberedList={activeSection?.toggleNumberedList ?? noop}
              toggleChecklistList={activeSection?.toggleChecklistList ?? noop}
              toggleBlockquote={activeSection?.toggleBlockquote ?? noop}
              applyLink={activeSection?.applyLink ?? noop}
              applyInlineCode={activeSection?.applyInlineCode ?? noop}
              applyCodeBlock={activeSection?.applyCodeBlock ?? noop}
              insertHorizontalRule={activeSection?.insertHorizontalRule ?? noop}
            />

            <div className="editor-sections-row" ref={editorSectionsRowRef}>
              {editorSections.map((entry, index) => (
              <Fragment key={entry.id}>
                {index > 0 ? (
                  <div
                    className="editor-section-divider"
                    onMouseDown={handleDividerMouseDown(editorSections[index - 1].id, entry.id)}
                  />
                ) : null}
                <div
                  className="editor-section-slot"
                  style={{ flexGrow: entry.widthFraction ?? (1 / editorSections.length), flexShrink: 1, flexBasis: 0 }}
                  ref={(el) => {
                    if (el) {
                      sectionSlotElByIdRef.current.set(entry.id, el)
                    } else {
                      sectionSlotElByIdRef.current.delete(entry.id)
                    }
                  }}
                >
                <EditorSection
                  sectionId={entry.id}
                  isLeftmostSection={index === 0}
                  canCreateSection={canCreateSection}
                  onCreateSection={() => void handleCreateSection(entry.position ?? index, entry.id)}
                  onCloseSection={() => void handleCloseSection(entry.id)}
                  sectionName={entry.name}
                  onRenameSection={(name) => void handleRenameSection(entry.id, name)}
                  onFetchSwapCandidates={() => handleFetchSwapCandidates(entry.id)}
                  onSwapSection={(incomingSectionId) => void handleSwapSection(entry.id, incomingSectionId)}
                  markSectionActive={markSectionActive}
                  isSidebarVisible={isSidebarVisible}
                  toggleSidebarVisible={toggleSidebarVisible}
                  persistenceReady={persistenceReady}
                  notes={notes}
                  setNotes={setNotes}
                  notesRef={notesRef}
                  activeSectionId={activeSectionId}
                  registerSectionHandle={registerSectionHandle}
                  reportSectionHandle={reportSectionHandle}
                  isApplyingInitialViewportRef={isApplyingInitialViewportRef}
                  pendingViewportRestoreRef={pendingViewportRestoreRef}
                  externalNoteOriginalTextByIdRef={externalNoteOriginalTextByIdRef}
                  externalNoteOriginalHashByIdRef={externalNoteOriginalHashByIdRef}
                  activeNoteExternalPathRef={activeNoteExternalPathRef}
                  currentExternalNoteHash={currentExternalNoteHash}
                  setCurrentExternalNoteHash={setCurrentExternalNoteHash}
                  queueAppStateSaveStable={queueAppStateSaveStable}
                  updateActiveNoteTitlePreviewStable={updateActiveNoteTitlePreviewStable}
                  revealNoteInMenuStable={revealNoteInMenuStable}
                  writeDebugEntryStable={writeDebugEntryStable}
                  activeNoteHasDebugTagRef={activeNoteHasDebugTagRef}
                  saveSelectedNoteState={saveSelectedNoteState}
                  refreshNotes={refreshNotes}
                  noteTransitionLockRef={noteTransitionLockRef}
                  updateNoteAssignedId={updateNoteAssignedId}
                  restoredTabBarMode={restoredTabBarMode}
                  tabBarModeRef={tabBarModeRef}
                  sidebarMode={sidebarMode}
                  dateFilteredNotesRef={dateFilteredNotesRef}
                  trashFilteredNotesRef={trashFilteredNotesRef}
                  categoryTreeRef={categoryTreeRef}
                  archiveTreeRef={archiveTreeRef}
                  restoredDocumentFindCaseSensitive={restoredDocumentFindCaseSensitive}
                  documentFindCaseSensitiveRef={documentFindCaseSensitiveRef}
                  editorRuntimeMetrics={editorRuntimeMetrics}
                  viewStyle={viewStyle}
                  viewFontSize={viewFontSize}
                  viewSpacing={viewSpacing}
                  editorStageRef={editorStageRef}
                  editorFontFamily={editorFontFamily}
                  editorFontLoadVersion={editorFontLoadVersion}
                  spellCheckEditEnabled={spellCheckEditEnabled}
                  spellCheckRenderEnabled={spellCheckRenderEnabled}
                  highlightSearchColor={highlightColors.search}
                />
                </div>
              </Fragment>
              ))}
            </div>
          </div>
        </div>
        {filterColorize > 0 && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              // 50% saturation gives a GIMP-colorize-like result: strong enough to
              // be visible on neutral text colours, not so strong it oversaturates
              // already-colourful UI elements. Lightness 50% keeps the hue pure.
              background: `hsl(${filterHueRotate}deg, 50%, 50%)`,
              opacity: filterColorize,
              // 'color' blend mode takes hue+saturation from this overlay and keeps
              // only the backdrop's luminosity — unlike 'hue', it still colorizes
              // near-neutral/grey pixels (e.g. text at #222) since the saturation
              // comes entirely from the overlay rather than being multiplied by
              // the (near-zero) backdrop saturation.
              mixBlendMode: 'color',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  )
}

export default App


