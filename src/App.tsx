import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import { Editor } from './components/Editor'
import { AccordionGroup, AccordionSection } from './components/AccordionSection'
import { AudioControls } from './components/AudioControls'
import './App.css'
import { buildExportCss, type ExportViewStyle, type ExportFontSize, type ExportSpacing } from './exportStyles'
import type {
  EditorAdapter,
  EditorBindings,
  EditorSelectionChangeEvent,
  EditorSelectionState,
  EditorTextChangeEvent,
  EditorViewportChangeEvent,
  EditorViewportState,
} from './editor/EditorContract'
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
import type { TextureCacheRequest } from './shared/textures'
import {
  DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EDITOR_SPACING,
  DEFAULT_EDITOR_STYLE,
  EDITOR_FONT_SIZE_OPTIONS,
  EDITOR_SPACING_OPTIONS,
  EDITOR_STYLE_OPTIONS,
  resolveEditorFontFamily,
  resolveEditorRuntimeMetrics,
  type EditorFontSizeKey,
  type EditorSpacingKey,
  type EditorStyleKey,
} from './editor/EditorTypography'
import {
  buildDocumentFindHits,
  resolveDocumentFindDirective,
  type DocumentFindDirective,
  type DocumentFindHit,
} from './editor/FindReplaceEngine'
import {
  indentSelectionByStep,
  resolveMarkdownSelectionContext,
} from './editor/MarkdownContext'
import { resolveMarkdownEnterTransform } from './editor/EnterTransformPolicy'
import { resolveMarkdownChecklistTypeoverTransform } from './editor/ChecklistTypingTransformPolicy'
import { normalizeInternalText } from './editor/TextPolicy'
import { resolvePreviewSourceAnchorEntry } from './editor/PreviewScrollAnchor'
import { readSelectionOffsetFromClientPoint } from './editor/SelectionOffsets'
import {
  buildReleaseRampDownPlanFromCurrentParams,
  cancelNonQuantizedSmoothScroll,
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  resolveApexSpeedPxPerSecFromCurrentParams,
  getRenderScrollDynamic,
  getRenderScrollResponsiveness,
  getRenderScrollTotalTimeSec,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollSkew,
  sampleReleaseRampDownPlan,
  resolveRampCrossingTimeSecFromCurrentParams,
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
} from './textures/types'
import { TEXTURE_ALGORITHM_VERSION, TEXTURE_REPEAT_TILE_SIZE, useTextureSurface } from './textures/useTextureSurface'

const SAVE_DEBOUNCE_MS = 350
const NEW_NOTE_TEMPLATE = '# '
const FALLBACK_NEW_NOTE_TITLE = 'Untitled'
const DEBUG_TAG_NAME = 'debug'
const PROTECTED_TAGS = new Set(['archived', 'deleted', 'external', DEBUG_TAG_NAME])
const GRID_DIVIDER_PX = 8
const SIDEBAR_MIN_WIDTH_PX = 288
const TAG_INPUT_MIN_WIDTH_PX = 150
const TAG_INPUT_MAX_WIDTH_PX = 250
const SUGGESTED_MIN_WIDTH_PX = 150
const UTILITY_WIDTH_PX = 129
const APP_GRID_MIN_WIDTH_PX = SIDEBAR_MIN_WIDTH_PX + (GRID_DIVIDER_PX * 2) + TAG_INPUT_MIN_WIDTH_PX + SUGGESTED_MIN_WIDTH_PX + UTILITY_WIDTH_PX
const DEFAULT_SIDEBAR_RATIO = 0.306
const DEFAULT_TAG_SPLIT_RATIO = 0.645
const EDITOR_GLYPH_PADDING_MIN_PX = 0
const EDITOR_GLYPH_PADDING_MAX_PX = 1
const TEXTURE_GRANULARITY_MIN = 1
const TEXTURE_GRANULARITY_MAX = 20
const TEXTURE_VSTEPS_MIN = 1
const TEXTURE_VSTEPS_MAX = 20
const TEXTURE_PREVIEW_SURFACE: TextureSurfaceKey = 'appGrid'
const SCROLL_TRACK_MIN_THUMB_HEIGHT_PX = 28
const SCROLL_TRACK_EDGE_GAP_PX = 3
const NOTE_RIGHT_CLICK_HOLD_MS = 200
const NOTE_LEFT_CLICK_HOLD_MS = 200
const COLOR_BUTTON_ARM_HOLD_MS = 300
const PENDING_UPDATE_DEBOUNCE_MS = 400
const PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER = CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER
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

const BOX_HIGHLIGHT_COLOR_ORDER: HighlightColorKey[] = ['background', 'grid', 'gridOutline', 'topBackground', 'bottomBackground']
const MARKDOWN_HIGHLIGHT_COLOR_ORDER: HighlightColorKey[] = [
  'markdownHeadline',
  'markdownList',
  'markdownBlockquote',
  'markdownCode',
  'markdownChecked',
  'markdownUnchecked',
]

const HIGHLIGHT_COLOR_TITLES: Record<HighlightColorKey, string> = {
  caret: 'Caret Color',
  search: 'Search Highlight color',
  selectionEdit: 'Edit selection color',
  selectionRender: 'Render selection color',
  textBase: 'UI text base color',
  textEmbossEdit: 'Edit text embossing color',
  textEmbossRender: 'Render text embossing color',
  textEmbossUi: 'UI text embossing color',
  background: 'Default Box Background',
  topBackground: 'Upper Box Background',
  bottomBackground: 'Lower Box Background',
  gridOutline: 'Box Outline',
  grid: 'Box Grid',
  base: 'App Base Background',
  inputFields: 'App (Input) Fields',
  appButtons: 'App Buttons',
  markdownHeadline: 'Markdown heading color',
  markdownList: 'Markdown list color',
  markdownBlockquote: 'Markdown blockquote color',
  markdownCode: 'Markdown code fence color',
  markdownChecked: 'Markdown checked task color',
  markdownUnchecked: 'Markdown unchecked task color',
}

const HIGHLIGHT_COLOR_ICONS: Record<HighlightColorKey, string> = {
  caret: 'fa-solid fa-i',
  search: 'fa-solid fa-magnifying-glass',
  selectionEdit: 'fa-solid fa-expand',
  selectionRender: 'fa-solid fa-expand',
  textBase: 'fa-solid fa-icons',
  textEmbossEdit: 'fa-solid fa-bacon',
  textEmbossRender: 'fa-solid fa-bacon',
  textEmbossUi: 'fa-solid fa-bacon',
  background: 'fa-solid fa-square',
  topBackground: 'fa-solid fa-square-caret-up',
  bottomBackground: 'fa-solid fa-square-caret-down',
  gridOutline: 'fa-regular fa-square',
  grid: 'fa-solid fa-border-all',
  base: 'fa-solid fa-display',
  inputFields: 'fa-solid fa-pen-to-square',
  appButtons: 'fa-solid fa-hockey-puck',
  markdownHeadline: 'fa-solid fa-heading',
  markdownList: 'fa-solid fa-list-ul',
  markdownBlockquote: 'fa-solid fa-quote-left',
  markdownCode: 'fa-solid fa-code',
  markdownChecked: 'fa-solid fa-square-check',
  markdownUnchecked: 'fa-regular fa-square',
}

// Icons for the 5 factory presets per mode, indexed by abs(id) - 1 (0-based).
const LIGHT_PRESET_ICONS: string[] = [
  'fa-solid fa-sun',
  'fa-solid fa-film',
  'fa-solid fa-droplet',
  'fa-solid fa-feather',
  'fa-regular fa-file',
]

const DARK_PRESET_ICONS: string[] = [
  'fa-solid fa-moon',
  'fa-solid fa-water',
  'fa-solid fa-mountain',
  'fa-solid fa-meteor',
  'fa-solid fa-fire',
]

// Names for the 5 factory presets per mode, indexed by abs(id) - 1 (0-based).
const LIGHT_PRESET_THEMES: string[] = [
  'Light (Default)',
  'Faded Film',
  'Droplet',
  'Feather',
  'Paper',
]

const DARK_PRESET_THEMES: string[] = [
  'Dark (Default)',
  'Flow',
  'Mountain',
  'Meteor',
  'Fire',
]

const TEXTURE_SURFACE_TITLES: Record<TextureSurfaceKey, string> = {
  appGrid: 'App grid texture color',
  sidebarContent: 'Sidebar texture color',
  editorEditText: 'Edit text panel texture color',
  editorRenderText: 'Render text panel texture color',
}

const TEXTURE_SURFACE_ICONS: Record<TextureSurfaceKey, string> = {
  appGrid: 'fa-solid fa-table-columns',
  sidebarContent: 'fa-solid fa-list',
  editorEditText: 'fa-solid fa-align-justify',
  editorRenderText: 'fa-solid fa-align-justify',
}

type SidebarMode = 'date' | 'category' | 'archive' | 'trash' | 'find' | 'options'
type NoteArmedAction = 'archive' | 'deletion' | 'save' | 'close'
type ProtectedQuickReleaseAction = 'remove-archived' | 'remove-deleted' | null
type TextDecorationFormat = 'bold' | 'italic' | 'strikethrough'
type ViewStyleKey = 'modern' | 'narrow' | 'cute' | 'xkcd' | 'print'
type ViewSizeKey = 'xs' | 's' | 'm' | 'l' | 'xl'
type ViewSpacingKey = 'tight' | 'compact' | 'cozy' | 'wide'
type HighlightColorKey =
  | 'caret'
  | 'search'
  | 'selectionEdit'
  | 'selectionRender'
  | 'textBase'
  | 'textEmbossEdit'
  | 'textEmbossRender'
  | 'textEmbossUi'
  | 'background'
  | 'topBackground'
  | 'bottomBackground'
  | 'gridOutline'
  | 'grid'
  | 'base'
  | 'inputFields'
  | 'appButtons'
  | 'markdownHeadline'
  | 'markdownList'
  | 'markdownBlockquote'
  | 'markdownCode'
  | 'markdownChecked'
  | 'markdownUnchecked'

type EditorTextColorTargetKey = 'editorEditText' | 'editorRenderText'

type HighlightColors = Record<HighlightColorKey, string>

type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
}

type HsvaColor = {
  h: number
  s: number
  v: number
  a: number
}

type HsvaControlKey = 'h' | 's' | 'v' | 'a'
const GLAZE_RADIAL_CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'] as const

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


type EditRestoreSnapshot = {
  noteId: string
  collapsedSelection: EditorSelectionState
  fullSelection: EditorSelectionState
  viewport: PersistedViewportState
  sourceAnchorLine?: number
  sourceAnchorText?: string | null
}

type EditViewportTelemetry = {
  scrollTopPx: number
  scrollHeightPx: number
  clientHeightPx: number
}

const TEXT_DECORATION_MARKERS: Record<TextDecorationFormat, { open: string; close: string }> = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  strikethrough: { open: '~~', close: '~~' },
}

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

function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

function isProtectedTagName(name: string): boolean {
  return PROTECTED_TAGS.has(normalizeTagName(name))
}

function isExternalTagName(name: string): boolean {
  return normalizeTagName(name) === 'external'
}

function sanitizeClipboardTitle(raw: string): string {
  const normalized = normalizeInternalText(raw)
  const firstLine = normalized.split('\n').map((line) => line.trim()).find((line) => line.length > 0)
  if (!firstLine) return FALLBACK_NEW_NOTE_TITLE

  const withoutHeadingPrefix = firstLine.replace(/^#+\s*/, '').trim()
  return withoutHeadingPrefix || FALLBACK_NEW_NOTE_TITLE
}

function clampColorChannel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

function clampAlphaChannel(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

function parseCssColorToRgba(color: string): RgbaColor | null {
  const raw = color.trim()
  if (!raw) return null

  const hexMatch = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  if (hexMatch) {
    const value = hexMatch[1]
    if (value.length === 3 || value.length === 4) {
      const r = Number.parseInt(value[0] + value[0], 16)
      const g = Number.parseInt(value[1] + value[1], 16)
      const b = Number.parseInt(value[2] + value[2], 16)
      const a = value.length === 4 ? Number.parseInt(value[3] + value[3], 16) / 255 : 1
      return { r, g, b, a }
    }

    const r = Number.parseInt(value.slice(0, 2), 16)
    const g = Number.parseInt(value.slice(2, 4), 16)
    const b = Number.parseInt(value.slice(4, 6), 16)
    const a = value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }

  const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/i)
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => part.trim())
    if (parts.length !== 3 && parts.length !== 4) return null

    const r = clampColorChannel(Number.parseFloat(parts[0]))
    const g = clampColorChannel(Number.parseFloat(parts[1]))
    const b = clampColorChannel(Number.parseFloat(parts[2]))
    const a = parts.length === 4 ? clampAlphaChannel(Number.parseFloat(parts[3])) : 1
    return { r, g, b, a }
  }

  return null
}

function rgbaToCssColor(color: RgbaColor): string {
  const alpha = Number(clampAlphaChannel(color.a).toFixed(3))
  return `rgba(${clampColorChannel(color.r)}, ${clampColorChannel(color.g)}, ${clampColorChannel(color.b)}, ${alpha})`
}

function rgbaToHex(color: RgbaColor): string {
  const r = clampColorChannel(color.r).toString(16).padStart(2, '0').toUpperCase()
  const g = clampColorChannel(color.g).toString(16).padStart(2, '0').toUpperCase()
  const b = clampColorChannel(color.b).toString(16).padStart(2, '0').toUpperCase()
  const a = clampColorChannel(Math.round(clampAlphaChannel(color.a) * 255)).toString(16).padStart(2, '0').toUpperCase()
  return `#${r}${g}${b}${a}`
}

function invertRgbaColor(color: RgbaColor, alphaScale = 1): RgbaColor {
  return {
    r: 255 - clampColorChannel(color.r),
    g: 255 - clampColorChannel(color.g),
    b: 255 - clampColorChannel(color.b),
    a: clamp(color.a * alphaScale, 0, 1),
  }
}

function rgbaToHsva(color: RgbaColor): HsvaColor {
  const r = clampColorChannel(color.r) / 255
  const g = clampColorChannel(color.g) / 255
  const b = clampColorChannel(color.b) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  const s = max === 0 ? 0 : delta / max
  const v = max

  return {
    h,
    s,
    v,
    a: clampAlphaChannel(color.a),
  }
}

function hsvaToRgba(color: HsvaColor): RgbaColor {
  const h = ((color.h % 360) + 360) % 360
  const s = Math.max(0, Math.min(1, color.s))
  const v = Math.max(0, Math.min(1, color.v))

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let rPrime = 0
  let gPrime = 0
  let bPrime = 0

  if (h < 60) {
    rPrime = c
    gPrime = x
  } else if (h < 120) {
    rPrime = x
    gPrime = c
  } else if (h < 180) {
    gPrime = c
    bPrime = x
  } else if (h < 240) {
    gPrime = x
    bPrime = c
  } else if (h < 300) {
    rPrime = x
    bPrime = c
  } else {
    rPrime = c
    bPrime = x
  }

  return {
    r: clampColorChannel((rPrime + m) * 255),
    g: clampColorChannel((gPrime + m) * 255),
    b: clampColorChannel((bPrime + m) * 255),
    a: clampAlphaChannel(color.a),
  }
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

function isSafePreviewHref(href: string | undefined): boolean {
  if (!href) return false
  try {
    const parsed = new URL(href)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' || parsed.protocol === 'tel:'
  } catch {
    return false
  }
}

function isSafePreviewImageSrc(src: string | undefined): boolean {
  if (!src) return false
  if (src.startsWith('data:')) return true
  if (src.startsWith('file:')) return true
  try {
    const parsed = new URL(src)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// Stable references for ReactMarkdown so per-frame App re-renders (e.g. from
// scroll-driven thumb state updates) don't force a full markdown reconciliation.
const PREVIEW_MARKDOWN_REMARK_PLUGINS = [remarkGfm]

const PREVIEW_MARKDOWN_COMPONENTS = {
  a: ({ children, href }: { children?: ReactNode; href?: string }) => {
    const normalizedHref = typeof href === 'string' ? href : undefined
    const isLiteralHrefChild =
      normalizedHref !== undefined &&
      typeof children === 'string' &&
      children.trim() === normalizedHref.trim()

    if (isLiteralHrefChild) {
      return <span>{children}</span>
    }

    if (isSafePreviewHref(normalizedHref)) {
      return <a href={normalizedHref} target="_blank" rel="noopener noreferrer">{children}</a>
    }

    return <span>{children}</span>
  },
  img: ({ src, alt }: { src?: string; alt?: string }) => {
    const normalizedSrc = typeof src === 'string' ? src : undefined
    if (isSafePreviewImageSrc(normalizedSrc)) {
      return <img src={normalizedSrc} alt={alt ?? ''} />
    }
    return <span>{alt ?? 'Image'}</span>
  },
  input: ({ checked, type, className }: { checked?: boolean; type?: string; className?: string }) => {
    if (type !== 'checkbox') {
      return null
    }

    const mergedClassName = [
      className,
      'markdown-task-checkbox-icon',
      checked ? 'markdown-task-checkbox-checked' : 'markdown-task-checkbox-unchecked',
    ]
      .filter((value) => typeof value === 'string' && value.length > 0)
      .join(' ')

    return (
      <span className={mergedClassName} aria-hidden="true">
        {checked ? '☑' : '☐'}
      </span>
    )
  },
} as const

function createPreviewSearchHighlightRehypePlugin(needle: string, isCaseSensitive: boolean) {
  const normalizedNeedle = isCaseSensitive ? needle : needle.toLocaleLowerCase()
  if (!normalizedNeedle) {
    return () => () => {}
  }

  return () => {
    return (tree: any) => {
      const transformNode = (node: any, parent: any, index: number | null) => {
        if (!node || typeof node !== 'object') return

        if (node.type === 'element') {
          const className = node.properties?.className
          const hasSearchHitClass = Array.isArray(className)
            ? className.includes('search-hit')
            : className === 'search-hit'
          if (hasSearchHitClass) return
        }

        if (node.type === 'text' && typeof node.value === 'string') {
          const textValue = node.value
          const haystack = isCaseSensitive ? textValue : textValue.toLocaleLowerCase()
          const needleLength = normalizedNeedle.length

          let cursor = 0
          const replacements: any[] = []
          let matchIndex = haystack.indexOf(normalizedNeedle, cursor)
          while (matchIndex >= 0) {
            if (matchIndex > cursor) {
              replacements.push({ type: 'text', value: textValue.slice(cursor, matchIndex) })
            }
            replacements.push({
              type: 'element',
              tagName: 'span',
              properties: { className: ['search-hit'] },
              children: [{ type: 'text', value: textValue.slice(matchIndex, matchIndex + needleLength) }],
            })
            cursor = matchIndex + needleLength
            matchIndex = haystack.indexOf(normalizedNeedle, cursor)
          }

          if (replacements.length > 0) {
            if (cursor < textValue.length) {
              replacements.push({ type: 'text', value: textValue.slice(cursor) })
            }
            if (parent && Array.isArray(parent.children) && typeof index === 'number') {
              parent.children.splice(index, 1, ...replacements)
            }
            return
          }
        }

        if (Array.isArray(node.children)) {
          for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
            transformNode(node.children[childIndex], node, childIndex)
          }
        }
      }

      transformNode(tree, null, null)
    }
  }
}

function titleFromFileBasename(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, '').trim()
  if (!withoutExtension) return FALLBACK_NEW_NOTE_TITLE

  const normalized = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized || FALLBACK_NEW_NOTE_TITLE
}

function isSameNoteSummary(a: NoteSummary, b: NoteSummary): boolean {
  return (
    a.id === b.id &&
    a.fileName === b.fileName &&
    a.title === b.title &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index]) &&
    a.createdAtMs === b.createdAtMs &&
    a.updatedAtMs === b.updatedAtMs &&
    a.sizeBytes === b.sizeBytes &&
    Boolean(a.hasUnsavedChanges) === Boolean(b.hasUnsavedChanges)
  )
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

function resolveSourceAnchorFromEditState(params: {
  text: string
  lineHeightPx: number
  telemetry?: EditViewportTelemetry | null
  viewport?: PersistedViewportState | null
}): { sourceAnchorLine: number; sourceAnchorText: string | null } {
  const { text, lineHeightPx, telemetry, viewport } = params
  const lines = text.split('\n')
  const safeLineHeight = Math.max(1, lineHeightPx)

  const editorScroller = document.querySelector<HTMLElement>('.editor-stage .measly-custom-scrollbar')
  const editorRoot = document.querySelector<HTMLElement>('.editor-stage .editor-text[contenteditable="true"]')

  if (editorScroller && editorRoot && document.body.contains(editorRoot)) {
    const scrollerRect = editorScroller.getBoundingClientRect()
    const rootRect = editorRoot.getBoundingClientRect()
    const topBoundaryPx = Math.max(0, Math.round((viewport?.topBoundaryLines ?? 0) * safeLineHeight))
    const sampleX = Math.max(scrollerRect.left + 4, rootRect.left + 4)
    const sampleY = Math.min(
      scrollerRect.bottom - 1,
      scrollerRect.top + topBoundaryPx + Math.max(1, Math.round(safeLineHeight / 2)),
    )
    const anchorOffset = readSelectionOffsetFromClientPoint(
      editorRoot,
      sampleX,
      sampleY,
      text.length,
      0,
    )
    const prefix = text.slice(0, Math.max(0, Math.min(text.length, anchorOffset)))
    const sourceAnchorLine = prefix.length === 0 ? 0 : (prefix.match(/\n/g)?.length ?? 0)
    const clampedLine = Math.min(Math.max(0, sourceAnchorLine), Math.max(0, lines.length - 1))

    return {
      sourceAnchorLine: clampedLine,
      sourceAnchorText: buildSourceAnchorTextSnippet(lines, clampedLine),
    }
  }

  const anchorLine = viewport
    ? Math.max(0, Math.round(viewport.scrollTopLines) + Math.round(viewport.topBoundaryLines))
    :
    (telemetry ? Math.max(0, Math.floor(telemetry.scrollTopPx / safeLineHeight)) : 0)
  const clampedLine = Math.min(Math.max(0, anchorLine), Math.max(0, lines.length - 1))

  const sourceAnchorText = buildSourceAnchorTextSnippet(lines, clampedLine)

  return {
    sourceAnchorLine: clampedLine,
    sourceAnchorText,
  }
}

function buildSourceAnchorTextSnippet(lines: string[], anchorLine: number): string | null {
  const startLine = Math.max(0, anchorLine - 12)
  const endLine = Math.min(lines.length - 1, anchorLine + 12)
  const snippet = lines.slice(startLine, endLine + 1).join('\n').trim()
  return snippet.length === 0 ? null : snippet.slice(0, 4096)
}

function resolveEditSourceAnchorLineFromUiState(text: string, uiState: { sourceAnchorLine?: unknown; sourceAnchorText?: unknown } | null | undefined): number | null {
  const totalLines = Math.max(1, text.split('\n').length)
  const sourceAnchorLine = typeof uiState?.sourceAnchorLine === 'number' && Number.isFinite(uiState.sourceAnchorLine)
    ? Math.max(0, Math.round(uiState.sourceAnchorLine))
    : null

  if (sourceAnchorLine !== null) {
    return Math.min(sourceAnchorLine, totalLines - 1)
  }

  return null
}

function findPreviewSourceAnchorElement(container: HTMLElement, sourceLine: number): HTMLElement | null {
  const anchors = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line-start], [data-source-line]'))
  if (anchors.length === 0) {
    return null
  }

  type AnchorEntry = { element: HTMLElement; tagName: string; line: number; lineStart: number; lineEnd: number; text: string | null }
  const entries: AnchorEntry[] = []

  for (const element of anchors) {
    const startValue = Number(element.dataset.sourceLineStart)
    const endValue = Number(element.dataset.sourceLineEnd)
    const fallbackStartValue = Number(element.dataset.sourceLine)
    const lineStart = Number.isFinite(startValue)
      ? Math.max(0, Math.round(startValue))
      : Number.isFinite(fallbackStartValue)
        ? Math.max(0, Math.round(fallbackStartValue))
        : null
    const lineEnd = Number.isFinite(endValue)
      ? Math.max(0, Math.round(endValue))
      : lineStart

    if (lineStart === null) continue

    entries.push({
      element,
      tagName: element.tagName,
      line: lineStart,
      lineStart,
      lineEnd: lineEnd ?? lineStart,
      text: element.textContent?.trim() ?? null,
    })
  }

  if (entries.length === 0) return null

  const resolvedEntry = resolvePreviewSourceAnchorEntry(entries, sourceLine)
  if (!resolvedEntry) {
    return null
  }

  return resolvedEntry.element
}

function createPreviewSourceAnchorRehypePlugin() {
  return () => {
    return (tree: any) => {
      const sourceAnchorTags = new Set([
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'blockquote', 'pre', 'table', 'hr', 'li',
      ])

      visit(tree, 'element', (node: any) => {
        if (typeof node.tagName !== 'string') return
        if (!sourceAnchorTags.has(node.tagName)) return
        const startLine = node.position?.start?.line
        const endLine = node.position?.end?.line
        if (typeof startLine !== 'number' || Number.isNaN(startLine)) return

        const normalizedStartLine = Math.max(0, Math.round(startLine - 1))
        const normalizedEndLine = typeof endLine === 'number' && !Number.isNaN(endLine)
          ? Math.max(normalizedStartLine, Math.round(endLine - 1))
          : normalizedStartLine

        node.properties = node.properties ?? {}
        if (node.properties['data-source-line'] === undefined) {
          node.properties['data-source-line'] = String(normalizedStartLine)
        }
        if (node.properties['data-source-line-start'] === undefined) {
          node.properties['data-source-line-start'] = String(normalizedStartLine)
        }
        if (node.properties['data-source-line-end'] === undefined) {
          node.properties['data-source-line-end'] = String(normalizedEndLine)
        }
      })
    }
  }
}

// Converts a pixel scroll position (e.g. from the legacy per-note SQLite
// scrollTop column) to an integer line count for storage in
// PersistedViewportState/EditRestoreSnapshot.viewport.
function scrollTopPxToLines(scrollTopPx: number, lineHeightPx: number): number {
  const safeLineHeight = Math.max(1, lineHeightPx)
  return Math.max(0, Math.round(scrollTopPx / safeLineHeight))
}

// Converts an integer line count back to a pixel scroll position, e.g. for
// writing back to the legacy per-note SQLite scrollTop column.
function scrollTopLinesToPx(scrollTopLines: number, lineHeightPx: number): number {
  const safeLineHeight = Math.max(1, lineHeightPx)
  return Math.max(0, Math.round(scrollTopLines)) * safeLineHeight
}

function buildEditRestoreSnapshotFromUiState(params: {
  noteId: string
  text: string
  uiState: { scrollTop?: unknown; cursorPos?: unknown; sourceAnchorLine?: unknown; sourceAnchorText?: unknown } | null | undefined
  fallbackViewport: PersistedViewportState | null
  lineHeightPx: number
  overrideCursorPos?: number
}): EditRestoreSnapshot {
  const { noteId, text, uiState, fallbackViewport, lineHeightPx, overrideCursorPos } = params
  // Default to 0 lines for both boundaries when nothing is stored (per spec:
  // a fresh/never-dragged note has no reserved top/bottom zones).
  const fallbackTopBoundaryLines = fallbackViewport?.topBoundaryLines ?? 0
  const fallbackBottomBoundaryLines = fallbackViewport?.bottomBoundaryLines ?? 0
  const selectionTextLength = Math.max(0, text.length)
  const persistedCursor =
    typeof overrideCursorPos === 'number' && Number.isFinite(overrideCursorPos)
      ? Math.max(0, Math.min(Math.round(overrideCursorPos), selectionTextLength))
      : typeof uiState?.cursorPos === 'number' && Number.isFinite(uiState.cursorPos)
        ? Math.max(0, Math.min(Math.round(uiState.cursorPos), selectionTextLength))
        : 0
  const anchorLine = resolveEditSourceAnchorLineFromUiState(text, uiState)
  const storedScrollTopLines =
    anchorLine !== null
      ? Math.max(0, anchorLine - fallbackTopBoundaryLines)
      : typeof uiState?.scrollTop === 'number' && Number.isFinite(uiState.scrollTop)
        ? scrollTopPxToLines(Math.max(0, uiState.scrollTop), lineHeightPx)
        : Math.max(0, Math.round(fallbackViewport?.scrollTopLines ?? 0))

  const collapsedSelection: EditorSelectionState = {
    anchor: persistedCursor,
    focus: persistedCursor,
    start: persistedCursor,
    end: persistedCursor,
    isCollapsed: true,
  }

  return {
    noteId,
    collapsedSelection,
    fullSelection: collapsedSelection,
    viewport: {
      topBoundaryLines: fallbackTopBoundaryLines,
      bottomBoundaryLines: fallbackBottomBoundaryLines,
      scrollTopLines: storedScrollTopLines,
    },
    sourceAnchorText: typeof uiState?.sourceAnchorText === 'string' ? uiState.sourceAnchorText : null,
    ...(anchorLine !== null ? { sourceAnchorLine: anchorLine } : {}),
  }
}

function formatCompactSettingNumber(value: number, step: number): string {
  const normalizedStep = String(step)
  const decimalIndex = normalizedStep.indexOf('.')
  const decimalPlaces = decimalIndex >= 0 ? normalizedStep.length - decimalIndex - 1 : 0
  return value.toFixed(decimalPlaces).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

type CompactScrollbarSliderProps = {
  id: string
  value: number
  min: number
  max: number
  step: number
  trackLabel: string
  ariaLabel: string
  reverseScale?: boolean
  onCommit: (value: number) => void
}

function CompactScrollbarSlider({
  id,
  value,
  min,
  max,
  step,
  trackLabel,
  ariaLabel,
  reverseScale = false,
  onCommit,
}: CompactScrollbarSliderProps) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const valueSpan = Math.max(max - min, Number.EPSILON)

  const valueToRatio = useCallback((nextValue: number) => {
    const normalized = clamp((nextValue - min) / valueSpan, 0, 1)
    return reverseScale ? 1 - normalized : normalized
  }, [min, reverseScale, valueSpan])

  const ratioToValue = useCallback((ratioFromLeft: number) => {
    const normalized = reverseScale ? 1 - ratioFromLeft : ratioFromLeft
    return min + (clamp(normalized, 0, 1) * valueSpan)
  }, [min, reverseScale, valueSpan])

  const ratio = valueToRatio(value)

  const snapValue = useCallback((nextValue: number) => {
    const steps = Math.round((nextValue - min) / step)
    return clamp(min + (steps * step), min, max)
  }, [max, min, step])

  const applyPointerValue = useCallback((clientX: number) => {
    const rail = railRef.current
    if (!rail) return

    const rect = rail.getBoundingClientRect()
    if (rect.width <= 0) return

    const styles = getComputedStyle(rail)
    const gap = Number.parseFloat(styles.getPropertyValue('--canonical-scroll-handle-gap')) || 3
    const baseThumbSize = Number.parseFloat(styles.getPropertyValue('--canonical-scroll-handle-thickness')) || 10
    const thumbSize = baseThumbSize + 2
    const thumbInset = gap - 1
    const startX = rect.left + thumbInset + (thumbSize / 2)
    const travel = Math.max(1, rect.width - (thumbInset * 2) - thumbSize)
    const nextRatio = clamp((clientX - startX) / travel, 0, 1)
    onCommit(snapValue(ratioToValue(nextRatio)))
  }, [onCommit, ratioToValue, snapValue])

  const nudgeBy = useCallback((delta: number) => {
    onCommit(snapValue(value + delta))
  }, [onCommit, snapValue, value])

  return (
    <div
      id={id}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(formatCompactSettingNumber(value, step))}
      className={`utility-setting-scrollbar-shell${isDragging ? ' is-dragging' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault()
          nudgeBy(-step)
          return
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault()
          nudgeBy(step)
          return
        }
        if (event.key === 'PageUp') {
          event.preventDefault()
          nudgeBy(step * 10)
          return
        }
        if (event.key === 'PageDown') {
          event.preventDefault()
          nudgeBy(-(step * 10))
          return
        }
        if (event.key === 'Home') {
          event.preventDefault()
          onCommit(reverseScale ? max : min)
          return
        }
        if (event.key === 'End') {
          event.preventDefault()
          onCommit(reverseScale ? min : max)
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setIsDragging(true)
        applyPointerValue(event.clientX)
      }}
      onPointerMove={(event) => {
        if (!isDragging) return
        applyPointerValue(event.clientX)
      }}
      onPointerUp={(event) => {
        if (!isDragging) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        setIsDragging(false)
      }}
      onPointerCancel={() => setIsDragging(false)}
    >
      <div className="utility-setting-scrollbar-rail" ref={railRef} aria-hidden="true">
        <span className="utility-setting-scrollbar-track-label">{trackLabel}</span>
        <div
          className="utility-setting-scrollbar-thumb"
          style={{
            left: `calc((var(--canonical-scroll-handle-gap) - 1px) + (${ratio} * (100% - ((var(--canonical-scroll-handle-gap) - 1px) * 2) - (var(--canonical-scroll-handle-thickness) + 2px))))`,
          }}
        />
      </div>
    </div>
  )
}

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
    renderScrollDynamic: roundForSignature(clamp(toFiniteNumber(source.renderScrollDynamic, getRenderScrollDynamic()), 0.1, 5)),
    renderScrollResponsiveness: roundForSignature(clamp(toFiniteNumber(source.renderScrollResponsiveness, getRenderScrollResponsiveness()), 0.1, 5)),
    renderScrollTotalTimeSec: roundForSignature(clamp(toFiniteNumber(source.renderScrollTotalTimeSec, getRenderScrollTotalTimeSec()), 0, 2)),
    renderScrollMaxSpeedPxPerSec: Math.round(clamp(toFiniteNumber(source.renderScrollMaxSpeedPxPerSec, getRenderScrollMaxSpeedPxPerSec()), 1000, 100000)),
    renderScrollSkew: roundForSignature(clamp(toFiniteNumber(source.renderScrollSkew, getRenderScrollSkew()), RENDER_SCROLL_SKEW_MIN, RENDER_SCROLL_SKEW_MAX)),
    audioKeyVolume: clamp(toFiniteNumber(source.audioKeyVolume, 1), 0, 1),
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
    if (window.measlyNotes) {
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
  onArmedLeftClick: (noteId: string) => void
  armedAction?: NoteArmedAction | null
  onLeftPressStart: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onLeftPressEnd: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onRightPressStart: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onRightPressEnd: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onArmHoverLeave: (noteId: string) => void
  variant?: 'default' | 'tree'
}

const NoteListItem = memo(function NoteListItem({
  note,
  isActive,
  isModified = false,
  onSelect,
  onArmedLeftClick,
  armedAction = null,
  onLeftPressStart,
  onLeftPressEnd,
  onRightPressStart,
  onRightPressEnd,
  onArmHoverLeave,
  variant = 'default',
}: NoteListItemProps) {
  const isTreeVariant = variant === 'tree'
  const createdDate = isTreeVariant ? '' : formatCreatedDate(note.createdAtMs)

  const handleSelect = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (armedAction) {
      event.preventDefault()
      event.stopPropagation()
      onArmedLeftClick(note.id)
      return
    }

    onSelect(note.id)
  }, [armedAction, note.id, onArmedLeftClick, onSelect])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(note.id)
    }
  }, [note.id, onSelect])

  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button === 2) {
      event.preventDefault()
      event.stopPropagation()
      onRightPressStart(note.id, event)
      return
    }

    if (event.button === 0) {
      onLeftPressStart(note.id, event)
    }
  }, [note.id, onLeftPressStart, onRightPressStart])

  const handleMouseUp = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button === 2) {
      event.preventDefault()
      event.stopPropagation()
      onRightPressEnd(note.id, event)
      return
    }

    if (event.button === 0) {
      onLeftPressEnd(note.id, event)
    }
  }, [note.id, onLeftPressEnd, onRightPressEnd])

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleMouseLeave = useCallback(() => {
    onArmHoverLeave(note.id)
  }, [note.id, onArmHoverLeave])

  const displayTitle = isExternalNote(note) ? note.fileName : note.title

  return (
    <div
      className={`note-list-item${isActive ? ' is-active' : ''}${isTreeVariant ? ' is-tree-card' : ''}${isModified ? ' is-modified' : ''}${isExternalNote(note) ? ' is-external' : ''}${armedAction === 'archive' ? ' is-armed-for-archiving' : ''}${armedAction === 'deletion' ? ' is-armed-for-deletion' : ''}${armedAction === 'save' ? ' is-armed-for-saving' : ''}${armedAction === 'close' ? ' is-armed-for-closing' : ''}`}
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
      <div className="note-list-content">
        <div className="note-list-title">{displayTitle || 'Untitled'}</div>
        {isTreeVariant ? null : (
          <div className="note-list-meta-row">
            <span className="note-list-meta-left">{createdDate}</span>
            <span className="note-list-meta-right">{formatModifiedDate(note.updatedAtMs)}</span>
          </div>
        )}
      </div>
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
  onArmedLeftClick: (noteId: string) => void
  armedNoteActionById: Map<string, NoteArmedAction>
  onLeftPressStart: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onLeftPressEnd: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onNoteRightPressStart: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onNoteRightPressEnd: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onNoteArmHoverLeave: (noteId: string) => void
}

const CategoryTreeView = memo(function CategoryTreeView({
  groups,
  activeNoteId,
  persistedCollapsedPrimary,
  persistedCollapsedSecondary,
  focusNoteRequestKey,
  onCollapseChange,
  onSelect,
  onArmedLeftClick,
  armedNoteActionById,
  onLeftPressStart,
  onLeftPressEnd,
  onNoteRightPressStart,
  onNoteRightPressEnd,
  onNoteArmHoverLeave,
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
                      onArmedLeftClick={onArmedLeftClick}
                      armedAction={armedNoteActionById.get(note.id) ?? null}
                      onLeftPressStart={onLeftPressStart}
                      onLeftPressEnd={onLeftPressEnd}
                      onRightPressStart={onNoteRightPressStart}
                      onRightPressEnd={onNoteRightPressEnd}
                      onArmHoverLeave={onNoteArmHoverLeave}
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

function isArchivedNote(note: NoteSummary): boolean {
  return note.tags.includes('archived')
}

function isDeletedNote(note: NoteSummary): boolean {
  return note.tags.includes('deleted')
}

function isExternalNote(note: NoteSummary): boolean {
  return note.tags.some((tag) => isExternalTagName(tag))
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function matchesSearchQuery(note: NoteSummary, query: string, isCaseSensitive: boolean): boolean {
  const trimmed = query.trim()
  const normalized = isCaseSensitive ? trimmed : trimmed.toLowerCase()
  if (!normalized) return true

  if (trimmed.startsWith('#')) {
    const rawTagQuery = trimmed.slice(1).trim()
    const tagQuery = isCaseSensitive ? rawTagQuery : rawTagQuery.toLowerCase()
    if (!tagQuery) return true
    return note.tags.some((tag) => {
      const comparableTag = isCaseSensitive ? tag : tag.toLowerCase()
      return comparableTag.includes(tagQuery)
    })
  }

  const title = isCaseSensitive ? note.title : note.title.toLowerCase()
  const fileName = isCaseSensitive ? note.fileName : note.fileName.toLowerCase()

  return (
    title.includes(normalized) ||
    fileName.includes(normalized) ||
    note.tags.some((tag) => {
      const comparableTag = isCaseSensitive ? tag : tag.toLowerCase()
      return comparableTag.includes(normalized)
    })
  )
}

async function hashNormalizedText(text: string): Promise<string> {
  const normalized = normalizeInternalText(text)
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function App() {
  const adapterRef = useRef<EditorAdapter | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const utilityGridRef = useRef<HTMLElement | null>(null)
  const sidebarContentRef = useRef<HTMLDivElement | null>(null)
  const optionsContentRef = useRef<HTMLDivElement | null>(null)
  const editorStageRef = useRef<HTMLDivElement | null>(null)
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null)
  const tagInputRef = useRef<HTMLInputElement | null>(null)
  const pageJumpInputRef = useRef<HTMLInputElement | null>(null)
  const textureSeedInputRef = useRef<HTMLInputElement | null>(null)
  const glazeLinearSeedInputRef = useRef<HTMLInputElement | null>(null)
  const glazeRadialSeedInputRef = useRef<HTMLInputElement | null>(null)
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const notesRef = useRef<NoteSummary[]>([])

  useEffect(() => {
    notesRef.current = notes
  }, [notes])
  const [tagInputValue, setTagInputValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchQueryCaseSensitive, setIsSearchQueryCaseSensitive] = useState(false)
  const [documentFindQuery, setDocumentFindQuery] = useState('')
  const [isDocumentFindCaseSensitive, setIsDocumentFindCaseSensitive] = useState(false)
  // Terminology convention: false = edit mode, true = render view.
  const [isPreviewMode, setIsPreviewMode] = useState(false)
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
  const [editorFontLoadVersion, setEditorFontLoadVersion] = useState(0)
  const [isTagMutationPending, setIsTagMutationPending] = useState(false)
  const [deleteArmedTagName, setDeleteArmedTagName] = useState<string | null>(null)
  const [deleteArmedCustomLoadoutId, setDeleteArmedCustomLoadoutId] = useState<number | null>(null)
  const [isCaretSuspended, setIsCaretSuspended] = useState(false)
  const [renamingTagName, setRenamingTagName] = useState<string | null>(null)
  const [draggedTagIndex, setDraggedTagIndex] = useState<number | null>(null)
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
  const [editorTextVersion, setEditorTextVersion] = useState(0)
  const [scrollbarHostEl, setScrollbarHostEl] = useState<HTMLDivElement | null>(null)
  const [sidebarTreeScrollerEl, setSidebarTreeScrollerEl] = useState<HTMLDivElement | null>(null)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [activeNoteText, setActiveNoteText] = useState('')
  const activeNoteExternalPathRef = useRef<string | null>(null)
  const [currentExternalNoteHash, setCurrentExternalNoteHash] = useState<string | null>(null)
  const [editorSelection, setEditorSelection] = useState<EditorSelectionState>({
    anchor: 0,
    focus: 0,
    start: 0,
    end: 0,
    isCollapsed: true,
  })
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [appShellWidthPx, setAppShellWidthPx] = useState(APP_GRID_MIN_WIDTH_PX)
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
  const [armedColorSource, setArmedColorSource] = useState<ColorArmSource>({ kind: 'active-color' })
  const [activeColorHsva, setActiveColorHsva] = useState<HsvaColor>(() => {
    const seed = parseCssColorToRgba(DEFAULT_HIGHLIGHT_COLORS.caret) ?? { r: 120, g: 115, b: 112, a: 0.8 }
    return rgbaToHsva(seed)
  })
  const [hsvaDragState, setHsvaDragState] = useState<HsvaDragState | null>(null)
  const [textureControlDragState, setTextureControlDragState] = useState<TextureControlDragState | null>(null)
  const colorArmTimerRef = useRef<number | null>(null)
  const pendingUpdateDebounceRef = useRef<number | null>(null)
  const pendingSaveTextRef = useRef<string | null>(null)
  const latestEditorTextRef = useRef('')
  const lastHeadlineLevelRef = useRef<1 | 2 | 3 | 4 | 5 | 6>(1)
  const latestEditorSelectionRef = useRef<EditorSelectionState>({
    anchor: 0,
    focus: 0,
    start: 0,
    end: 0,
    isCollapsed: true,
  })
  type ConsoleMethodName = 'log' | 'info' | 'warn' | 'error' | 'debug'
  const saveTimerRef = useRef<number | null>(null)
  const appStateSaveTimerRef = useRef<number | null>(null)
  const noteTransitionLockRef = useRef(false)
  const pendingViewportRestoreRef = useRef<PersistedViewportState | null>(null)
  const originalConsoleMethodsRef = useRef<Partial<Record<ConsoleMethodName, (...args: any[]) => void>>>({})
  const isWritingDebugEntryRef = useRef(false)
  const debugNoteCreationPromiseRef = useRef<Promise<string | null> | null>(null)
  const externalNoteOriginalTextByIdRef = useRef<Map<string, string>>(new Map())
  const externalNoteOriginalHashByIdRef = useRef<Map<string, string>>(new Map())
  const pendingSidebarScrollRestoreRef = useRef<{ mode: SidebarMode; scrollTop: number } | null>(null)
  const ignoreNextUserViewportChangeRef = useRef(false)
  const latestEditViewportRef = useRef<PersistedViewportState | null>(null)
  const latestEditViewportTelemetryRef = useRef<EditViewportTelemetry | null>(null)

  const areMatchingViewportLines = useCallback((expected: PersistedViewportState, event: EditorViewportState) => {
    const lineHeight = Math.max(1, event.lineHeightPx)
    const actualTop = Math.max(0, Math.round(event.topBoundaryPx / lineHeight))
    const actualBottom = Math.max(0, Math.round(event.bottomBoundaryPx / lineHeight))
    const actualScrollTop = Math.max(0, Math.round(event.scrollTopPx / lineHeight))
    return (
      actualTop === expected.topBoundaryLines &&
      actualBottom === expected.bottomBoundaryLines &&
      actualScrollTop === expected.scrollTopLines
    )
  }, []);
  const editUiStateSaveTimerRef = useRef<number | null>(null)
  const lastPersistedEditUiStateRef = useRef<{ noteId: string; progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number; sourceAnchorText: string | null } | null>(null)
  const pendingEditRestoreSnapshotRef = useRef<EditRestoreSnapshot | null>(null)
  const editModeSnapshotByNoteIdRef = useRef<Map<string, EditRestoreSnapshot>>(new Map())
  const previousActiveNoteIdForEditRestoreRef = useRef<string | null>(null)
  const pendingRenderViewSourceAnchorRef = useRef<{ sourceAnchorLine: number; sourceAnchorText: string | null } | null>(null)
  const previousPreviewModeRef = useRef(false)
  const hasPreviewModeBaselineRef = useRef(false)
  const latestViewportRef = useRef<PersistedViewportState | null>(null)
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
  const [isTrashViewDeleteArmed, setIsTrashViewDeleteArmed] = useState(false)
  const [armedNoteActionState, setArmedNoteActionState] = useState<{ noteId: string; action: NoteArmedAction } | null>(null)
  const noteArmTimerRef = useRef<{ noteId: string; button: 0 | 2; timeoutId: number; quickReleaseAction: ProtectedQuickReleaseAction | null } | null>(null)
  const skipArmedLeftClickRef = useRef<string | null>(null)
  const trashButtonArmTimerRef = useRef<number | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const previewTextureRef = useRef<HTMLDivElement>(null)
  const previewScrollSaveTimerRef = useRef<number | null>(null)
  const previewScrollbarTrackRef = useRef<HTMLDivElement | null>(null)
  const previewScrollbarRafRef = useRef<number | null>(null)
  const previewScrollbarDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null)
  const previewScrollbarThumbRef = useRef<HTMLDivElement | null>(null)
  const sidebarTextureRef = useRef<HTMLDivElement | null>(null)
  const previewScrollThumbTopRef = useRef(0)
  const previewScrollThumbHeightRef = useRef(0)
  const previewContinuousScrollDirectionRef = useRef<-1 | 0 | 1>(0)
  const previewContinuousScrollRafRef = useRef<number | null>(null)
  const previewContinuousScrollLastTsRef = useRef<number | null>(null)
  const previewReleaseRampDownRafRef = useRef<number | null>(null)
  const previewContinuousPreviousScrollBehaviorRef = useRef<string | null>(null)
  const previewPageKeysHeldRef = useRef(new Set<string>())
  const previewContinuousHandoffTimeoutRef = useRef<number | null>(null)
  const [isPreviewScrollThumbActive, setIsPreviewScrollThumbActive] = useState(false)
  const [isDraggingPreviewScrollThumb, setIsDraggingPreviewScrollThumb] = useState(false)

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
    const textureApi = window.measlyTextures
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
      audioKeyVolume,
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
    setRenderScrollDynamic(clamp(loadout.renderScrollDynamic, 0.1, 5))
    setRenderScrollResponsiveness(clamp(loadout.renderScrollResponsiveness, 0.1, 5))
    setRenderScrollTotalTimeSec(clamp(loadout.renderScrollTotalTimeSec, 0, 2))
    setRenderScrollMaxSpeedPxPerSec(clamp(loadout.renderScrollMaxSpeedPxPerSec, 1000, 100000))
    setRenderScrollSkew(clamp(loadout.renderScrollSkew, RENDER_SCROLL_SKEW_MIN, RENDER_SCROLL_SKEW_MAX))
    setAudioKeyVolume(clamp(loadout.audioKeyVolume, 0, 1))
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
    if (!window.measlyLoadouts) return
    try {
      const result = await window.measlyLoadouts.setActive(id)
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
    if (!window.measlyLoadouts) return
    try {
      const result = await window.measlyLoadouts.saveCustom(uiMode)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
    } catch (error) {
      console.error('Failed to save custom UI loadout', error)
    }
  }, [uiMode])

  const deleteCustomLoadout = useCallback(async (id: number) => {
    if (!window.measlyLoadouts) return
    if (idKind(id) !== 'custom') return
    try {
      const result = await window.measlyLoadouts.deleteCustom(id)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
      const sign = modeSign(idMode(id))
      const active = result.entries.find((entry) => entry.id * sign > 0 && entry.isActive)
      if (active) applyEntryToLiveState(active)
    } catch (error) {
      console.error('Failed to delete custom UI loadout', error)
    }
  }, [applyEntryToLiveState])

  const resetCustomLoadout = useCallback(async () => {
    if (!window.measlyLoadouts) return
    try {
      const result = await window.measlyLoadouts.resetCustom(uiMode)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
      const sign = modeSign(uiMode)
      const active = result.entries.find((entry) => entry.id * sign > 0 && entry.isActive)
      if (active) applyEntryToLiveState(active)
    } catch (error) {
      console.error('Failed to reset custom UI loadout', error)
    }
  }, [uiMode, applyEntryToLiveState])

  const handleCustomLoadoutSlotClick = useCallback((entryId: number) => {
    if (deleteArmedCustomLoadoutId === entryId) {
      setDeleteArmedCustomLoadoutId(null)
      void deleteCustomLoadout(entryId)
      return
    }

    setDeleteArmedCustomLoadoutId(null)
    void selectLoadoutPreset(entryId)
  }, [deleteArmedCustomLoadoutId, deleteCustomLoadout, selectLoadoutPreset])

  const handleCustomLoadoutSlotContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>, entryId: number) => {
    event.preventDefault()
    setDeleteArmedCustomLoadoutId(entryId)
  }, [])

  const handleCustomLoadoutSlotMouseLeave = useCallback((entryId: number) => {
    if (deleteArmedCustomLoadoutId === entryId) {
      setDeleteArmedCustomLoadoutId(null)
    }
  }, [deleteArmedCustomLoadoutId])

  const exportLayoutsTdl = useCallback(async () => {
    if (!window.measlyLoadouts) return
    try {
      await window.measlyLoadouts.exportTdl()
    } catch (error) {
      console.error('Failed to export layouts', error)
    }
  }, [])

  const importLayoutsTdl = useCallback(async () => {
    if (!window.measlyLoadouts) return
    try {
      const result = await window.measlyLoadouts.importTdl()
      if (result) {
        setUiLoadoutEntries(result.entries)
        setLastCustomIdByMode(result.lastCustomIdByMode)
      }
    } catch (error) {
      console.error('Failed to import layouts', error)
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
      setArmedColorSource(source)
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

  // On mount: fetch the full loadout table, then apply whichever entry is
  // active for the current uiMode to the live editable state.
  useEffect(() => {
    if (!window.measlyLoadouts) return
    let cancelled = false

    void window.measlyLoadouts.list()
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
    // Intentionally runs once on mount only — uiMode here reflects whatever
    // was restored from appState before this effect fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (!window.measlyLoadouts) return
    if (!activeEntryForCurrentMode) return
    if (activeEntryForCurrentMode.signature === currentUiLoadoutSignature) return

    if (pendingUpdateDebounceRef.current !== null) {
      window.clearTimeout(pendingUpdateDebounceRef.current)
    }

    pendingUpdateDebounceRef.current = window.setTimeout(() => {
      pendingUpdateDebounceRef.current = null
      void window.measlyLoadouts?.updatePending(uiMode, capturedUiLayoutLoadout)
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

  const readCurrentEditUiPayload = useCallback((): { progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number; sourceAnchorText: string | null } | null => {
    const selection = latestEditorSelectionRef.current

    const liveSnapshot = adapterRef.current?.getSnapshot()
    const snapshotViewport = liveSnapshot?.viewport
    const snapshotViewportLines = liveSnapshot?.viewportLines
    let snapshotViewportState: PersistedViewportState | null = null

    if (snapshotViewportLines) {
      snapshotViewportState = {
        topBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.topBoundaryLines)),
        bottomBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.bottomBoundaryLines)),
        scrollTopLines: Math.max(0, Math.round(snapshotViewportLines.scrollTopLines)),
      }

      latestViewportRef.current = snapshotViewportState
      latestEditViewportRef.current = snapshotViewportState
    }

    if (snapshotViewport) {
      latestEditViewportTelemetryRef.current = {
        scrollTopPx: Math.round(snapshotViewport.scrollTopPx),
        scrollHeightPx: Math.max(0, Math.round(snapshotViewport.scrollHeightPx ?? 0)),
        clientHeightPx: Math.max(0, Math.round(snapshotViewport.clientHeightPx ?? 0)),
      }
    }

    const viewport = snapshotViewportState ?? latestEditViewportRef.current ?? latestViewportRef.current
    if (!viewport) return null

    const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const { sourceAnchorLine, sourceAnchorText } = resolveSourceAnchorFromEditState({
      text: activeText,
      lineHeightPx: editorRuntimeMetrics.lineHeightPx,
      telemetry: latestEditViewportTelemetryRef.current ?? undefined,
      viewport,
    })

    const scrollTopLines = Math.max(0, Math.round(viewport.scrollTopLines))
    const scrollTop = scrollTopLinesToPx(scrollTopLines, editorRuntimeMetrics.lineHeightPx)
    const progressEdit = scrollTopLines
    const cursorPos = Math.max(0, selection.end)

    return {
      progressEdit,
      cursorPos,
      scrollTop,
      sourceAnchorLine,
      sourceAnchorText,
    }
  }, [activeNoteText, editorRuntimeMetrics.lineHeightPx])

  const updateEditModeSnapshotCache = useCallback((snapshot: EditRestoreSnapshot) => {
    editModeSnapshotByNoteIdRef.current.set(snapshot.noteId, snapshot)
  }, [])

  const captureEditModeSnapshotFromEditor = useCallback((noteId: string): EditRestoreSnapshot | null => {
    const liveSnapshot = adapterRef.current?.getSnapshot()
    const selection = liveSnapshot?.selection ?? latestEditorSelectionRef.current
    const snapshotViewport = liveSnapshot?.viewport
    const snapshotViewportLines = liveSnapshot?.viewportLines
    const viewport: PersistedViewportState | null = snapshotViewportLines
      ? {
          topBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.topBoundaryLines)),
          bottomBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.bottomBoundaryLines)),
          scrollTopLines: Math.max(0, Math.round(snapshotViewportLines.scrollTopLines)),
        }
      : (latestEditViewportRef.current ?? latestViewportRef.current)

    if (snapshotViewportLines) {
      latestViewportRef.current = viewport
      latestEditViewportRef.current = viewport
    }

    if (snapshotViewport) {
      latestEditViewportTelemetryRef.current = {
        scrollTopPx: Math.round(snapshotViewport.scrollTopPx),
        scrollHeightPx: Math.max(0, Math.round(snapshotViewport.scrollHeightPx ?? 0)),
        clientHeightPx: Math.max(0, Math.round(snapshotViewport.clientHeightPx ?? 0)),
      }
    }

    if (!viewport) return null

    const collapsedSelection: EditorSelectionState = {
      anchor: selection.end,
      focus: selection.end,
      start: selection.end,
      end: selection.end,
      isCollapsed: true,
    }

    const snapshot: EditRestoreSnapshot = {
      noteId,
      collapsedSelection,
      fullSelection: selection,
      viewport,
    }

    pendingEditRestoreSnapshotRef.current = snapshot
    updateEditModeSnapshotCache(snapshot)
    return snapshot
  }, [updateEditModeSnapshotCache])

  const persistEditUiPayloadForNote = useCallback(async (
    noteId: string,
    payload: { progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number; sourceAnchorText: string | null },
  ) => {
    const notesApi = window.measlyNotes
    if (!notesApi) return

    const { progressEdit, cursorPos, scrollTop, sourceAnchorLine, sourceAnchorText } = payload
    const previousPersisted = lastPersistedEditUiStateRef.current
    const changed =
      !previousPersisted
      || previousPersisted.noteId !== noteId
      || previousPersisted.scrollTop !== scrollTop
      || previousPersisted.cursorPos !== cursorPos
      || previousPersisted.sourceAnchorLine !== sourceAnchorLine
      || previousPersisted.sourceAnchorText !== sourceAnchorText
      || Math.abs(previousPersisted.progressEdit - progressEdit) >= 0.0001

    if (changed) {
      lastPersistedEditUiStateRef.current = {
        noteId,
        progressEdit,
        cursorPos,
        scrollTop,
        sourceAnchorLine,
        sourceAnchorText,
      }
      await notesApi.saveNoteUiState({ id: noteId, payload })
      return
    }
  }, [])

  const armedNoteActionById = useMemo(() => {
    if (!armedNoteActionState) {
      return new Map<string, NoteArmedAction>()
    }

    return new Map<string, NoteArmedAction>([[armedNoteActionState.noteId, armedNoteActionState.action]])
  }, [armedNoteActionState])

  const clearNoteArmTimer = useCallback(() => {
    if (!noteArmTimerRef.current) return
    window.clearTimeout(noteArmTimerRef.current.timeoutId)
    noteArmTimerRef.current = null
  }, [])

  const clearTrashButtonArmTimer = useCallback(() => {
    if (trashButtonArmTimerRef.current === null) return
    window.clearTimeout(trashButtonArmTimerRef.current)
    trashButtonArmTimerRef.current = null
  }, [])

  const persistedMenuStateRef = useRef<PersistedMenuState | null>(null)

  const buildMenuStateSnapshot = useCallback((overrides?: {
    sidebarMode?: SidebarMode
    sidebarViewStateByMode?: SidebarViewStateByMode
  }): PersistedMenuState => {
    const effectiveViewStateByMode = overrides?.sidebarViewStateByMode ?? sidebarViewStateByMode

    return {
      sidebarMode: overrides?.sidebarMode ?? sidebarMode,
      selectedMonths: [...selectedMonths],
      selectedYears: [...selectedYears],
      searchQuery,
      searchQueryCaseSensitive: isSearchQueryCaseSensitive,
      documentFindCaseSensitive: isDocumentFindCaseSensitive,
      isPreviewMode,
      viewStyle,
      viewFontSize,
      viewSpacing,
      editorStyle,
      editorFontSize,
      editorSpacing,
      editorGlyphPaddingPx,
      sidebarWidthRatio: DEFAULT_SIDEBAR_RATIO,
      tagSplitRatio: DEFAULT_TAG_SPLIT_RATIO,
      exportFolder: exportFolder ?? undefined,
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
      audioKeyVolume,
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
    editorSpacing,
    editorStyle,
    exportFolder,
    isDocumentFindCaseSensitive,
    isPreviewMode,
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
    if (!window.measlyState || !persistenceReady) return

    const snapshot = buildMenuStateSnapshot({
      sidebarMode: nextSidebarMode,
      sidebarViewStateByMode: nextSidebarViewStateByMode,
    })

    persistedMenuStateRef.current = snapshot

    await window.measlyState.saveAppState({
      selectedNoteId: activeNoteId,
      viewport: latestViewportRef.current ?? undefined,
      menu: snapshot,
    })
  }, [activeNoteId, buildMenuStateSnapshot, persistenceReady])

  const persistMenuStateOnUnload = useCallback(() => {
    if (!window.measlyState || !persistenceReady) return

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

    void window.measlyState.saveAppState({
      selectedNoteId: activeNoteId,
      viewport: latestViewportRef.current ?? undefined,
      menu: snapshot,
    })
  }, [
    activeNoteId,
    buildMenuStateSnapshot,
    captureSidebarModeState,
    persistenceReady,
    sidebarMode,
    sidebarViewStateByMode,
  ])

  const focusActiveNoteInSidebarMode = useCallback((mode: SidebarMode): boolean => {
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
  }, [activeNoteId])

  const runSidebarMenuTransition = useCallback((nextMode: SidebarMode) => {
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
  }, [
    captureSidebarModeState,
    focusActiveNoteInSidebarMode,
    persistMenuStateOnce,
    restoreSidebarModeStateFrom,
    sidebarMode,
    sidebarViewStateByMode,
  ])

  const toggleSidebarOptionsMenu = useCallback(() => {
    if (sidebarMode === 'options') {
      runSidebarMenuTransition(lastSidebarModeBeforeOptions)
      return
    }

    setLastSidebarModeBeforeOptions(sidebarMode)
    runSidebarMenuTransition('options')
  }, [lastSidebarModeBeforeOptions, runSidebarMenuTransition, sidebarMode])

  const handleWindowMinimize = useCallback(() => {
    ;(window as any).windowControls?.minimize?.()
  }, [])

  const handleWindowUtilityCollapseToggle = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    const utilityEl = utilityGridRef.current
    if (!utilityEl) return
    const utilityRect = utilityEl.getBoundingClientRect()

    const probe = utilityEl.cloneNode(true) as HTMLElement
    probe.classList.add('is-collapsed', 'is-measure-probe')
    document.body.appendChild(probe)

    const probeRect = probe.getBoundingClientRect()
    probe.remove()

    const targetWidth = Math.max(96, Math.round(utilityRect.width || UTILITY_WIDTH_PX))
    const targetHeight = Math.max(72, Math.ceil(probeRect.height || 160))

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
    })
    return () => unsubscribe?.()
  }, [])

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
  }, [isPreviewMode])

  const layout = useMemo(() => {
    const dividerTotalWidthPx = GRID_DIVIDER_PX * 2
    const sidebarWidthPx = SIDEBAR_MIN_WIDTH_PX

    const mainColumnsWidthPx = Math.max(
      TAG_INPUT_MIN_WIDTH_PX + SUGGESTED_MIN_WIDTH_PX,
      appShellWidthPx - dividerTotalWidthPx - UTILITY_WIDTH_PX - sidebarWidthPx,
    )

    // Tag-input and suggested-tags share remaining space at a 1:2 growth
    // ratio above their combined minimums, until tag-input hits its max.
    const baselineWidthPx = TAG_INPUT_MIN_WIDTH_PX + SUGGESTED_MIN_WIDTH_PX
    const growthPx = Math.max(0, mainColumnsWidthPx - baselineWidthPx)
    const tagInputGrowthPx = Math.min(growthPx / 3, TAG_INPUT_MAX_WIDTH_PX - TAG_INPUT_MIN_WIDTH_PX)
    const tagInputWidthPx = TAG_INPUT_MIN_WIDTH_PX + tagInputGrowthPx
    const suggestedWidthPx = mainColumnsWidthPx - tagInputWidthPx

    return {
      sidebarWidthPx,
      mainColumnsWidthPx,
      tagInputWidthPx,
      suggestedWidthPx,
      gridTemplateColumns: `${Math.round(sidebarWidthPx)}px ${GRID_DIVIDER_PX}px ${Math.round(tagInputWidthPx)}px ${Math.round(suggestedWidthPx)}px ${GRID_DIVIDER_PX}px ${UTILITY_WIDTH_PX}px`,
    }
  }, [appShellWidthPx])

  const appShellStyle = useMemo(() => {
    const style: CSSProperties & Record<string, string> = {
      gridTemplateColumns: layout.gridTemplateColumns,
      '--color-bg-regular': highlightColors.background,
      '--color-bg-leading': highlightColors.topBackground,
      '--color-bg-trailing': highlightColors.bottomBackground,
      '--color-grid-outline': highlightColors.gridOutline,
      '--color-grid-bg': highlightColors.grid,
      '--color-caret': highlightColors.caret,
      '--color-selection': isPreviewMode ? highlightColors.selectionRender : highlightColors.selectionEdit,
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
    editorEditTextTextureCss,
    editorEditTextureTintCss,
    editorRenderTextTextureCss,
    editorRenderTextureTintCss,
    highlightColors,
    isPreviewMode,
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
    return {
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

  // Writes a structured debug entry to a session-scoped debug note (tagged
  // "debug"). No-ops when debuggingEnabled is false. Safe to call from any
  // async or sync context — creation and tagging are fire-and-forget.
  const createDebugNote = useCallback(async (): Promise<string | null> => {
    if (!window.measlyNotes) return null

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const title = `# Debug: ${dateStr} / ${pad(now.getHours())}:${pad(now.getMinutes())}`

    try {
      const created = await window.measlyNotes.createNote({ initialText: `${title}\n` })
      debugNoteIdRef.current = created.id
      setNotes((previous) => {
        const index = previous.findIndex(n => n.id === created.id)
        if (index >= 0) return previous
        return [created, ...previous]
      })
      await window.measlyNotes.addTagToNote({ id: created.id, tagName: DEBUG_TAG_NAME, position: 0 }).catch(() => {})
      return created.id
    } catch (error) {
      console.error('Failed to create debug note', error)
      return null
    }
  }, [persistenceReady])

  const findExistingDebugNoteId = useCallback(async (): Promise<string | null> => {
    if (!window.measlyNotes) return null

    try {
      const listed = await window.measlyNotes.listNotes()
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
    if (!debuggingEnabled || !window.measlyNotes) return null

    if (debugNoteIdRef.current) {
      try {
        const loaded = await window.measlyNotes.loadNote({ id: debugNoteIdRef.current })
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
    if (!window.measlyNotes) return
    if (isWritingDebugEntryRef.current) return

    const noteId = await ensureDebugNoteExists()
    if (!noteId) return

    isWritingDebugEntryRef.current = true
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    const section = `\n## ${timeStr} / ${functionName}\n${lines.map(l => `- ${l}`).join('\n')}`

    try {
      const loaded = await window.measlyNotes.loadNote({ id: noteId })
      const updated = await window.measlyNotes.saveNote({
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
    if (!window.measlyState) return
    if (!persistenceReady) return
    if (isApplyingInitialViewportRef.current || pendingViewportRestoreRef.current) return

    if (appStateSaveTimerRef.current !== null) {
      window.clearTimeout(appStateSaveTimerRef.current)
    }

    appStateSaveTimerRef.current = window.setTimeout(() => {
      appStateSaveTimerRef.current = null
      const viewport = latestViewportRef.current
      void window.measlyState?.saveAppState({
        selectedNoteId,
        viewport: viewport ?? undefined,
        menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
      })
    }, 150)
  }, [buildMenuStateSnapshot, persistenceReady, writeDebugEntry])

  const chooseExportFolder = useCallback(async () => {
    const exportApi = window.measlyExport
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
    queueAppStateSave(activeNoteId)
    return folderPath
  }, [activeNoteId, buildMenuStateSnapshot, queueAppStateSave])

  const buildExportHtmlContent = useCallback(async () => {
    const currentEditorText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const exportCss = buildExportCss(viewStyle as ExportViewStyle, viewFontSize as ExportFontSize, viewSpacing as ExportSpacing)

    const markdownHtml = renderToStaticMarkup(
      <div className="pdf-exporter-page">
        <div className={`pdf-exporter-markdown-preview markdown-preview style-${viewStyle} size-${viewFontSize} spacing-${viewSpacing}`}>
          <ReactMarkdown
            remarkPlugins={PREVIEW_MARKDOWN_REMARK_PLUGINS}
            components={PREVIEW_MARKDOWN_COMPONENTS}
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
<title>${deriveNoteTitleFromText(activeNoteText || '')}</title>
<base href="${document.location.href}">
<style>${exportCss}</style>
</head>
<body>
${markdownHtml}
</body>
</html>`
  }, [activeNoteText, viewFontSize, viewSpacing, viewStyle])

  const flushSave = useCallback(async () => {
    if (!window.measlyNotes || !activeNoteId) return
    const nextText = pendingSaveTextRef.current
    if (nextText === null) return

    pendingSaveTextRef.current = null
    try {
      const noteSummary = notesRef.current.find((note) => note.id === activeNoteId)
      const isExternal = noteSummary ? isExternalNote(noteSummary) : false
      if (isExternal) {
        console.warn('[external-note] flushSave triggered for external note', { noteId: activeNoteId, textLength: nextText.length, nextText })
      }
      const normalizedText = normalizeInternalText(nextText)
      console.debug('[external-note] flushing note into DB', { noteId: activeNoteId, textLength: normalizedText.length, normalizedText })

      const savedSummary = await window.measlyNotes.saveNote({ id: activeNoteId, text: normalizedText })

      if (isExternal) {
        await window.measlyNotes?.saveNoteSnapshot({ id: activeNoteId, content: normalizedText, isManual: false })
        console.warn('[external-note] external note current state persisted into DB snapshot', { noteId: activeNoteId, textLength: normalizedText.length })
        latestEditorTextRef.current = normalizedText
        setActiveNoteText(normalizedText)
      }

      setNotes((previous) => {
        const index = previous.findIndex((note) => note.id === savedSummary.id)
        if (index < 0) return previous

        const existing = previous[index]
        if (isSameNoteSummary(existing, savedSummary)) {
          return previous
        }

        const next = [...previous]
        next[index] = savedSummary
        return next
      })
    } catch (error) {
      console.error('Failed to persist note', error)
    }
  }, [activeNoteId])

  const flushPendingSaveNow = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    await flushSave()
  }, [flushSave])

  const saveSelectedNoteState = useCallback(async (selectedNoteId: string | null) => {
    if (!window.measlyState) return
    await window.measlyState.saveAppState({
      selectedNoteId,
      viewport: latestViewportRef.current ?? undefined,
      menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
    })
  }, [buildMenuStateSnapshot])

  const resolvePreviewSourceAnchorFromContainer = useCallback((container: HTMLElement): { sourceAnchorLine: number; sourceAnchorText: string | null } | null => {
    const containerRect = container.getBoundingClientRect()
    const anchors = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line]'))
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const line = Number(element.dataset.sourceLine)
        return {
          element,
          line: Number.isFinite(line) ? Math.max(0, Math.round(line)) : -1,
          top: rect.top - containerRect.top,
          bottom: rect.bottom - containerRect.top,
        }
      })
      .filter((entry) => entry.line >= 0)

    if (anchors.length === 0) {
      return null
    }

    anchors.sort((a, b) => a.top - b.top)
    const visibleAtOrAboveTop = anchors.filter((entry) => entry.top <= 0)
    const selected = visibleAtOrAboveTop.length > 0
      ? visibleAtOrAboveTop.reduce((best, candidate) => (candidate.top > best.top ? candidate : best))
      : anchors.reduce((best, candidate) => (candidate.top < best.top ? candidate : best))

    return {
      sourceAnchorLine: selected.line,
      sourceAnchorText: selected.element.textContent?.trim() ?? null,
    }
  }, [])

  const persistRenderViewStateForNoteNow = useCallback(async (noteId: string) => {
    const container = previewScrollRef.current
    if (!container) return

    const sourceAnchor = resolvePreviewSourceAnchorFromContainer(container)
    if (!sourceAnchor) return

    const payload: { sourceAnchorLine: number; sourceAnchorText: string | null } = {
      sourceAnchorLine: sourceAnchor.sourceAnchorLine,
      sourceAnchorText: sourceAnchor.sourceAnchorText,
    }

    await window.measlyNotes?.saveNoteUiState({ id: noteId, payload })
  }, [resolvePreviewSourceAnchorFromContainer])

  const activateNote = useCallback(async (noteId: string, overrideCursorPos?: number) => {
    if (!window.measlyNotes) return

    setIsCaretSuspended(true)
    const previousNoteId = activeNoteId
    if (persistenceReady && previousNoteId && previousNoteId !== noteId) {
      const previousPayload = readCurrentEditUiPayload()
      const previousSnapshot = editModeSnapshotByNoteIdRef.current.get(previousNoteId)
      const snapshotPayload = previousPayload ?? (previousSnapshot ? {
        progressEdit: previousSnapshot.viewport.scrollTopLines,
        cursorPos: previousSnapshot.fullSelection.end,
        scrollTop: scrollTopLinesToPx(previousSnapshot.viewport.scrollTopLines, editorRuntimeMetrics.lineHeightPx),
        sourceAnchorLine: Math.max(0, previousSnapshot.viewport.scrollTopLines + previousSnapshot.viewport.topBoundaryLines),
        sourceAnchorText: null,
      } : null)

      if (snapshotPayload) {
        await persistEditUiPayloadForNote(previousNoteId, snapshotPayload)
      }
    }

    const [loaded, nextUiState] = await Promise.all([
      window.measlyNotes.loadNote({ id: noteId }),
      window.measlyNotes?.getNoteUiState({ id: noteId }) ?? Promise.resolve(null),
    ])
    const hydratedText = normalizeInternalText(loaded.text)
    const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
    const preloadedSnapshot = buildEditRestoreSnapshotFromUiState({
      noteId,
      text: hydratedText,
      uiState: nextUiState,
      fallbackViewport,
      lineHeightPx: editorRuntimeMetrics.lineHeightPx,
      overrideCursorPos,
    })
    updateEditModeSnapshotCache(preloadedSnapshot)

    let originalText: string | null = null
    let originalHash: string | null = null

    if (isExternalNote(loaded)) {
      const snapshotRows = await window.measlyNotes?.getNoteSnapshots({ id: loaded.id }) ?? []
      const originalSnapshotRow = snapshotRows.find((row) => !row.isManual) ?? snapshotRows[0]

      originalText = originalSnapshotRow
        ? normalizeInternalText(originalSnapshotRow.content)
        : hydratedText

      console.warn('[external-note] activating external note', {
        noteId: loaded.id,
        snapshotCount: snapshotRows.length,
        hasOriginalSnapshot: !!originalSnapshotRow,
        hydratedLength: hydratedText.length,
        externalPath: loaded.externalPath,
      })

      if (!snapshotRows.some((row) => !row.isManual)) {
        await window.measlyNotes?.saveNoteSnapshot({ id: loaded.id, content: hydratedText, isManual: false })
        console.warn('[external-note] created initial original snapshot for external note', { noteId: loaded.id, textLength: hydratedText.length })
      }

      externalNoteOriginalTextByIdRef.current.set(loaded.id, originalText)
      originalHash = await hashNormalizedText(originalText)
      externalNoteOriginalHashByIdRef.current.set(loaded.id, originalHash)
      activeNoteExternalPathRef.current = loaded.externalPath ?? null
      console.warn('[external-note] stored original hash for external note', {
        noteId: loaded.id,
        originalHash,
        externalPath: loaded.externalPath,
      })
    }

    latestEditorTextRef.current = hydratedText
    pendingEditRestoreSnapshotRef.current = preloadedSnapshot
    setActiveNoteId(loaded.id)
    setActiveNoteText(hydratedText)
    pendingViewportRestoreRef.current = null
    await saveSelectedNoteState(loaded.id)
  }, [
    activeNoteId,
    editorRuntimeMetrics.lineHeightPx,
    persistEditUiPayloadForNote,
    persistenceReady,
    saveSelectedNoteState,
    updateEditModeSnapshotCache,
  ])

  const refreshNotes = useCallback(async (preferredId?: string | null) => {
    if (!window.measlyNotes) return null

    const listed = await window.measlyNotes.listNotes()
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
    const fileSyncApi = window.measlyFileSync
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
    const fileSyncApi = window.measlyFileSync
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
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteId === activeNoteId && !options?.forceReload) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      if (!isPreviewMode && activeNoteId && noteId !== activeNoteId) {
        captureEditModeSnapshotFromEditor(activeNoteId)
      }
      if (isPreviewMode && activeNoteId && noteId !== activeNoteId) {
        await persistRenderViewStateForNoteNow(activeNoteId)
      }
      await flushPendingSaveNow()
      await activateNote(noteId)
    } catch (error) {
      console.error('Failed to select note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [
    activeNoteId,
    activateNote,
    captureEditModeSnapshotFromEditor,
    flushPendingSaveNow,
    isPreviewMode,
    persistRenderViewStateForNoteNow,
    persistenceReady,
  ])

  const handleSelectNote = useCallback((noteId: string) => {
    // Force a reload even for the active card to recover from any stale editor state.
    void selectNote(noteId, { forceReload: true })
  }, [selectNote])

  const restoreEditorSelection = useCallback(() => {
    const selection = latestEditorSelectionRef.current
    if (!selection) return

    const adapter = adapterRef.current
    if (adapter) {
      adapter.applySnapshot({
        selectionScrollBehavior: 'preserve-scroll',
        selection,
      })
      return
    }

    requestAnimationFrame(() => {
      adapterRef.current?.applySnapshot({
        selectionScrollBehavior: 'preserve-scroll',
        selection,
      })
    })
  }, [])

  const focusEditorInEditMode = useCallback((options?: { restoreSelection?: boolean }) => {
    if (isPreviewMode || !activeNoteId) return

    const editorRoot = document.querySelector<HTMLElement>('.editor-stage .editor-text[contenteditable="true"]')
    if (!editorRoot) return
    if (document.activeElement === editorRoot) return

    if (options?.restoreSelection ?? true) {
      restoreEditorSelection()
    }
    editorRoot.focus({ preventScroll: true })
  }, [activeNoteId, isPreviewMode, restoreEditorSelection])

  const scheduleFocusEditorInEditMode = useCallback((options?: { restoreSelection?: boolean }) => {
    const attemptFocus = () => {
      if (isPreviewMode || !activeNoteId) return

      const adapter = adapterRef.current
      const editorRoot = document.querySelector<HTMLElement>('.editor-stage .editor-text[contenteditable="true"]')
      if (!adapter || !editorRoot) {
        requestAnimationFrame(attemptFocus)
        return
      }

      focusEditorInEditMode(options)
    }

    window.setTimeout(() => {
      requestAnimationFrame(attemptFocus)
    }, 0)
  }, [activeNoteId, focusEditorInEditMode, isPreviewMode])

  const isAllowedNonEditorFocusTarget = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false

    if (target instanceof HTMLSelectElement) {
      return true
    }

    if (
      target === sidebarSearchInputRef.current ||
      target === tagInputRef.current ||
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

    if (target.closest('.tag-pill, .tags-display, .suggested-tags, .tag-input-section')) {
      return true
    }

    if (target.closest('[draggable="true"]')) {
      return true
    }

    return false
  }, [])

  const updateActiveNoteTitlePreview = useCallback((nextText: string) => {
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
  }, [activeNoteId])

  const createNote = useCallback(async (initialText = NEW_NOTE_TEMPLATE) => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    if (isPreviewMode) {
      toggleRenderViewMode()
    }

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()
      const created = await window.measlyNotes.createNote({ initialText })
      await refreshNotes(created.id)
      await activateNote(created.id, initialText.length)
      setSidebarMode('date')
    } catch (error) {
      console.error('Failed to create note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, flushPendingSaveNow, persistenceReady, refreshNotes])

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
    const externalApi = window.measlyExternalFiles
    const notesApi = window.measlyNotes
    if (!externalApi || !notesApi) return
    if (!persistenceReady) return

    if (noteTransitionLockRef.current) {
      return
    }

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      const existingTempId = await notesApi.getNoteIdByExternalPath({ externalPath: filePath })
      if (existingTempId) {
        console.debug('[external-note] external file already tracked, activating existing temp note', { filePath, noteId: existingTempId })
        await refreshNotes(existingTempId)
        await activateNote(existingTempId)
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
      await activateNote(noteId)
      setSidebarMode('date')
    } catch (error) {
      console.error('Failed to import external file', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, flushPendingSaveNow, persistenceReady, refreshNotes])

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

  const activeNoteSummary = useMemo(() => {
    if (!activeNoteId) return null
    return notes.find((note) => note.id === activeNoteId) ?? null
  }, [activeNoteId, notes])

  const activeNoteHasDebugTag = useMemo(() => {
    return activeNoteSummary?.tags.some((tag) => normalizeTagName(tag) === DEBUG_TAG_NAME) ?? false
  }, [activeNoteSummary])

  const getCurrentExternalNoteModifiedState = useCallback((note: NoteSummary, currentHash: string | null = currentExternalNoteHash): boolean => {
    if (!isExternalNote(note)) return false
    if (note.id !== activeNoteId) {
      return Boolean(note.hasUnsavedChanges)
    }

    if (Boolean(note.hasUnsavedChanges)) {
      return true
    }

    return (
      currentHash !== null
      && currentHash !== externalNoteOriginalHashByIdRef.current.get(note.id)
    )
  }, [activeNoteId, currentExternalNoteHash])

  useEffect(() => {
    if (!activeNoteId || !activeNoteSummary || !isExternalNote(activeNoteSummary)) {
      setCurrentExternalNoteHash(null)
      return
    }

    let disposed = false
    void (async () => {
      const currentText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
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
  }, [activeNoteId, activeNoteSummary, activeNoteText, editorTextVersion, getCurrentExternalNoteModifiedState])

  const persistEditUiState = useCallback((noteId: string, options?: { immediate?: boolean }) => {
    const notesApi = window.measlyNotes
    if (!notesApi) return

    const persistNow = async () => {
      const payload = readCurrentEditUiPayload()
      if (!payload) return
      const { progressEdit, cursorPos, scrollTop, sourceAnchorLine, sourceAnchorText } = payload

      const cached = editModeSnapshotByNoteIdRef.current.get(noteId)
      if (cached) {
        updateEditModeSnapshotCache({
          ...cached,
          collapsedSelection: {
            anchor: cursorPos,
            focus: cursorPos,
            start: cursorPos,
            end: cursorPos,
            isCollapsed: true,
          },
          fullSelection: {
            anchor: cursorPos,
            focus: cursorPos,
            start: cursorPos,
            end: cursorPos,
            isCollapsed: true,
          },
          viewport: {
            ...cached.viewport,
            scrollTopLines: scrollTopPxToLines(scrollTop, editorRuntimeMetrics.lineHeightPx),
          },
        })
      }

      const previousPersisted = lastPersistedEditUiStateRef.current
      if (
        previousPersisted &&
        previousPersisted.noteId === noteId &&
        previousPersisted.scrollTop === scrollTop &&
        previousPersisted.cursorPos === cursorPos &&
        previousPersisted.sourceAnchorLine === sourceAnchorLine &&
        previousPersisted.sourceAnchorText === sourceAnchorText &&
        Math.abs(previousPersisted.progressEdit - progressEdit) < 0.0001
      ) {
        return
      }

      lastPersistedEditUiStateRef.current = {
        noteId,
        progressEdit,
        cursorPos,
        scrollTop,
        sourceAnchorLine,
        sourceAnchorText,
      }

      await notesApi.saveNoteUiState({ id: noteId, payload })
    }

    if (options?.immediate) {
      if (editUiStateSaveTimerRef.current !== null) {
        window.clearTimeout(editUiStateSaveTimerRef.current)
        editUiStateSaveTimerRef.current = null
      }
      void persistNow()
      return
    }

    if (editUiStateSaveTimerRef.current !== null) {
      window.clearTimeout(editUiStateSaveTimerRef.current)
    }

    editUiStateSaveTimerRef.current = window.setTimeout(() => {
      editUiStateSaveTimerRef.current = null
      void persistNow()
    }, 280)
  }, [editorRuntimeMetrics.lineHeightPx, readCurrentEditUiPayload, updateEditModeSnapshotCache])

  const persistActiveNoteEditModeStateNow = useCallback(() => {
    if (!activeNoteId) return

    if (!isPreviewMode) {
      captureEditModeSnapshotFromEditor(activeNoteId)
    }

    const payload = readCurrentEditUiPayload() ?? (() => {
      const cachedSnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
      if (!cachedSnapshot) return null
      return {
        progressEdit: cachedSnapshot.viewport.scrollTopLines,
        cursorPos: cachedSnapshot.fullSelection.end,
        scrollTop: scrollTopLinesToPx(cachedSnapshot.viewport.scrollTopLines, editorRuntimeMetrics.lineHeightPx),
        sourceAnchorLine: Math.max(0, cachedSnapshot.viewport.scrollTopLines + cachedSnapshot.viewport.topBoundaryLines),
        sourceAnchorText: null,
      }
    })()
    if (!payload) return

    void persistEditUiPayloadForNote(activeNoteId, payload)
  }, [
    activeNoteId,
    captureEditModeSnapshotFromEditor,
    editorRuntimeMetrics.lineHeightPx,
    isPreviewMode,
    persistEditUiPayloadForNote,
  ])

  const applyEditRestoreSnapshot = useCallback((snapshot: EditRestoreSnapshot, options?: { restoreFullSelection?: boolean; focusAfterApply?: boolean; onComplete?: () => void }) => {
    const restoreFullSelection = options?.restoreFullSelection ?? true
    const focusAfterApply = options?.focusAfterApply ?? false
    const onComplete = options?.onComplete
    let cancelled = false

    const applySourceAnchorToEditor = () => {
      if (typeof snapshot.sourceAnchorLine !== 'number' || !Number.isFinite(snapshot.sourceAnchorLine)) {
        return
      }

      const scroller = document.querySelector<HTMLElement>('.editor-stage .measly-custom-scrollbar')
      const editorRoot = document.querySelector<HTMLElement>('.editor-stage .editor-text[contenteditable="true"]')
      if (!scroller || !editorRoot) {
        return
      }

      const paragraphs = Array.from(editorRoot.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
      if (paragraphs.length === 0) {
        return
      }

      const targetIndex = Math.max(0, Math.min(paragraphs.length - 1, Math.round(snapshot.sourceAnchorLine)))
      const targetParagraph = paragraphs[targetIndex]
      const scrollerRect = scroller.getBoundingClientRect()
      const paragraphRect = targetParagraph.getBoundingClientRect()
      const topBoundaryPx = Math.max(0, Math.round(snapshot.viewport.topBoundaryLines * editorRuntimeMetrics.lineHeightPx))
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const targetScrollTop = Math.max(
        0,
        Math.min(
          maxScrollTop,
          scroller.scrollTop + (paragraphRect.top - scrollerRect.top) - topBoundaryPx,
        ),
      )

      scroller.scrollTop = targetScrollTop
      requestAnimationFrame(() => {
        if (!cancelled) {
          scroller.scrollTop = targetScrollTop
        }
      })
    }

    // Restoring from integer line counts is direct and idempotent: no
    // measurement-dependent clamping happens at apply time (see
    // EditorViewportLines / clampBoundaryLines), so a single applySnapshot
    // call is sufficient. The previous implementation needed a multi-frame
    // reconciliation loop to work around pixel-based restores being
    // invalidated by container-size races; that is no longer necessary.
    const applyWhenReady = () => {
      if (cancelled) return
      const adapter = adapterRef.current
      if (!adapter) {
        requestAnimationFrame(applyWhenReady)
        return
      }

      const selection = restoreFullSelection ? snapshot.fullSelection : snapshot.collapsedSelection

      adapter.applySnapshot({
        selectionScrollBehavior: 'preserve-scroll',
        selection,
        viewportLines: snapshot.viewport,
      })

      requestAnimationFrame(() => {
        if (cancelled) return
        applySourceAnchorToEditor()
      })

      latestViewportRef.current = snapshot.viewport
      latestEditViewportRef.current = snapshot.viewport

      if (focusAfterApply) {
        requestAnimationFrame(() => {
          focusEditorInEditMode({ restoreSelection: false })
        })
      }

      if (onComplete) {
        onComplete()
      }
    }

    requestAnimationFrame(applyWhenReady)

    return () => {
      cancelled = true
    }
  }, [editorRuntimeMetrics.lineHeightPx, focusEditorInEditMode])

  const orderedActiveTags = activeNoteSummary?.tags ?? []
  const activeNoteIsExternal = orderedActiveTags.some((tag) => isExternalTagName(tag))

  const suggestedTags = useMemo(() => {
    const usageByName = new Map<string, number>()

    for (const note of notes) {
      for (const tag of note.tags) {
        usageByName.set(tag, (usageByName.get(tag) ?? 0) + 1)
      }
    }

    const activeTagSet = new Set(orderedActiveTags)

    return [...usageByName.entries()]
      .filter(([name]) => !PROTECTED_TAGS.has(normalizeTagName(name)) && !activeTagSet.has(name))
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1]
        }
        return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
      })
      .map(([name]) => name)
        .slice(0, 15)
  }, [notes, orderedActiveTags])

  const runActiveNoteTagMutation = useCallback(async (mutate: (noteId: string) => Promise<void>) => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (!activeNoteId) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    setIsTagMutationPending(true)
    try {
      await flushPendingSaveNow()
      await mutate(activeNoteId)
      await refreshNotes(activeNoteId)
      await activateNote(activeNoteId)
    } catch (error) {
      console.error('Failed to mutate active note tags', error)
    } finally {
      setIsTagMutationPending(false)
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, activateNote, flushPendingSaveNow, persistenceReady, refreshNotes])

  const handleAddSuggestedTag = useCallback((tagName: string) => {
    if (activeNoteIsExternal) return
    if (orderedActiveTags.includes(tagName)) return

    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.addTagToNote({
        id: noteId,
        tagName,
        position: orderedActiveTags.length,
      })
    })
  }, [activeNoteIsExternal, orderedActiveTags, runActiveNoteTagMutation])

  const handleTagInputEnter = useCallback(() => {
    if (!activeNoteId || !persistenceReady) return
    if (activeNoteIsExternal) return

    const normalized = normalizeTagName(tagInputValue)
    if (!normalized) return

    if (renamingTagName) {
      const fromName = normalizeTagName(renamingTagName)
      const toName = normalized
      setRenamingTagName(null)
      setTagInputValue('')

      if (fromName === toName) {
        return
      }

      if (isProtectedTagName(fromName)) {
        return
      }

      if (!window.measlyNotes) return
      if (noteTransitionLockRef.current) return

      noteTransitionLockRef.current = true
      setIsTagMutationPending(true)
      void (async () => {
        try {
          await flushPendingSaveNow()
          await window.measlyNotes!.renameTag({ fromName, toName })
          await refreshNotes(activeNoteId)
          await activateNote(activeNoteId)
        } catch (error) {
          console.error('Failed to rename tag', error)
        } finally {
          setIsTagMutationPending(false)
          noteTransitionLockRef.current = false
        }
      })()
      return
    }

    if (isProtectedTagName(normalized)) {
      setTagInputValue('')
      return
    }

    if (orderedActiveTags.map(normalizeTagName).includes(normalized)) {
      setTagInputValue('')
      return
    }

    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.addTagToNote({
        id: noteId,
        tagName: normalized,
        position: orderedActiveTags.length,
      })
    })
    setTagInputValue('')
  }, [
    activeNoteId,
    activateNote,
    flushPendingSaveNow,
    orderedActiveTags,
    persistenceReady,
    refreshNotes,
    renamingTagName,
    runActiveNoteTagMutation,
    tagInputValue,
    activeNoteIsExternal,
  ])

  const handleTagChipClick = useCallback((tagName: string) => {
    if (deleteArmedTagName === tagName) {
      setDeleteArmedTagName(null)
      void runActiveNoteTagMutation(async (noteId) => {
        await window.measlyNotes!.removeTagFromNote({ id: noteId, tagName })
      })
      return
    }

    setDeleteArmedTagName(tagName)
  }, [deleteArmedTagName, runActiveNoteTagMutation])

  const handleTagChipMouseLeave = useCallback((tagName: string) => {
    if (deleteArmedTagName === tagName) {
      setDeleteArmedTagName(null)
    }
  }, [deleteArmedTagName])

  const handleTagDragStart = useCallback((event: DragEvent<HTMLDivElement>, index: number) => {
    const tagName = orderedActiveTags[index] ?? ''
    if (isProtectedTagName(tagName)) return

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tagName)
    setDraggedTagIndex(index)
  }, [orderedActiveTags])

  const handleTagDragEnd = useCallback(() => {
    setDraggedTagIndex(null)
  }, [])

  const handleTagDrop = useCallback((event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault()
    event.stopPropagation()

    if (draggedTagIndex === null || draggedTagIndex === targetIndex) {
      setDraggedTagIndex(null)
      return
    }

    const targetTag = orderedActiveTags[targetIndex] ?? ''
    if (isProtectedTagName(targetTag)) {
      setDraggedTagIndex(null)
      return
    }

    const reordered = [...orderedActiveTags]
    const [moved] = reordered.splice(draggedTagIndex, 1)
    if (!moved) {
      setDraggedTagIndex(null)
      return
    }
    reordered.splice(targetIndex, 0, moved)
    setDraggedTagIndex(null)

    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.reorderNoteTags({ id: noteId, tagNames: reordered })
    })
  }, [draggedTagIndex, orderedActiveTags, runActiveNoteTagMutation])

  const handleTagContainerDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggedTagIndex === null) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
  }, [draggedTagIndex])

  const handleTagContainerDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggedTagIndex === null) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const reordered = [...orderedActiveTags]
    const [moved] = reordered.splice(draggedTagIndex, 1)
    if (!moved) {
      setDraggedTagIndex(null)
      return
    }

    reordered.push(moved)
    setDraggedTagIndex(null)

    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.reorderNoteTags({ id: noteId, tagNames: reordered })
    })
  }, [draggedTagIndex, orderedActiveTags, runActiveNoteTagMutation])

  const handleTagContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, tagName: string) => {
    event.preventDefault()
    if (isProtectedTagName(tagName)) return

    setRenamingTagName(tagName)
    setTagInputValue(tagName)
  }, [])

  const applyProtectedNoteDestination = useCallback(async (noteId: string, destination: 'archived' | 'deleted') => {
    if (!window.measlyNotes) return

    const summary = notes.find((note) => note.id === noteId)
    const existingTags = summary?.tags ?? []
    const opposite = destination === 'archived' ? 'deleted' : 'archived'

    const hasDestination = existingTags.some((tag) => normalizeTagName(tag) === destination)
    const hasOpposite = existingTags.some((tag) => normalizeTagName(tag) === opposite)

    if (hasOpposite) {
      await window.measlyNotes.removeTagFromNote({ id: noteId, tagName: opposite })
    }

    if (!hasDestination) {
      await window.measlyNotes.addTagToNote({
        id: noteId,
        tagName: destination,
        position: 0,
      })
    }

    const reordered = [
      destination,
      ...existingTags.filter((tag) => {
        const normalized = normalizeTagName(tag)
        return normalized !== destination && normalized !== opposite
      }),
    ]

    await window.measlyNotes.reorderNoteTags({ id: noteId, tagNames: reordered })
  }, [notes])

  const saveExternalNoteToFile = useCallback(async (noteId: string) => {
    if (!window.measlyNotes || !window.measlyExternalFiles) return
    if (activeNoteId !== noteId) return

    const summary = notes.find((note) => note.id === noteId)
    let externalPath = summary?.externalPath ?? activeNoteExternalPathRef.current ?? null
    if (!externalPath) {
      console.warn('[external-note] saveExternalNoteToFile missing externalPath on summary, attempting loadNote fallback', { noteId, summary })
      try {
        const loadedNote = await window.measlyNotes.loadNote({ id: noteId })
        externalPath = loadedNote.externalPath ?? null
        console.debug('[external-note] saveExternalNoteToFile loaded note path fallback', { noteId, loadedExternalPath: externalPath, loadedNote })
        if (externalPath) {
          activeNoteExternalPathRef.current = externalPath
        }
        if (externalPath && summary) {
          setNotes((previous) => {
            const index = previous.findIndex((note) => note.id === noteId)
            if (index < 0) return previous
            const next = [...previous]
            next[index] = { ...next[index], externalPath }
            return next
          })
        }
      } catch (error) {
        console.error('[external-note] saveExternalNoteToFile fallback loadNote failed', { noteId, error })
      }
    }

    if (!externalPath) {
      console.error('[external-note] saveExternalNoteToFile missing externalPath', { noteId, noteSummary: summary })
      return
    }

    const currentText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const currentHash = await hashNormalizedText(currentText)

    console.debug('[external-note] explicit save path starting', {
      noteId,
      externalPath,
      textLength: currentText.length,
      hash: currentHash,
      activeNoteId,
    })

    let diskSanityText: string | null = null
    let writeSucceeded = false
    let writeAttemptedViaNoteApi = false
    let writeAttemptedViaExternalApi = false

    let syncedSummary: NoteSummary | null = null
    try {
      writeAttemptedViaNoteApi = true
      writeSucceeded = await window.measlyNotes.syncExternalNoteToFile({ id: noteId, content: currentText })
      console.debug('[external-note] syncExternalNoteToFile result', { noteId, externalPath, writeSucceeded })
      if (writeSucceeded) {
        syncedSummary = await window.measlyNotes.updateExternalNoteState({ id: noteId, hasUnsavedChanges: false, syncMode: true })
      }
    } catch (error) {
      console.error('[external-note] syncExternalNoteToFile exception', { noteId, externalPath, error })
    }

    if (!writeSucceeded) {
      try {
        writeAttemptedViaExternalApi = true
        writeSucceeded = await window.measlyExternalFiles.writeFileContent(externalPath, currentText)
        console.debug('[external-note] writeFileContent fallback result', { noteId, externalPath, writeSucceeded })
        if (writeSucceeded) {
          syncedSummary = await window.measlyNotes.updateExternalNoteState({ id: noteId, hasUnsavedChanges: false, syncMode: true })
        }
      } catch (error) {
        console.error('[external-note] writeFileContent fallback exception', { noteId, externalPath, error })
      }
    }

    if (!writeSucceeded) {
      console.error('[external-note] external save failed, no write method succeeded', {
        noteId,
        externalPath,
        writeAttemptedViaNoteApi,
        writeAttemptedViaExternalApi,
      })
    } else {
      latestEditorTextRef.current = currentText
      try {
        const savedSummary = await window.measlyNotes.saveNote({ id: noteId, text: currentText })
        console.debug('[external-note] saveExternalNoteToFile persisted temp note text into DB', { noteId, externalPath, savedSummary })

        const nextSummary = syncedSummary ?? savedSummary
        setNotes((previous) => {
          const index = previous.findIndex((note) => note.id === nextSummary.id)
          if (index < 0) return previous

          const existing = previous[index]
          if (isSameNoteSummary(existing, nextSummary)) {
            return previous
          }

          const next = [...previous]
          next[index] = nextSummary
          return next
        })
      } catch (error) {
        console.error('[external-note] saveExternalNoteToFile failed to persist temp note in DB', { noteId, externalPath, error })
      }
    }

    try {
      const diskContent = await window.measlyExternalFiles.readFileContent(externalPath)
      console.debug('[external-note] readFileContent after save', { noteId, externalPath, diskContentLength: diskContent?.length ?? null, diskContentIsNull: diskContent === null })
      if (diskContent !== null) {
        diskSanityText = diskContent
      } else {
        console.error('[external-note] failed to read disk content for sanity snapshot', { noteId, externalPath })
      }
    } catch (error) {
      console.error('[external-note] failed to read disk content for sanity snapshot', { noteId, externalPath, error })
    }

    if (diskSanityText === null) {
      return
    }

    const diskSanityNormalized = normalizeInternalText(diskSanityText)
    const isDiskEqual = currentText === diskSanityNormalized

    try {
      if (isDiskEqual) {
        await window.measlyNotes.saveNoteSnapshot({ id: noteId, content: currentText, isManual: false })
        externalNoteOriginalTextByIdRef.current.set(noteId, currentText)
        externalNoteOriginalHashByIdRef.current.set(noteId, currentHash)
        setCurrentExternalNoteHash(currentHash)
        if (activeNoteId === noteId) {
          setActiveNoteText(currentText)
        }
        setNotes((previous) => {
          const index = previous.findIndex((note) => note.id === noteId)
          if (index < 0) return previous

          const next = [...previous]
          next[index] = {
            ...next[index],
            updatedAtMs: Date.now(),
          }
          return next
        })
      } else {
        const diskHash = await hashNormalizedText(diskSanityNormalized)
        await window.measlyNotes.saveNoteSnapshot({ id: noteId, content: diskSanityNormalized, isManual: false })
        externalNoteOriginalTextByIdRef.current.set(noteId, diskSanityNormalized)
        externalNoteOriginalHashByIdRef.current.set(noteId, diskHash)
        setCurrentExternalNoteHash(currentHash)
        if (activeNoteId === noteId) {
          setActiveNoteText(currentText)
        }
        console.error('[external-note] disk sanity mismatch after save', { noteId, currentHash, diskHash, writeSucceeded })
      }
    } catch (error) {
      console.error('[external-note] failed to persist external note snapshots', { noteId, error })
    }
  }, [activeNoteId, activeNoteText, notes])

  const getNextActiveNoteIdAfterRemoval = useCallback((removedNoteId: string): string | null => {
    if (sidebarMode === 'date') {
      return dateFilteredNotesRef.current.find((note) => note.id !== removedNoteId)?.id ?? null
    }

    if (sidebarMode === 'trash') {
      return trashFilteredNotesRef.current.find((note) => note.id !== removedNoteId)?.id ?? null
    }

    if (sidebarMode === 'category') {
      for (const primary of categoryTreeRef.current) {
        for (const secondary of primary.secondary) {
          for (const tertiary of secondary.tertiary) {
            for (const note of tertiary.notes) {
              if (note.id !== removedNoteId) {
                return note.id
              }
            }
          }
        }
      }
      return null
    }

    if (sidebarMode === 'archive') {
      for (const primary of archiveTreeRef.current) {
        for (const secondary of primary.secondary) {
          for (const tertiary of secondary.tertiary) {
            for (const note of tertiary.notes) {
              if (note.id !== removedNoteId) {
                return note.id
              }
            }
          }
        }
      }
      return null
    }

    return null
  }, [sidebarMode])


  const executeArmedNoteAction = useCallback(async (noteId: string, action: NoteArmedAction) => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    const summary = notes.find((note) => note.id === noteId)
    const isCurrentlyDeleted = summary ? isDeletedNote(summary) : false

    noteTransitionLockRef.current = true
    try {
      if (action === 'close') {
        await closeExternalNoteWithoutSaving(noteId)
        return
      }

      await flushPendingSaveNow()

      if (action === 'save') {
        await saveExternalNoteToFile(noteId)
        return
      }

      if (action === 'deletion' && isCurrentlyDeleted) {
        await window.measlyNotes.deleteNote({ id: noteId })
        await refreshNotes(activeNoteId === noteId ? null : activeNoteId)

        if (activeNoteId === noteId) {
          const nextActiveId = getNextActiveNoteIdAfterRemoval(noteId)
          if (nextActiveId) {
            await activateNote(nextActiveId)
          } else {
            setActiveNoteId(null)
            setActiveNoteText('')
          }
        }

        return
      }

      if (action === 'archive') {
        await applyProtectedNoteDestination(noteId, 'archived')
      } else {
        await applyProtectedNoteDestination(noteId, 'deleted')
      }

      await refreshNotes(activeNoteId ?? noteId)
      if (activeNoteId === noteId) {
        if (action === 'archive' || action === 'deletion') {
          const nextActiveId = getNextActiveNoteIdAfterRemoval(noteId)
          if (nextActiveId) {
            await activateNote(nextActiveId)
          } else {
            setActiveNoteId(null)
            setActiveNoteText('')
          }
        } else {
          await activateNote(noteId)
        }
      }
    } catch (error) {
      console.error('Failed to apply note action', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, activeNoteId, applyProtectedNoteDestination, flushPendingSaveNow, notes, persistenceReady, refreshNotes, saveExternalNoteToFile])

  const applyQuickProtectedRightClickAction = useCallback(async (noteId: string, action: Exclude<ProtectedQuickReleaseAction, null>) => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      if (action === 'remove-archived') {
        await window.measlyNotes.removeTagFromNote({ id: noteId, tagName: 'archived' })
      } else {
        await window.measlyNotes.removeTagFromNote({ id: noteId, tagName: 'deleted' })
      }

      await refreshNotes(activeNoteId ?? noteId)
      if (activeNoteId === noteId) {
        await activateNote(noteId)
      }
    } catch (error) {
      console.error('Failed to apply protected right-click action', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, activeNoteId, flushPendingSaveNow, persistenceReady, refreshNotes])

  const closeExternalNoteWithoutSaving = useCallback(async (noteId: string) => {
    if (!window.measlyNotes) return

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    pendingSaveTextRef.current = null

    clearNoteArmTimer()
    const nextActiveId = activeNoteId === noteId ? getNextActiveNoteIdAfterRemoval(noteId) : null

    externalNoteOriginalTextByIdRef.current.delete(noteId)
    externalNoteOriginalHashByIdRef.current.delete(noteId)
    setCurrentExternalNoteHash((current) => (activeNoteId === noteId ? null : current))

    try {
      await window.measlyNotes.deleteNote({ id: noteId })
      setNotes((previous) => previous.filter((note) => note.id !== noteId))

      if (activeNoteId === noteId) {
        if (nextActiveId) {
          await activateNote(nextActiveId)
        } else {
          setActiveNoteId(null)
          setActiveNoteText('')
        }
      }
    } catch (error) {
      console.error('Failed to delete external temp note', error)
    }
  }, [activeNoteId, activateNote, clearNoteArmTimer, getNextActiveNoteIdAfterRemoval])

  const handleNoteRightPressStart = useCallback((noteId: string, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    const summary = notes.find((note) => note.id === noteId)
    const isNoteExternal = summary ? isExternalNote(summary) : false
    const isNoteModified = summary ? getCurrentExternalNoteModifiedState(summary) : false

    if (isNoteExternal && !isNoteModified) {
      clearNoteArmTimer()
      void closeExternalNoteWithoutSaving(noteId)
      return
    }

    if (isNoteExternal && isNoteModified) {
      if (armedNoteActionState?.noteId === noteId && armedNoteActionState.action === 'close') {
        return
      }

      clearNoteArmTimer()
      const timeoutId = window.setTimeout(() => {
        setArmedNoteActionState({ noteId, action: 'close' })
        if (noteArmTimerRef.current?.noteId === noteId) {
          noteArmTimerRef.current = null
        }
      }, NOTE_RIGHT_CLICK_HOLD_MS)

      noteArmTimerRef.current = { noteId, button: 2, timeoutId, quickReleaseAction: null }
      return
    }

    clearNoteArmTimer()

    const isNoteArchived = summary ? isArchivedNote(summary) : false
    const isNoteDeleted = summary ? isDeletedNote(summary) : false
    if (isNoteArchived || isNoteDeleted) {
      setArmedNoteActionState(null)
    } else {
      setArmedNoteActionState({ noteId, action: 'archive' })
    }

    const quickReleaseAction: ProtectedQuickReleaseAction = isNoteDeleted
      ? 'remove-deleted'
      : (isNoteArchived ? 'remove-archived' : null)

    const timeoutId = window.setTimeout(() => {
      setArmedNoteActionState((previous) => {
        if (quickReleaseAction) {
          return {
            noteId,
            action: 'deletion',
          }
        }

        if (!previous || previous.noteId !== noteId) {
          return previous
        }

        return {
          noteId,
          action: 'deletion',
        }
      })

      if (noteArmTimerRef.current?.noteId === noteId) {
        noteArmTimerRef.current = null
      }
    }, NOTE_RIGHT_CLICK_HOLD_MS)

    noteArmTimerRef.current = { noteId, button: 2, timeoutId, quickReleaseAction }
  }, [activeNoteId, armedNoteActionState, clearNoteArmTimer, closeExternalNoteWithoutSaving, currentExternalNoteHash, notes])

  const handleNoteLeftPressStart = useCallback((noteId: string, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    clearNoteArmTimer()

    const summary = notes.find((note) => note.id === noteId)
    const isNoteExternal = summary ? isExternalNote(summary) : false
    const isNoteModified = summary ? getCurrentExternalNoteModifiedState(summary) : false

    if (!isNoteExternal || !isNoteModified) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setArmedNoteActionState({ noteId, action: 'save' })
      skipArmedLeftClickRef.current = noteId
      if (noteArmTimerRef.current?.noteId === noteId) {
        noteArmTimerRef.current = null
      }
    }, NOTE_LEFT_CLICK_HOLD_MS)

    noteArmTimerRef.current = { noteId, button: 0, timeoutId, quickReleaseAction: null }
  }, [activeNoteId, clearNoteArmTimer, currentExternalNoteHash, notes])

  const handleNoteLeftPressEnd = useCallback((noteId: string, event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const pendingArm = noteArmTimerRef.current
    if (!pendingArm || pendingArm.noteId !== noteId) return

    if (pendingArm.button === 0) {
      clearNoteArmTimer()
    }
  }, [clearNoteArmTimer])

  const handleNoteRightPressEnd = useCallback((noteId: string, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    const pendingArm = noteArmTimerRef.current
    if (!pendingArm || pendingArm.noteId !== noteId) {
      return
    }

    const quickReleaseAction = pendingArm.quickReleaseAction
    clearNoteArmTimer()

    if (quickReleaseAction) {
      setArmedNoteActionState(null)
      void applyQuickProtectedRightClickAction(noteId, quickReleaseAction)
    }
  }, [applyQuickProtectedRightClickAction, clearNoteArmTimer])

  const handleArmedNoteLeftClick = useCallback((noteId: string) => {
    const armed = armedNoteActionState
    if (!armed || armed.noteId !== noteId) {
      return
    }

    if (skipArmedLeftClickRef.current === noteId) {
      skipArmedLeftClickRef.current = null
      return
    }

    clearNoteArmTimer()
    setArmedNoteActionState(null)
    void executeArmedNoteAction(noteId, armed.action)
  }, [armedNoteActionState, clearNoteArmTimer, executeArmedNoteAction])

  const handleNoteArmHoverLeave = useCallback((noteId: string) => {
    const pendingArm = noteArmTimerRef.current
    if (pendingArm && pendingArm.noteId === noteId) {
      clearNoteArmTimer()
    }

    setArmedNoteActionState((previous) => {
      if (!previous || previous.noteId !== noteId) {
        return previous
      }

      return null
    })
  }, [clearNoteArmTimer])

  const purgeDeletedNotesPermanently = useCallback(async () => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    const deletedNoteIds = notes
      .filter((note) => isDeletedNote(note))
      .map((note) => note.id)

    if (deletedNoteIds.length === 0) {
      return
    }

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      for (const noteId of deletedNoteIds) {
        await window.measlyNotes.deleteNote({ id: noteId })
      }

      const activeDeleted = activeNoteId ? deletedNoteIds.includes(activeNoteId) : false
      await refreshNotes(activeDeleted ? null : activeNoteId)

      if (activeDeleted && activeNoteId) {
        const nextActiveId = getNextActiveNoteIdAfterRemoval(activeNoteId)
        if (nextActiveId) {
          await activateNote(nextActiveId)
        } else {
          setActiveNoteId(null)
          setActiveNoteText('')
        }
      }
    } catch (error) {
      console.error('Failed to permanently purge deleted notes', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, activeNoteId, flushPendingSaveNow, notes, persistenceReady, refreshNotes])

  const handleTrashViewButtonMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    clearTrashButtonArmTimer()
    setIsTrashViewDeleteArmed(false)

    trashButtonArmTimerRef.current = window.setTimeout(() => {
      setIsTrashViewDeleteArmed(true)
      trashButtonArmTimerRef.current = null
    }, NOTE_RIGHT_CLICK_HOLD_MS)
  }, [clearTrashButtonArmTimer])

  const handleTrashViewButtonMouseUp = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()

    // Quick release before timeout should not arm the trash purge action.
    if (trashButtonArmTimerRef.current !== null) {
      clearTrashButtonArmTimer()
      setIsTrashViewDeleteArmed(false)
    }
  }, [clearTrashButtonArmTimer])

  const handleTrashViewButtonContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleViewModeButtonClick = useCallback((mode: SidebarMode) => {
    if (mode === 'trash' && isTrashViewDeleteArmed) {
      setIsTrashViewDeleteArmed(false)
      void purgeDeletedNotesPermanently()
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
      setIsTrashViewDeleteArmed(false)
      clearTrashButtonArmTimer()
      runSidebarMenuTransition('find')
      requestAnimationFrame(() => {
        sidebarSearchInputRef.current?.focus()
        sidebarSearchInputRef.current?.select()
      })
      return
    }

    setIsTrashViewDeleteArmed(false)
    clearTrashButtonArmTimer()
    runSidebarMenuTransition(mode)
  }, [
    clearTrashButtonArmTimer,
    focusActiveNoteInSidebarMode,
    isTrashViewDeleteArmed,
    purgeDeletedNotesPermanently,
    runSidebarMenuTransition,
    sidebarMode,
  ])

  const queueSave = useCallback((text: string) => {
    if (!persistenceReady) return
    pendingSaveTextRef.current = normalizeInternalText(text)
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }, [flushSave, persistenceReady])

  useEffect(() => {
    let disposed = false

    const bootstrap = async () => {
      const hasBridge = await waitForNotesBridge(() => disposed)
      if (!hasBridge) {
        return
      }
      const measlyNotes = window.measlyNotes
      if (!measlyNotes) {
        return
      }

      setPersistenceReady(false)

      let attempt = 0
      while (!disposed) {
        try {
          let listed = await measlyNotes.listNotes()
          if (disposed) return

          if (listed.length === 0) {
            await measlyNotes.createNote({ initialText: NEW_NOTE_TEMPLATE })
            listed = await measlyNotes.listNotes()
            if (listed.length === 0) {
              throw new Error('Notes list remained empty after creating bootstrap note')
            }
          }

          const appState = window.measlyState ? await window.measlyState.loadAppState() : { selectedNoteId: null }
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
            setIsDocumentFindCaseSensitive(appState.menu.documentFindCaseSensitive ?? false)
            setIsPreviewMode(appState.menu.isPreviewMode ?? false)
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

          const loaded = await measlyNotes.loadNote({ id: selectedSummary.id })
          if (disposed) return

          setNotes((previous) => mergeNoteSummaries(previous, listed))
          setActiveNoteId(loaded.id)

          const hydratedText = normalizeInternalText(loaded.text)
          latestEditorTextRef.current = hydratedText
          setActiveNoteText(hydratedText)

          if (appState.viewport) {
            // Line counts are stored as-is, with no clamping at load time.
            // Display values are derived continuously inside Editor.tsx via
            // clampBoundaryLines once the container is measured.
            pendingViewportRestoreRef.current = {
              topBoundaryLines: appState.viewport.topBoundaryLines,
              bottomBoundaryLines: appState.viewport.bottomBoundaryLines,
              scrollTopLines: appState.viewport.scrollTopLines,
            }
            latestViewportRef.current = pendingViewportRestoreRef.current
          } else {
            // Per spec: default to 0 lines for both boundaries (and scroll)
            // when nothing is stored.
            pendingViewportRestoreRef.current = {
              topBoundaryLines: 0,
              bottomBoundaryLines: 0,
              scrollTopLines: 0,
            }
            latestViewportRef.current = pendingViewportRestoreRef.current
          }

          if (window.measlyState) {
            await window.measlyState.saveAppState({
              selectedNoteId: loaded.id,
              viewport: pendingViewportRestoreRef.current ?? undefined,
              menu: persistedMenuStateRef.current ?? undefined,
            })
          }

          isApplyingInitialViewportRef.current = true
          setPersistenceReady(true)
          return
        } catch (error) {
          attempt += 1
          console.error(`Failed to initialize note lifecycle (attempt ${attempt})`, error)
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(1500, 200 * attempt)))
        }
      }
    }

    void bootstrap()

    return () => {
      disposed = true
      if (editUiStateSaveTimerRef.current !== null) {
        window.clearTimeout(editUiStateSaveTimerRef.current)
        editUiStateSaveTimerRef.current = null
      }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (appStateSaveTimerRef.current !== null) {
        window.clearTimeout(appStateSaveTimerRef.current)
        appStateSaveTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!persistenceReady) return
    const pending = pendingViewportRestoreRef.current
    if (!pending) return

    let cancelled = false
    isApplyingInitialViewportRef.current = true

    const applyViewport = () => {
      if (cancelled) return
      const adapter = adapterRef.current
      if (!adapter) {
        requestAnimationFrame(applyViewport)
        return
      }

      // Restoring from integer line counts is direct: no clamping or
      // measurement-dependent math happens here (see EditorViewportLines /
      // clampBoundaryLines in Editor.tsx). This call is correct even before
      // the editor's container has been measured.
      ignoreNextUserViewportChangeRef.current = true
      adapter.applySnapshot({
        viewportLines: pending,
      })

      latestViewportRef.current = pending
      latestEditViewportRef.current = pending
      // Keep the pending restore until the editor reports the matching
      // restored viewport. This guards against an intermediate 0/0/0
      // programmatic event that can arrive directly after applySnapshot.
    }

    requestAnimationFrame(applyViewport)

    return () => {
      cancelled = true
      isApplyingInitialViewportRef.current = false
    }
  }, [persistenceReady, activeNoteId, writeDebugEntry])

  useEffect(() => {
    void typingSoundManager.load()
  }, [])

  useEffect(() => {
    typingSoundManager.setLayerGain('click', audioKeyVolume)
  }, [audioKeyVolume])

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

  const shouldPlayTypingSound = useCallback((event: EditorTextChangeEvent) => {
    if (event.source !== 'user-input') return false
    const delta = event.text.length - event.previousText.length
    return delta > 0 && delta <= 8
  }, [])

  const shouldPlayReverseTypingSound = useCallback((event: EditorTextChangeEvent) => {
    if (event.source !== 'user-input') return false
    const delta = event.text.length - event.previousText.length
    return delta < 0 && delta >= -8
  }, [])

  const deriveTypingSoundKeyId = useCallback((event: EditorTextChangeEvent): string | undefined => {
    if (event.source !== 'user-input') return undefined

    const delta = event.text.length - event.previousText.length
    if (delta === 1) {
      const inserted = event.text.slice(event.previousText.length)
      if (inserted.length === 1) {
        return `key:${inserted}`
      }
    }

    if (delta === -1) {
      return 'key:backspace'
    }

    return undefined
  }, [])

  const bindings = useMemo<EditorBindings>(() => ({
    onTextChange: (event: EditorTextChangeEvent) => {
      const keyId = deriveTypingSoundKeyId(event)
      if (shouldPlayTypingSound(event)) {
        void typingSoundManager.playRandomClick({ keyId })
      } else if (shouldPlayReverseTypingSound(event)) {
        void typingSoundManager.playRandomClick({ keyId, reverse: true, detune: 600 })
      }

      const normalizedText = normalizeInternalText(event.text)
      latestEditorTextRef.current = normalizedText
      latestEditorSelectionRef.current = event.selection
      setActiveNoteText(normalizedText)
      setEditorSelection(event.selection)
      setEditorTextVersion((previous) => previous + 1)

      if (!activeNoteId || !persistenceReady || activeNoteHasDebugTag) return

      const noteSummary = notes.find((note) => note.id === activeNoteId)
      const isExternal = noteSummary ? isExternalNote(noteSummary) : false
      const isUserEditableSource =
        event.source === 'user-input' || event.source === 'history-undo' || event.source === 'history-redo'

      if (isExternal && isUserEditableSource) {
        console.warn('[external-note] editor text change detected for external note', {
          noteId: activeNoteId,
          textLength: normalizedText.length,
          source: event.source,
        })

        const originalExternalText = externalNoteOriginalTextByIdRef.current.get(activeNoteId)
        const isCurrentlyModified = originalExternalText !== undefined
          ? normalizedText !== originalExternalText
          : Boolean(noteSummary && noteSummary.hasUnsavedChanges)

        if (noteSummary && noteSummary.hasUnsavedChanges !== isCurrentlyModified) {
          setNotes((previous) => {
            const index = previous.findIndex((note) => note.id === activeNoteId)
            if (index < 0) return previous
            const existing = previous[index]
            if (existing.hasUnsavedChanges === isCurrentlyModified) return previous
            const next = [...previous]
            next[index] = { ...existing, hasUnsavedChanges: isCurrentlyModified }
            return next
          })

          const notesApi = window.measlyNotes
          if (notesApi) {
            void notesApi.updateExternalNoteState({
              id: activeNoteId,
              hasUnsavedChanges: isCurrentlyModified,
              syncMode: !isCurrentlyModified,
            }).then((updatedSummary) => {
              setNotes((previous) => {
                const index = previous.findIndex((note) => note.id === updatedSummary.id)
                if (index < 0) return previous
                const existing = previous[index]
                if (isSameNoteSummary(existing, updatedSummary)) return previous
                const next = [...previous]
                next[index] = updatedSummary
                return next
              })
            }).catch((error) => {
              console.error('[external-note] failed to persist unsaved state', { noteId: activeNoteId, isCurrentlyModified, error })
            })
          }
        }
      }

      if (!isUserEditableSource) {
        // Do not derive save/pause transitions from hydration/programmatic events.
        return
      }

      updateActiveNoteTitlePreview(normalizedText)
      queueSave(normalizedText)
    },
    onSelectionChange: (event: EditorSelectionChangeEvent) => {
      latestEditorSelectionRef.current = event.selection
      setEditorSelection(event.selection)

      if (!isPreviewMode && activeNoteId) {
        const cached = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
        if (cached) {
          updateEditModeSnapshotCache({
            ...cached,
            collapsedSelection: {
              anchor: event.selection.end,
              focus: event.selection.end,
              start: event.selection.end,
              end: event.selection.end,
              isCollapsed: true,
            },
            fullSelection: event.selection,
          })
        }
      }
    },
    onTabIndentTransform: ({ shiftKey, text, selection }) => {
      if (!activeNoteId || activeNoteHasDebugTag) return null

      const sourceText = normalizeInternalText(text)
      const lineContext = resolveMarkdownSelectionContext(sourceText, selection).line

      if (lineContext.headingLevel > 0) {
        const nextHeadingLevel = shiftKey
          ? Math.max(1, lineContext.headingLevel - 1)
          : Math.min(6, lineContext.headingLevel + 1)

        if (nextHeadingLevel !== lineContext.headingLevel) {
          const nextLineText = lineContext.lineText.replace(
            /^(\s*(?:>\s*)*)#{1,6}(?=\s|$)/,
            `$1${'#'.repeat(nextHeadingLevel)}`,
          )

          if (nextLineText !== lineContext.lineText) {
            const nextText = `${sourceText.slice(0, lineContext.lineStart)}${nextLineText}${sourceText.slice(lineContext.lineEndExclusive)}`
            const markerMatch = lineContext.lineText.match(/^(\s*(?:>\s*)*)#{1,6}/)
            const markerStart = lineContext.lineStart + (markerMatch ? markerMatch[1].length : 0)
            const oldMarkerEnd = markerStart + lineContext.headingLevel
            const headingDelta = nextHeadingLevel - lineContext.headingLevel

            const remapSelectionOffset = (offset: number) => {
              if (offset <= markerStart) return offset
              if (offset <= oldMarkerEnd) {
                const relative = offset - markerStart
                return markerStart + Math.min(relative, nextHeadingLevel)
              }
              return offset + headingDelta
            }

            const nextAnchor = Math.max(0, Math.min(nextText.length, remapSelectionOffset(selection.anchor)))
            const nextFocus = Math.max(0, Math.min(nextText.length, remapSelectionOffset(selection.focus)))
            const nextSelection: EditorSelectionState = {
              anchor: nextAnchor,
              focus: nextFocus,
              start: Math.min(nextAnchor, nextFocus),
              end: Math.max(nextAnchor, nextFocus),
              isCollapsed: nextAnchor === nextFocus,
            }

            latestEditorTextRef.current = nextText
            setActiveNoteText(nextText)
            setEditorTextVersion((previous) => previous + 1)
            updateActiveNoteTitlePreview(nextText)
            queueSave(nextText)

            latestEditorSelectionRef.current = nextSelection
            setEditorSelection(nextSelection)
            return { text: nextText, selection: nextSelection }
          }
        }
      }

      const direction = shiftKey ? 'outdent' : 'indent'
      const next = indentSelectionByStep(sourceText, selection, direction, 3)

      const didTextChange = next.text !== sourceText
      const didSelectionChange =
        next.selection.anchor !== selection.anchor ||
        next.selection.focus !== selection.focus

      if (!didTextChange && !didSelectionChange) {
        return null
      }

      latestEditorTextRef.current = next.text
      setActiveNoteText(next.text)
      setEditorTextVersion((previous) => previous + 1)
      updateActiveNoteTitlePreview(next.text)
      queueSave(next.text)

      latestEditorSelectionRef.current = next.selection
      setEditorSelection(next.selection)
      return { text: next.text, selection: next.selection }
    },
    onMarkdownShortcutTransform: ({ shortcut, text, selection }) => {
      if (!activeNoteId || activeNoteHasDebugTag) return null

      const sourceText = normalizeInternalText(text)
      let next: { text: string; selection: EditorSelectionState } | null = null

      if (shortcut === 'bold' || shortcut === 'italic' || shortcut === 'strikethrough') {
        next = buildTextDecorationTransform(sourceText, selection, shortcut)
      } else if (shortcut === 'heading-toggle') {
        next = buildToggleCurrentLineHeadingTransform(sourceText, selection)
      } else if (shortcut === 'unordered-list') {
        next = buildToggleBulletedListTransform(sourceText, selection)
      } else if (shortcut === 'ordered-list') {
        next = buildToggleNumberedListTransform(sourceText, selection)
      }

      if (!next) return null

      latestEditorTextRef.current = next.text
      setActiveNoteText(next.text)
      setEditorTextVersion((previous) => previous + 1)
      updateActiveNoteTitlePreview(next.text)
      queueSave(next.text)
      latestEditorSelectionRef.current = next.selection
      setEditorSelection(next.selection)
      return next
    },
    onCharacterInsertTransform: ({ char, text, selection }) => {
      if (!activeNoteId || activeNoteHasDebugTag) return null

      const sourceText = normalizeInternalText(text)
      const next = resolveMarkdownChecklistTypeoverTransform({
        char,
        text: sourceText,
        selection,
      })
      if (!next) {
        return null
      }

      latestEditorTextRef.current = next.text
      setActiveNoteText(next.text)
      setEditorTextVersion((previous) => previous + 1)
      updateActiveNoteTitlePreview(next.text)
      queueSave(next.text)
      latestEditorSelectionRef.current = next.selection
      setEditorSelection(next.selection)
      return next
    },
    onEnterTransform: (event) => {
      if (!activeNoteId || activeNoteHasDebugTag) return null
      void typingSoundManager.playRandomClick({ detune: -500 })
      const next = resolveMarkdownEnterTransform(event)
      if (!next) {
        return null
      }

      latestEditorTextRef.current = next.text
      setActiveNoteText(next.text)
      setEditorTextVersion((previous) => previous + 1)
      updateActiveNoteTitlePreview(next.text)
      queueSave(next.text)

      latestEditorSelectionRef.current = next.selection
      setEditorSelection(next.selection)

      return {
        text: next.text,
        selection: next.selection,
      }
    },
    onViewportChange: (event: EditorViewportChangeEvent) => {
      if (ignoreNextUserViewportChangeRef.current && event.source === 'user-input') {
        ignoreNextUserViewportChangeRef.current = false
        return
      }

      const pendingRestore = pendingViewportRestoreRef.current
      if (pendingRestore) {
        if (event.source === 'programmatic' && areMatchingViewportLines(pendingRestore, event.viewport)) {
          pendingViewportRestoreRef.current = null
          isApplyingInitialViewportRef.current = false
        } else {
          return
        }
      }

      if (event.source !== 'user-input') {
        return
      }

      const isViewportDrag = event.origin === 'viewport-drag'
      const isScroll = event.origin === 'scroll'
      if (!isViewportDrag && !isScroll) {
        return
      }

      // Derive line counts directly from the event's px values rather than
      // re-reading via adapterRef.current?.getSnapshot(). The adapter object
      // is recreated on the same render cycle as a boundary drag (because
      // buildViewportLines is in its dep array), causing adapterRef.current
      // to be briefly null between the old adapter's cleanup and the new
      // adapter's setup — exactly when this handler fires. Re-reading through
      // the adapter would return null and fall back to stale 0/0/0 values.
      // Reading from the event is safe: it carries the values from the render
      // that triggered this effect, so they're always current.
      const lh = Math.max(1, event.viewport.lineHeightPx)
      const nextViewport: PersistedViewportState = {
        topBoundaryLines: Math.max(0, Math.round(event.viewport.topBoundaryPx / lh)),
        bottomBoundaryLines: Math.max(0, Math.round(event.viewport.bottomBoundaryPx / lh)),
        scrollTopLines: Math.max(0, Math.round(event.viewport.scrollTopPx / lh)),
      }
      const nextTelemetry = {
        scrollTopPx: Math.round(event.viewport.scrollTopPx),
        scrollHeightPx: Math.max(0, Math.round(event.viewport.scrollHeightPx ?? 0)),
        clientHeightPx: Math.max(0, Math.round(event.viewport.clientHeightPx ?? 0)),
      }
      latestViewportRef.current = nextViewport
      latestEditViewportRef.current = nextViewport
      latestEditViewportTelemetryRef.current = nextTelemetry

      if (!isPreviewMode && activeNoteId) {
        const selection = latestEditorSelectionRef.current
        updateEditModeSnapshotCache({
          noteId: activeNoteId,
          collapsedSelection: {
            anchor: selection.end,
            focus: selection.end,
            start: selection.end,
            end: selection.end,
            isCollapsed: true,
          },
          fullSelection: selection,
          viewport: nextViewport,
        })
      }

      queueAppStateSave(activeNoteId)
    },
  }), [
    activeNoteId,
    isPreviewMode,
    persistenceReady,
    queueSave,
    queueAppStateSave,
    updateActiveNoteTitlePreview,
    updateEditModeSnapshotCache,
    writeDebugEntry,
  ])

  useEffect(() => {
    latestEditorSelectionRef.current = editorSelection
  }, [editorSelection])

  useEffect(() => {
    if (!hasPreviewModeBaselineRef.current) {
      previousPreviewModeRef.current = isPreviewMode
      if (persistenceReady) {
        hasPreviewModeBaselineRef.current = true
      }
      return
    }

    const wasPreviewMode = previousPreviewModeRef.current
    previousPreviewModeRef.current = isPreviewMode

    if (!persistenceReady || !activeNoteId) return

    if (wasPreviewMode && !isPreviewMode) {
      pendingRenderViewSourceAnchorRef.current = null
    }

    const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)

    if (!wasPreviewMode && isPreviewMode) {
      const liveSnapshot = adapterRef.current?.getSnapshot()
      const selection = liveSnapshot?.selection ?? latestEditorSelectionRef.current
      const snapshotViewport = liveSnapshot?.viewport
      const snapshotViewportLines = liveSnapshot?.viewportLines
      const viewport: PersistedViewportState | null = snapshotViewportLines
        ? {
            topBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.topBoundaryLines)),
            bottomBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.bottomBoundaryLines)),
            scrollTopLines: Math.max(0, Math.round(snapshotViewportLines.scrollTopLines)),
          }
        : (latestEditViewportRef.current ?? latestViewportRef.current)

      if (snapshotViewportLines) {
        latestViewportRef.current = viewport
        latestEditViewportRef.current = viewport
      }

      if (snapshotViewport) {
        latestEditViewportTelemetryRef.current = {
          scrollTopPx: Math.round(snapshotViewport.scrollTopPx),
          scrollHeightPx: Math.max(0, Math.round(snapshotViewport.scrollHeightPx ?? 0)),
          clientHeightPx: Math.max(0, Math.round(snapshotViewport.clientHeightPx ?? 0)),
        }
      }

      if (viewport) {
        const collapsedSelection: EditorSelectionState = {
          anchor: selection.end,
          focus: selection.end,
          start: selection.end,
          end: selection.end,
          isCollapsed: true,
        }

        pendingEditRestoreSnapshotRef.current = {
          noteId: activeNoteId,
          collapsedSelection,
          fullSelection: selection,
          viewport,
        }
        updateEditModeSnapshotCache(pendingEditRestoreSnapshotRef.current)
      }

      persistEditUiState(activeNoteId, { immediate: true })
      return
    }

    if (!wasPreviewMode || isPreviewMode) {
      return
    }

    // Single-owner restore rule: render->edit transition owns restore for the
    // current note. Mark this note as handled so the note-activation effect
    // does not race in with a second restore source.
    previousActiveNoteIdForEditRestoreRef.current = activeNoteId

    const cachedSnapshot = pendingEditRestoreSnapshotRef.current

    if (cachedSnapshot && cachedSnapshot.noteId === activeNoteId) {
      pendingEditRestoreSnapshotRef.current = null
applyEditRestoreSnapshot(cachedSnapshot, { restoreFullSelection: true, focusAfterApply: true, onComplete: () => setIsCaretSuspended(false) })
      return
    }

    const memorySnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    if (memorySnapshot) {
applyEditRestoreSnapshot(memorySnapshot, { restoreFullSelection: true, focusAfterApply: true, onComplete: () => setIsCaretSuspended(false) })
      return
    }

    let cancelled = false

    const restoreFromPersistedEditState = async () => {
      try {
        const uiState = await window.measlyNotes?.getNoteUiState({ id: activeNoteId })
        if (cancelled) return

        const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
        const fallbackSnapshot = buildEditRestoreSnapshotFromUiState({
          noteId: activeNoteId,
          text: activeText,
          uiState,
          fallbackViewport,
          lineHeightPx: editorRuntimeMetrics.lineHeightPx,
        })
        updateEditModeSnapshotCache(fallbackSnapshot)

applyEditRestoreSnapshot(fallbackSnapshot, { restoreFullSelection: false, focusAfterApply: true, onComplete: () => setIsCaretSuspended(false) })
      } catch (error) {
        console.warn('Failed to restore edit mode state from persisted UI data', error)
      }
    }

    void restoreFromPersistedEditState()

    return () => {
      cancelled = true
    }
  }, [
    activeNoteText,
    activeNoteId,
    applyEditRestoreSnapshot,
    editorRuntimeMetrics.lineHeightPx,
    isPreviewMode,
    persistEditUiState,
    persistenceReady,
    updateEditModeSnapshotCache,
  ])

  const captureEditModeSnapshotForRenderView = useCallback((noteId: string, activeText: string) => {
    const snapshot = captureEditModeSnapshotFromEditor(noteId)
    const viewport = snapshot?.viewport ?? latestEditViewportRef.current ?? latestViewportRef.current

    if (!viewport) {
      pendingRenderViewSourceAnchorRef.current = null
      return
    }

    const anchor = resolveSourceAnchorFromEditState({
      text: activeText,
      lineHeightPx: editorRuntimeMetrics.lineHeightPx,
      telemetry: latestEditViewportTelemetryRef.current ?? undefined,
      viewport,
    })

    pendingRenderViewSourceAnchorRef.current = anchor
  }, [captureEditModeSnapshotFromEditor, editorRuntimeMetrics.lineHeightPx])

  const toggleRenderViewMode = useCallback(async () => {
    if (isPreviewMode && activeNoteId) {
      try {
        await persistRenderViewStateForNoteNow(activeNoteId)
        const uiState = await window.measlyNotes?.getNoteUiState({ id: activeNoteId })
        if (uiState) {
          const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
          const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
          const restoreSnapshot = buildEditRestoreSnapshotFromUiState({
            noteId: activeNoteId,
            text: activeText,
            uiState,
            fallbackViewport,
            lineHeightPx: editorRuntimeMetrics.lineHeightPx,
          })
          pendingEditRestoreSnapshotRef.current = restoreSnapshot
          updateEditModeSnapshotCache(restoreSnapshot)
        }
      } catch (error) {
        console.warn('Failed to persist render view state before toggling mode', error)
      }

      pendingRenderViewSourceAnchorRef.current = null
    }

    setIsPreviewMode((previous) => {
      if (!previous && activeNoteId) {
        const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
        setActiveNoteText(activeText)
        captureEditModeSnapshotForRenderView(activeNoteId, activeText)
      }
      return !previous
    })
  }, [activeNoteId, activeNoteText, captureEditModeSnapshotForRenderView, editorRuntimeMetrics.lineHeightPx, isPreviewMode, persistRenderViewStateForNoteNow, updateEditModeSnapshotCache])

  const handleExportPdf = useCallback(async () => {
    if (!activeNoteId || isExportingPdf) return
    setIsExportingPdf(true)

    try {
      const exportApi = window.measlyExport
      const exportPdf = exportApi
        ? exportApi.exportPdf
        : (folderPath: string, fileName: string, htmlContent?: string) => window.ipcRenderer?.invoke('export-pdf', folderPath, fileName, htmlContent)

      const folderPath = exportFolder ?? await chooseExportFolder()
      if (!folderPath) return

      const fileName = `${deriveNoteTitleFromText(activeNoteText || '')}.pdf`
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
  }, [activeNoteId, activeNoteText, exportFolder, isExportingPdf, chooseExportFolder, buildExportHtmlContent])

  const handleExportMd = useCallback(async (forceChooseFolder = false) => {
    if (!activeNoteId || isExportingMd) return
    setIsExportingMd(true)

    try {
      const folderPath = (!exportFolder || forceChooseFolder)
        ? await chooseExportFolder()
        : exportFolder
      if (!folderPath) return

      const fileName = `${deriveNoteTitleFromText(activeNoteText || '')}.md`
      const result = await window.ipcRenderer?.invoke('export-md', activeNoteId, folderPath, fileName)

      if (!result?.ok) {
        console.error('Export MD failed', result?.error)
      }
    } catch (error) {
      console.error('Export MD failed', error)
    } finally {
      setIsExportingMd(false)
    }
  }, [activeNoteId, activeNoteText, exportFolder, isExportingMd, chooseExportFolder])

  useEffect(() => {
    if (!window.measlyState || !activeNoteId) return
    queueAppStateSave(activeNoteId)
  }, [activeNoteId, queueAppStateSave])

  useEffect(() => {
    if (!persistenceReady || !activeNoteId) return

    let cancelled = false

    const preloadEditModeSnapshot = async () => {
      try {
        const uiState = await window.measlyNotes?.getNoteUiState({ id: activeNoteId })
        if (cancelled) return

        const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
        const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
        const snapshot = buildEditRestoreSnapshotFromUiState({
          noteId: activeNoteId,
          text: activeText,
          uiState,
          fallbackViewport,
          lineHeightPx: editorRuntimeMetrics.lineHeightPx,
        })
        updateEditModeSnapshotCache(snapshot)
      } catch (error) {
        console.warn('Failed to preload edit mode snapshot for active note', error)
      }
    }

    void preloadEditModeSnapshot()

    return () => {
      cancelled = true
    }
  }, [activeNoteId, activeNoteText, editorRuntimeMetrics.lineHeightPx, persistenceReady, updateEditModeSnapshotCache])

  useEffect(() => {
    if (isPreviewMode) return
    if (!persistenceReady) return
    if (!activeNoteId) {
      // Reset the restore sentinel when editor selection is cleared.
      // Without this, re-selecting the same note id after a clear path can
      // skip edit-mode restore and leave the remounted editor unhydrated.
      previousActiveNoteIdForEditRestoreRef.current = null
      return
    }

    const wasPreviewMode = previousPreviewModeRef.current
    const previousActiveNoteId = previousActiveNoteIdForEditRestoreRef.current
    previousActiveNoteIdForEditRestoreRef.current = activeNoteId
    if (previousActiveNoteId === activeNoteId && !wasPreviewMode) {
      // Note identity did not change and we are not returning from preview.
      // Avoid re-restoring on plain edit-mode re-renders or same-note updates.
      return
    }

    const cachedSnapshot = pendingEditRestoreSnapshotRef.current
    if (cachedSnapshot && cachedSnapshot.noteId === activeNoteId) {
      pendingEditRestoreSnapshotRef.current = null
      applyEditRestoreSnapshot(cachedSnapshot, {
        restoreFullSelection: true,
        focusAfterApply: true,
        onComplete: () => setIsCaretSuspended(false),
      })
      return
    }

    const memorySnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    if (memorySnapshot && !wasPreviewMode) {
      applyEditRestoreSnapshot(memorySnapshot, {
        restoreFullSelection: true,
        focusAfterApply: true,
        onComplete: () => setIsCaretSuspended(false),
      })
      return
    }

    let cancelled = false

    const restorePersistedEditState = async () => {
      try {
        const uiState = await window.measlyNotes?.getNoteUiState({ id: activeNoteId })
        if (cancelled) return

        const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
        const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
        const restoreSnapshot = buildEditRestoreSnapshotFromUiState({
          noteId: activeNoteId,
          text: activeText,
          uiState,
          fallbackViewport,
          lineHeightPx: editorRuntimeMetrics.lineHeightPx,
        })
        updateEditModeSnapshotCache(restoreSnapshot)

        applyEditRestoreSnapshot(restoreSnapshot, {
          restoreFullSelection: false,
          onComplete: () => setIsCaretSuspended(false),
        })
      } catch (error) {
        console.warn('Failed to restore persisted edit state on note activation', error)
      }
    }

    void restorePersistedEditState()

    return () => {
      cancelled = true
    }
  }, [
    activeNoteId,
    activeNoteText,
    applyEditRestoreSnapshot,
    editorRuntimeMetrics.lineHeightPx,
    isPreviewMode,
    persistenceReady,
    updateEditModeSnapshotCache,
  ])

  useLayoutEffect(() => {
    if (!isPreviewMode) return
    if (!activeNoteId) return

    let cancelled = false

    const setPreviewScrollBehavior = (behavior: '' | 'auto') => {
      const container = previewScrollRef.current
      if (!container) return
      container.style.scrollBehavior = behavior
    }

    const applyPreviewSourceAnchor = (sourceLine: number) => {
      const container = previewScrollRef.current
      if (!container) return

      const previousScrollBehavior = container.style.scrollBehavior
      container.style.scrollBehavior = 'auto'

      const target = findPreviewSourceAnchorElement(container, sourceLine)
      if (!target) {
        container.style.scrollBehavior = previousScrollBehavior
        return
      }

      requestAnimationFrame(() => {
        if (!container || !document.body.contains(target)) return

        target.scrollIntoView({ block: 'start', inline: 'nearest' })
        container.style.scrollBehavior = previousScrollBehavior
      })
    }

    const pendingSourceAnchor = pendingRenderViewSourceAnchorRef.current
    if (pendingSourceAnchor) {
      pendingRenderViewSourceAnchorRef.current = null
      applyPreviewSourceAnchor(pendingSourceAnchor.sourceAnchorLine)
      return () => {
        cancelled = true
        setPreviewScrollBehavior('')
      }
    }

    const restorePreviewScroll = async () => {
      try {
        const uiState = await window.measlyNotes?.getNoteUiState({ id: activeNoteId })
        if (cancelled) return

        const sourceAnchorLine = uiState?.sourceAnchorLine
        if (typeof sourceAnchorLine === 'number' && Number.isFinite(sourceAnchorLine)) {
          applyPreviewSourceAnchor(sourceAnchorLine)
          return
        }

        // No source anchor available; preserve the current default scroll state.
      } catch (error) {
        console.warn('Failed to restore preview scroll state', error)
      }
    }

    void restorePreviewScroll()

    return () => {
      cancelled = true
      setPreviewScrollBehavior('')
    }
  }, [activeNoteId, isPreviewMode])

  useEffect(() => {
    if (!isPreviewMode) return
    if (!activeNoteId) return

    const container = previewScrollRef.current
    if (!container) return

    const persistPreviewScroll = () => {
      if (previewScrollSaveTimerRef.current !== null) {
        window.clearTimeout(previewScrollSaveTimerRef.current)
      }

      previewScrollSaveTimerRef.current = window.setTimeout(() => {
        previewScrollSaveTimerRef.current = null
        const sourceAnchor = resolvePreviewSourceAnchorFromContainer(container)
        if (!sourceAnchor) return
        const payload: { sourceAnchorLine: number; sourceAnchorText: string | null } = {
          sourceAnchorLine: sourceAnchor.sourceAnchorLine,
          sourceAnchorText: sourceAnchor.sourceAnchorText,
        }
        void window.measlyNotes?.saveNoteUiState({ id: activeNoteId, payload })
      }, 120)
    }

    container.addEventListener('scroll', persistPreviewScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', persistPreviewScroll)
      if (previewScrollSaveTimerRef.current !== null) {
        window.clearTimeout(previewScrollSaveTimerRef.current)
        previewScrollSaveTimerRef.current = null
      }
    }
  }, [activeNoteId, isPreviewMode])

  useEffect(() => {
    if (!persistenceReady) return

    const externalApi = window.measlyExternalFiles
    if (!externalApi || !window.measlyNotes) return

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

    const updateShellWidth = () => {
      setAppShellWidthPx(Math.max(APP_GRID_MIN_WIDTH_PX, Math.round(shellElement.clientWidth)))
    }

    updateShellWidth()

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setAppShellWidthPx(Math.max(APP_GRID_MIN_WIDTH_PX, Math.round(entry.contentRect.width)))
    })

    observer.observe(shellElement)
    return () => observer.disconnect()
  }, [])

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [notes])

  const searchedNotes = useMemo(() => {
    return sortedNotes.filter((note) => matchesSearchQuery(note, searchQuery, isSearchQueryCaseSensitive))
  }, [isSearchQueryCaseSensitive, searchQuery, sortedNotes])

  const isFindMode = sidebarMode === 'find'
  const currentEditorText = useMemo(() => {
    return normalizeInternalText(latestEditorTextRef.current || activeNoteText)
  }, [activeNoteText, editorTextVersion])

  const activeNoteDocumentStats = useMemo(() => {
    const hasSelection = !editorSelection.isCollapsed && editorSelection.end > editorSelection.start
    const selectionStart = Math.max(0, Math.min(currentEditorText.length, editorSelection.start))
    const selectionEnd = Math.max(selectionStart, Math.min(currentEditorText.length, editorSelection.end))
    const text = hasSelection
      ? currentEditorText.slice(selectionStart, selectionEnd)
      : currentEditorText
    const characterCount = text.length
    const trimmed = text.trim()
    const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length

    return {
      wordCount,
      characterCount,
    }
  }, [currentEditorText, editorSelection.end, editorSelection.isCollapsed, editorSelection.start])

  const documentFindDirective = useMemo<DocumentFindDirective>(() => {
    return resolveDocumentFindDirective(documentFindQuery, currentEditorText, isDocumentFindCaseSensitive)
  }, [currentEditorText, documentFindQuery, isDocumentFindCaseSensitive])

  const previewSearchHighlightPlugin = useMemo(
    () => createPreviewSearchHighlightRehypePlugin(documentFindDirective.findText, isDocumentFindCaseSensitive),
    [documentFindDirective.findText, isDocumentFindCaseSensitive],
  )

  const previewSourceAnchorPlugin = useMemo(
    () => createPreviewSourceAnchorRehypePlugin(),
    [],
  )

  // Memoized so per-frame App re-renders (scroll thumb state, etc.) do not
  // trigger a full ReactMarkdown reconciliation of long notes. That heavy
  // reconciliation was stalling the main thread and freezing rAF mid-scroll.
  const previewMarkdownElement = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={PREVIEW_MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={[previewSearchHighlightPlugin, previewSourceAnchorPlugin]}
      components={PREVIEW_MARKDOWN_COMPONENTS}
    >
      {currentEditorText}
    </ReactMarkdown>
  ), [currentEditorText, previewSearchHighlightPlugin, previewSourceAnchorPlugin])

  const documentFindHits = useMemo<DocumentFindHit[]>(() => {
    return buildDocumentFindHits(currentEditorText, documentFindDirective.findText, isDocumentFindCaseSensitive)
  }, [currentEditorText, documentFindDirective.findText, isDocumentFindCaseSensitive])

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
    return filterNotesBySelectedDate(dateEligibleNotes)
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

  const isNoteDisplayedInCurrentMenu = useCallback((noteId: string): boolean => {
    if (sidebarMode === 'date') {
      return dateFilteredNotes.some((note) => note.id === noteId)
    }

    if (sidebarMode === 'trash') {
      return trashFilteredNotes.some((note) => note.id === noteId)
    }

    if (sidebarMode === 'category') {
      for (const primary of categoryTreeRef.current) {
        for (const secondary of primary.secondary) {
          for (const tertiary of secondary.tertiary) {
            if (tertiary.notes.some((note) => note.id === noteId)) {
              return true
            }
          }
        }
      }
      return false
    }

    if (sidebarMode === 'archive') {
      for (const primary of archiveTreeRef.current) {
        for (const secondary of primary.secondary) {
          for (const tertiary of secondary.tertiary) {
            if (tertiary.notes.some((note) => note.id === noteId)) {
              return true
            }
          }
        }
      }
      return false
    }

    return true
  }, [sidebarMode, dateFilteredNotes, trashFilteredNotes])

  useEffect(() => {
    if (sidebarMode !== 'date' && sidebarMode !== 'trash' && sidebarMode !== 'category' && sidebarMode !== 'archive') {
      return
    }

    if (!activeNoteId) {
      // No active note — auto-load the first available note in date/trash/category/archive.
      const firstId = getNextActiveNoteIdAfterRemoval('')
      if (firstId) {
        void activateNote(firstId)
      }
      return
    }

    if (isNoteDisplayedInCurrentMenu(activeNoteId)) {
      return
    }

    // In tree views (category/archive), a note may not appear in that tree but
    // still exists — keep it in the editor without replacement.
    if (sidebarMode === 'category' || sidebarMode === 'archive') {
      return
    }

    const nextActiveId = getNextActiveNoteIdAfterRemoval(activeNoteId)
    if (nextActiveId) {
      void activateNote(nextActiveId)
    } else {
      setActiveNoteId(null)
      setActiveNoteText('')
    }
  }, [activeNoteId, sidebarMode, isNoteDisplayedInCurrentMenu, getNextActiveNoteIdAfterRemoval, activateNote])
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
  const applyPreviewThumbDom = useCallback((topPx: number, heightPx: number) => {
    previewScrollThumbTopRef.current = topPx
    previewScrollThumbHeightRef.current = heightPx
    const thumbEl = previewScrollbarThumbRef.current
    if (!thumbEl) return
    thumbEl.style.top = `${topPx}px`
    thumbEl.style.height = `${Math.max(0, heightPx)}px`
  }, [])

  const applySidebarThumbDom = useCallback((topPx: number, heightPx: number) => {
    sidebarScrollThumbTopRef.current = topPx
    sidebarScrollThumbHeightRef.current = heightPx
    const thumbEl = sidebarScrollbarThumbRef.current
    if (!thumbEl) return
    thumbEl.style.top = `${topPx}px`
    thumbEl.style.height = `${Math.max(0, heightPx)}px`
  }, [])

  const syncPreviewCustomScrollbar = useCallback((options?: { force?: boolean }) => {
    if (isDraggingPreviewScrollThumb && !options?.force) {
      return
    }

    if (!isPreviewMode) {
      applyPreviewThumbDom(0, 0)
      setIsPreviewScrollThumbActive(false)
      return
    }

    const scroller = previewScrollRef.current
    const track = previewScrollbarTrackRef.current
    if (!scroller) return

    if (previewTextureRef.current) {
      syncTextureToScroll(scroller.scrollTop, previewTextureRef.current)
    }

    if (!track) return

    const viewportHeight = scroller.clientHeight
    const contentHeight = scroller.scrollHeight
    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    if (viewportHeight <= 0 || contentHeight <= 0 || trackHeight <= 0) {
      applyPreviewThumbDom(0, 0)
      setIsPreviewScrollThumbActive(false)
      return
    }

    if (contentHeight <= viewportHeight) {
      applyPreviewThumbDom(SCROLL_TRACK_EDGE_GAP_PX, usableTrackHeight)
      setIsPreviewScrollThumbActive(false)
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

    applyPreviewThumbDom(nextThumbTop, nextThumbHeight)
    setIsPreviewScrollThumbActive(true)
  }, [applyPreviewThumbDom, isDraggingPreviewScrollThumb, isPreviewMode])

  const previewScrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = previewScrollRef.current
    const track = previewScrollbarTrackRef.current
    if (!scroller || !track) return

    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - previewScrollThumbHeightRef.current)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(thumbTopPx, maxThumbTop))
    applyPreviewThumbDom(clampedTop, previewScrollThumbHeightRef.current)
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0
    scroller.scrollTop = ratio * maxScrollTop
  }, [applyPreviewThumbDom])

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
    documentFindHits.length,
    getSidebarScrollerForMode,
    pagedVisibleNotes.length,
    sidebarMode,
    syncSidebarCustomScrollbar,
  ])

  const jumpToPreviewDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    const scroller = previewScrollRef.current
    if (!scroller) return

    const normalizedNeedle = normalizeInternalText(documentFindDirective.findText)
    if (!normalizedNeedle) return

    const hitOrdinal = documentFindHits.findIndex((candidate) => candidate.id === hit.id)
    const compareNeedle = isDocumentFindCaseSensitive ? normalizedNeedle : normalizedNeedle.toLocaleLowerCase()

    type TextSegment = {
      node: Text
      start: number
      end: number
    }

    const segments: TextSegment[] = []
    let aggregateText = ''
    const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      if (node instanceof Text && node.nodeValue && node.nodeValue.length > 0) {
        const value = node.nodeValue
        const start = aggregateText.length
        aggregateText += value
        segments.push({
          node,
          start,
          end: aggregateText.length,
        })
      }
      node = walker.nextNode()
    }

    const haystack = isDocumentFindCaseSensitive ? aggregateText : aggregateText.toLocaleLowerCase()
    const resolvedOrdinal = hitOrdinal >= 0 ? hitOrdinal : 0

    let occurrence = -1
    let cursor = 0
    for (let index = 0; index <= resolvedOrdinal; index += 1) {
      const foundIndex = haystack.indexOf(compareNeedle, cursor)
      if (foundIndex < 0) {
        occurrence = -1
        break
      }
      occurrence = foundIndex
      cursor = foundIndex + Math.max(1, compareNeedle.length)
    }

    const fallbackTarget = (() => {
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      if (maxScrollTop <= 0) return 0
      const ratio = clamp(hit.index / Math.max(1, currentEditorText.length), 0, 1)
      return ratio * maxScrollTop
    })()

    if (occurrence < 0 || segments.length === 0) {
      scrollToNonQuantizedSmooth(scroller, fallbackTarget, {
        onStep: () => syncPreviewCustomScrollbar(),
      })
      return
    }

    const startSegment = segments.find((segment) => occurrence >= segment.start && occurrence < segment.end)
    if (!startSegment) {
      scrollToNonQuantizedSmooth(scroller, fallbackTarget, {
        onStep: () => syncPreviewCustomScrollbar(),
      })
      return
    }

    const endOffsetGlobal = occurrence + Math.max(1, hit.matchLength)
    const endSegment = segments.find((segment) => endOffsetGlobal > segment.start && endOffsetGlobal <= segment.end) ?? startSegment

    const startOffsetInNode = Math.max(0, Math.min(startSegment.node.nodeValue?.length ?? 0, occurrence - startSegment.start))
    const endOffsetInNode = Math.max(
      startOffsetInNode,
      Math.min(endSegment.node.nodeValue?.length ?? 0, endOffsetGlobal - endSegment.start),
    )

    const range = document.createRange()
    range.setStart(startSegment.node, startOffsetInNode)
    range.setEnd(endSegment.node, endOffsetInNode)

    const rect = range.getBoundingClientRect()
    if (rect.height <= 0 && rect.width <= 0) {
      scrollToNonQuantizedSmooth(scroller, fallbackTarget, {
        onStep: () => syncPreviewCustomScrollbar(),
      })
      return
    }

    const scrollerRect = scroller.getBoundingClientRect()
    const absoluteTop = scroller.scrollTop + (rect.top - scrollerRect.top)
    const targetScrollTop = absoluteTop - (scroller.clientHeight * 0.35)
    scrollToNonQuantizedSmooth(scroller, targetScrollTop, {
      onStep: () => syncPreviewCustomScrollbar(),
    })
  }, [
    currentEditorText.length,
    documentFindDirective.findText,
    documentFindHits,
    isDocumentFindCaseSensitive,
    syncPreviewCustomScrollbar,
  ])

  const handleJumpToDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    if (isPreviewMode) {
      jumpToPreviewDocumentFindHit(hit)
      return
    }

    const adapter = adapterRef.current
    if (!adapter) return

    adapter.applySnapshot({
      selection: {
        anchor: hit.index,
        focus: hit.index + hit.matchLength,
        start: hit.index,
        end: hit.index + hit.matchLength,
        isCollapsed: false,
      },
    })
  }, [isPreviewMode, jumpToPreviewDocumentFindHit])

  const applyProgrammaticEditorText = useCallback((nextText: string, selectionStart?: number, selectionEnd?: number) => {
    if (activeNoteHasDebugTag) return

    const normalizedText = normalizeInternalText(nextText)
    latestEditorTextRef.current = normalizedText
    setActiveNoteText(normalizedText)
    setEditorTextVersion((previous) => previous + 1)
    updateActiveNoteTitlePreview(normalizedText)
    queueSave(normalizedText)

    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      const safeSelectionStart = Math.max(0, Math.min(selectionStart, normalizedText.length))
      const safeSelectionEnd = Math.max(0, Math.min(selectionEnd, normalizedText.length))
      const nextSelection: EditorSelectionState = {
        anchor: safeSelectionStart,
        focus: safeSelectionEnd,
        start: Math.min(safeSelectionStart, safeSelectionEnd),
        end: Math.max(safeSelectionStart, safeSelectionEnd),
        isCollapsed: safeSelectionStart === safeSelectionEnd,
      }

      // Keep local selection state in sync with programmatic transforms so
      // subsequent operations never remap from stale offsets.
      latestEditorSelectionRef.current = nextSelection
      setEditorSelection(nextSelection)

      requestAnimationFrame(() => {
        adapterRef.current?.applySnapshot({
          selectionScrollBehavior: 'preserve-scroll',
          selection: nextSelection,
        })
      })
    }
  }, [queueSave, updateActiveNoteTitlePreview])

  const replaceDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    const sourceText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const directive = resolveDocumentFindDirective(documentFindQuery, sourceText, isDocumentFindCaseSensitive)

    // Right-click should still behave like a normal jump when replace mode is not active.
    if (!directive.isReplaceMode || !directive.findText) {
      handleJumpToDocumentFindHit(hit)
      return
    }

    const selectedText = sourceText.slice(hit.index, hit.index + hit.matchLength)
    const selectedComparable = isDocumentFindCaseSensitive ? selectedText : selectedText.toLowerCase()
    const findComparable = isDocumentFindCaseSensitive ? directive.findText : directive.findText.toLowerCase()
    if (selectedComparable !== findComparable) {
      // If content shifted since hit computation, just jump to keep behavior predictable.
      handleJumpToDocumentFindHit(hit)
      return
    }

    const nextText = `${sourceText.slice(0, hit.index)}${directive.replaceText}${sourceText.slice(hit.index + hit.matchLength)}`
    const replacementEnd = hit.index + directive.replaceText.length
    applyProgrammaticEditorText(nextText, hit.index, replacementEnd)
  }, [activeNoteText, applyProgrammaticEditorText, documentFindQuery, handleJumpToDocumentFindHit, isDocumentFindCaseSensitive])

  const replaceAllDocumentFindHits = useCallback(() => {
    const sourceText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const directive = resolveDocumentFindDirective(documentFindQuery, sourceText, isDocumentFindCaseSensitive)
    if (!directive.isReplaceMode || !directive.findText) {
      return
    }

    const hits = buildDocumentFindHits(sourceText, directive.findText, isDocumentFindCaseSensitive)
    if (hits.length === 0) {
      return
    }

    let cursor = 0
    let nextText = ''
    for (const hit of hits) {
      nextText += sourceText.slice(cursor, hit.index)
      nextText += directive.replaceText
      cursor = hit.index + hit.matchLength
    }
    nextText += sourceText.slice(cursor)

    const firstHitStart = hits[0]?.index ?? 0
    const firstHitEnd = firstHitStart + directive.replaceText.length
    applyProgrammaticEditorText(nextText, firstHitStart, firstHitEnd)
  }, [activeNoteText, applyProgrammaticEditorText, documentFindQuery, isDocumentFindCaseSensitive])

  const isSelectionWrappedBy = useCallback((text: string, selection: EditorSelectionState, open: string, close: string) => {
    const start = Math.max(0, Math.min(selection.start, text.length))
    const end = Math.max(start, Math.min(selection.end, text.length))

    return (
      start >= open.length &&
      text.slice(start - open.length, start) === open &&
      text.slice(end, end + close.length) === close
    )
  }, [])

  const markdownSelectionContext = useMemo(
    () => resolveMarkdownSelectionContext(currentEditorText, editorSelection),
    [currentEditorText, editorSelection],
  )

  const activeDecorationFormats = useMemo(() => {
    const active = new Set<TextDecorationFormat>()

    if (markdownSelectionContext.inline.inBold) {
      active.add('bold')
    }
    if (markdownSelectionContext.inline.inItalic) {
      active.add('italic')
    }
    if (markdownSelectionContext.inline.inStrikethrough) {
      active.add('strikethrough')
    }

    return active
  }, [markdownSelectionContext])

  const activeHeadingLevel = markdownSelectionContext.line.headingLevel
  const isChecklistActive = /^\s*(?:>\s*)*[-*+]\s+\[[ xX]\]\s+/.test(markdownSelectionContext.line.lineText)
  const isBulletedListActive = markdownSelectionContext.line.listKind === 'unordered' && !isChecklistActive
  const isNumberedListActive = markdownSelectionContext.line.listKind === 'ordered'
  const isBlockquoteActive = markdownSelectionContext.line.blockquoteDepth > 0
  const isCodeBlockActive = markdownSelectionContext.inline.inFencedCodeBlock
  const isInlineCodeActive = markdownSelectionContext.inline.inInlineCode

  useEffect(() => {
    if (activeHeadingLevel > 0) {
      lastHeadlineLevelRef.current = activeHeadingLevel as 1 | 2 | 3 | 4 | 5 | 6
    }
  }, [activeHeadingLevel])

  const buildTextDecorationTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
    format: TextDecorationFormat,
  ): { text: string; selection: EditorSelectionState } | null => {
    const marker = TEXT_DECORATION_MARKERS[format]
    const selectionStart = Math.max(0, Math.min(baseSelection.start, sourceText.length))
    const selectionEnd = Math.max(selectionStart, Math.min(baseSelection.end, sourceText.length))

    const isWordChar = (char: string) => /[A-Za-z0-9_]/.test(char)
    let start = selectionStart
    let end = selectionEnd

    if (baseSelection.isCollapsed) {
      let left = selectionStart
      let right = selectionStart

      while (left > 0 && isWordChar(sourceText[left - 1])) {
        left -= 1
      }
      while (right < sourceText.length && isWordChar(sourceText[right])) {
        right += 1
      }

      if (right > left) {
        start = left
        end = right
      }
    }

    const selectionForOperation: EditorSelectionState = {
      anchor: start,
      focus: end,
      start,
      end,
      isCollapsed: start === end,
    }

    const inlineContext = resolveMarkdownSelectionContext(sourceText, selectionForOperation).inline
    const isFormatActive = (
      (format === 'bold' && inlineContext.inBold)
      || (format === 'italic' && inlineContext.inItalic)
      || (format === 'strikethrough' && inlineContext.inStrikethrough)
    )
    const hasWrapping = isSelectionWrappedBy(sourceText, selectionForOperation, marker.open, marker.close)

    if (isFormatActive && hasWrapping) {
      const unwrapped = `${sourceText.slice(0, start - marker.open.length)}${sourceText.slice(start, end)}${sourceText.slice(end + marker.close.length)}`
      const nextStart = start - marker.open.length
      const nextEnd = nextStart + (end - start)
      return {
        text: unwrapped,
        selection: {
          anchor: nextStart,
          focus: nextEnd,
          start: nextStart,
          end: nextEnd,
          isCollapsed: nextStart === nextEnd,
        },
      }
    }

    const nextText = `${sourceText.slice(0, start)}${marker.open}${sourceText.slice(start, end)}${marker.close}${sourceText.slice(end)}`
    if (selectionForOperation.isCollapsed) {
      const cursor = start + marker.open.length
      return {
        text: nextText,
        selection: {
          anchor: cursor,
          focus: cursor,
          start: cursor,
          end: cursor,
          isCollapsed: true,
        },
      }
    }

    const nextStart = start + marker.open.length
    const nextEnd = nextStart + (end - start)
    return {
      text: nextText,
      selection: {
        anchor: nextStart,
        focus: nextEnd,
        start: nextStart,
        end: nextEnd,
        isCollapsed: false,
      },
    }
  }, [isSelectionWrappedBy])

  const applyTextDecoration = useCallback((format: TextDecorationFormat) => {
    if (!activeNoteId) return

    const next = buildTextDecorationTransform(currentEditorText, editorSelection, format)
    if (!next) return

    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [activeNoteId, applyProgrammaticEditorText, buildTextDecorationTransform, currentEditorText, editorSelection])

  const resolveSelectionBoundsFromSelection = useCallback((text: string, selection: EditorSelectionState) => {
    const start = Math.max(0, Math.min(selection.start, text.length))
    const end = Math.max(start, Math.min(selection.end, text.length))
    return { start, end }
  }, [])

  const resolveSelectionBounds = useCallback((text: string) => {
    return resolveSelectionBoundsFromSelection(text, editorSelection)
  }, [editorSelection, resolveSelectionBoundsFromSelection])

  const applyWrappedMarker = useCallback((open: string, close: string, collapsedPlaceholder = '') => {
    if (!activeNoteId) return

    const sourceText = currentEditorText
    const { start, end } = resolveSelectionBounds(sourceText)
    const hasWrapping = isSelectionWrappedBy(sourceText, editorSelection, open, close)

    if (hasWrapping) {
      const unwrapped = `${sourceText.slice(0, start - open.length)}${sourceText.slice(start, end)}${sourceText.slice(end + close.length)}`
      const nextStart = start - open.length
      const nextEnd = nextStart + (end - start)
      applyProgrammaticEditorText(unwrapped, nextStart, nextEnd)
      return
    }

    if (editorSelection.isCollapsed && collapsedPlaceholder.length > 0) {
      const nextText = `${sourceText.slice(0, start)}${open}${collapsedPlaceholder}${close}${sourceText.slice(end)}`
      const nextStart = start + open.length
      const nextEnd = nextStart + collapsedPlaceholder.length
      applyProgrammaticEditorText(nextText, nextStart, nextEnd)
      return
    }

    const nextText = `${sourceText.slice(0, start)}${open}${sourceText.slice(start, end)}${close}${sourceText.slice(end)}`
    if (editorSelection.isCollapsed) {
      const cursor = start + open.length
      applyProgrammaticEditorText(nextText, cursor, cursor)
      return
    }

    const nextStart = start + open.length
    const nextEnd = nextStart + (end - start)
    applyProgrammaticEditorText(nextText, nextStart, nextEnd)
  }, [activeNoteId, applyProgrammaticEditorText, currentEditorText, editorSelection, isSelectionWrappedBy, resolveSelectionBounds])

  const resolveLineRange = useCallback((text: string, start: number, end: number) => {
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const endProbe = end > start ? end - 1 : end
    const lineEndNewline = text.indexOf('\n', endProbe)
    const lineEndExclusive = lineEndNewline === -1 ? text.length : lineEndNewline
    return { lineStart, lineEndExclusive }
  }, [])

  const transformSelectedLinesForSelection = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
    transform: (line: string, index: number) => string,
    remapLocalOffsetInLine?: (params: {
      lineIndex: number
      oldLine: string
      newLine: string
      localOffsetInLine: number
    }) => number,
  ): { text: string; selection: EditorSelectionState } => {
    const start = Math.max(0, Math.min(baseSelection.start, sourceText.length))
    const end = Math.max(start, Math.min(baseSelection.end, sourceText.length))
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const selectedBlock = sourceText.slice(lineStart, lineEndExclusive)
    const lines = selectedBlock.split('\n')
    const nextLines = lines.map((line, index) => transform(line, index))
    const nextBlock = nextLines.join('\n')
    const nextText = `${sourceText.slice(0, lineStart)}${nextBlock}${sourceText.slice(lineEndExclusive)}`

    const lengthDelta = nextBlock.length - selectedBlock.length
    const remapOffset = (offset: number) => {
      if (offset <= lineStart) {
        return offset
      }
      if (offset >= lineEndExclusive) {
        return offset + lengthDelta
      }

      const localOffset = offset - lineStart
      let oldCursor = 0
      let newCursor = 0

      for (let index = 0; index < lines.length; index += 1) {
        const oldLineLength = lines[index].length
        const newLineLength = nextLines[index].length
        const oldLineEnd = oldCursor + oldLineLength
        const isLastLine = index === lines.length - 1

        if (localOffset < oldLineEnd) {
          const localOffsetInLine = localOffset - oldCursor
          const remappedLocalOffset = remapLocalOffsetInLine
            ? remapLocalOffsetInLine({
                lineIndex: index,
                oldLine: lines[index],
                newLine: nextLines[index],
                localOffsetInLine,
              })
            : localOffsetInLine
          return lineStart + newCursor + Math.min(Math.max(0, remappedLocalOffset), newLineLength)
        }

        if (localOffset === oldLineEnd) {
          return lineStart + newCursor + newLineLength
        }

        if (!isLastLine) {
          const oldNewlineOffset = oldLineEnd + 1
          const newNewlineOffset = newCursor + newLineLength + 1
          if (localOffset === oldNewlineOffset) {
            return lineStart + newNewlineOffset
          }

          oldCursor = oldNewlineOffset
          newCursor = newNewlineOffset
          continue
        }

        return lineStart + newCursor + newLineLength
      }

      return lineStart + nextBlock.length
    }

    const nextAnchor = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.anchor)))
    const nextFocus = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.focus)))
    return {
      text: nextText,
      selection: {
        anchor: nextAnchor,
        focus: nextFocus,
        start: Math.min(nextAnchor, nextFocus),
        end: Math.max(nextAnchor, nextFocus),
        isCollapsed: nextAnchor === nextFocus,
      },
    }
  }, [resolveLineRange])

  const transformSelectedLines = useCallback((transform: (line: string, index: number) => string) => {
    if (!activeNoteId) return

    const sourceText = currentEditorText
    const next = transformSelectedLinesForSelection(sourceText, latestEditorSelectionRef.current, transform)
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [
    activeNoteId,
    applyProgrammaticEditorText,
    currentEditorText,
    transformSelectedLinesForSelection,
  ])

  const applyHeading = useCallback((level: 1 | 2 | 3 | 4 | 5 | 6) => {
    lastHeadlineLevelRef.current = level
    const headingPrefix = `${'#'.repeat(level)} `

    transformSelectedLines((line) => {
      const withoutAnyHeading = line.replace(/^#{1,6}\s+/, '')
      const alreadyAtLevel = line.startsWith(headingPrefix)
      return alreadyAtLevel ? withoutAnyHeading : `${headingPrefix}${withoutAnyHeading}`
    })
  }, [transformSelectedLines])

  const buildToggleCurrentLineHeadingTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
  ): { text: string; selection: EditorSelectionState } | null => {
    const clampOffset = (offset: number) => Math.max(0, Math.min(offset, sourceText.length))
    const caret = clampOffset(baseSelection.focus)
    const lineStart = sourceText.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
    const lineEndNewline = sourceText.indexOf('\n', caret)
    const lineEndExclusive = lineEndNewline === -1 ? sourceText.length : lineEndNewline
    const lineText = sourceText.slice(lineStart, lineEndExclusive)

    const currentHeadingPrefixMatch = lineText.match(/^(#{1,6}\s*)/)
    if (currentHeadingPrefixMatch) {
      const removedPrefix = currentHeadingPrefixMatch[1]
      const removedLength = removedPrefix.length
      const nextLineText = lineText.slice(removedLength)
      const nextText = `${sourceText.slice(0, lineStart)}${nextLineText}${sourceText.slice(lineEndExclusive)}`

      const remapOffset = (offset: number) => {
        const safeOffset = clampOffset(offset)
        if (safeOffset <= lineStart) return safeOffset
        if (safeOffset <= lineStart + removedLength) return lineStart
        return safeOffset - removedLength
      }

      const nextAnchor = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.anchor)))
      const nextFocus = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.focus)))
      return {
        text: nextText,
        selection: {
          anchor: nextAnchor,
          focus: nextFocus,
          start: Math.min(nextAnchor, nextFocus),
          end: Math.max(nextAnchor, nextFocus),
          isCollapsed: nextAnchor === nextFocus,
        },
      }
    }

    let searchLineEnd = lineStart > 0 ? lineStart - 1 : -1
    let inheritedPrefix: string | null = null

    while (searchLineEnd >= 0) {
      const searchLineStart = sourceText.lastIndexOf('\n', Math.max(0, searchLineEnd - 1)) + 1
      const previousLine = sourceText.slice(searchLineStart, searchLineEnd + 1)
      const previousHeadingPrefixMatch = previousLine.match(/^(#{1,6}\s*)/)
      if (previousHeadingPrefixMatch) {
        inheritedPrefix = previousHeadingPrefixMatch[1]
        break
      }

      if (searchLineStart === 0) {
        break
      }
      searchLineEnd = searchLineStart - 2
    }

    if (!inheritedPrefix) {
      inheritedPrefix = `${'#'.repeat(lastHeadlineLevelRef.current)} `
    }

    const addedLength = inheritedPrefix.length
    const nextLineText = `${inheritedPrefix}${lineText}`
    const nextText = `${sourceText.slice(0, lineStart)}${nextLineText}${sourceText.slice(lineEndExclusive)}`

    const remapOffset = (offset: number) => {
      const safeOffset = clampOffset(offset)
      if (safeOffset <= lineStart) return safeOffset
      return safeOffset + addedLength
    }

    const nextAnchor = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.anchor)))
    const nextFocus = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.focus)))
    return {
      text: nextText,
      selection: {
        anchor: nextAnchor,
        focus: nextFocus,
        start: Math.min(nextAnchor, nextFocus),
        end: Math.max(nextAnchor, nextFocus),
        isCollapsed: nextAnchor === nextFocus,
      },
    }
  }, [])

  const toggleCurrentLineHeading = useCallback(() => {
    if (!activeNoteId) return

    const sourceText = normalizeInternalText(latestEditorTextRef.current || currentEditorText)
    const next = buildToggleCurrentLineHeadingTransform(sourceText, latestEditorSelectionRef.current)
    if (!next) return
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [
    activeNoteId,
    applyProgrammaticEditorText,
    buildToggleCurrentLineHeadingTransform,
    currentEditorText,
  ])

  const buildToggleBulletedListTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
  ): { text: string; selection: EditorSelectionState } => {
    const bulletPattern = /^(\s*(?:>\s*)*)([-*+])\s+/
    const numberedPattern = /^(\s*(?:>\s*)*)(\d+[.)])\s+/

    const splitListPrefix = (line: string) => {
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      const quotePrefix = quotePrefixMatch ? quotePrefixMatch[1] : ''
      const remainder = line.slice(quotePrefix.length)
      const withoutListMarker = remainder.replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      return { quotePrefix, withoutListMarker }
    }

    const { start, end } = resolveSelectionBoundsFromSelection(sourceText, baseSelection)
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const lines = sourceText.slice(lineStart, lineEndExclusive).split('\n')
    const allBulleted = lines.every((line) => line.trim().length === 0 || bulletPattern.test(line))

    const resolveContentStart = (line: string) => {
      const match = line.match(/^(\s*(?:>\s*)*)(?:[-*+]|\d+[.)])\s+/)
      if (match) return match[0].length
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      return quotePrefixMatch ? quotePrefixMatch[0].length : 0
    }

    return transformSelectedLinesForSelection(sourceText, baseSelection, (line) => {
      if (line.trim().length === 0) return line
      const { quotePrefix, withoutListMarker } = splitListPrefix(line)
      if (allBulleted) {
        return bulletPattern.test(line) ? `${quotePrefix}${withoutListMarker}` : line
      }

      const hadNumberedMarker = numberedPattern.test(line)
      const hadBulletedMarker = bulletPattern.test(line)
      if (hadBulletedMarker || hadNumberedMarker) {
        return `${quotePrefix}- ${withoutListMarker}`
      }

      return `${quotePrefix}- ${withoutListMarker}`
    }, ({ oldLine, newLine, localOffsetInLine }) => {
      const oldContentStart = resolveContentStart(oldLine)
      const newContentStart = resolveContentStart(newLine)

      if (localOffsetInLine <= oldContentStart) {
        return Math.min(localOffsetInLine, newContentStart)
      }

      return localOffsetInLine + (newContentStart - oldContentStart)
    })
  }, [resolveLineRange, resolveSelectionBoundsFromSelection, transformSelectedLinesForSelection])

  const buildToggleNumberedListTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
  ): { text: string; selection: EditorSelectionState } => {
    const numberedPattern = /^(\s*(?:>\s*)*)(\d+[.)])\s+/
    const bulletPattern = /^(\s*(?:>\s*)*)([-*+])\s+/

    const splitListPrefix = (line: string) => {
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      const quotePrefix = quotePrefixMatch ? quotePrefixMatch[1] : ''
      const remainder = line.slice(quotePrefix.length)
      const withoutListMarker = remainder.replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      return { quotePrefix, withoutListMarker }
    }

    const { start, end } = resolveSelectionBoundsFromSelection(sourceText, baseSelection)
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const lines = sourceText.slice(lineStart, lineEndExclusive).split('\n')
    const allNumbered = lines.every((line) => line.trim().length === 0 || numberedPattern.test(line))

    const resolveContentStart = (line: string) => {
      const match = line.match(/^(\s*(?:>\s*)*)(?:[-*+]|\d+[.)])\s+/)
      if (match) return match[0].length
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      return quotePrefixMatch ? quotePrefixMatch[0].length : 0
    }

    return transformSelectedLinesForSelection(sourceText, baseSelection, (line, index) => {
      if (line.trim().length === 0) return line
      const { quotePrefix, withoutListMarker } = splitListPrefix(line)
      if (allNumbered) {
        return numberedPattern.test(line) ? `${quotePrefix}${withoutListMarker}` : line
      }

      const hadNumberedMarker = numberedPattern.test(line)
      const hadBulletedMarker = bulletPattern.test(line)
      if (hadNumberedMarker || hadBulletedMarker) {
        return `${quotePrefix}${index + 1}. ${withoutListMarker}`
      }

      return `${quotePrefix}${index + 1}. ${withoutListMarker}`
    }, ({ oldLine, newLine, localOffsetInLine }) => {
      const oldContentStart = resolveContentStart(oldLine)
      const newContentStart = resolveContentStart(newLine)

      if (localOffsetInLine <= oldContentStart) {
        return Math.min(localOffsetInLine, newContentStart)
      }

      return localOffsetInLine + (newContentStart - oldContentStart)
    })
  }, [resolveLineRange, resolveSelectionBoundsFromSelection, transformSelectedLinesForSelection])

  const toggleBulletedList = useCallback(() => {
    const next = buildToggleBulletedListTransform(currentEditorText, latestEditorSelectionRef.current)
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [applyProgrammaticEditorText, buildToggleBulletedListTransform, currentEditorText])

  const toggleNumberedList = useCallback(() => {
    const next = buildToggleNumberedListTransform(currentEditorText, latestEditorSelectionRef.current)
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [applyProgrammaticEditorText, buildToggleNumberedListTransform, currentEditorText])

  const buildToggleChecklistListTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
  ): { text: string; selection: EditorSelectionState } => {
    const checklistPattern = /^(\s*(?:>\s*)*)(?:[-*+])\s+\[[ xX]\]\s+/;
    const splitListPrefix = (line: string) => {
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      const quotePrefix = quotePrefixMatch ? quotePrefixMatch[1] : ''
      const remainder = line.slice(quotePrefix.length)
      const withoutListMarker = remainder.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '')
      return { quotePrefix, withoutListMarker }
    }

    const resolveContentStart = (line: string) => {
      const match = line.match(/^(\s*(?:>\s*)*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/)
      if (match) return match[0].length
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      return quotePrefixMatch ? quotePrefixMatch[0].length : 0
    }

    const { start, end } = resolveSelectionBoundsFromSelection(sourceText, baseSelection)
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const selectedBlock = sourceText.slice(lineStart, lineEndExclusive)
    const lines = selectedBlock.split('\n')
    const allChecklist = lines.every((line) => line.trim().length === 0 || checklistPattern.test(line))

    return transformSelectedLinesForSelection(sourceText, baseSelection, (line) => {
      if (line.trim().length === 0) return line
      const checklistMatch = line.match(checklistPattern)
      if (allChecklist && checklistMatch) {
        return `${checklistMatch[1]}${line.slice(checklistMatch[0].length)}`
      }

      const { quotePrefix, withoutListMarker } = splitListPrefix(line)
      return `${quotePrefix}- [ ] ${withoutListMarker}`
    }, ({ oldLine, newLine, localOffsetInLine }) => {
      const oldContentStart = resolveContentStart(oldLine)
      const newContentStart = resolveContentStart(newLine)

      if (oldLine.match(/^(\s*(?:>\s*)*[-*+]\s+)\[[ xX]\]\s+/)) {
        const checkboxPrefixLength = oldLine.match(/^(\s*(?:>\s*)*[-*+]\s+\[[ xX]\]\s+)/)![1].length
        if (localOffsetInLine <= checkboxPrefixLength) {
          return Math.min(localOffsetInLine, newContentStart)
        }
      }

      if (localOffsetInLine <= oldContentStart) {
        return Math.min(localOffsetInLine, newContentStart)
      }
      return localOffsetInLine + (newContentStart - oldContentStart)
    })
  }, [resolveLineRange, resolveSelectionBoundsFromSelection, transformSelectedLinesForSelection])

  const toggleChecklistList = useCallback(() => {
    const next = buildToggleChecklistListTransform(currentEditorText, latestEditorSelectionRef.current)
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [applyProgrammaticEditorText, buildToggleChecklistListTransform, currentEditorText])

  const toggleBlockquote = useCallback(() => {
    const quotePattern = /^>\s?/
    const sourceText = currentEditorText
    const { start, end } = resolveSelectionBounds(sourceText)
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const lines = sourceText.slice(lineStart, lineEndExclusive).split('\n')
    const allQuoted = lines.every((line) => line.trim().length === 0 || quotePattern.test(line))

    transformSelectedLines((line) => {
      if (line.trim().length === 0) return line
      return allQuoted ? line.replace(quotePattern, '') : `> ${line}`
    })
  }, [currentEditorText, resolveLineRange, resolveSelectionBounds, transformSelectedLines])

  const applyLink = useCallback(() => {
    applyWrappedMarker('[', '](url)', 'link')
  }, [applyWrappedMarker])

  const applyInlineCode = useCallback(() => {
    applyWrappedMarker('`', '`', 'code')
  }, [applyWrappedMarker])

  const applyCodeBlock = useCallback(() => {
    applyWrappedMarker('```\n', '\n```', 'code')
  }, [applyWrappedMarker])

  const insertHorizontalRule = useCallback(() => {
    if (!activeNoteId) return

    const sourceText = currentEditorText
    const { start, end } = resolveSelectionBounds(sourceText)
    const needsLeadingNewline = start > 0 && sourceText[start - 1] !== '\n'
    const needsTrailingNewline = end < sourceText.length && sourceText[end] !== '\n'
    const inserted = `${needsLeadingNewline ? '\n' : ''}---${needsTrailingNewline ? '\n' : ''}`
    const nextText = `${sourceText.slice(0, start)}${inserted}${sourceText.slice(end)}`
    const cursor = start + inserted.length
    applyProgrammaticEditorText(nextText, cursor, cursor)
  }, [activeNoteId, applyProgrammaticEditorText, currentEditorText, resolveSelectionBounds])

  const handleFindViewButtonContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    replaceAllDocumentFindHits()
  }, [replaceAllDocumentFindHits])

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

  useEffect(() => {
    setDeleteArmedTagName(null)
  }, [activeNoteId, orderedActiveTags])

  useEffect(() => {
    setDeleteArmedCustomLoadoutId((current) => {
      if (current === null) return null
      const stillExists = customSlotEntriesForCurrentMode.some((entry) => entry.id === current)
      return stillExists ? current : null
    })
  }, [customSlotEntriesForCurrentMode, uiMode])

  useEffect(() => {
    if (!armedNoteActionState) return
    if (!notes.some((note) => note.id === armedNoteActionState.noteId)) {
      clearNoteArmTimer()
      setArmedNoteActionState(null)
    }
  }, [armedNoteActionState, clearNoteArmTimer, notes])

  useEffect(() => {
    if (!isTrashViewDeleteArmed) return
    if (!notes.some((note) => isDeletedNote(note))) {
      setIsTrashViewDeleteArmed(false)
    }
  }, [isTrashViewDeleteArmed, notes])

  useEffect(() => {
    return () => {
      clearNoteArmTimer()
      clearTrashButtonArmTimer()
    }
  }, [clearNoteArmTimer, clearTrashButtonArmTimer])

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
  }, [isSidebarScrollbarMode, syncSidebarCustomScrollbar, sidebarMode, categoryTree, archiveTree, documentFindHits])

  useEffect(() => {
    if (!isPreviewMode) return
    syncPreviewCustomScrollbar()
  }, [isPreviewMode, syncPreviewCustomScrollbar, activeNoteId, currentEditorText, viewStyle, viewFontSize, viewSpacing])

  useEffect(() => {
    if (!isPreviewMode) return

    const scroller = previewScrollRef.current
    if (!scroller) return

    const onScroll = () => {
      syncPreviewCustomScrollbar()
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [isPreviewMode, syncPreviewCustomScrollbar])

  useEffect(() => {
    if (!isPreviewMode) return

    const scroller = previewScrollRef.current
    if (!scroller) return

    const scheduleSync = () => {
      if (previewScrollbarRafRef.current !== null) {
        cancelAnimationFrame(previewScrollbarRafRef.current)
      }

      previewScrollbarRafRef.current = requestAnimationFrame(() => {
        previewScrollbarRafRef.current = null
        syncPreviewCustomScrollbar()
      })
    }

    scheduleSync()
    const previewContentEl = scroller.firstElementChild as HTMLElement | null

    const resizeObserver = new ResizeObserver(() => scheduleSync())
    resizeObserver.observe(scroller)
    if (previewContentEl) {
      resizeObserver.observe(previewContentEl)
    }

    const mutationObserver = new MutationObserver(() => scheduleSync())
    mutationObserver.observe(scroller, {
      subtree: true,
      childList: true,
      characterData: true,
    })

    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (previewScrollbarRafRef.current !== null) {
        cancelAnimationFrame(previewScrollbarRafRef.current)
        previewScrollbarRafRef.current = null
      }
    }
  }, [isPreviewMode, syncPreviewCustomScrollbar])

  useEffect(() => {
    if (!isDraggingPreviewScrollThumb) return

    const onMouseMove = (event: globalThis.MouseEvent) => {
      const origin = previewScrollbarDragOriginRef.current
      if (!origin) return
      const deltaY = event.clientY - origin.pointerY
      previewScrollFromThumbTop(origin.thumbTopPx + deltaY)
    }

    const onMouseUp = () => {
      setIsDraggingPreviewScrollThumb(false)
      previewScrollbarDragOriginRef.current = null
      requestAnimationFrame(() => syncPreviewCustomScrollbar({ force: true }))
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDraggingPreviewScrollThumb, previewScrollFromThumbTop, syncPreviewCustomScrollbar])

  useEffect(() => {
    const scroller = previewScrollRef.current
    if (!scroller) return

    scroller.style.scrollBehavior = isDraggingPreviewScrollThumb ? 'auto' : ''

    return () => {
      scroller.style.scrollBehavior = ''
    }
  }, [isDraggingPreviewScrollThumb])

  const handlePreviewTrackMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const track = previewScrollbarTrackRef.current
    const scroller = previewScrollRef.current
    if (!track || !scroller) return

    const rect = track.getBoundingClientRect()
    const clickY = event.clientY - rect.top
    const thumbHeightPx = previewScrollThumbHeightRef.current
    const targetThumbTop = clickY - (thumbHeightPx / 2)

    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - thumbHeightPx)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(targetThumbTop, maxThumbTop))
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0
    const targetScrollTop = ratio * maxScrollTop

    scrollToNonQuantizedSmooth(scroller, targetScrollTop)
  }, [])

  const handlePreviewThumbMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const scroller = previewScrollRef.current
    if (scroller) {
      scroller.style.scrollBehavior = 'auto'
    }
    setIsDraggingPreviewScrollThumb(true)
    previewScrollbarDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: previewScrollThumbTopRef.current,
    }
  }, [])

  const stopPreviewContinuousScroll = useCallback(() => {
    previewContinuousScrollDirectionRef.current = 0
    previewContinuousScrollLastTsRef.current = null
    if (previewContinuousScrollRafRef.current !== null) {
      cancelAnimationFrame(previewContinuousScrollRafRef.current)
      previewContinuousScrollRafRef.current = null
    }
    if (previewReleaseRampDownRafRef.current !== null) {
      cancelAnimationFrame(previewReleaseRampDownRafRef.current)
      previewReleaseRampDownRafRef.current = null
    }

    const scroller = previewScrollRef.current
    if (scroller && previewContinuousPreviousScrollBehaviorRef.current !== null) {
      scroller.style.scrollBehavior = previewContinuousPreviousScrollBehaviorRef.current
      previewContinuousPreviousScrollBehaviorRef.current = null
    }
  }, [])

  const clearPreviewContinuousHandoff = useCallback(() => {
    if (previewContinuousHandoffTimeoutRef.current !== null) {
      window.clearTimeout(previewContinuousHandoffTimeoutRef.current)
      previewContinuousHandoffTimeoutRef.current = null
    }
  }, [])

  const runPreviewContinuousScroll = useCallback((nowMs: number) => {
    const direction = previewContinuousScrollDirectionRef.current
    if (direction === 0) {
      previewContinuousScrollRafRef.current = null
      previewContinuousScrollLastTsRef.current = null
      return
    }

    const scroller = previewScrollRef.current
    if (!scroller || !isPreviewMode) {
      previewContinuousScrollDirectionRef.current = 0
      previewContinuousScrollRafRef.current = null
      previewContinuousScrollLastTsRef.current = null
      return
    }

    const previousTs = previewContinuousScrollLastTsRef.current
    previewContinuousScrollLastTsRef.current = nowMs
    if (previousTs !== null) {
      const deltaSec = Math.max(0, (nowMs - previousTs) / 1000)
      const speedPxPerSec = Math.max(
        1,
        resolveApexSpeedPxPerSecFromCurrentParams(scroller.clientHeight * 0.9)
          * PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
      )
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const nextScrollTop = clamp(
        scroller.scrollTop + (direction * speedPxPerSec * deltaSec),
        0,
        maxScrollTop,
      )

      if (Math.abs(nextScrollTop - scroller.scrollTop) > 0.01) {
        scroller.scrollTop = nextScrollTop
        syncPreviewCustomScrollbar()
      }

      const hitBoundary = (direction < 0 && nextScrollTop <= 0.01)
        || (direction > 0 && nextScrollTop >= maxScrollTop - 0.01)
      if (hitBoundary) {
        previewContinuousScrollDirectionRef.current = 0
        previewContinuousScrollRafRef.current = null
        previewContinuousScrollLastTsRef.current = null
        return
      }
    }

    previewContinuousScrollRafRef.current = requestAnimationFrame(runPreviewContinuousScroll)
  }, [isPreviewMode, syncPreviewCustomScrollbar])

  const startPreviewReleaseRampDown = useCallback((direction: -1 | 1) => {
    if (!isPreviewMode) {
      stopPreviewContinuousScroll()
      return
    }

    const scroller = previewScrollRef.current
    if (!scroller) {
      stopPreviewContinuousScroll()
      return
    }

    const releaseSpeedPxPerSec = Math.max(
      1,
      resolveApexSpeedPxPerSecFromCurrentParams(scroller.clientHeight * 0.9)
        * PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
    )
    const rampDownPlan = buildReleaseRampDownPlanFromCurrentParams(direction, releaseSpeedPxPerSec)
    if (!rampDownPlan) {
      stopPreviewContinuousScroll()
      return
    }

    if (previewContinuousScrollRafRef.current !== null) {
      cancelAnimationFrame(previewContinuousScrollRafRef.current)
      previewContinuousScrollRafRef.current = null
    }
    previewContinuousScrollDirectionRef.current = 0
    previewContinuousScrollLastTsRef.current = null

    if (previewReleaseRampDownRafRef.current !== null) {
      cancelAnimationFrame(previewReleaseRampDownRafRef.current)
      previewReleaseRampDownRafRef.current = null
    }

    if (previewContinuousPreviousScrollBehaviorRef.current === null) {
      previewContinuousPreviousScrollBehaviorRef.current = scroller.style.scrollBehavior
    }
    scroller.style.scrollBehavior = 'auto'

    const startScrollTop = scroller.scrollTop
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    let startMs: number | null = null

    const animateRampDown = (nowMs: number) => {
      if (!isPreviewMode) {
        stopPreviewContinuousScroll()
        return
      }

      if (startMs === null) {
        startMs = nowMs
      }

      const elapsedSec = Math.max(0, (nowMs - startMs) / 1000)
      const displacement = sampleReleaseRampDownPlan(rampDownPlan, elapsedSec)
      const nextScrollTop = clamp(startScrollTop + displacement, 0, maxScrollTop)

      if (Math.abs(nextScrollTop - scroller.scrollTop) > 0.01) {
        scroller.scrollTop = nextScrollTop
        syncPreviewCustomScrollbar()
      }

      const hitBoundary = nextScrollTop <= 0.01 || nextScrollTop >= maxScrollTop - 0.01
      if (elapsedSec >= rampDownPlan.tailDurationSec || hitBoundary) {
        previewReleaseRampDownRafRef.current = null
        if (previewContinuousPreviousScrollBehaviorRef.current !== null) {
          scroller.style.scrollBehavior = previewContinuousPreviousScrollBehaviorRef.current
          previewContinuousPreviousScrollBehaviorRef.current = null
        }
        return
      }

      previewReleaseRampDownRafRef.current = requestAnimationFrame(animateRampDown)
    }

    previewReleaseRampDownRafRef.current = requestAnimationFrame(animateRampDown)
  }, [isPreviewMode, stopPreviewContinuousScroll, syncPreviewCustomScrollbar])

  const startPreviewContinuousScroll = useCallback((direction: -1 | 1) => {
    if (!isPreviewMode) return
    const scroller = previewScrollRef.current
    if (!scroller) return

    cancelNonQuantizedSmoothScroll(scroller)

    if (previewContinuousPreviousScrollBehaviorRef.current === null) {
      previewContinuousPreviousScrollBehaviorRef.current = scroller.style.scrollBehavior
    }
    scroller.style.scrollBehavior = 'auto'

    const previousDirection = previewContinuousScrollDirectionRef.current
    previewContinuousScrollDirectionRef.current = direction

    // Do not reset timing on every key-repeat event; that throttles effective
    // speed. Only reset when direction changes or when starting from idle.
    if (previewContinuousScrollRafRef.current === null || previousDirection !== direction) {
      previewContinuousScrollLastTsRef.current = null
    }

    if (previewContinuousScrollRafRef.current === null) {
      previewContinuousScrollRafRef.current = requestAnimationFrame(runPreviewContinuousScroll)
    }
  }, [isPreviewMode, runPreviewContinuousScroll])

  useEffect(() => {
    if (!isPreviewMode) {
      previewPageKeysHeldRef.current.clear()
      clearPreviewContinuousHandoff()
      stopPreviewContinuousScroll()
      return
    }

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tagName = target.tagName
      return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
    }

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (isEditableTarget(event.target)) return
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return

      const scroller = previewScrollRef.current
      if (!scroller) return

      event.preventDefault()
      const direction: -1 | 1 = event.key === 'PageDown' ? 1 : -1
      previewPageKeysHeldRef.current.add(event.key)

      if (event.repeat) {
        if (previewContinuousHandoffTimeoutRef.current === null) {
          startPreviewContinuousScroll(direction)
        }
        return
      }

      clearPreviewContinuousHandoff()
      stopPreviewContinuousScroll()
      const pageStepPx = Math.max(1, scroller.clientHeight * 0.9)
      const startScrollTop = scroller.scrollTop
      const targetScrollTop = scroller.scrollTop + (direction * pageStepPx)
      scrollToNonQuantizedSmooth(scroller, targetScrollTop, {
        onStep: () => syncPreviewCustomScrollbar(),
      })

      const targetContinuousSpeedPxPerSec = Math.max(
        1,
        resolveApexSpeedPxPerSecFromCurrentParams(targetScrollTop - startScrollTop)
          * PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
      )
      const crossingTimeSec = resolveRampCrossingTimeSecFromCurrentParams(
        targetScrollTop - startScrollTop,
        targetContinuousSpeedPxPerSec,
      )

      if (crossingTimeSec !== null) {
        const delayMs = Math.max(0, Math.round(crossingTimeSec * 1000))
        previewContinuousHandoffTimeoutRef.current = window.setTimeout(() => {
          previewContinuousHandoffTimeoutRef.current = null
          if (!isPreviewMode) return
          if (!previewPageKeysHeldRef.current.has(event.key)) return
          startPreviewContinuousScroll(direction)
        }, delayMs)
      }
    }

    const onWindowKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'PageDown' || event.key === 'PageUp') {
        previewPageKeysHeldRef.current.delete(event.key)
        clearPreviewContinuousHandoff()
        if (previewPageKeysHeldRef.current.size === 0) {
          const activeDirection = previewContinuousScrollDirectionRef.current
          if (activeDirection !== 0) {
            startPreviewReleaseRampDown(activeDirection)
          } else {
            stopPreviewContinuousScroll()
          }
        }
      }
    }

    const onWindowBlur = () => {
      previewPageKeysHeldRef.current.clear()
      clearPreviewContinuousHandoff()
      stopPreviewContinuousScroll()
    }

    window.addEventListener('keydown', onWindowKeyDown)
    window.addEventListener('keyup', onWindowKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown)
      window.removeEventListener('keyup', onWindowKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      previewPageKeysHeldRef.current.clear()
      clearPreviewContinuousHandoff()
      stopPreviewContinuousScroll()
    }
  }, [
    clearPreviewContinuousHandoff,
    isPreviewMode,
    startPreviewReleaseRampDown,
    startPreviewContinuousScroll,
    stopPreviewContinuousScroll,
    syncPreviewCustomScrollbar,
  ])

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

  const renderSidebarOptionsContent = () => {
    const topRowHighlightKeys: HighlightColorKey[] = ['base', 'inputFields', 'appButtons']
    const middleRowHighlightKeys: HighlightColorKey[] = [
      isPreviewMode ? 'textEmbossRender' : 'textEmbossEdit',
      'caret',
      isPreviewMode ? 'selectionRender' : 'selectionEdit',
      'textBase',
      'textEmbossUi',
    ]
    const textureTargets = ['appGrid', 'sidebarContent', isPreviewMode ? 'editorRenderText' : 'editorEditText'] as TextureSurfaceKey[]

    const renderHighlightSwatchButton = (key: HighlightColorKey) => {
      const resolvedKey: HighlightColorKey = isPreviewMode && key === 'caret' ? 'search' : key
      const isSearchHighlightControl = key === 'caret' && isPreviewMode
      const buttonTitle = isSearchHighlightControl ? 'Search highlight color' : HIGHLIGHT_COLOR_TITLES[key]
      const buttonIcon = isSearchHighlightControl ? 'fa-solid fa-magnifying-glass' : HIGHLIGHT_COLOR_ICONS[key]

      return (
        <button
          key={key}
          type="button"
          className={`btn-icon options-color-swatch${key === 'textBase' ? ' text-ui-icon' : ''}`}
          onClick={() => {
            if (armedColorSource.kind === 'active-color') {
              applyActiveColorToElement(resolvedKey)
              return
            }

            if (armedColorSource.kind === 'texture-preview') {
              updateHighlightColor(resolvedKey, hsvaToRgba(texturePreviewMaterial.color))
              return
            }

            if (armedColorSource.kind === 'hsva') {
              applyHsvaValueToElement(armedColorSource.key, resolvedKey)
            }
          }}
          onMouseDown={(event) => startElementPreviewCopyHold({ kind: 'element', key: resolvedKey }, event)}
          onMouseUp={(event) => {
            if (event.button !== 2) return
            clearColorArmTimer()
          }}
          onMouseLeave={() => {
            clearColorArmTimer()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            clearColorArmTimer()
          }}
          style={{ '--options-swatch-color': highlightColors[resolvedKey] } as React.CSSProperties}
          title={buttonTitle}
        >
          <span className={`options-color-swatch-glyph ${buttonIcon}`} aria-hidden="true" />
        </button>
      )
    }

    const renderTextureSwatchButton = (surface: TextureSurfaceKey) => (
      <button
        key={surface}
        type="button"
        className="btn-icon options-color-swatch"
        onClick={() => {
          if (armedColorSource.kind === 'active-color') {
            applyActiveColorToTexture(surface)
            return
          }

          if (armedColorSource.kind === 'texture-preview') {
            applyTexturePreviewToSurface(surface)
            return
          }

          if (armedColorSource.kind === 'hsva') {
            applyHsvaValueToTexture(armedColorSource.key, surface)
          }
        }}
        onMouseDown={(event) => startElementPreviewCopyHold({ kind: 'texture', key: surface }, event)}
        onMouseUp={(event) => {
          if (event.button !== 2) return
          clearColorArmTimer()
        }}
        onMouseLeave={() => {
          clearColorArmTimer()
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          clearColorArmTimer()
        }}
        style={{ '--options-swatch-color': rgbaToCssColor(hsvaToRgba(textureMaterials[surface].color)) } as React.CSSProperties}
        title={TEXTURE_SURFACE_TITLES[surface]}
      >
        <span className={`options-color-swatch-glyph ${TEXTURE_SURFACE_ICONS[surface]}`} aria-hidden="true" />
      </button>
    )

    return (
    <div
      ref={optionsContentRef}
      className={`options-content sidebar-options-content ${isPreviewMode ? 'mode-view' : 'mode-edit'}`}
      aria-label="Settings panel"
    >
      <div className="preset-section">
        <div className="options-loadout-grid" role="group" aria-label="UI mode presets">
          {factoryPresetEntriesForCurrentMode.map((entry) => {
            const presetIcons = uiMode === 'dark' ? DARK_PRESET_ICONS : LIGHT_PRESET_ICONS
            const presetThemes = uiMode === 'dark' ? DARK_PRESET_THEMES : LIGHT_PRESET_THEMES
            const icon = presetIcons[Math.abs(entry.id) - 1] ?? 'fa-solid fa-circle'
            const theme = presetThemes[Math.abs(entry.id) - 1] ?? 'None'
            return (
              <button
                key={`preset-${entry.id}`}
                type="button"
                className={`btn-icon options-color-swatch options-loadout-btn${activeEntryForCurrentMode?.id === entry.id ? ' active' : ''}`}
                title={theme}
                aria-label={theme}
                onClick={() => void selectLoadoutPreset(entry.id)}
              >
                <span className={icon} aria-hidden="true" />
              </button>
            )
          })}
          <button
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn${isDynamicCustomPresetActive ? ' active' : ''}`}
            title="Custom"
            aria-label="Custom preset"
            onClick={selectDynamicCustomPreset}
          >
            <span className="fa-solid fa-marker" aria-hidden="true" />
          </button>
        </div>
      </div>
      <AccordionGroup>
      <AccordionSection
        className="sidebar-options-section-layouts"
        ariaLabel="Custom Presets"
        heading="Custom Presets"
      >
        <div className="options-loadout-grid" role="group" aria-label="Custom UI layout presets">
          {customSlotEntriesForCurrentMode.map((entry) => (
            <button
              key={`custom-${entry.id}`}
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn${activeEntryForCurrentMode?.id === entry.id ? ' active' : ''}${deleteArmedCustomLoadoutId === entry.id ? ' armed' : ''}`}
              title={deleteArmedCustomLoadoutId === entry.id
                ? 'Click to delete this custom preset or move cursor away to cancel'
                : `Custom ${Math.abs(entry.id) - LOADOUT_FACTORY_PRESET_COUNT - 2}. Right click to arm deletion.`}
              onClick={() => {
                handleCustomLoadoutSlotClick(entry.id)
              }}
              onContextMenu={(event) => {
                handleCustomLoadoutSlotContextMenu(event, entry.id)
              }}
              onMouseLeave={() => {
                handleCustomLoadoutSlotMouseLeave(entry.id)
              }}
            >
              <span className="options-loadout-index">{Math.abs(entry.id) - LOADOUT_FACTORY_PRESET_COUNT - 2}</span>
            </button>
          ))}

          <button
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn options-loadout-plus${hasUnsavedUiLoadoutChanges ? ' active' : ''}`}
            title="Save current settings as a new custom preset"
            aria-label="Save current settings as a new custom preset"
            onClick={() => void saveCustomLoadout()}
          >
            <span className="options-loadout-plus-glyph fa-solid fa-plus" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            title="Reset custom preset to defaults"
            aria-label="Reset custom preset to defaults"
            onClick={() => void resetCustomLoadout()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span className="fa-solid fa-rotate-left" aria-hidden="true" />
          </button>
        </div>
      </AccordionSection>


      <AccordionSection
        className="sidebar-options-section-colors"
        ariaLabel="Colors & Textures"
        heading="Colors & Textures"
      >
        <div className="options-color-layout" aria-label="Color and texture controls">
          <div className="options-color-grid options-hsva-grid" role="group" aria-label="HSVA value controls">
            <button
              type="button"
              className={`btn-icon options-color-swatch options-hsva-control${hsvaDragState?.control === 'h' ? ' is-dragging' : ''}${armedColorSource.kind === 'hsva' && armedColorSource.key === 'h' ? ' active' : ''}`}
              style={{ background: hsvaDisplayColors.hColor }}
              title={`Hue: ${Math.round(activeColorHsva.h)}\n${activeColorHex}`}
              onPointerDown={(event) => {
                startHsvaDrag('h', event)
              }}
              onPointerMove={(event) => {
                handleHsvaDragMove('h', event)
              }}
              onPointerUp={(event) => {
                stopHsvaDrag('h', event)
              }}
              onPointerCancel={(event) => {
                stopHsvaDrag('h', event)
              }}
              onLostPointerCapture={(event) => {
                stopHsvaDrag('h', event)
              }}
              onMouseDown={(event) => {
                if (event.button !== 2) return
                startColorArmHold({ kind: 'hsva', key: 'h' }, event)
              }}
              onMouseUp={(event) => {
                if (event.button !== 2) return
                clearColorArmTimer()
              }}
              onMouseLeave={clearColorArmTimer}
              onContextMenu={(event) => {
                event.preventDefault()
                clearColorArmTimer()
              }}
              onWheel={(event) => {
                wheelAdjustHsvaControl('h', event)
              }}
            ><span className="options-hsva-glyph fa-solid fa-rainbow" aria-hidden="true" /></button>
            <button
              type="button"
              className={`btn-icon options-color-swatch options-hsva-control${hsvaDragState?.control === 's' ? ' is-dragging' : ''}${armedColorSource.kind === 'hsva' && armedColorSource.key === 's' ? ' active' : ''}`}
              style={{ background: hsvaDisplayColors.sColor }}
              title={`Saturation: ${Math.round(activeColorHsva.s * 255)}\n${activeColorHex}`}
              onPointerDown={(event) => {
                startHsvaDrag('s', event)
              }}
              onPointerMove={(event) => {
                handleHsvaDragMove('s', event)
              }}
              onPointerUp={(event) => {
                stopHsvaDrag('s', event)
              }}
              onPointerCancel={(event) => {
                stopHsvaDrag('s', event)
              }}
              onLostPointerCapture={(event) => {
                stopHsvaDrag('s', event)
              }}
              onMouseDown={(event) => {
                if (event.button !== 2) return
                startColorArmHold({ kind: 'hsva', key: 's' }, event)
              }}
              onMouseUp={(event) => {
                if (event.button !== 2) return
                clearColorArmTimer()
              }}
              onMouseLeave={clearColorArmTimer}
              onContextMenu={(event) => {
                event.preventDefault()
                clearColorArmTimer()
              }}
              onWheel={(event) => {
                wheelAdjustHsvaControl('s', event)
              }}
            ><span className="options-hsva-glyph fa-solid fa-droplet" aria-hidden="true" /></button>
            <button
              type="button"
              className={`btn-icon options-color-swatch options-hsva-control${hsvaDragState?.control === 'v' ? ' is-dragging' : ''}${armedColorSource.kind === 'hsva' && armedColorSource.key === 'v' ? ' active' : ''}`}
              style={{ background: hsvaDisplayColors.vColor }}
              title={`Value: ${Math.round(activeColorHsva.v * 255)}\n${activeColorHex}`}
              onPointerDown={(event) => {
                startHsvaDrag('v', event)
              }}
              onPointerMove={(event) => {
                handleHsvaDragMove('v', event)
              }}
              onPointerUp={(event) => {
                stopHsvaDrag('v', event)
              }}
              onPointerCancel={(event) => {
                stopHsvaDrag('v', event)
              }}
              onLostPointerCapture={(event) => {
                stopHsvaDrag('v', event)
              }}
              onMouseDown={(event) => {
                if (event.button !== 2) return
                startColorArmHold({ kind: 'hsva', key: 'v' }, event)
              }}
              onMouseUp={(event) => {
                if (event.button !== 2) return
                clearColorArmTimer()
              }}
              onMouseLeave={clearColorArmTimer}
              onContextMenu={(event) => {
                event.preventDefault()
                clearColorArmTimer()
              }}
              onWheel={(event) => {
                wheelAdjustHsvaControl('v', event)
              }}
            ><span className="options-hsva-glyph fa-solid fa-circle-half-stroke" aria-hidden="true" /></button>
            <button
              type="button"
              className={[
                'btn-icon',
                'options-color-swatch',
                'options-hsva-control',
                'options-hsva-alpha',
                hsvaDragState?.control === 'a' ? 'is-dragging' : '',
                armedColorSource.kind === 'hsva' && armedColorSource.key === 'a' ? 'active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ background: 'var(--color-background-light)', color: hsvaDisplayColors.aGhostColor }}
              title={`Alpha: ${Math.round(activeColorHsva.a * 255)}\n${activeColorHex}`}
              onPointerDown={(event) => {
                startHsvaDrag('a', event)
              }}
              onPointerMove={(event) => {
                handleHsvaDragMove('a', event)
              }}
              onPointerUp={(event) => {
                stopHsvaDrag('a', event)
              }}
              onPointerCancel={(event) => {
                stopHsvaDrag('a', event)
              }}
              onLostPointerCapture={(event) => {
                stopHsvaDrag('a', event)
              }}
              onMouseDown={(event) => {
                if (event.button !== 2) return
                startColorArmHold({ kind: 'hsva', key: 'a' }, event)
              }}
              onMouseUp={(event) => {
                if (event.button !== 2) return
                clearColorArmTimer()
              }}
              onMouseLeave={clearColorArmTimer}
              onContextMenu={(event) => {
                event.preventDefault()
                clearColorArmTimer()
              }}
              onWheel={(event) => {
                wheelAdjustHsvaControl('a', event)
              }}
            ><span className="options-hsva-glyph fa-solid fa-eye" aria-hidden="true" /></button>
            <button
              type="button"
              className={`btn-icon options-color-swatch options-active-color${armedColorSource.kind === 'active-color' ? ' active' : ''}`}
              title={`Active color:\n${activeColorHex}`}
              style={{ background: `linear-gradient(${activeColorCss}, ${activeColorCss}), var(--color-background-light)` }}
              onMouseDown={(event) => {
                if (event.button !== 2) return
                startColorArmHold({ kind: 'active-color' }, event)
              }}
              onMouseUp={(event) => {
                if (event.button !== 2) return
                clearColorArmTimer()
              }}
              onMouseLeave={clearColorArmTimer}
              onContextMenu={(event) => {
                event.preventDefault()
                clearColorArmTimer()
              }}
              onClick={() => {}}
            />
          </div>
          <div className="options-texture-settings" aria-label="Texture generation settings">
            <div className="options-texture-preview-row">
              <button
                type="button"
                className={`btn-icon options-color-swatch options-active-color options-texture-preview${armedColorSource.kind === 'texture-preview' ? ' active' : ''}`}
                title={`Texture preview: ${texturePreviewHex}`}
                style={{
                  '--texture-preview-color': texturePreviewTintCss,
                  '--texture-preview-mask': texturePreviewCss,
                } as React.CSSProperties}
                onMouseDown={(event) => {
                  if (event.button !== 2) return
                  startColorArmHold({ kind: 'texture-preview' }, event)
                }}
                onMouseUp={(event) => {
                  if (event.button !== 2) return
                  clearColorArmTimer()
                }}
                onMouseLeave={clearColorArmTimer}
                onContextMenu={(event) => {
                  event.preventDefault()
                  clearColorArmTimer()
                }}
                onClick={() => {
                  setArmedColorSource({ kind: 'texture-preview' })
                }}
              />
            </div>
            <div className="options-texture-seed-slot">
              <div className="options-seed-editor" aria-label="Texture seed">
                {isTextureSeedEditing ? (
                  <label className="options-seed-btn is-editing" aria-label="Edit texture seed">
                    <input
                      ref={textureSeedInputRef}
                      type="number"
                      min={0}
                      max={1000000}
                      step={1}
                      inputMode="numeric"
                      className="sidebar-page-number-input sidebar-page-number-input--edit"
                      value={textureSeedInput}
                      onChange={(event) => {
                        setTextureSeedInput(event.target.value.replace(/[^0-9]/g, ''))
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitTextureSeedEdit()
                          scheduleFocusEditorInEditMode()
                          return
                        }

                        if (event.key === 'Escape' || event.key === 'Tab') {
                          event.preventDefault()
                          cancelTextureSeedEdit()
                          scheduleFocusEditorInEditMode()
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(() => {
                          if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                            scheduleFocusEditorInEditMode()
                          }
                        }, 0)
                      }}
                    />
                  </label>
                ) : (
                  <button
                    type="button"
                    className="options-seed-btn"
                    aria-label={`Texture seed ${texturePreviewMaterial.seed}. Left click to randomize. Right click to edit.`}
                    title="Left click: random seed. Right click: edit seed."
                    onClick={randomizeTextureSeed}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      startTextureSeedEdit()
                    }}
                  ><span className="fa-solid fa-seedling" />
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              role="slider"
              aria-label="Texture granularity"
              aria-orientation="vertical"
              aria-valuemin={TEXTURE_GRANULARITY_MIN}
              aria-valuemax={TEXTURE_GRANULARITY_MAX}
              aria-valuenow={texturePreviewMaterial.granularity}
              className={[
                'btn-icon',
                'options-color-swatch',
                'options-hsva-control',
                'options-hsva-alpha',
                'options-texture-control-btn',
                'options-texture-control-btn-granularity',
                textureControlDragState?.control === 'granularity' ? 'is-dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={`Granularity (${texturePreviewMaterial.granularity})`}
              onPointerDown={(event) => {
                startTextureControlDrag('granularity', event)
              }}
              onPointerMove={(event) => {
                handleTextureControlDragMove('granularity', event)
              }}
              onPointerUp={(event) => {
                stopTextureControlDrag('granularity', event)
              }}
              onPointerCancel={(event) => {
                stopTextureControlDrag('granularity', event)
              }}
              onLostPointerCapture={(event) => {
                stopTextureControlDrag('granularity', event)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
              }}
              onWheel={(event) => {
                wheelAdjustTextureControl('granularity', event)
              }}
            >
              <span className="options-hsva-glyph fa-solid fa-chess-board" aria-hidden="true" />
            </button>
            <button
              type="button"
              role="slider"
              aria-label="Texture smoothness"
              aria-orientation="vertical"
              aria-valuemin={TEXTURE_VSTEPS_MIN}
              aria-valuemax={TEXTURE_VSTEPS_MAX}
              aria-valuenow={texturePreviewMaterial.vSteps}
              className={[
                'btn-icon',
                'options-color-swatch',
                'options-hsva-control',
                'options-hsva-alpha',
                'options-texture-control-btn',
                'options-texture-control-btn-smoothness',
                textureControlDragState?.control === 'smoothness' ? 'is-dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={`Smoothness (${texturePreviewMaterial.vSteps})`}
              onPointerDown={(event) => {
                startTextureControlDrag('smoothness', event)
              }}
              onPointerMove={(event) => {
                handleTextureControlDragMove('smoothness', event)
              }}
              onPointerUp={(event) => {
                stopTextureControlDrag('smoothness', event)
              }}
              onPointerCancel={(event) => {
                stopTextureControlDrag('smoothness', event)
              }}
              onLostPointerCapture={(event) => {
                stopTextureControlDrag('smoothness', event)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
              }}
              onWheel={(event) => {
                wheelAdjustTextureControl('smoothness', event)
              }}
            >
              <span className="options-hsva-glyph fa-solid fa-pen-nib" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="sidebar-options-divider" aria-hidden="true" />

        <div className="options-color-grid options-element-grid options-row-grid options-row-grid-top" role="group" aria-label="App base and texture colors">
          {topRowHighlightKeys.map((key) => renderHighlightSwatchButton(key))}
          {textureTargets.map((surface) => renderTextureSwatchButton(surface))}
        </div>

        <div className="sidebar-options-divider" aria-hidden="true" />

        <div className="options-color-grid options-element-grid options-row-grid options-row-grid-middle" role="group" aria-label="Mode text and selection colors">
          <button
            type="button"
            className="btn-icon options-color-swatch text-icon"
            onClick={() => {
              const target: EditorTextColorTargetKey = isPreviewMode ? 'editorRenderText' : 'editorEditText'

              if (armedColorSource.kind === 'active-color') {
                applyActiveColorToEditorText(target)
                return
              }

              if (armedColorSource.kind === 'texture-preview') {
                updateEditorTextColor(target, hsvaToRgba(texturePreviewMaterial.color))
                return
              }

              if (armedColorSource.kind === 'hsva') {
                applyHsvaValueToEditorText(armedColorSource.key, target)
              }
            }}
            onMouseDown={(event) => startElementPreviewCopyHold({ kind: 'text', key: isPreviewMode ? 'editorRenderText' : 'editorEditText' }, event)}
            onMouseUp={(event) => {
              if (event.button !== 2) return
              clearColorArmTimer()
            }}
            onMouseLeave={() => {
              clearColorArmTimer()
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              clearColorArmTimer()
            }}
            style={{
              '--options-swatch-color': editorTextColors[isPreviewMode ? 'editorRenderText' : 'editorEditText'],
            } as React.CSSProperties}
            title={isPreviewMode ? 'Render mode text color' : 'Edit mode text color'}
          >
            <span className="options-color-swatch-glyph fa-solid fa-font" aria-hidden="true" />
          </button>

          {middleRowHighlightKeys.map((key) => renderHighlightSwatchButton(key))}
        </div>

        {!isPreviewMode ? (
          <>
            <div className="sidebar-options-divider" aria-hidden="true" />
            <div className="options-color-grid options-element-grid options-row-grid options-row-grid-bottom" role="group" aria-label="Edit mode box colors">
              {BOX_HIGHLIGHT_COLOR_ORDER.map((key) => renderHighlightSwatchButton(key))}
            </div>
            <div className="sidebar-options-divider" aria-hidden="true" />
            <div className="options-color-grid options-element-grid options-row-grid options-row-grid-edit-markdown" role="group" aria-label="Edit mode markdown colors">
              {MARKDOWN_HIGHLIGHT_COLOR_ORDER.map((key) => renderHighlightSwatchButton(key))}
            </div>
          </>
        ) : null}
      </AccordionSection>

      <AccordionSection
        ariaLabel="Glaze"
        heading="Glaze"
      >
        <div className="options-glaze-settings-grid" role="group" aria-label="Glaze overlay controls">
          <div className="options-glaze-cell options-glaze-cell-span-2 options-glaze-top-left">
            <div className="options-seed-editor" aria-label="Linear glaze seed">
              {isGlazeLinearSeedEditing ? (
                <label className="options-seed-btn is-editing" aria-label="Edit linear glaze seed">
                  <input
                    ref={glazeLinearSeedInputRef}
                    type="number"
                    min={0}
                    max={1000000}
                    step={1}
                    inputMode="numeric"
                    className="sidebar-page-number-input sidebar-page-number-input--edit"
                    value={glazeLinearSeedInput}
                    onChange={(event) => {
                      setGlazeLinearSeedInput(event.target.value.replace(/[^0-9]/g, ''))
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitGlazeLinearSeedEdit()
                        scheduleFocusEditorInEditMode()
                        return
                      }

                      if (event.key === 'Escape' || event.key === 'Tab') {
                        event.preventDefault()
                        cancelGlazeLinearSeedEdit()
                        scheduleFocusEditorInEditMode()
                      }
                    }}
                    onBlur={() => {
                      commitGlazeLinearSeedEdit()
                      window.setTimeout(() => {
                        if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                          scheduleFocusEditorInEditMode()
                        }
                      }, 0)
                    }}
                  />
                </label>
              ) : (
                <button
                  type="button"
                  className="options-seed-btn"
                  aria-label={`Linear glaze seed ${glazeSettings.linearSeed}. Left click to randomize. Right click to edit.`}
                  title="Left click: random seed. Right click: edit seed."
                  onClick={randomizeGlazeLinearSeed}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    startGlazeLinearSeedEdit()
                  }}
                >
                  <span className="fa-solid fa-barcode"/>
                </button>
              )}
            </div>
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2 options-glaze-top-center">
            <button
              type="button"
              className={`btn-icon options-color-swatch options-glaze-layer-order-btn${glazeSettings.radialAboveLinear ? ' active' : ''}`}
              aria-label={glazeSettings.radialAboveLinear ? 'Display flair above glare.' : 'Display flair above glare.'}
              title={glazeSettings.radialAboveLinear ? 'Display flair above glare.' : 'Display flair above glare.'}
              onClick={() => {
                setGlazeSettings((current) => ({
                  ...current,
                  radialAboveLinear: !current.radialAboveLinear,
                }))
              }}
            >
              <span className="fa-solid fa-layer-group" aria-hidden="true" />
            </button>
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2 options-glaze-top-right">
            <div className="options-seed-editor" aria-label="Radial glaze seed">
              {isGlazeRadialSeedEditing ? (
                <label className="options-seed-btn is-editing" aria-label="Edit radial glaze seed">
                  <input
                    ref={glazeRadialSeedInputRef}
                    type="number"
                    min={0}
                    max={1000000}
                    step={1}
                    inputMode="numeric"
                    className="sidebar-page-number-input sidebar-page-number-input--edit"
                    value={glazeRadialSeedInput}
                    onChange={(event) => {
                      setGlazeRadialSeedInput(event.target.value.replace(/[^0-9]/g, ''))
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitGlazeRadialSeedEdit()
                        scheduleFocusEditorInEditMode()
                        return
                      }

                      if (event.key === 'Escape' || event.key === 'Tab') {
                        event.preventDefault()
                        cancelGlazeRadialSeedEdit()
                        scheduleFocusEditorInEditMode()
                      }
                    }}
                    onBlur={() => {
                      commitGlazeRadialSeedEdit()
                      window.setTimeout(() => {
                        if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                          scheduleFocusEditorInEditMode()
                        }
                      }, 0)
                    }}
                  />
                </label>
              ) : (
                <button
                  type="button"
                  className="options-seed-btn"
                  aria-label={`Radial glaze seed ${glazeSettings.radialSeed}. Left click to randomize. Right click to edit.`}
                  title="Left click: random seed. Right click: edit seed."
                  onClick={randomizeGlazeRadialSeed}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    startGlazeRadialSeedEdit()
                  }}
                >
                  <span className="fa-solid fa-wand-magic-sparkles"/>
                </button>
              )}
            </div>
          </div>

          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="glaze-linear-stack-count"
              min={0}
              max={5}
              step={1}
              value={glazeSettings.linearStackCount}
              trackLabel="stacks"
              ariaLabel="Number of linear glaze stacks"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  linearStackCount: clamp(Math.round(value), 0, 5),
                }))
              }}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="glaze-radial-count"
              min={0}
              max={4}
              step={1}
              value={glazeSettings.radialCount}
              trackLabel="sources"
              ariaLabel="Number of radial corner gradients"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  radialCount: clamp(Math.round(value), 0, 4),
                }))
              }}
            />
          </div>

          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="glaze-linear-opacity"
              min={0}
              max={GLAZE_LINEAR_OPACITY_MAX}
              step={0.005}
              value={glazeSettings.linearOpacity}
              trackLabel="glare"
              ariaLabel="Linear gradient stack opacity"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  linearOpacity: clamp(value, 0, GLAZE_LINEAR_OPACITY_MAX),
                }))
              }}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="glaze-radial-opacity"
              min={0}
              max={GLAZE_RADIAL_OPACITY_MAX}
              step={0.005}
              value={glazeSettings.radialOpacity}
              trackLabel="flair"
              ariaLabel="Radial gradient stack opacity"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  radialOpacity: clamp(value, 0, GLAZE_RADIAL_OPACITY_MAX),
                }))
              }}
            />
          </div>

          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="glaze-gloom-position"
              min={-0.5}
              max={1.5}
              step={0.005}
              value={glazeSettings.gloomPosition}
              trackLabel="position"
              ariaLabel="Black gradient gloom vertical position"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  gloomPosition: clamp(value, -0.5, 1.5),
                }))
              }}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="glaze-gloom-shape"
              min={0}
              max={2}
              step={0.01}
              value={glazeSettings.gloomShape}
              trackLabel="shape"
              ariaLabel="Black gradient gloom edge shape"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  gloomShape: clamp(value, 0, 2),
                }))
              }}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="glaze-gloom-opacity"
              min={0}
              max={GLAZE_GLOOM_OPACITY_MAX}
              step={0.005}
              value={glazeSettings.gloomOpacity}
              trackLabel="gloom"
              ariaLabel="Black gradient gloom opacity"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  gloomOpacity: clamp(value, 0, GLAZE_GLOOM_OPACITY_MAX),
                }))
              }}
            />
          </div>

          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="glaze-sheen-position"
              min={-0.5}
              max={1.5}
              step={0.005}
              value={glazeSettings.sheenPosition}
              trackLabel="position"
              ariaLabel="White gradient sheen vertical position"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  sheenPosition: clamp(value, -0.5, 1.5),
                }))
              }}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="glaze-sheen-shape"
              min={0}
              max={2}
              step={0.01}
              value={glazeSettings.sheenShape}
              trackLabel="shape"
              ariaLabel="White gradient sheen edge shape"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  sheenShape: clamp(value, 0, 2),
                }))
              }}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="glaze-sheen-opacity"
              min={0}
              max={GLAZE_SHEEN_OPACITY_MAX}
              step={0.005}
              value={glazeSettings.sheenOpacity}
              trackLabel="sheen"
              ariaLabel="White gradient sheen opacity"
              onCommit={(value) => {
                setGlazeSettings((current) => ({
                  ...current,
                  sheenOpacity: clamp(value, 0, GLAZE_SHEEN_OPACITY_MAX),
                }))
              }}
            />
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        ariaLabel="Filters"
        heading="Filters"
      >
<div className="utility-setting-slider-stack" aria-label="CSS filter controls">
          <CompactScrollbarSlider id="filter-invert" min={0} max={1} step={0.01} value={filterInvert} trackLabel="invert" ariaLabel="Invert" onCommit={setFilterInvert} />
          <CompactScrollbarSlider id="filter-sepia" min={0} max={1} step={0.01} value={filterSepia} trackLabel="sepia" ariaLabel="Sepia" onCommit={setFilterSepia} />
          <CompactScrollbarSlider id="filter-hue-rotate" min={0} max={360} step={1} value={filterHueRotate} trackLabel="hue-rotate" ariaLabel="Hue rotate (degrees)" onCommit={setFilterHueRotate} />
          <CompactScrollbarSlider id="filter-brightness" min={0} max={2} step={0.01} value={filterBrightness} trackLabel="brightness" ariaLabel="Brightness" onCommit={setFilterBrightness} />
          <CompactScrollbarSlider id="filter-contrast" min={0} max={2} step={0.01} value={filterContrast} trackLabel="contrast" ariaLabel="Contrast" onCommit={setFilterContrast} />
          <CompactScrollbarSlider id="filter-saturate" min={0} max={1} step={0.001} value={filterSaturate} trackLabel="saturate" ariaLabel="Saturate" onCommit={setFilterSaturate} />
          <CompactScrollbarSlider id="filter-colorize" min={0} max={1} step={0.01} value={filterColorize} trackLabel="colorize" ariaLabel="Colorize opacity" onCommit={setFilterColorize} />
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-scrolling"
        ariaLabel="Scrolling Behavior"
        heading="Scrolling Behavior"
      >
<div className="utility-setting-slider-stack" aria-label="Scroll curve settings">
          <CompactScrollbarSlider
            id="render-scroll-dynamic"
            min={0.1}
            max={5}
            step={0.05}
            value={renderScrollDynamic}
            trackLabel="ramp"
            ariaLabel="Curve dynamic parameter a"
            onCommit={(value) => setRenderScrollDynamic(clamp(value, 0.1, 5))}
          />
          <CompactScrollbarSlider
            id="render-scroll-responsiveness"
            min={0.1}
            max={5}
            step={0.05}
            value={renderScrollResponsiveness}
            trackLabel="response"
            ariaLabel="Curve responsiveness parameter b"
            onCommit={(value) => setRenderScrollResponsiveness(clamp(value, 0.1, 5))}
          />
          <CompactScrollbarSlider
            id="render-scroll-total-time"
            min={0}
            max={2}
            step={0.05}
            value={renderScrollTotalTimeSec}
            trackLabel="speed"
            ariaLabel="Total time parameter t in seconds"
            reverseScale
            onCommit={(value) => setRenderScrollTotalTimeSec(clamp(value, 0, 2))}
          />
          <CompactScrollbarSlider
            id="render-scroll-max-speed"
            min={1000}
            max={100000}
            step={1000}
            value={renderScrollMaxSpeedPxPerSec}
            trackLabel="max speed"
            ariaLabel="Maximum scroll speed in pixels per second"
            onCommit={(value) => setRenderScrollMaxSpeedPxPerSec(clamp(value, 1000, 100000))}
          />
          <CompactScrollbarSlider
            id="render-scroll-skew"
            min={RENDER_SCROLL_SKEW_MIN}
            max={RENDER_SCROLL_SKEW_MAX}
            step={0.01}
            value={renderScrollSkew}
            trackLabel="shape"
            ariaLabel="Curve skew (apex bias)"
            onCommit={(value) => setRenderScrollSkew(
              Math.max(RENDER_SCROLL_SKEW_MIN, Math.min(RENDER_SCROLL_SKEW_MAX, value)),
            )}
          />
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-audio"
        ariaLabel="Keystroke Sounds"
        heading="Keystroke Sounds"
      >
<div className="utility-setting-slider-stack" aria-label="Keystroke Sounds controls">
          <div className="utility-setting-button-row" role="group" aria-label="Typing sound controls">
            <button
              type="button"
              className={`btn-icon options-audio-btn${!typingSoundEnabled ? ' is-active' : ''}`}
              onClick={() => {
                setTypingSoundEnabled(false)
                typingSoundManager.setTypingSoundEnabled(false)
              }}
              aria-pressed={!typingSoundEnabled}
              title="No Key Sounds"
            >
              <span className="fa-solid fa-ban" aria-hidden="true" />
            </button>
            {(['A', 'B', 'C'] as const).map((setId) => (
              <button
                key={setId}
                type="button"
                className={`btn-icon options-audio-btn${typingSoundEnabled && typingSoundSet === setId ? ' is-active' : ''}`}
                onClick={() => {
                  setTypingSoundEnabled(true)
                  setTypingSoundSet(setId)
                  typingSoundManager.setTypingSoundEnabled(true)
                  typingSoundManager.setTypingSoundSet(setId)
                }}
                aria-pressed={typingSoundEnabled && typingSoundSet === setId}
                title={`${setId === 'A' ? 'Pops' : ''}${setId === 'B' ? 'Pins' : ''}${setId === 'C' ? 'Creamy' : ''}`}
              >
                <span className={`${setId === 'A' ? 'fa-solid fa-burst' : ''}${setId === 'B' ? 'fa-solid fa-map-pin' : ''}${setId === 'C' ? 'fa-solid fa-ice-cream' : ''}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <CompactScrollbarSlider
            id="audio-key-volume"
            min={0}
            max={1}
            step={0.01}
            value={audioKeyVolume}
            trackLabel="key"
            ariaLabel="Key volume"
            onCommit={(value) => setAudioKeyVolume(clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="audio-bass-volume"
            min={0}
            max={1}
            step={0.01}
            value={audioBassVolume}
            trackLabel="bass"
            ariaLabel="Bass volume"
            onCommit={(value) => setAudioBassVolume(clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="audio-treble-volume"
            min={0}
            max={1}
            step={0.01}
            value={audioTrebleVolume}
            trackLabel="treble"
            ariaLabel="Treble volume"
            onCommit={(value) => setAudioTrebleVolume(clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="audio-reverb-strength"
            min={0}
            max={1}
            step={0.01}
            value={audioReverbStrength}
            trackLabel="reverb"
            ariaLabel="Reverb strength"
            onCommit={(value) => setAudioReverbStrength(clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="audio-reverb-space"
            min={0}
            max={1}
            step={0.01}
            value={audioReverbSpace}
            trackLabel="room"
            ariaLabel="Reverb space"
            onCommit={(value) => setAudioReverbSpace(clamp(value, 0, 1))}
          />
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-music"
        ariaLabel="Music"
        heading="Music"
        forceOpenNonce={musicAccordionNonce}
      >
        <div className="utility-setting-slider-stack" aria-label="Music player controls">
          <CompactScrollbarSlider
            id="music-volume"
            min={0}
            max={1}
            step={0.01}
            value={musicVolume}
            trackLabel="volume"
            ariaLabel="Music volume"
            onCommit={(value) => setMusicVolume(clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="music-reverb-amount"
            min={0}
            max={1}
            step={0.01}
            value={musicReverbAmount}
            trackLabel="reverb"
            ariaLabel="Music reverb amount"
            onCommit={(value) => setMusicReverbAmount(clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="music-reverb-room"
            min={0}
            max={1}
            step={0.01}
            value={musicReverbRoom}
            trackLabel="room"
            ariaLabel="Music reverb room size"
            onCommit={(value) => setMusicReverbRoom(clamp(value, 0, 1))}
          />
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-misc"
        ariaLabel="Miscellaneous Settings"
        heading="Miscellaneous Settings"
      >
<div className="utility-setting-slider-stack" aria-label="Miscellaneous settings controls">
          <CompactScrollbarSlider
            id="editor-glyph-padding"
            min={EDITOR_GLYPH_PADDING_MIN_PX}
            max={EDITOR_GLYPH_PADDING_MAX_PX}
            step={1}
            value={editorGlyphPaddingPx}
            trackLabel="padding"
            ariaLabel="Editor glyph side padding in pixels"
            onCommit={(value) => setEditorGlyphPaddingPx(
              clamp(
                Math.round(value),
                EDITOR_GLYPH_PADDING_MIN_PX,
                EDITOR_GLYPH_PADDING_MAX_PX,
              ),
            )}
          />
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-notes"
        ariaLabel="Notes and Import"
        heading="Data Synchronization"
      >
<div className="options-loadout-grid" role="group" aria-label="Note sync and import actions">
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            onClick={syncExistingNotes}
            title="Sync stored note files"
            aria-label="Sync stored note files"
          >
            <span className="fa-solid fa-rotate" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            onClick={importNotes}
            title="Import notes from files or folders"
            aria-label="Import notes from files or folders"
          >
            <span className="fa-solid fa-file-import" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            onClick={() => void exportLayoutsTdl()}
            title="Export custom layouts to a .tdl file"
            aria-label="Export custom layouts to a .tdl file"
          >
            <span className="fa-solid fa-file-export" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            onClick={() => void importLayoutsTdl()}
            title="Import layouts from a .tdl file"
            aria-label="Import layouts from a .tdl file"
          >
            <span className="fa-solid fa-file-arrow-up" aria-hidden="true" />
          </button>
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-debug"
        ariaLabel="Debugging"
        heading="Debugging"
      >
<div className="options-loadout-grid" role="group" aria-label="Debug tools">
          <button
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn${debuggingEnabled ? ' is-active' : ''}`}
            onClick={() => {
              const next = !debuggingEnabled
              setDebuggingEnabled(next)
              if (!next) {
                // Reset session debug note so a fresh note is created if
                // debugging is re-enabled later in the same session
                debugNoteIdRef.current = null
              }
              queueAppStateSave(activeNoteId)
            }}
            title={debuggingEnabled ? 'Disable debug logging' : 'Enable debug logging to a note'}
            aria-label={debuggingEnabled ? 'Disable debug logging' : 'Enable debug logging to a note'}
            aria-pressed={debuggingEnabled}
          >
            <span className="fa-solid fa-bug" aria-hidden="true" />
          </button>
        </div>
      </AccordionSection>
      </AccordionGroup>
    </div>
    )
  }

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
      const isTagField = target === tagInputRef.current
      const isPageJumpField = target === pageJumpInputRef.current
      const isTextureSeedField = target === textureSeedInputRef.current
      const isGlazeLinearSeedField = target === glazeLinearSeedInputRef.current
      const isGlazeRadialSeedField = target === glazeRadialSeedInputRef.current
      const isEditorControlField = isSearchField || isTagField || isPageJumpField || isTextureSeedField || isGlazeLinearSeedField || isGlazeRadialSeedField

      if (isEditorControlField && ['Escape', 'Enter', 'Tab'].includes(event.key)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        scheduleFocusEditorInEditMode()
        return
      }

      if (isFindMode && event.ctrlKey && !event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        replaceAllDocumentFindHits()
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

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNote()
        return
      }

      if (isEditorTarget && activeNoteId && event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase()

        if (!event.shiftKey && key === 'b') {
          event.preventDefault()
          applyTextDecoration('bold')
          return
        }

        if (!event.shiftKey && key === 'i') {
          event.preventDefault()
          applyTextDecoration('italic')
          return
        }

        if (!event.shiftKey && key === 'j') {
          event.preventDefault()
          applyTextDecoration('strikethrough')
          return
        }

        if (!event.shiftKey && key === 'h') {
          event.preventDefault()
          toggleCurrentLineHeading()
          return
        }

        const isOrderedListShortcut = event.key === '#' || (event.shiftKey && event.key === '3')
        if (isOrderedListShortcut) {
          event.preventDefault()
          toggleNumberedList()
          return
        }

        if (!event.shiftKey && event.key === '-') {
          event.preventDefault()
          toggleBulletedList()
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
        toggleRenderViewMode()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    toggleRenderViewMode,
    createNote,
    createNoteFromClipboardTitle,
    activeNoteId,
    applyTextDecoration,
    toggleCurrentLineHeading,
    toggleNumberedList,
    toggleBulletedList,
    isFindMode,
    runSidebarMenuTransition,
    replaceAllDocumentFindHits,
  ])

  useEffect(() => {
    if (isPreviewMode || !activeNoteId) return

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
      scheduleFocusEditorInEditMode()
    }

    window.addEventListener('mousedown', onMouseDownCapture, true)
    return () => window.removeEventListener('mousedown', onMouseDownCapture, true)
  }, [activeNoteId, isAllowedNonEditorFocusTarget, isPreviewMode, scheduleFocusEditorInEditMode])

  useEffect(() => {
    const handleBeforeUnload = () => {
      // Flush any pending debounced app-state save immediately so the main
      // process receives the latest viewport/menu state before the renderer
      // is torn down. The main process will also re-save its cached copy on
      // before-quit as a belt-and-suspenders guarantee.
      if (appStateSaveTimerRef.current !== null) {
        window.clearTimeout(appStateSaveTimerRef.current)
        appStateSaveTimerRef.current = null
        const viewport = latestViewportRef.current
        void window.measlyState?.saveAppState({
          selectedNoteId: activeNoteId,
          viewport: viewport ?? undefined,
          menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
        })
      }

      persistActiveNoteEditModeStateNow()
      if (isPreviewMode && activeNoteId) {
        void persistRenderViewStateForNoteNow(activeNoteId)
      }
      persistMenuStateOnUnload()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [activeNoteId, buildMenuStateSnapshot, isPreviewMode, persistActiveNoteEditModeStateNow, persistMenuStateOnUnload, persistRenderViewStateForNoteNow, writeDebugEntry])

  const syncSidebarTexture = useCallback(() => {
    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    if (!scroller || !sidebarTextureRef.current) return
    syncTextureToScroll(scroller.scrollTop, sidebarTextureRef.current)
  }, [sidebarTreeScrollerEl])

  // Native scroll (covers mouse wheel, trackpad, keyboard when not intercepted)
  const handlePreviewScroll = useCallback(() => {
    if (!previewScrollRef.current || !previewTextureRef.current) return;
    syncTextureToScroll(previewScrollRef.current.scrollTop, previewTextureRef.current);
  }, []);

  // The render view is normally plain (non-editable) rendered markdown, but
  // Chromium's native spellchecker only underlines misspellings inside an
  // editable region. To let spell check work in render view too, we make the
  // preview container contentEditable when the render-view spell check
  // toggle is on, and block every event that would actually mutate its
  // content — so it stays visually read-only while still being "editable"
  // enough for the OS/Chromium spellchecker to run against it.
  const blockPreviewEditMutation = useCallback((event: { preventDefault: () => void }) => {
    event.preventDefault()
  }, [])

  const handleSidebarScroll = useCallback(() => {
    syncSidebarTexture()
  }, [syncSidebarTexture])

  useEffect(() => {
    syncSidebarTexture()
  }, [syncSidebarTexture, sidebarMode, isSidebarScrollbarMode])

  return (
    <div className="app-root" style={appRootStyle} onDragOver={handleAppDragOver} onDrop={handleAppDrop}>
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
            <aside className="notes-sidebar" style={{ gridArea: 'sidebar' }}>
              <div className="search-box" aria-label="Search panel">
                <div className="search-input-shell">
                <input
                  className="search-input-field has-case-toggle"
                  ref={sidebarSearchInputRef}
                  type="text"
                  placeholder={isFindMode ? 'Find in current note...' : 'Filters notes by content or #tag...'}
                  value={isFindMode ? documentFindQuery : searchQuery}
                  onChange={(event) => {
                    const value = event.target.value
                    if (isFindMode) {
                      setDocumentFindQuery(value)
                    } else {
                      setSearchQuery(value)
                    }
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                        scheduleFocusEditorInEditMode()
                      }
                    }, 0)
                  }}
                />
                <button
                  type="button"
                  className={`btn-icon search-input-case-toggle${(isFindMode ? isDocumentFindCaseSensitive : isSearchQueryCaseSensitive) ? ' is-active' : ''}`}
                  aria-pressed={isFindMode ? isDocumentFindCaseSensitive : isSearchQueryCaseSensitive}
                  title="Match letter case"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (isFindMode) {
                      setIsDocumentFindCaseSensitive((previous) => !previous)
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
                      className={`toggle-btn notes-mode-button icon-btn ${iconClassByMode[mode]}${isActive ? ' is-active' : ''}${mode === 'trash' && isTrashViewDeleteArmed ? ' is-armed-for-deletion' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      title={label}
                      aria-label={label}
                      onClick={() => handleViewModeButtonClick(mode)}
                      onContextMenu={
                        mode === 'trash'
                          ? handleTrashViewButtonContextMenu
                          : mode === 'find'
                            ? handleFindViewButtonContextMenu
                            : undefined
                      }
                      onMouseDown={mode === 'trash' ? handleTrashViewButtonMouseDown : undefined}
                      onMouseUp={mode === 'trash' ? handleTrashViewButtonMouseUp : undefined}
                      onMouseLeave={mode === 'trash' ? () => {
                        clearTrashButtonArmTimer()
                        setIsTrashViewDeleteArmed(false)
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
                          const isActive = note.id === activeNoteId
                          const isModified = isExternalNote(note) && getCurrentExternalNoteModifiedState(note)
                          return (
                            <NoteListItem
                              key={note.id}
                              note={note}
                              isActive={isActive}
                              isModified={isModified}
                              onSelect={handleSelectNote}
                              onArmedLeftClick={handleArmedNoteLeftClick}
                              armedAction={armedNoteActionById.get(note.id) ?? null}
                              onLeftPressStart={handleNoteLeftPressStart}
                              onLeftPressEnd={handleNoteLeftPressEnd}
                              onRightPressStart={handleNoteRightPressStart}
                              onRightPressEnd={handleNoteRightPressEnd}
                              onArmHoverLeave={handleNoteArmHoverLeave}
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
                        className="notes-list find-view measly-custom-scrollbar"
                        ref={setSidebarTreeScrollerEl}
                      >
                        {documentFindHits.map((hit, index) => (
                          <button
                            key={hit.id}
                            type="button"
                            className="find-hit-item"
                            onClick={() => handleJumpToDocumentFindHit(hit)}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              replaceDocumentFindHit(hit)
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
                        {documentFindHits.length === 0 ? (
                          <div className="notes-empty-state">
                            {documentFindQuery.trim()
                              ? 'No matches in the current note.'
                              : 'Type in the search field to find text in the current note.'}
                          </div>
                        ) : null}
                      </div>
                    ) : sidebarMode === 'options' ? (
                      renderSidebarOptionsContent()
                    ) : (
                      <div
                        className={`notes-list tree-view measly-custom-scrollbar${hasDateFilter ? ' is-filtered' : ''}`}
                        ref={setSidebarTreeScrollerEl}
                      >
                        <CategoryTreeView
                          groups={sidebarMode === 'category' ? categoryTree : archiveTree}
                          activeNoteId={activeNoteId}
                          persistedCollapsedPrimary={sidebarMode === 'category' ? categoryCollapsedPrimary : archiveCollapsedPrimary}
                          persistedCollapsedSecondary={sidebarMode === 'category' ? categoryCollapsedSecondary : archiveCollapsedSecondary}
                          focusNoteRequestKey={sidebarMode === 'category' ? categoryFocusRequestKey : archiveFocusRequestKey}
                          onCollapseChange={sidebarMode === 'category' ? handleCategoryCollapseChange : handleArchiveCollapseChange}
                          onSelect={handleSelectNote}
                          onArmedLeftClick={handleArmedNoteLeftClick}
                          armedNoteActionById={armedNoteActionById}
                          onLeftPressStart={handleNoteLeftPressStart}
                          onLeftPressEnd={handleNoteLeftPressEnd}
                          onNoteRightPressStart={handleNoteRightPressStart}
                          onNoteRightPressEnd={handleNoteRightPressEnd}
                          onNoteArmHoverLeave={handleNoteArmHoverLeave}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {isSidebarScrollbarMode ? (
                  <aside className="sidebar-scrollbar-slot" aria-hidden="true">
                    <div className="sidebar-scrollbar-slot-inner">
                      <div className="measly-scroll-rail sidebar-measly-scroll-rail">
                        <div
                          ref={sidebarScrollbarTrackRef}
                          className="measly-scroll-track"
                          onMouseDown={handleSidebarTrackMouseDown}
                        >
                          <div
                            ref={sidebarScrollbarThumbRef}
                            className={`measly-scroll-thumb${isDraggingSidebarScrollThumb ? ' is-dragging' : ''}${isSidebarScrollThumbActive ? '' : ' is-inactive'}`}
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
                            scheduleFocusEditorInEditMode()
                            return
                          }

                          if (event.key === 'Escape' || event.key === 'Tab') {
                            event.preventDefault()
                            cancelPageJumpEdit()
                            scheduleFocusEditorInEditMode()
                          }
                        }}
                        onBlur={() => {
                          window.setTimeout(() => {
                            if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                              scheduleFocusEditorInEditMode()
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
            <div
              className="grid-divider divider-sidebar"
              style={{ gridArea: 'd-sidebar' }}
            />

            <section className="tag-input-grid" style={{ gridArea: 'taginput' }} aria-label="Tag input manager">
              <div className="tag-input-container">
                <div className="tag-input-section">
                  <div className="tag-input-bar">
                    <div className="tag-input-wrapper">
                      <input
                        ref={tagInputRef}
                        className="tag-input"
                        type="text"
                        value={tagInputValue}
                        placeholder={
                          !activeNoteId
                            ? (notes.length > 0 ? 'Select a note to edit tags.' : 'Once you have created a note, you can add tags here.')
                            : (renamingTagName ? 'Rename tag and press Enter...' : 'Type to add tag...')
                        }
                        onChange={(event) => setTagInputValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            handleTagInputEnter()
                            scheduleFocusEditorInEditMode()
                            return
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            if (renamingTagName) {
                              setRenamingTagName(null)
                              setTagInputValue('')
                            }
                            scheduleFocusEditorInEditMode()
                            return
                          }
                          if (event.key === 'Tab') {
                            event.preventDefault()
                            if (renamingTagName) {
                              setRenamingTagName(null)
                              setTagInputValue('')
                            }
                            scheduleFocusEditorInEditMode()
                          }
                        }}
                        disabled={!persistenceReady || !activeNoteId || isTagMutationPending || activeNoteIsExternal}
                        aria-label="Tag input"
                      />
                    </div>
                  </div>

                  <div
                    className="tags-display"
                    aria-live="polite"
                    onDragOver={handleTagContainerDragOver}
                    onDrop={handleTagContainerDrop}
                  >
                    {!activeNoteId ? (
                      <div className="tag-empty-state">Drag to order, left click to remove, right click to rename.</div>
                    ) : orderedActiveTags.length === 0 ? (
                      <div className="tag-empty-state">No tags on active note.</div>
                    ) : (
                      orderedActiveTags.map((tagName, index) => {
                        const normalized = normalizeTagName(tagName)
                        const isProtected = isProtectedTagName(tagName)
                        return (
                          <div
                            key={tagName}
                            className={`tag-pill active${deleteArmedTagName === tagName ? ' armed' : ''}${isProtected ? ` protected ${normalized}` : ''}`}
                            draggable={!isProtected}
                            onDragStart={(event) => handleTagDragStart(event, index)}
                            onDragEnd={handleTagDragEnd}
                            onDragOver={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              event.dataTransfer.dropEffect = 'move'
                            }}
                            onDrop={(event) => handleTagDrop(event, index)}
                            onClick={() => handleTagChipClick(tagName)}
                            onContextMenu={(event) => handleTagContextMenu(event, tagName)}
                            onMouseLeave={() => handleTagChipMouseLeave(tagName)}
                            title={deleteArmedTagName === tagName ? 'Click again to delete or move cursor away to cancel' : 'Click to arm deletion'}
                          >
                            <span className="tag-pill-label">
                              {tagName}
                            </span>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="suggested-grid" style={{ gridArea: 'suggested' }} aria-label="Suggested tags panel">
              <div className="suggested-tags" aria-hidden={suggestedTags.length === 0}>
                {suggestedTags.map((tagName) => (
                  <div
                    key={tagName}
                    className="tag-pill suggested"
                    onClick={() => handleAddSuggestedTag(tagName)}
                    title={`Add ${tagName}`}
                    aria-disabled={!activeNoteId || isTagMutationPending || activeNoteIsExternal}
                  >
                    {tagName}
                  </div>
                ))}
                {suggestedTags.length === 0 ? (
                  <div className="suggested-empty">
                    {activeNoteId
                      ? ''
                      : 'Tags you have used before will appear here. Click them to quickly assign them to your current note. If a tag is no longer in use, it will disappear from this list.'}
                  </div>
                ) : null}
              </div>
            </section>

            <div className="grid-divider divider-right" style={{ gridArea: 'd-right' }} aria-hidden="true" />

            <section
              className={`utility-grid${windowIsCollapsed ? ' is-collapsed' : ''}`}
              ref={utilityGridRef}
              style={{ gridArea: 'utility' }}
              aria-label="Utility grid"
            >
              <div className="window-controls" aria-label="Window controls">
                <div className="window-minimize-split" role="group" aria-label="Mini mode and minimize controls">
                  <button
                    type="button"
                    className="toolbar-gear-btn btn-icon window-minimize-split-btn mini-mode"
                    title={windowIsCollapsed ? 'Exit mini mode' : 'Enter mini mode'}
                    aria-label={windowIsCollapsed ? 'Exit mini mode' : 'Enter mini mode'}
                    onClick={handleWindowUtilityCollapseToggle}
                  >
                    <span className={`fa-solid ${windowIsCollapsed ? 'fa-arrows-left-right' : 'fa-caret-up'}`} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="toolbar-gear-btn btn-icon window-minimize-split-btn minimize"
                    title="Minimize"
                    aria-label="Minimize window"
                    onClick={handleWindowMinimize}
                  >
                    <span className="fa-solid fa-caret-down" aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  className="toolbar-gear-btn btn-icon"
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
                  className="toolbar-gear-btn btn-icon"
                  title="Close"
                  aria-label="Close window"
                  onClick={handleWindowClose}
                >
                  <span className="fa-solid fa-dove" aria-hidden="true" />
                </button>
              </div>

              <AudioControls
                volume={musicVolume}
                reverbAmount={musicReverbAmount}
                reverbRoom={musicReverbRoom}
                activeSlots={musicActiveSlots}
                onActiveSlotsChange={setMusicActiveSlots}
                isOptionsOpen={sidebarMode === 'options'}
                onOpenMusicOptions={() => {
                  if (sidebarMode !== 'options') setMusicAccordionNonce((n) => n + 1)
                  toggleSidebarOptionsMenu()
                }}
              />
            </section>

            <section className="toolbar-grid" style={{ gridArea: 'toolbar' }} aria-label="Editor toolbar">
              <div className="editor-toolbar">
                <div className="toolbar-left-tools">
                  <button
                    className={`btn-icon ${!isPreviewMode ? 'active' : ''}`}
                    type="button"
                    title={isPreviewMode ? 'Edit mode inactive' : 'Edit mode active'}
                    aria-label={isPreviewMode ? 'Edit mode inactive' : 'Edit mode active'}
                    onClick={toggleRenderViewMode}
                  >
                    <span className="fa-solid fa-pen-to-square" aria-hidden="true" />
                  </button>
                  <div className="toolbar-spacer-large"/>
                  <button
                    className={`btn-icon ${(isPreviewMode ? spellCheckRenderEnabled : spellCheckEditEnabled) ? 'active' : ''}`}
                    type="button"
                    title={
                      isPreviewMode
                        ? (spellCheckRenderEnabled ? 'Disable spell check (render view)' : 'Enable spell check (render view)')
                        : (spellCheckEditEnabled ? 'Disable spell check (edit mode)' : 'Enable spell check (edit mode)')
                    }
                    aria-label={
                      isPreviewMode
                        ? (spellCheckRenderEnabled ? 'Spell check active in render view' : 'Spell check inactive in render view')
                        : (spellCheckEditEnabled ? 'Spell check active in edit mode' : 'Spell check inactive in edit mode')
                    }
                    aria-pressed={isPreviewMode ? spellCheckRenderEnabled : spellCheckEditEnabled}
                    onClick={() => {
                      if (isPreviewMode) {
                        setSpellCheckRenderEnabled((prev) => !prev)
                      } else {
                        setSpellCheckEditEnabled((prev) => !prev)
                      }
                      queueAppStateSave(activeNoteId)
                    }}
                  >
                    <span className="fa-solid fa-spell-check" aria-hidden="true" />
                  </button>

                  {isPreviewMode ? (
                    <div className="toolbar-action-group" aria-label="Print toolbar">
                      <div className="toolbar-spacer"/>
                      <button
                        type="button"
                        className="btn-icon"
                        title="Export PDF"
                        aria-label="Export current note to PDF"
                        onClick={handleExportPdf}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          void chooseExportFolder()
                        }}
                        disabled={!activeNoteId || isExportingPdf}
                      >
                        <span className="fa-solid fa-file-pdf" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        title="Export Markdown"
                        aria-label="Export current note to Markdown"
                        onClick={() => void handleExportMd()}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          void handleExportMd(true)
                        }}
                        disabled={!activeNoteId || isExportingMd}
                      >
                        <span className="fa-solid fa-file-code" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}

                  {!isPreviewMode ? (
                    <div className="markdown-toolbar" aria-label="Markdown toolbar">
                      <div className="toolbar-spacer"/>
                      <button
                        type="button"
                        className={`btn-icon ${activeDecorationFormats.has('bold') ? 'active' : ''}`}
                        onClick={() => applyTextDecoration('bold')}
                        title="Bold"
                        aria-label="Bold"
                        disabled={!activeNoteId}
                      >
                        <strong>B</strong>
                      </button>
                      <button
                        type="button"
                        className={`btn-icon ${activeDecorationFormats.has('italic') ? 'active' : ''}`}
                        onClick={() => applyTextDecoration('italic')}
                        title="Italic"
                        aria-label="Italic"
                        disabled={!activeNoteId}
                      >
                        <em>I</em>
                      </button>
                      <button
                        type="button"
                        className={`btn-icon ${activeDecorationFormats.has('strikethrough') ? 'active' : ''}`}
                        onClick={() => applyTextDecoration('strikethrough')}
                        title="Strikethrough"
                        aria-label="Strikethrough"
                        disabled={!activeNoteId}
                      >
                        <span style={{ textDecoration: 'line-through' }}>S</span>
                      </button>

                      <div className="toolbar-spacer"/>

                      <button type="button" className={`btn-icon ${activeHeadingLevel === 1 ? 'active' : ''}`} title="Heading 1" onClick={() => applyHeading(1)} disabled={!activeNoteId}>H1</button>
                      <button type="button" className={`btn-icon ${activeHeadingLevel === 2 ? 'active' : ''}`} title="Heading 2" onClick={() => applyHeading(2)} disabled={!activeNoteId}>H2</button>
                      <button type="button" className={`btn-icon ${activeHeadingLevel === 3 ? 'active' : ''}`} title="Heading 3" onClick={() => applyHeading(3)} disabled={!activeNoteId}>H3</button>

                      <div className="toolbar-spacer"/>

                      <button type="button" className={`btn-icon ${isBulletedListActive ? 'active' : ''}`} title="Bulleted list" onClick={toggleBulletedList} disabled={!activeNoteId}>≡</button>
                      <button type="button" className={`btn-icon ${isNumberedListActive ? 'active' : ''}`} title="Numbered list" onClick={toggleNumberedList} disabled={!activeNoteId}>#</button>
                      <button type="button" className={`btn-icon ${isChecklistActive ? 'active' : ''}`} title="Checklist" onClick={toggleChecklistList} disabled={!activeNoteId}>☐</button>

                      <div className="toolbar-spacer"/>

                      <button type="button" className={`btn-icon ${isBlockquoteActive ? 'active' : ''}`} title="Blockquote" onClick={toggleBlockquote} disabled={!activeNoteId}>&quot;</button>
                      <button type="button" className={`btn-icon ${isCodeBlockActive ? 'active' : ''}`} title="Code block" onClick={applyCodeBlock} disabled={!activeNoteId}>{'{ }'}</button>
                      <button type="button" className={`btn-icon ${isInlineCodeActive ? 'active' : ''}`} title="Inline code" onClick={applyInlineCode} disabled={!activeNoteId}>{'<>'}</button>

                      <div className="toolbar-spacer"/>

                      <button type="button" className="btn-icon" title="Horizontal rule" onClick={insertHorizontalRule} disabled={!activeNoteId}>—</button>
                      <button type="button" className="btn-icon" title="Link" onClick={applyLink} disabled={!activeNoteId}>🔗</button>
                    </div>
                  ) : null}
                </div>

                <div className="toolbar-right-tools" aria-label="Toolbar right controls">
                  {isPreviewMode ? (
                    <>
                      <div className="style-selector">
                        <select
                          value={viewStyle}
                          onChange={(event) => setViewStyle(event.target.value as ViewStyleKey)}
                          aria-label="Render style"
                          disabled={!activeNoteId}
                        >
                          <option value="modern">Modern</option>
                          <option value="narrow">Narrow</option>
                          <option value="cute">Cute</option>
                          <option value="xkcd">xkcd</option>
                          <option value="print">Print</option>
                        </select>
                      </div>

                      <div className="style-selector">
                        <select
                          value={viewFontSize}
                          onChange={(event) => setViewFontSize(event.target.value as ViewSizeKey)}
                          aria-label="Render font size"
                          disabled={!activeNoteId}
                        >
                          <option value="xs">XS</option>
                          <option value="s">S</option>
                          <option value="m">M</option>
                          <option value="l">L</option>
                          <option value="xl">XL</option>
                        </select>
                      </div>

                      <div className="style-selector">
                        <select
                          value={viewSpacing}
                          onChange={(event) => setViewSpacing(event.target.value as ViewSpacingKey)}
                          aria-label="Render spacing"
                          disabled={!activeNoteId}
                        >
                          <option value="tight">Tight</option>
                          <option value="compact">Compact</option>
                          <option value="cozy">Cozy</option>
                          <option value="wide">Wide</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="style-selector">
                        <select
                          value={editorStyle}
                          onChange={(event) => {
                            setEditorStyle(event.target.value as EditorStyleKey)
                            scheduleFocusEditorInEditMode()
                          }}
                          aria-label="Editor style"
                          disabled={!activeNoteId}
                        >
                          {EDITOR_STYLE_OPTIONS.map((option) => (
                            <option key={option.key} value={option.key}>{option.label}</option>
                          ))}
                        </select>
                      </div>

                      <div className="style-selector">
                        <select
                          value={editorFontSize}
                          onChange={(event) => {
                            setEditorFontSize(event.target.value as EditorFontSizeKey)
                            scheduleFocusEditorInEditMode()
                          }}
                          aria-label="Editor font size"
                          disabled={!activeNoteId}
                        >
                          {EDITOR_FONT_SIZE_OPTIONS.map((option) => (
                            <option key={option.key} value={option.key}>{option.label}</option>
                          ))}
                        </select>
                      </div>

                      <div className="style-selector">
                        <select
                          value={editorSpacing}
                          onChange={(event) => {
                            setEditorSpacing(event.target.value as EditorSpacingKey)
                            scheduleFocusEditorInEditMode()
                          }}
                          aria-label="Editor spacing"
                          disabled={!activeNoteId}
                        >
                          {EDITOR_SPACING_OPTIONS.map((option) => (
                            <option key={option.key} value={option.key}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}

                  <button
                    type="button"
                    className={`toggle-btn icon-btn toolbar-gear-btn${uiMode === 'dark' ? ' is-active' : ''}`}
                    title="Toggle dark mode"
                    aria-label="Toggle dark mode"
                    onClick={toggleUiMode}
                  >
                    <span className="toolbar-gear-glyph fa-solid fa-moon" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    className={`toggle-btn icon-btn toolbar-gear-btn${sidebarMode === 'options' ? ' is-active' : ''}`}
                    title="View options"
                    aria-label="View options"
                    onClick={toggleSidebarOptionsMenu}
                  >
                    <span className="toolbar-gear-glyph fa-solid fa-gear" aria-hidden="true" />
                  </button>

                </div>
              </div>
            </section>

            <div className="editor-viewer-frame" style={{ gridArea: 'viewer' }}>
              <main className="editor-shell">
                <div className="editor-background">
                  <div ref={editorStageRef} className={`editor-stage${isPreviewMode ? ' is-preview-mode' : ''}`}>
                    <div className="edit-container" style={{ display: isPreviewMode ? 'none' : undefined }}>
                      <Editor
                        key={activeNoteId ?? 'editor' }
                        bindings={bindings}
                        adapterRef={adapterRef}
                        noteId={activeNoteId}
                        initialText={activeNoteText}
                        scrollbarHost={scrollbarHostEl}
                        fontFamily={editorFontFamily}
                        fontSizePx={editorRuntimeMetrics.fontSizePx}
                        lineHeightPx={editorRuntimeMetrics.lineHeightPx}
                        glyphWidthPx={editorRuntimeMetrics.glyphWidthPx}
                        cellWidthPx={editorRuntimeMetrics.cellWidthPx}
                        fontReady={editorFontLoadVersion > 0}
                        editorReadOnly={activeNoteHasDebugTag}
                        caretSuspended={isCaretSuspended}
                        spellCheckEnabled={spellCheckEditEnabled}
                      />
                    </div>
                    <div className="render-container" style={{ display: isPreviewMode ? undefined : 'none' }} aria-hidden={!isPreviewMode}>
                      <div ref={previewTextureRef} className="markdown-preview-texture" />
                      <div
                        ref={previewScrollRef}
                        onScroll={handlePreviewScroll}
                        className={`markdown-preview measly-custom-scrollbar style-${viewStyle} size-${viewFontSize} spacing-${viewSpacing}`}
                        style={{ '--search-hit-color': highlightColors.search } as CSSProperties}
                        contentEditable={spellCheckRenderEnabled}
                        suppressContentEditableWarning={spellCheckRenderEnabled}
                        spellCheck={spellCheckRenderEnabled}
                        onBeforeInput={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                        onPaste={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                        onCut={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                        onDrop={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                      >
                        {previewMarkdownElement}
                      </div>
                    </div>
                  </div>
                </div>
              </main>
              <aside className="editor-scrollbar-slot" aria-hidden="true">
                <div className="editor-scrollbar-slot-inner">
                  {!isPreviewMode ? (
                    <div ref={setScrollbarHostEl} className="editor-scrollbar-slot-inner" />
                  ) : (
                    <div className="measly-scroll-rail">
                      <div
                        ref={previewScrollbarTrackRef}
                        className="measly-scroll-track"
                        onMouseDown={handlePreviewTrackMouseDown}
                      >
                        <div
                          ref={previewScrollbarThumbRef}
                          className={`measly-scroll-thumb${isDraggingPreviewScrollThumb ? ' is-dragging' : ''}${isPreviewScrollThumbActive ? '' : ' is-inactive'}`}
                          onMouseDown={handlePreviewThumbMouseDown}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </aside>
              <div className="editor-document-stats" aria-live="polite">
                {activeNoteId ? (
                  <>
                    <div className="editor-document-wordcount"><span><b>{activeNoteDocumentStats.wordCount.toLocaleString()}</b> ({activeNoteDocumentStats.characterCount.toLocaleString()})</span></div>
                  </>
                ) : (
                  <span>0 words</span>
                )}
              </div>
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


