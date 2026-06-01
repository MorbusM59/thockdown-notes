import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Editor } from './components/Editor'
import './App.css'
import type {
  EditorAdapter,
  EditorBindings,
  EditorSelectionChangeEvent,
  EditorSelectionState,
  EditorTextChangeEvent,
  EditorViewportChangeEvent,
} from './editor/EditorContract'
import type { PersistedMenuState, PersistedSidebarViewState, PersistedViewportState } from './shared/appState'
import type { NoteSummary } from './shared/noteLifecycle'
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
import { normalizeInternalText } from './editor/TextPolicy'
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

const SAVE_DEBOUNCE_MS = 350
const NEW_NOTE_TEMPLATE = '# '
const FALLBACK_NEW_NOTE_TITLE = 'Untitled'
const PROTECTED_TAGS = new Set(['archived', 'deleted', 'external'])
const GRID_DIVIDER_PX = 8
const SIDEBAR_MIN_WIDTH_PX = 288
const SIDEBAR_MAX_WIDTH_PX = 520
const TAG_INPUT_MIN_WIDTH_PX = 320
const SUGGESTED_MIN_WIDTH_PX = 220
const UTILITY_WIDTH_PX = 160
const DEFAULT_SIDEBAR_RATIO = 0.306
const DEFAULT_TAG_SPLIT_RATIO = 0.645
const EDITOR_GLYPH_PADDING_MIN_PX = 0
const EDITOR_GLYPH_PADDING_MAX_PX = 5
const SCROLL_TRACK_MIN_THUMB_HEIGHT_PX = 28
const SCROLL_TRACK_EDGE_GAP_PX = 3
const NOTE_RIGHT_CLICK_HOLD_MS = 200
const COLOR_BUTTON_ARM_HOLD_MS = 300
const PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER = CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER
const DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {
  caret: 'rgba(120, 115, 112, 0.8)',
  selection: 'rgba(199, 94, 0, 0.49)',
  background: '#e9e6e3',
  topBackground: 'rgba(196, 187, 182, 0.49)',
  bottomBackground: 'rgba(196, 187, 182, 0.49)',
  gridOutline: '#00000022',
}

const HIGHLIGHT_COLOR_ORDER: HighlightColorKey[] = ['topBackground', 'bottomBackground', 'background', 'gridOutline', 'caret', 'selection']

const HIGHLIGHT_COLOR_TITLES: Record<HighlightColorKey, string> = {
  caret: 'Caret color',
  selection: 'Selection box color',
  background: 'Background',
  topBackground: 'Upper Box',
  bottomBackground: 'Lower Box',
  gridOutline: 'Box outline',
}

const HIGHLIGHT_COLOR_ICONS: Record<HighlightColorKey, string> = {
  caret: 'fa-solid fa-i-cursor',
  selection: 'fa-solid fa-arrow-pointer',
  background: 'fa-solid fa-square',
  topBackground: 'fa-solid fa-square-caret-up',
  bottomBackground: 'fa-solid fa-square-caret-down',
  gridOutline: 'fa-regular fa-square',
}

type SidebarMode = 'date' | 'category' | 'archive' | 'trash' | 'find'
type NoteArmedAction = 'archive' | 'deletion'
type ProtectedQuickReleaseAction = 'remove-archived' | 'remove-deleted' | null
type TextDecorationFormat = 'bold' | 'italic' | 'strikethrough'
type ViewStyleKey = 'modern' | 'narrow' | 'cute' | 'print'
type ViewSizeKey = 'xs' | 's' | 'm' | 'l' | 'xl'
type ViewSpacingKey = 'tight' | 'compact' | 'cozy' | 'wide'
type HighlightColorKey = 'caret' | 'selection' | 'background' | 'topBackground' | 'bottomBackground' | 'gridOutline'

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

type HsvaDragState = {
  control: HsvaControlKey
  pointerId: number
  startX: number
  baseValue: number
}

type ColorArmSource =
  | { kind: 'element'; key: HighlightColorKey }
  | { kind: 'hsva'; key: HsvaControlKey }
  | { kind: 'active-color' }

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

function isSafePreviewHref(href: string | undefined): boolean {
  if (!href) return false
  try {
    const parsed = new URL(href)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' || parsed.protocol === 'tel:'
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
} as const

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
    a.sizeBytes === b.sizeBytes
  )
}

function mergeNoteSummaries(previous: NoteSummary[], next: NoteSummary[]): NoteSummary[] {
  const previousById = new Map(previous.map((note) => [note.id, note]))
  const merged: NoteSummary[] = []
  let changed = previous.length !== next.length

  for (let index = 0; index < next.length; index += 1) {
    const nextNote = next[index]
    const existing = previousById.get(nextNote.id)

    if (existing && isSameNoteSummary(existing, nextNote)) {
      merged.push(existing)
      if (previous[index] !== existing) {
        changed = true
      }
      continue
    }

    merged.push(nextNote)
    changed = true
  }

  return changed ? merged : previous
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolvePreviewAnchorRatioFromEditState(params: {
  text: string
  selectionEnd: number
  viewport: PersistedViewportState | null
  telemetry?: EditViewportTelemetry | null
  lineHeightPx: number
}): number {
  const { text, selectionEnd, viewport, telemetry, lineHeightPx } = params

  const safeTextLength = Math.max(1, text.length)
  const cursorRatio = clamp(selectionEnd / safeTextLength, 0, 1)

  if (telemetry) {
    const maxScrollTopPx = Math.max(0, telemetry.scrollHeightPx - telemetry.clientHeightPx)
    if (maxScrollTopPx > 0) {
      return clamp(telemetry.scrollTopPx / maxScrollTopPx, 0, 1)
    }
  }

  if (!viewport) {
    return cursorRatio
  }

  const totalRows = Math.max(1, text.split('\n').length)
  const safeLineHeight = Math.max(1, lineHeightPx)
  const scrolledRows = Math.max(0, viewport.scrollTopPx / safeLineHeight)
  const viewportRatio = clamp(scrolledRows / Math.max(1, totalRows - 1), 0, 1)

  return viewportRatio
}

function quantizeEditScrollTop(scrollTopPx: number, lineHeightPx: number): number {
  const safeLineHeight = Math.max(1, lineHeightPx)
  return Math.max(0, Math.round(scrollTopPx / safeLineHeight) * safeLineHeight)
}

function buildEditRestoreSnapshotFromUiState(params: {
  noteId: string
  text: string
  uiState: { scrollTop?: unknown; cursorPos?: unknown } | null | undefined
  fallbackViewport: PersistedViewportState | null
  lineHeightPx: number
}): EditRestoreSnapshot {
  const { noteId, text, uiState, fallbackViewport, lineHeightPx } = params
  const fallbackTopBoundary = fallbackViewport?.topBoundaryPx ?? 0
  const fallbackBottomBoundary = fallbackViewport?.bottomBoundaryPx ?? (lineHeightPx * 6)
  const selectionTextLength = Math.max(0, text.length)
  const persistedCursor =
    typeof uiState?.cursorPos === 'number' && Number.isFinite(uiState.cursorPos)
      ? Math.max(0, Math.min(Math.round(uiState.cursorPos), selectionTextLength))
      : 0
  const storedScrollTop =
    typeof uiState?.scrollTop === 'number' && Number.isFinite(uiState.scrollTop)
      ? quantizeEditScrollTop(Math.max(0, Math.round(uiState.scrollTop)), lineHeightPx)
      : 0

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
      topBoundaryPx: fallbackTopBoundary,
      bottomBoundaryPx: fallbackBottomBoundary,
      scrollTopPx: storedScrollTop,
    },
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
  onSelect: (noteId: string) => void
  onArmedLeftClick: (noteId: string) => void
  armedAction?: NoteArmedAction | null
  onRightPressStart: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onRightPressEnd: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onArmHoverLeave: (noteId: string) => void
  variant?: 'default' | 'tree'
}

const NoteListItem = memo(function NoteListItem({
  note,
  isActive,
  onSelect,
  onArmedLeftClick,
  armedAction = null,
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
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    onRightPressStart(note.id, event)
  }, [note.id, onRightPressStart])

  const handleMouseUp = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    onRightPressEnd(note.id, event)
  }, [note.id, onRightPressEnd])

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleMouseLeave = useCallback(() => {
    onArmHoverLeave(note.id)
  }, [note.id, onArmHoverLeave])

  return (
    <div
      className={`note-list-item${isActive ? ' is-active' : ''}${isTreeVariant ? ' is-tree-card' : ''}${armedAction === 'archive' ? ' is-armed-for-archiving' : ''}${armedAction === 'deletion' ? ' is-armed-for-deletion' : ''}`}
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
        <div className="note-list-title">{note.title || 'Untitled'}</div>
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

function matchesSearchQuery(note: NoteSummary, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  if (normalized.startsWith('#')) {
    const tagQuery = normalized.slice(1).trim()
    if (!tagQuery) return true
    return note.tags.some((tag) => tag.toLowerCase().includes(tagQuery))
  }

  return (
    note.title.toLowerCase().includes(normalized) ||
    note.fileName.toLowerCase().includes(normalized) ||
    note.tags.some((tag) => tag.toLowerCase().includes(normalized))
  )
}

function App() {
  const adapterRef = useRef<EditorAdapter | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const sidebarContentRef = useRef<HTMLDivElement | null>(null)
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null)
  const tagInputRef = useRef<HTMLInputElement | null>(null)
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [tagInputValue, setTagInputValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [documentFindQuery, setDocumentFindQuery] = useState('')
  const [isDocumentFindCaseSensitive, setIsDocumentFindCaseSensitive] = useState(false)
  // Terminology convention: false = edit mode, true = render view.
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [viewStyle, setViewStyle] = useState<ViewStyleKey>('modern')
  const [viewFontSize, setViewFontSize] = useState<ViewSizeKey>('m')
  const [viewSpacing, setViewSpacing] = useState<ViewSpacingKey>('cozy')
  const [editorStyle, setEditorStyle] = useState<EditorStyleKey>(DEFAULT_EDITOR_STYLE)
  const [editorFontSize, setEditorFontSize] = useState<EditorFontSizeKey>(DEFAULT_EDITOR_FONT_SIZE)
  const [editorSpacing, setEditorSpacing] = useState<EditorSpacingKey>(DEFAULT_EDITOR_SPACING)
  const [editorGlyphPaddingPx, setEditorGlyphPaddingPx] = useState<number>(DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX)
  const [isTagMutationPending, setIsTagMutationPending] = useState(false)
  const [deleteArmedTagName, setDeleteArmedTagName] = useState<string | null>(null)
  const [renamingTagName, setRenamingTagName] = useState<string | null>(null)
  const [draggedTagIndex, setDraggedTagIndex] = useState<number | null>(null)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('date')
  const [sidebarViewStateByMode, setSidebarViewStateByMode] = useState<SidebarViewStateByMode>(() => createDefaultSidebarViewStateByMode())
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set())
  const [selectedYears, setSelectedYears] = useState<Set<number | 'older'>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
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
  const [editorSelection, setEditorSelection] = useState<EditorSelectionState>({
    anchor: 0,
    focus: 0,
    start: 0,
    end: 0,
    isCollapsed: true,
  })
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [appShellWidthPx, setAppShellWidthPx] = useState(980)
  const [sidebarWidthRatio, setSidebarWidthRatio] = useState(DEFAULT_SIDEBAR_RATIO)
  const [tagSplitRatio, setTagSplitRatio] = useState(DEFAULT_TAG_SPLIT_RATIO)
  const [renderScrollDynamic, setRenderScrollDynamic] = useState(() => getRenderScrollDynamic())
  const [renderScrollResponsiveness, setRenderScrollResponsiveness] = useState(() => getRenderScrollResponsiveness())
  const [renderScrollTotalTimeSec, setRenderScrollTotalTimeSec] = useState(() => getRenderScrollTotalTimeSec())
  const [renderScrollMaxSpeedPxPerSec, setRenderScrollMaxSpeedPxPerSec] = useState(() => getRenderScrollMaxSpeedPxPerSec())
  const [renderScrollSkew, setRenderScrollSkew] = useState(() => getRenderScrollSkew())
  const [isScrollSettingsOpen, setIsScrollSettingsOpen] = useState(false)
  const [highlightColors, setHighlightColors] = useState<HighlightColors>(DEFAULT_HIGHLIGHT_COLORS)
  const [activeHighlightColorKey, setActiveHighlightColorKey] = useState<HighlightColorKey>('caret')
  const [armedColorSource, setArmedColorSource] = useState<ColorArmSource | null>(null)
  const [activeColorHsva, setActiveColorHsva] = useState<HsvaColor>(() => {
    const seed = parseCssColorToRgba(DEFAULT_HIGHLIGHT_COLORS.caret) ?? { r: 120, g: 115, b: 112, a: 0.8 }
    return rgbaToHsva(seed)
  })
  const [hsvaDragState, setHsvaDragState] = useState<HsvaDragState | null>(null)
  const [activeDividerDrag, setActiveDividerDrag] = useState<'sidebar' | 'tag-split' | null>(null)
  const colorArmTimerRef = useRef<number | null>(null)
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
  const saveTimerRef = useRef<number | null>(null)
  const appStateSaveTimerRef = useRef<number | null>(null)
  const noteTransitionLockRef = useRef(false)
  const pendingViewportRestoreRef = useRef<PersistedViewportState | null>(null)
  const pendingSidebarScrollRestoreRef = useRef<{ mode: SidebarMode; scrollTop: number } | null>(null)
  const latestEditViewportRef = useRef<PersistedViewportState | null>(null)
  const latestEditViewportTelemetryRef = useRef<EditViewportTelemetry | null>(null)
  const editUiStateSaveTimerRef = useRef<number | null>(null)
  const lastPersistedEditUiStateRef = useRef<{ noteId: string; progressEdit: number; cursorPos: number; scrollTop: number } | null>(null)
  const pendingEditRestoreSnapshotRef = useRef<EditRestoreSnapshot | null>(null)
  const editModeSnapshotByNoteIdRef = useRef<Map<string, EditRestoreSnapshot>>(new Map())
  const previousActiveNoteIdForEditRestoreRef = useRef<string | null>(null)
  const pendingRenderViewAnchorRatioRef = useRef<number | null>(null)
  const previousPreviewModeRef = useRef(false)
  const hasPreviewModeBaselineRef = useRef(false)
  const latestViewportRef = useRef<PersistedViewportState | null>(null)
  const isApplyingInitialViewportRef = useRef(false)
  const dateFilteredNotesRef = useRef<NoteSummary[]>([])
  const trashFilteredNotesRef = useRef<NoteSummary[]>([])
  const categoryTreeRef = useRef<PrimaryGroup[]>([])
  const archiveTreeRef = useRef<PrimaryGroup[]>([])
  const dividerDragStartXRef = useRef(0)
  const dividerStartSidebarWidthRef = useRef(0)
  const dividerStartTagInputWidthRef = useRef(0)
  const dividerStartMainWidthRef = useRef(0)
  const externalOpenQueueRef = useRef<Promise<void>>(Promise.resolve())
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
  const noteArmTimerRef = useRef<{ noteId: string; timeoutId: number; quickReleaseAction: ProtectedQuickReleaseAction } | null>(null)
  const trashButtonArmTimerRef = useRef<number | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const previewScrollSaveTimerRef = useRef<number | null>(null)
  const previewScrollbarTrackRef = useRef<HTMLDivElement | null>(null)
  const previewScrollbarRafRef = useRef<number | null>(null)
  const previewScrollbarDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null)
  const previewScrollbarThumbRef = useRef<HTMLDivElement | null>(null)
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
    [editorStyle, editorFontSize, editorSpacing, editorGlyphPaddingPx],
  )
  const editorFontFamily = useMemo(() => resolveEditorFontFamily(editorStyle), [editorStyle])
  const activeColorRgba = useMemo(() => hsvaToRgba(activeColorHsva), [activeColorHsva])
  const activeColorCss = useMemo(() => rgbaToCssColor(activeColorRgba), [activeColorRgba])

  const hsvaDisplayColors = useMemo(() => {
    const hColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: 1, v: 1, a: 1 }))
    const sColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: activeColorHsva.s, v: 1, a: 1 }))
    const vColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: 0, v: activeColorHsva.v, a: 1 }))
    const aGhostColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: 0, v: 0, a: activeColorHsva.a }))
    return { hColor, sColor, vColor, aGhostColor }
  }, [activeColorHsva])

  const updateHighlightColor = useCallback((key: HighlightColorKey, color: RgbaColor) => {
    setHighlightColors((previous) => ({
      ...previous,
      [key]: rgbaToCssColor(color),
    }))
  }, [])

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

  const applyElementColorToElement = useCallback((sourceKey: HighlightColorKey, targetKey: HighlightColorKey) => {
    if (sourceKey === targetKey) return

    setHighlightColors((previous) => {
      const source = resolveHighlightColor(previous, sourceKey)
      return {
        ...previous,
        [targetKey]: rgbaToCssColor(source),
      }
    })
  }, [resolveHighlightColor])

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

  const applyActiveColorToElement = useCallback((targetKey: HighlightColorKey) => {
    setHighlightColors((previous) => ({
      ...previous,
      [targetKey]: activeColorCss,
    }))
  }, [activeColorCss])

  const applyElementValueToHsvaControl = useCallback((sourceKey: HighlightColorKey, control: HsvaControlKey) => {
    const source = resolveHighlightColor(highlightColors, sourceKey)
    const sourceHsva = rgbaToHsva(source)

    setActiveColorHsva((previous) => ({
      ...previous,
      [control]: sourceHsva[control],
    }))
  }, [highlightColors, resolveHighlightColor])

  const applyElementColorToActiveColor = useCallback((sourceKey: HighlightColorKey) => {
    const source = resolveHighlightColor(highlightColors, sourceKey)
    setActiveColorHsva(rgbaToHsva(source))
  }, [highlightColors, resolveHighlightColor])

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

  const startHsvaDrag = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    if (armedColorSource?.kind === 'element') return

    event.preventDefault()

    const baseValue = control === 'h'
      ? activeColorHsva.h
      : activeColorHsva[control] * 255

    event.currentTarget.setPointerCapture(event.pointerId)

    setHsvaDragState({
      control,
      pointerId: event.pointerId,
      startX: event.clientX,
      baseValue,
    })

    updateHsvaControlValue(control, baseValue)
  }, [activeColorHsva, armedColorSource, updateHsvaControlValue])

  const handleHsvaDragMove = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = hsvaDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    event.preventDefault()
    const delta = event.clientX - currentDrag.startX
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

  useEffect(() => {
    if (!hsvaDragState) {
      document.body.classList.remove('hsva-dragging')
      return
    }

    document.body.classList.add('hsva-dragging')
    return () => {
      document.body.classList.remove('hsva-dragging')
    }
  }, [hsvaDragState])

  useEffect(() => {
    return () => {
      clearColorArmTimer()
    }
  }, [clearColorArmTimer])

  useEffect(() => {
    if (!armedColorSource) return

    const handleGlobalMouseDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 2) return
      clearColorArmTimer()
      setArmedColorSource(null)
    }

    window.addEventListener('mousedown', handleGlobalMouseDown, true)
    return () => {
      window.removeEventListener('mousedown', handleGlobalMouseDown, true)
    }
  }, [armedColorSource, clearColorArmTimer])

  useEffect(() => {
    if (isScrollSettingsOpen) return
    clearColorArmTimer()
    setArmedColorSource(null)
  }, [isScrollSettingsOpen, clearColorArmTimer])

  const readCurrentEditUiPayload = useCallback((): { progressEdit: number; cursorPos: number; scrollTop: number } | null => {
    const selection = latestEditorSelectionRef.current

    const snapshotViewport = adapterRef.current?.getSnapshot()?.viewport
    let snapshotViewportState: PersistedViewportState | null = null

    if (snapshotViewport) {
      snapshotViewportState = {
        topBoundaryPx: Math.round(snapshotViewport.topBoundaryPx),
        bottomBoundaryPx: Math.round(snapshotViewport.bottomBoundaryPx),
        scrollTopPx: Math.round(snapshotViewport.scrollTopPx),
      }

      latestViewportRef.current = snapshotViewportState
      latestEditViewportRef.current = snapshotViewportState
      latestEditViewportTelemetryRef.current = {
        scrollTopPx: Math.round(snapshotViewport.scrollTopPx),
        scrollHeightPx: Math.max(0, Math.round(snapshotViewport.scrollHeightPx ?? 0)),
        clientHeightPx: Math.max(0, Math.round(snapshotViewport.clientHeightPx ?? 0)),
      }
    }

    const viewport = snapshotViewportState ?? latestEditViewportRef.current ?? latestViewportRef.current
    if (!viewport) return null

    const scrollTop = Math.max(0, Math.round(viewport.scrollTopPx))
    const lineHeight = Math.max(1, editorRuntimeMetrics.lineHeightPx)
    const progressEdit = scrollTop / lineHeight
    const cursorPos = Math.max(0, selection.end)

    return {
      progressEdit,
      cursorPos,
      scrollTop,
    }
  }, [editorRuntimeMetrics.lineHeightPx])

  const updateEditModeSnapshotCache = useCallback((snapshot: EditRestoreSnapshot) => {
    editModeSnapshotByNoteIdRef.current.set(snapshot.noteId, {
      ...snapshot,
      viewport: {
        ...snapshot.viewport,
        scrollTopPx: quantizeEditScrollTop(snapshot.viewport.scrollTopPx, editorRuntimeMetrics.lineHeightPx),
      },
    })
  }, [editorRuntimeMetrics.lineHeightPx])

  const captureEditModeSnapshotFromEditor = useCallback((noteId: string): EditRestoreSnapshot | null => {
    const liveSnapshot = adapterRef.current?.getSnapshot()
    const selection = liveSnapshot?.selection ?? latestEditorSelectionRef.current
    const snapshotViewport = liveSnapshot?.viewport
    const viewport = snapshotViewport
      ? {
          topBoundaryPx: Math.round(snapshotViewport.topBoundaryPx),
          bottomBoundaryPx: Math.round(snapshotViewport.bottomBoundaryPx),
          scrollTopPx: Math.round(snapshotViewport.scrollTopPx),
        }
      : (latestEditViewportRef.current ?? latestViewportRef.current)

    if (snapshotViewport) {
      latestViewportRef.current = viewport
      latestEditViewportRef.current = viewport
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
    payload: { progressEdit: number; cursorPos: number; scrollTop: number },
  ) => {
    const legacyDb = window.measlyLegacyDb
    if (!legacyDb) return

    const { progressEdit, cursorPos, scrollTop } = payload
    const previousPersisted = lastPersistedEditUiStateRef.current
    const changed =
      !previousPersisted
      || previousPersisted.noteId !== noteId
      || previousPersisted.scrollTop !== scrollTop
      || previousPersisted.cursorPos !== cursorPos
      || Math.abs(previousPersisted.progressEdit - progressEdit) >= 0.0001

    if (changed) {
      lastPersistedEditUiStateRef.current = {
        noteId,
        progressEdit,
        cursorPos,
        scrollTop,
      }
      await legacyDb.saveNoteUiState(noteId, payload)
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
      documentFindCaseSensitive: isDocumentFindCaseSensitive,
      isPreviewMode,
      viewStyle,
      viewFontSize,
      viewSpacing,
      editorStyle,
      editorFontSize,
      editorSpacing,
      editorGlyphPaddingPx,
      sidebarWidthRatio,
      tagSplitRatio,
      renderScrollDynamic,
      renderScrollResponsiveness,
      renderScrollTotalTimeSec,
      renderScrollMaxSpeedPxPerSec,
      renderScrollSkew,
      highlightCaretColor: highlightColors.caret,
      highlightSelectionColor: highlightColors.selection,
      highlightBackgroundColor: highlightColors.background,
      highlightTopBackgroundColor: highlightColors.topBackground,
      highlightBottomBackgroundColor: highlightColors.bottomBackground,
      highlightGridOutlineColor: highlightColors.gridOutline,
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
    }
  }, [
    archiveCollapsedPrimary,
    archiveCollapsedSecondary,
    categoryCollapsedPrimary,
    categoryCollapsedSecondary,
    editorFontSize,
    editorGlyphPaddingPx,
    editorSpacing,
    editorStyle,
    isDocumentFindCaseSensitive,
    isPreviewMode,
    renderScrollDynamic,
    renderScrollResponsiveness,
    renderScrollMaxSpeedPxPerSec,
    renderScrollSkew,
    renderScrollTotalTimeSec,
    highlightColors,
    searchQuery,
    selectedMonths,
    selectedYears,
    sidebarMode,
    sidebarViewStateByMode,
    sidebarWidthRatio,
    tagSplitRatio,
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

      const safeItemsPerPage = Math.max(1, itemsPerPage)
      const targetPage = Math.floor(noteIndex / safeItemsPerPage) + 1
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
  }, [activeNoteId, itemsPerPage])

  const runSidebarMenuTransition = useCallback((nextMode: SidebarMode) => {
    if (nextMode === sidebarMode) {
      return
    }

    const leavingSnapshot = captureSidebarModeState(sidebarMode)
    const nextSidebarViewStateByMode: SidebarViewStateByMode = {
      ...sidebarViewStateByMode,
      [sidebarMode]: leavingSnapshot,
    }

    setSidebarViewStateByMode(nextSidebarViewStateByMode)
    setSidebarMode(nextMode)
    restoreSidebarModeStateFrom(nextMode, nextSidebarViewStateByMode)
    void persistMenuStateOnce(nextMode, nextSidebarViewStateByMode)
  }, [
    captureSidebarModeState,
    persistMenuStateOnce,
    restoreSidebarModeStateFrom,
    sidebarMode,
    sidebarViewStateByMode,
  ])

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
    setIsScrollSettingsOpen(false)
  }, [isPreviewMode])

  const layout = useMemo(() => {
    const dividerTotalWidthPx = GRID_DIVIDER_PX * 3
    const maxSidebarWidthPx = Math.max(
      SIDEBAR_MIN_WIDTH_PX,
      Math.min(
        SIDEBAR_MAX_WIDTH_PX,
        appShellWidthPx - dividerTotalWidthPx - UTILITY_WIDTH_PX - TAG_INPUT_MIN_WIDTH_PX - SUGGESTED_MIN_WIDTH_PX,
      ),
    )

    const sidebarWidthPx = clamp(appShellWidthPx * sidebarWidthRatio, SIDEBAR_MIN_WIDTH_PX, maxSidebarWidthPx)
    const mainColumnsWidthPx = Math.max(
      TAG_INPUT_MIN_WIDTH_PX + SUGGESTED_MIN_WIDTH_PX,
      appShellWidthPx - dividerTotalWidthPx - UTILITY_WIDTH_PX - sidebarWidthPx,
    )

    const tagInputWidthPx = clamp(mainColumnsWidthPx * tagSplitRatio, TAG_INPUT_MIN_WIDTH_PX, mainColumnsWidthPx - SUGGESTED_MIN_WIDTH_PX)
    const suggestedWidthPx = Math.max(SUGGESTED_MIN_WIDTH_PX, mainColumnsWidthPx - tagInputWidthPx)

    return {
      sidebarWidthPx,
      mainColumnsWidthPx,
      tagInputWidthPx,
      suggestedWidthPx,
      gridTemplateColumns: `${Math.round(sidebarWidthPx)}px ${GRID_DIVIDER_PX}px ${Math.round(tagInputWidthPx)}px ${GRID_DIVIDER_PX}px ${Math.round(suggestedWidthPx)}px ${GRID_DIVIDER_PX}px ${UTILITY_WIDTH_PX}px`,
    }
  }, [appShellWidthPx, sidebarWidthRatio, tagSplitRatio])

  const appShellStyle = useMemo(() => {
    const style: CSSProperties & Record<string, string> = {
      gridTemplateColumns: layout.gridTemplateColumns,
      '--color-bg-regular': highlightColors.background,
      '--color-bg-leading': highlightColors.topBackground,
      '--color-bg-trailing': highlightColors.bottomBackground,
      '--color-grid-outline': highlightColors.gridOutline,
      '--color-caret': highlightColors.caret,
      '--color-selection': highlightColors.selection,
    }
    return style
  }, [highlightColors, layout.gridTemplateColumns])

  const queueAppStateSave = useCallback((selectedNoteId: string | null) => {
    if (!window.measlyState) return
    if (!persistenceReady) return
    if (isApplyingInitialViewportRef.current) return

    if (appStateSaveTimerRef.current !== null) {
      window.clearTimeout(appStateSaveTimerRef.current)
    }

    appStateSaveTimerRef.current = window.setTimeout(() => {
      appStateSaveTimerRef.current = null
      void window.measlyState?.saveAppState({
        selectedNoteId,
        viewport: latestViewportRef.current ?? undefined,
        menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
      })
    }, 150)
  }, [buildMenuStateSnapshot, persistenceReady])

  const flushSave = useCallback(async () => {
    if (!window.measlyNotes || !activeNoteId) return
    const nextText = pendingSaveTextRef.current
    if (nextText === null) return

    pendingSaveTextRef.current = null
    try {
      const savedSummary = await window.measlyNotes.saveNote({ id: activeNoteId, text: normalizeInternalText(nextText) })
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

  const persistRenderViewStateForNoteNow = useCallback(async (noteId: string) => {
    const container = previewScrollRef.current
    if (!container) return

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    const ratio = maxScrollTop <= 0 ? 0 : clamp(container.scrollTop / maxScrollTop, 0, 1)
    await window.measlyLegacyDb?.saveNoteUiState(noteId, { progressPreview: ratio })
  }, [])

  const activateNote = useCallback(async (noteId: string) => {
    if (!window.measlyNotes) return

    const previousNoteId = activeNoteId
    if (persistenceReady && previousNoteId && previousNoteId !== noteId) {
      const previousSnapshot = editModeSnapshotByNoteIdRef.current.get(previousNoteId)
      const snapshotPayload = previousSnapshot
        ? {
            progressEdit: previousSnapshot.viewport.scrollTopPx / Math.max(1, editorRuntimeMetrics.lineHeightPx),
            cursorPos: previousSnapshot.fullSelection.end,
            scrollTop: quantizeEditScrollTop(previousSnapshot.viewport.scrollTopPx, editorRuntimeMetrics.lineHeightPx),
          }
        : null
      const payload = snapshotPayload

      if (payload) {
        await persistEditUiPayloadForNote(previousNoteId, payload)
      }
    }

    const [loaded, nextUiState] = await Promise.all([
      window.measlyNotes.loadNote({ id: noteId }),
      window.measlyLegacyDb?.getNoteUiState(noteId) ?? Promise.resolve(null),
    ])
    const hydratedText = normalizeInternalText(loaded.text)
    const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
    const preloadedSnapshot = buildEditRestoreSnapshotFromUiState({
      noteId,
      text: hydratedText,
      uiState: nextUiState,
      fallbackViewport,
      lineHeightPx: editorRuntimeMetrics.lineHeightPx,
    })
    updateEditModeSnapshotCache(preloadedSnapshot)

    latestEditorTextRef.current = hydratedText
    pendingEditRestoreSnapshotRef.current = preloadedSnapshot
    pendingRenderViewAnchorRatioRef.current = null
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

  const focusEditorInEditMode = useCallback(() => {
    if (isPreviewMode || !activeNoteId) return

    const editorRoot = document.querySelector<HTMLElement>('.editor-stage .editor-text[contenteditable="true"]')
    if (!editorRoot) return
    if (document.activeElement === editorRoot) return

    editorRoot.focus({ preventScroll: true })
  }, [activeNoteId, isPreviewMode])

  const scheduleFocusEditorInEditMode = useCallback(() => {
    window.setTimeout(() => {
      focusEditorInEditMode()
    }, 0)
  }, [focusEditorInEditMode])

  const isAllowedNonEditorFocusTarget = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false

    if (target instanceof HTMLSelectElement) {
      return true
    }

    if (target === sidebarSearchInputRef.current || target === tagInputRef.current) {
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

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()
      const created = await window.measlyNotes.createNote({ initialText })
      await refreshNotes(created.id)
      await activateNote(created.id)
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
    const legacyDbApi = window.measlyLegacyDb
    const notesApi = window.measlyNotes
    if (!externalApi || !legacyDbApi || !notesApi) return
    if (!persistenceReady) return

    if (noteTransitionLockRef.current) {
      return
    }

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      const [fileName, content] = await Promise.all([
        externalApi.getFileBasename(filePath),
        externalApi.readFileContent(filePath),
      ])

      if (content === null) {
        return
      }

      const initialTitle = titleFromFileBasename(fileName)
      let noteId = await legacyDbApi.getTempNoteIdByExternalPath(filePath)

      if (!noteId) {
        noteId = await legacyDbApi.createTempNote(initialTitle, filePath, 'utf8')
      }

      await notesApi.saveNote({ id: noteId, text: normalizeInternalText(content) })
      await legacyDbApi.updateTempNoteState(noteId, false, true)
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
    const queue = externalOpenQueueRef.current
    externalOpenQueueRef.current = queue
      .then(() => importExternalFileAsTempNote(filePath))
      .catch((error) => {
        console.error('External file import queue error', error)
      })
  }, [importExternalFileAsTempNote])

  const activeNoteSummary = useMemo(() => {
    if (!activeNoteId) return null
    return notes.find((note) => note.id === activeNoteId) ?? null
  }, [activeNoteId, notes])

  const persistEditUiState = useCallback((noteId: string, options?: { immediate?: boolean }) => {
    const legacyDb = window.measlyLegacyDb
    if (!legacyDb) return

    const persistNow = async () => {
      const payload = readCurrentEditUiPayload()
      if (!payload) return
      const { progressEdit, cursorPos, scrollTop } = payload

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
            scrollTopPx: quantizeEditScrollTop(scrollTop, editorRuntimeMetrics.lineHeightPx),
          },
        })
      }

      const previousPersisted = lastPersistedEditUiStateRef.current
      if (
        previousPersisted &&
        previousPersisted.noteId === noteId &&
        previousPersisted.scrollTop === scrollTop &&
        previousPersisted.cursorPos === cursorPos &&
        Math.abs(previousPersisted.progressEdit - progressEdit) < 0.0001
      ) {
        return
      }

      lastPersistedEditUiStateRef.current = {
        noteId,
        progressEdit,
        cursorPos,
        scrollTop,
      }

      await legacyDb.saveNoteUiState(noteId, payload)
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

    const cachedSnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    const snapshotPayload = cachedSnapshot
      ? {
          progressEdit: cachedSnapshot.viewport.scrollTopPx / Math.max(1, editorRuntimeMetrics.lineHeightPx),
          cursorPos: cachedSnapshot.fullSelection.end,
          scrollTop: quantizeEditScrollTop(cachedSnapshot.viewport.scrollTopPx, editorRuntimeMetrics.lineHeightPx),
        }
      : null
    const payload = snapshotPayload
    if (!payload) return

    void persistEditUiPayloadForNote(activeNoteId, payload)
  }, [
    activeNoteId,
    captureEditModeSnapshotFromEditor,
    editorRuntimeMetrics.lineHeightPx,
    isPreviewMode,
    persistEditUiPayloadForNote,
  ])

  const applyEditRestoreSnapshot = useCallback((snapshot: EditRestoreSnapshot, options?: { restoreFullSelection?: boolean }) => {
    const restoreFullSelection = options?.restoreFullSelection ?? true
    let cancelled = false
    const targetScrollTop = Math.max(0, Math.round(snapshot.viewport.scrollTopPx))

    const applyViewportSnapshot = () => {
      adapterRef.current?.applySnapshot({
        viewport: {
          topBoundaryPx: snapshot.viewport.topBoundaryPx,
          bottomBoundaryPx: snapshot.viewport.bottomBoundaryPx,
          scrollTopPx: targetScrollTop,
          lineHeightPx: editorRuntimeMetrics.lineHeightPx,
          cellWidthPx: editorRuntimeMetrics.cellWidthPx,
        },
      })
    }

    const scheduleViewportReconcile = (attempt: number, stableFrames: number) => {
      if (cancelled) return

      const viewport = adapterRef.current?.getSnapshot()?.viewport
      const observedScrollTop = typeof viewport?.scrollTopPx === 'number' ? Math.round(viewport.scrollTopPx) : null
      const maxScrollTop = viewport
        ? Math.max(0, Math.round((viewport.scrollHeightPx ?? 0) - (viewport.clientHeightPx ?? 0)))
        : 0
      const waitingForHydration = targetScrollTop > 0 && maxScrollTop <= 0
      const expectedScrollTop = waitingForHydration
        ? targetScrollTop
        : Math.min(targetScrollTop, maxScrollTop)
      const scrollDelta = observedScrollTop === null ? Number.POSITIVE_INFINITY : Math.abs(observedScrollTop - expectedScrollTop)
      const isSettled = !waitingForHydration && scrollDelta <= 1
      const nextStableFrames = isSettled ? (stableFrames + 1) : 0
      const maxAttempts = 120

      if (nextStableFrames >= 2 || attempt >= maxAttempts) {
        return
      }

      applyViewportSnapshot()
      requestAnimationFrame(() => scheduleViewportReconcile(attempt + 1, nextStableFrames))
    }

    const applyWhenReady = () => {
      if (cancelled) return
      const adapter = adapterRef.current
      if (!adapter) {
        requestAnimationFrame(applyWhenReady)
        return
      }

      adapter.applySnapshot({
        selection: snapshot.collapsedSelection,
        viewport: {
          topBoundaryPx: snapshot.viewport.topBoundaryPx,
          bottomBoundaryPx: snapshot.viewport.bottomBoundaryPx,
          scrollTopPx: targetScrollTop,
          lineHeightPx: editorRuntimeMetrics.lineHeightPx,
          cellWidthPx: editorRuntimeMetrics.cellWidthPx,
        },
      })

      latestViewportRef.current = {
        topBoundaryPx: snapshot.viewport.topBoundaryPx,
        bottomBoundaryPx: snapshot.viewport.bottomBoundaryPx,
        scrollTopPx: targetScrollTop,
      }
      latestEditViewportRef.current = latestViewportRef.current

      requestAnimationFrame(() => scheduleViewportReconcile(0, 0))

      if (!restoreFullSelection || snapshot.fullSelection.isCollapsed) {
        return
      }

      requestAnimationFrame(() => {
        if (cancelled) return
        adapterRef.current?.applySnapshot({
          selection: snapshot.fullSelection,
        })
      })
    }

    requestAnimationFrame(applyWhenReady)

    return () => {
      cancelled = true
    }
  }, [editorRuntimeMetrics.cellWidthPx, editorRuntimeMetrics.lineHeightPx])

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

  const handleTagDragStart = useCallback((index: number) => {
    const tagName = orderedActiveTags[index] ?? ''
    if (isProtectedTagName(tagName)) return
    setDraggedTagIndex(index)
  }, [orderedActiveTags])

  const handleTagDrop = useCallback((event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault()

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
    reordered.splice(targetIndex, 0, moved)
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

  const executeArmedNoteAction = useCallback(async (noteId: string, action: NoteArmedAction) => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    const summary = notes.find((note) => note.id === noteId)
    const isCurrentlyDeleted = summary ? isDeletedNote(summary) : false

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      if (action === 'deletion' && isCurrentlyDeleted) {
        await window.measlyNotes.deleteNote({ id: noteId })

        const preferredId = activeNoteId === noteId ? null : (activeNoteId ?? null)
        const nextActiveId = await refreshNotes(preferredId)

        if (activeNoteId === noteId) {
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
        await activateNote(noteId)
      }
    } catch (error) {
      console.error('Failed to apply note action', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, activeNoteId, applyProtectedNoteDestination, flushPendingSaveNow, notes, persistenceReady, refreshNotes])

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

  const handleNoteRightPressStart = useCallback((noteId: string, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    clearNoteArmTimer()

    const summary = notes.find((note) => note.id === noteId)
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

    noteArmTimerRef.current = { noteId, timeoutId, quickReleaseAction }
  }, [clearNoteArmTimer, notes])

  const handleNoteRightPressEnd = useCallback((noteId: string, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    const pendingArm = noteArmTimerRef.current
    if (!pendingArm || pendingArm.noteId !== noteId) {
      return
    }

    // Quick release consumes the current cycle before hold-escalation.
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
      const preferredId = activeDeleted ? null : (activeNoteId ?? null)
      const nextActiveId = await refreshNotes(preferredId)

      if (activeDeleted) {
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
            }

            setSidebarViewStateByMode(loadedSidebarViewState)
            setSidebarMode(appState.menu.sidebarMode)
            setSelectedMonths(new Set(appState.menu.selectedMonths))
            setSelectedYears(new Set(appState.menu.selectedYears))
            setSearchQuery(appState.menu.searchQuery)
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
            setSidebarWidthRatio(appState.menu.sidebarWidthRatio)
            setTagSplitRatio(appState.menu.tagSplitRatio)
            setRenderScrollDynamic(appState.menu.renderScrollDynamic ?? appState.menu.renderScrollEaseMultiplier ?? getRenderScrollDynamic())
            setRenderScrollResponsiveness(appState.menu.renderScrollResponsiveness ?? appState.menu.renderScrollDistanceTimeInfluence ?? getRenderScrollResponsiveness())
            setRenderScrollTotalTimeSec(appState.menu.renderScrollTotalTimeSec ?? getRenderScrollTotalTimeSec())
            setRenderScrollMaxSpeedPxPerSec(appState.menu.renderScrollMaxSpeedPxPerSec ?? getRenderScrollMaxSpeedPxPerSec())
            setRenderScrollSkew(appState.menu.renderScrollSkew ?? getRenderScrollSkew())
            setHighlightColors({
              caret: appState.menu.highlightCaretColor ?? DEFAULT_HIGHLIGHT_COLORS.caret,
              selection: appState.menu.highlightSelectionColor ?? DEFAULT_HIGHLIGHT_COLORS.selection,
              background: appState.menu.highlightBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.background,
              topBackground: appState.menu.highlightTopBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.topBackground,
              bottomBackground: appState.menu.highlightBottomBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.bottomBackground,
              gridOutline: appState.menu.highlightGridOutlineColor ?? DEFAULT_HIGHLIGHT_COLORS.gridOutline,
            })

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
          } else {
            persistedMenuStateRef.current = null
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

          pendingViewportRestoreRef.current = appState.viewport ?? null
          latestViewportRef.current = appState.viewport ?? null

          if (window.measlyState) {
            await window.measlyState.saveAppState({
              selectedNoteId: loaded.id,
              viewport: appState.viewport,
              menu: persistedMenuStateRef.current ?? undefined,
            })
          }

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

      adapter.applySnapshot({
        viewport: {
          topBoundaryPx: pending.topBoundaryPx,
          bottomBoundaryPx: pending.bottomBoundaryPx,
          scrollTopPx: pending.scrollTopPx,
          lineHeightPx: editorRuntimeMetrics.lineHeightPx,
          cellWidthPx: editorRuntimeMetrics.cellWidthPx,
        },
      })

      latestEditViewportRef.current = {
        topBoundaryPx: pending.topBoundaryPx,
        bottomBoundaryPx: pending.bottomBoundaryPx,
        scrollTopPx: pending.scrollTopPx,
      }

      pendingViewportRestoreRef.current = null
      isApplyingInitialViewportRef.current = false
    }

    requestAnimationFrame(applyViewport)

    return () => {
      cancelled = true
      isApplyingInitialViewportRef.current = false
    }
  }, [persistenceReady, activeNoteId, editorRuntimeMetrics.lineHeightPx, editorRuntimeMetrics.cellWidthPx])

  const bindings = useMemo<EditorBindings>(() => ({
    onTextChange: (event: EditorTextChangeEvent) => {
      const normalizedText = normalizeInternalText(event.text)
      latestEditorTextRef.current = normalizedText
      latestEditorSelectionRef.current = event.selection
      setEditorSelection(event.selection)
      setEditorTextVersion((previous) => previous + 1)

      if (!activeNoteId || !persistenceReady) return

      const isUserEditableSource =
        event.source === 'user-input' || event.source === 'history-undo' || event.source === 'history-redo'

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
      if (!activeNoteId) return null

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
      if (!activeNoteId) return null

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
    onEnterTransform: (event) => {
      if (!activeNoteId) return null
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
      const nextViewport = {
        topBoundaryPx: Math.round(event.viewport.topBoundaryPx),
        bottomBoundaryPx: Math.round(event.viewport.bottomBoundaryPx),
        scrollTopPx: Math.round(event.viewport.scrollTopPx),
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

    const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)

    if (!wasPreviewMode && isPreviewMode) {
      if (
        pendingRenderViewAnchorRatioRef.current === null
        || !pendingEditRestoreSnapshotRef.current
        || pendingEditRestoreSnapshotRef.current.noteId !== activeNoteId
      ) {
        const liveSnapshot = adapterRef.current?.getSnapshot()
        const selection = liveSnapshot?.selection ?? latestEditorSelectionRef.current
        const snapshotViewport = liveSnapshot?.viewport
        const viewport = snapshotViewport
          ? {
              topBoundaryPx: Math.round(snapshotViewport.topBoundaryPx),
              bottomBoundaryPx: Math.round(snapshotViewport.bottomBoundaryPx),
              scrollTopPx: Math.round(snapshotViewport.scrollTopPx),
            }
          : (latestEditViewportRef.current ?? latestViewportRef.current)

        if (snapshotViewport) {
          latestViewportRef.current = viewport
          latestEditViewportRef.current = viewport
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

        const cursorPos = Math.max(0, Math.min(selection.end, Math.max(1, activeText.length)))
        pendingRenderViewAnchorRatioRef.current = resolvePreviewAnchorRatioFromEditState({
          text: activeText,
          selectionEnd: cursorPos,
          viewport,
          telemetry: latestEditViewportTelemetryRef.current,
          lineHeightPx: editorRuntimeMetrics.lineHeightPx,
        })
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
      return applyEditRestoreSnapshot(cachedSnapshot, { restoreFullSelection: true })
    }

    const memorySnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    if (memorySnapshot) {
      return applyEditRestoreSnapshot(memorySnapshot, { restoreFullSelection: true })
    }

    let cancelled = false

    const restoreFromPersistedEditState = async () => {
      try {
        const uiState = await window.measlyLegacyDb?.getNoteUiState(activeNoteId)
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

        applyEditRestoreSnapshot(fallbackSnapshot, { restoreFullSelection: false })
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
    const selectionEnd = snapshot?.fullSelection.end ?? latestEditorSelectionRef.current.end
    const viewport = snapshot?.viewport ?? latestEditViewportRef.current ?? latestViewportRef.current

    const cursorPos = Math.max(0, Math.min(selectionEnd, Math.max(1, activeText.length)))
    pendingRenderViewAnchorRatioRef.current = resolvePreviewAnchorRatioFromEditState({
      text: activeText,
      selectionEnd: cursorPos,
      viewport,
      telemetry: latestEditViewportTelemetryRef.current,
      lineHeightPx: editorRuntimeMetrics.lineHeightPx,
    })
  }, [captureEditModeSnapshotFromEditor, editorRuntimeMetrics.lineHeightPx])

  const toggleRenderViewMode = useCallback(() => {
    setIsPreviewMode((previous) => {
      if (!previous && activeNoteId) {
        const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
        setActiveNoteText(activeText)
        captureEditModeSnapshotForRenderView(activeNoteId, activeText)
      } else if (previous && activeNoteId) {
        void persistRenderViewStateForNoteNow(activeNoteId)
      }
      return !previous
    })
  }, [activeNoteId, activeNoteText, captureEditModeSnapshotForRenderView, persistRenderViewStateForNoteNow])

  useEffect(() => {
    if (!window.measlyState || !activeNoteId) return
    queueAppStateSave(activeNoteId)
  }, [activeNoteId, queueAppStateSave])

  useEffect(() => {
    if (!persistenceReady || !activeNoteId) return

    let cancelled = false

    const preloadEditModeSnapshot = async () => {
      try {
        const uiState = await window.measlyLegacyDb?.getNoteUiState(activeNoteId)
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
    if (!persistenceReady || !activeNoteId) return

    const previousActiveNoteId = previousActiveNoteIdForEditRestoreRef.current
    previousActiveNoteIdForEditRestoreRef.current = activeNoteId
    if (previousActiveNoteId === activeNoteId) {
      // Note identity did not change; avoid re-restoring on edit/render mode toggles.
      return
    }

    const cachedSnapshot = pendingEditRestoreSnapshotRef.current
    if (cachedSnapshot && cachedSnapshot.noteId === activeNoteId) {
      pendingEditRestoreSnapshotRef.current = null
      applyEditRestoreSnapshot(cachedSnapshot, { restoreFullSelection: true })
      return
    }

    const memorySnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    if (memorySnapshot) {
      applyEditRestoreSnapshot(memorySnapshot, { restoreFullSelection: true })
      return
    }

    let cancelled = false

    const restorePersistedEditState = async () => {
      try {
        const uiState = await window.measlyLegacyDb?.getNoteUiState(activeNoteId)
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

        applyEditRestoreSnapshot(restoreSnapshot, { restoreFullSelection: false })
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

    const applyPreviewRatio = (ratio: number) => {
      const container = previewScrollRef.current
      if (!container) return
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      container.scrollTop = Math.max(0, Math.min(maxScrollTop, ratio * maxScrollTop))
    }

    const applyPreviewRatioImmediate = (ratio: number) => {
      const clampedRatio = clamp(ratio, 0, 1)
      setPreviewScrollBehavior('auto')

      const reconcilePreviewRatio = (attempt: number, previousMaxScrollTop: number, stableFrames: number) => {
        if (cancelled) return

        const container = previewScrollRef.current
        if (!container) {
          setPreviewScrollBehavior('')
          return
        }

        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
        const targetScrollTop = Math.max(0, Math.min(maxScrollTop, clampedRatio * maxScrollTop))
        if (Math.abs(container.scrollTop - targetScrollTop) > 0.5) {
          container.scrollTop = targetScrollTop
        }

        const observedDelta = Math.abs(container.scrollTop - targetScrollTop)
        const maxScrollStable = Math.abs(maxScrollTop - previousMaxScrollTop) <= 0.5
        const nextStableFrames = maxScrollStable && observedDelta <= 1 ? (stableFrames + 1) : 0

        if (nextStableFrames >= 2 || attempt >= 24) {
          setPreviewScrollBehavior('')
          return
        }

        requestAnimationFrame(() => {
          reconcilePreviewRatio(attempt + 1, maxScrollTop, nextStableFrames)
        })
      }

      applyPreviewRatio(clampedRatio)
      requestAnimationFrame(() => {
        reconcilePreviewRatio(0, -1, 0)
      })
    }

    const pendingAnchorRatio = pendingRenderViewAnchorRatioRef.current
    if (typeof pendingAnchorRatio === 'number') {
      pendingRenderViewAnchorRatioRef.current = null
      applyPreviewRatioImmediate(pendingAnchorRatio)

      return () => {
        cancelled = true
        setPreviewScrollBehavior('')
      }
    }

    const restorePreviewScroll = async () => {
      try {
        const uiState = await window.measlyLegacyDb?.getNoteUiState(activeNoteId)
        if (cancelled) return

        const ratio = uiState?.progressPreview
        if (typeof ratio !== 'number' || Number.isNaN(ratio)) {
          if (previewScrollRef.current) {
            setPreviewScrollBehavior('auto')
            previewScrollRef.current.scrollTop = 0
            requestAnimationFrame(() => {
              if (cancelled) return
              setPreviewScrollBehavior('')
            })
          }
          return
        }

        applyPreviewRatioImmediate(ratio)
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
        const maxScrollTop = Math.max(1, container.scrollHeight - container.clientHeight)
        const ratio = maxScrollTop <= 0 ? 0 : (container.scrollTop / maxScrollTop)
        void window.measlyLegacyDb?.saveNoteUiState(activeNoteId, { progressPreview: ratio })
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
    if (!externalApi || !window.measlyLegacyDb || !window.measlyNotes) return

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
      setAppShellWidthPx(Math.max(980, Math.round(shellElement.clientWidth)))
    }

    updateShellWidth()

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setAppShellWidthPx(Math.max(980, Math.round(entry.contentRect.width)))
    })

    observer.observe(shellElement)
    return () => observer.disconnect()
  }, [])

  const handleDividerMouseDown = useCallback((divider: 'sidebar' | 'tag-split', event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    dividerDragStartXRef.current = event.clientX
    dividerStartSidebarWidthRef.current = layout.sidebarWidthPx
    dividerStartTagInputWidthRef.current = layout.tagInputWidthPx
    dividerStartMainWidthRef.current = layout.mainColumnsWidthPx
    setActiveDividerDrag(divider)
  }, [layout.mainColumnsWidthPx, layout.sidebarWidthPx, layout.tagInputWidthPx])

  useEffect(() => {
    if (!activeDividerDrag) return

    const onPointerMove = (event: globalThis.MouseEvent) => {
      const deltaX = event.clientX - dividerDragStartXRef.current

      if (activeDividerDrag === 'sidebar') {
        const maxSidebarWidthPx = Math.max(
          SIDEBAR_MIN_WIDTH_PX,
          Math.min(
            SIDEBAR_MAX_WIDTH_PX,
            appShellWidthPx - (GRID_DIVIDER_PX * 3) - UTILITY_WIDTH_PX - TAG_INPUT_MIN_WIDTH_PX - SUGGESTED_MIN_WIDTH_PX,
          ),
        )

        const nextSidebarWidthPx = clamp(
          dividerStartSidebarWidthRef.current + deltaX,
          SIDEBAR_MIN_WIDTH_PX,
          maxSidebarWidthPx,
        )

        setSidebarWidthRatio(nextSidebarWidthPx / appShellWidthPx)
        return
      }

      const nextTagInputWidthPx = clamp(
        dividerStartTagInputWidthRef.current + deltaX,
        TAG_INPUT_MIN_WIDTH_PX,
        dividerStartMainWidthRef.current - SUGGESTED_MIN_WIDTH_PX,
      )

      setTagSplitRatio(nextTagInputWidthPx / dividerStartMainWidthRef.current)
    }

    const onPointerUp = () => {
      setActiveDividerDrag(null)
      if (persistenceReady && activeNoteId) {
        queueAppStateSave(activeNoteId)
      }
    }

    document.body.classList.add('splitter-dragging')
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)

    return () => {
      document.body.classList.remove('splitter-dragging')
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseup', onPointerUp)
    }
  }, [activeDividerDrag, activeNoteId, appShellWidthPx, persistenceReady, queueAppStateSave])

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [notes])

  const searchedNotes = useMemo(() => {
    return sortedNotes.filter((note) => matchesSearchQuery(note, searchQuery))
  }, [searchQuery, sortedNotes])

  const isFindMode = sidebarMode === 'find'
  const currentEditorText = useMemo(() => {
    return normalizeInternalText(latestEditorTextRef.current || activeNoteText)
  }, [activeNoteText, editorTextVersion])

  // Memoized so per-frame App re-renders (scroll thumb state, etc.) do not
  // trigger a full ReactMarkdown reconciliation of long notes. That heavy
  // reconciliation was stalling the main thread and freezing rAF mid-scroll.
  const previewMarkdownElement = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={PREVIEW_MARKDOWN_REMARK_PLUGINS}
      components={PREVIEW_MARKDOWN_COMPONENTS}
    >
      {currentEditorText}
    </ReactMarkdown>
  ), [currentEditorText])
  const documentFindDirective = useMemo<DocumentFindDirective>(() => {
    return resolveDocumentFindDirective(documentFindQuery, currentEditorText, isDocumentFindCaseSensitive)
  }, [currentEditorText, documentFindQuery, isDocumentFindCaseSensitive])

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

    const monthMatch = !hasMonthFilter || selectedMonths.has(noteMonth)

    let yearMatch = !hasYearFilter
    if (hasYearFilter) {
      if (selectedYears.has(noteYear)) {
        yearMatch = true
      } else if (selectedYears.has('older') && noteYear <= 2021) {
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
      if (isDeletedNote(note)) {
        return false
      }
      if (isArchivedNote(note) && !hasDateFilter) {
        return false
      }
      return true
    })
  }, [hasDateFilter, searchedNotes])

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
  const totalPages = Math.max(1, Math.ceil(totalPagedNotes / Math.max(1, itemsPerPage)))
  const isSidebarTreeMode = sidebarMode === 'category' || sidebarMode === 'archive'
  const isSidebarCustomScrollbarMode = isSidebarTreeMode || isFindMode

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
    if (!scroller || !track) return

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
    if (!isSidebarCustomScrollbarMode) {
      applySidebarThumbDom(0, 0)
      setIsSidebarScrollThumbActive(false)
      return
    }

    const scroller = sidebarTreeScrollerEl
    const track = sidebarScrollbarTrackRef.current
    if (!scroller || !track) return

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
  }, [applySidebarThumbDom, isSidebarCustomScrollbarMode, sidebarTreeScrollerEl])

  const sidebarScrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = sidebarTreeScrollerEl
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

    const startIndex = (currentPage - 1) * itemsPerPage
    return visibleNotes.slice(startIndex, startIndex + itemsPerPage)
  }, [currentPage, itemsPerPage, sidebarMode, visibleNotes])

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
  const isBulletedListActive = markdownSelectionContext.line.listKind === 'unordered'
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
  }, [selectedMonths, selectedYears, searchQuery])

  useEffect(() => {
    setDeleteArmedTagName(null)
  }, [activeNoteId, orderedActiveTags])

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

  useEffect(() => {
    const ITEM_HEIGHT = 56
    const ITEM_GAP = 8
    const ITEM_TOTAL = ITEM_HEIGHT + ITEM_GAP

    const compute = () => {
      const container = sidebarContentRef.current
      if (!container) return

      const contentHeight = container.clientHeight
      let nextItemsPerPage = Math.floor(contentHeight / ITEM_TOTAL)
      if (nextItemsPerPage < 1) nextItemsPerPage = 1

      if (nextItemsPerPage !== itemsPerPage) {
        setItemsPerPage(nextItemsPerPage)
      }

      const shouldShowPagination =
        (sidebarMode === 'date' || sidebarMode === 'trash') &&
        Math.ceil(totalPagedNotes / Math.max(1, nextItemsPerPage)) > 1

      setShowPagination(shouldShowPagination)
    }

    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [itemsPerPage, sidebarMode, totalPagedNotes])

  useEffect(() => {
    if (!isSidebarCustomScrollbarMode) return
    syncSidebarCustomScrollbar()
  }, [isSidebarCustomScrollbarMode, syncSidebarCustomScrollbar, sidebarMode, categoryTree, archiveTree, documentFindHits])

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
    if (!isSidebarCustomScrollbarMode || !sidebarTreeScrollerEl) return

    const onScroll = () => {
      syncSidebarCustomScrollbar()
    }

    sidebarTreeScrollerEl.addEventListener('scroll', onScroll, { passive: true })
    return () => sidebarTreeScrollerEl.removeEventListener('scroll', onScroll)
  }, [isSidebarCustomScrollbarMode, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

  useEffect(() => {
    if (!isSidebarCustomScrollbarMode || !sidebarTreeScrollerEl) return

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
    const treeContentEl = sidebarTreeScrollerEl.firstElementChild as HTMLElement | null

    const resizeObserver = new ResizeObserver(() => scheduleSync())
    resizeObserver.observe(sidebarTreeScrollerEl)
    if (treeContentEl) {
      resizeObserver.observe(treeContentEl)
    }

    const mutationObserver = new MutationObserver(() => scheduleSync())
    mutationObserver.observe(sidebarTreeScrollerEl, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['open'],
    })

    const onDetailsToggle = (event: Event) => {
      if (isSidebarTreeMode && event.target instanceof HTMLDetailsElement) {
        scheduleSync()
      }
    }

    sidebarTreeScrollerEl.addEventListener('toggle', onDetailsToggle, true)

    return () => {
      sidebarTreeScrollerEl.removeEventListener('toggle', onDetailsToggle, true)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (sidebarScrollbarRafRef.current !== null) {
        cancelAnimationFrame(sidebarScrollbarRafRef.current)
        sidebarScrollbarRafRef.current = null
      }
    }
  }, [isSidebarCustomScrollbarMode, isSidebarTreeMode, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

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

    const scroller = sidebarTreeScrollerEl
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
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return

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

      const target = event.target instanceof HTMLElement ? event.target : null
      const isEditorTarget = Boolean(target?.closest('.editor-stage'))
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

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      if (target.closest('.editor-stage .editor-text[contenteditable="true"]')) {
        return
      }

      if (isAllowedNonEditorFocusTarget(target)) {
        return
      }

      scheduleFocusEditorInEditMode()
    }

    window.addEventListener('focusin', onFocusIn)
    return () => window.removeEventListener('focusin', onFocusIn)
  }, [activeNoteId, isAllowedNonEditorFocusTarget, isPreviewMode, scheduleFocusEditorInEditMode])

  useEffect(() => {
    const handleBeforeUnload = () => {
      persistActiveNoteEditModeStateNow()
      if (isPreviewMode && activeNoteId) {
        void persistRenderViewStateForNoteNow(activeNoteId)
      }
      persistMenuStateOnUnload()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [activeNoteId, isPreviewMode, persistActiveNoteEditModeStateNow, persistMenuStateOnUnload, persistRenderViewStateForNoteNow])

  return (
    <div
      className="app-shell app-grid"
      ref={appShellRef}
      style={appShellStyle}
    >
      <aside className="notes-sidebar" style={{ gridArea: 'sidebar' }}>
        <div className="search-box" aria-label="Search panel">
          <input
            ref={sidebarSearchInputRef}
            type="text"
            placeholder={isFindMode ? 'Find in current note...' : 'Search notes or #tag...'}
            value={isFindMode ? documentFindQuery : searchQuery}
            onChange={(event) => {
              const value = event.target.value
              if (isFindMode) {
                setDocumentFindQuery(value)
              } else {
                setSearchQuery(value)
              }
            }}
          />
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
                {mode === 'find' ? <span className="find-mode-glyph fa-solid fa-magnifying-glass" aria-hidden="true" /> : <span className="sr-only-mode-label">{label}</span>}
              </button>
            )
          })}
        </div>

        <div className={`sidebar-scroll-frame${isSidebarCustomScrollbarMode ? ' is-tree-mode' : ''}`}>
          <div
            className={`sidebar-content${(sidebarMode === 'date' || sidebarMode === 'trash') ? ' is-paged-mode' : ''}${isSidebarCustomScrollbarMode ? ' is-tree-mode' : ''}`}
            ref={sidebarContentRef}
          >
            {(sidebarMode === 'date' || sidebarMode === 'trash') ? (
              <div className="notes-list date-view" role="listbox" aria-label="Note list">
                {pagedVisibleNotes.map((note) => {
                  const isActive = note.id === activeNoteId
                  return (
                    <NoteListItem
                      key={note.id}
                      note={note}
                      isActive={isActive}
                      onSelect={handleSelectNote}
                      onArmedLeftClick={handleArmedNoteLeftClick}
                      armedAction={armedNoteActionById.get(note.id) ?? null}
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
            ) : (
              <div
                className="notes-list tree-view measly-custom-scrollbar"
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
                  onNoteRightPressStart={handleNoteRightPressStart}
                  onNoteRightPressEnd={handleNoteRightPressEnd}
                  onNoteArmHoverLeave={handleNoteArmHoverLeave}
                />
              </div>
            )}
          </div>

          {isSidebarCustomScrollbarMode ? (
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
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
            >
              &lt;
            </button>
            <span className="sidebar-page-number">{currentPage}</span>
            <button
              type="button"
              className="sidebar-page-btn"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
            >
              &gt;
            </button>
          </div>
        ) : null}

        {isFindMode ? (
          <div className="find-options-rail" aria-label="Find options">
            <button
              type="button"
              className={`find-option-btn${isDocumentFindCaseSensitive ? ' is-active' : ''}`}
              aria-pressed={isDocumentFindCaseSensitive}
              title="Match letter case"
              onClick={() => setIsDocumentFindCaseSensitive((previous) => !previous)}
            >
              Case
            </button>
          </div>
        ) : (sidebarMode === 'date' || sidebarMode === 'trash' || isSidebarTreeMode) ? (
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
        className={`grid-divider divider-sidebar divider-handle${activeDividerDrag === 'sidebar' ? ' is-dragging' : ''}`}
        style={{ gridArea: 'd-sidebar' }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={(event) => handleDividerMouseDown('sidebar', event)}
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
                    }
                    if (event.key === 'Escape' && renamingTagName) {
                      event.preventDefault()
                      setRenamingTagName(null)
                      setTagInputValue('')
                    }
                  }}
                  disabled={!persistenceReady || !activeNoteId || isTagMutationPending || activeNoteIsExternal}
                  aria-label="Tag input"
                />
              </div>
            </div>

            <div className="tags-display" aria-live="polite">
              {!activeNoteId ? (
                <div className="tag-empty-state">Tags appear here. Drag to change order, left click to remove or right click to rename across all notes.</div>
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
                      onDragStart={() => handleTagDragStart(index)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleTagDrop(event, index)}
                      onClick={() => handleTagChipClick(tagName)}
                      onContextMenu={(event) => handleTagContextMenu(event, tagName)}
                      onMouseLeave={() => handleTagChipMouseLeave(tagName)}
                      title={deleteArmedTagName === tagName ? 'Click again to delete or move cursor away to cancel' : 'Click to arm deletion'}
                    >
                      {tagName}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <div
        className={`grid-divider divider-left divider-handle${activeDividerDrag === 'tag-split' ? ' is-dragging' : ''}`}
        style={{ gridArea: 'd-left' }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize tag panels"
        onMouseDown={(event) => handleDividerMouseDown('tag-split', event)}
      />

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

      <section className="utility-grid" style={{ gridArea: 'utility' }} aria-label="Utility grid placeholder">
        <div className="panel-placeholder utility-panel-placeholder">
          <div className="panel-placeholder-title">Utility Grid</div>
          <div className="panel-placeholder-text">Placeholder for utility actions and controls.</div>
        </div>
      </section>

      <section className="toolbar-grid" style={{ gridArea: 'toolbar' }} aria-label="Editor toolbar">
        <div className="editor-toolbar">
          <div className="toolbar-left-tools">
            <button
              className={`toolbar-toggle-btn ${!isPreviewMode ? 'active' : ''}`}
              type="button"
              title={isPreviewMode ? 'Edit mode inactive' : 'Edit mode active'}
              aria-label={isPreviewMode ? 'Edit mode inactive' : 'Edit mode active'}
              onClick={toggleRenderViewMode}
            >
              Edit
            </button>

            {!isPreviewMode ? (
              <div className="markdown-toolbar" aria-label="Markdown toolbar">
              <button
                type="button"
                className={`toolbar-btn-icon ${activeDecorationFormats.has('bold') ? 'active' : ''}`}
                onClick={() => applyTextDecoration('bold')}
                title="Bold"
                aria-label="Bold"
                disabled={!activeNoteId}
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                className={`toolbar-btn-icon ${activeDecorationFormats.has('italic') ? 'active' : ''}`}
                onClick={() => applyTextDecoration('italic')}
                title="Italic"
                aria-label="Italic"
                disabled={!activeNoteId}
              >
                <em>I</em>
              </button>
              <button
                type="button"
                className={`toolbar-btn-icon ${activeDecorationFormats.has('strikethrough') ? 'active' : ''}`}
                onClick={() => applyTextDecoration('strikethrough')}
                title="Strikethrough"
                aria-label="Strikethrough"
                disabled={!activeNoteId}
              >
                <span style={{ textDecoration: 'line-through' }}>S</span>
              </button>

              <span className="toolbar-divider">|</span>

              <button type="button" className={`toolbar-btn-icon ${activeHeadingLevel === 1 ? 'active' : ''}`} title="Heading 1" onClick={() => applyHeading(1)} disabled={!activeNoteId}>H1</button>
              <button type="button" className={`toolbar-btn-icon ${activeHeadingLevel === 2 ? 'active' : ''}`} title="Heading 2" onClick={() => applyHeading(2)} disabled={!activeNoteId}>H2</button>
              <button type="button" className={`toolbar-btn-icon ${activeHeadingLevel === 3 ? 'active' : ''}`} title="Heading 3" onClick={() => applyHeading(3)} disabled={!activeNoteId}>H3</button>

              <span className="toolbar-divider">|</span>

              <button type="button" className={`toolbar-btn-icon ${isBulletedListActive ? 'active' : ''}`} title="Bulleted list" onClick={toggleBulletedList} disabled={!activeNoteId}>≡</button>
              <button type="button" className={`toolbar-btn-icon ${isNumberedListActive ? 'active' : ''}`} title="Numbered list" onClick={toggleNumberedList} disabled={!activeNoteId}>#</button>
              <button type="button" className="toolbar-btn-icon" title="Link" onClick={applyLink} disabled={!activeNoteId}>🔗</button>

              <span className="toolbar-divider">|</span>

              <button type="button" className={`toolbar-btn-icon ${isBlockquoteActive ? 'active' : ''}`} title="Blockquote" onClick={toggleBlockquote} disabled={!activeNoteId}>&quot;</button>
              <button type="button" className={`toolbar-btn-icon ${isCodeBlockActive ? 'active' : ''}`} title="Code block" onClick={applyCodeBlock} disabled={!activeNoteId}>{'{ }'}</button>
              <button type="button" className={`toolbar-btn-icon ${isInlineCodeActive ? 'active' : ''}`} title="Inline code" onClick={applyInlineCode} disabled={!activeNoteId}>{'<>'}</button>

              <span className="toolbar-divider">|</span>

              <button type="button" className="toolbar-btn-icon" title="Horizontal rule" onClick={insertHorizontalRule} disabled={!activeNoteId}>—</button>
              </div>
            ) : null}
          </div>

          <div className="toolbar-right-tools" aria-label="Toolbar right controls">
            {isPreviewMode ? (
              <>
                <div className="style-selector">
                  <label className="selector-label">Style:</label>
                  <select
                    value={viewStyle}
                    onChange={(event) => setViewStyle(event.target.value as ViewStyleKey)}
                    aria-label="Render style"
                    disabled={!activeNoteId}
                  >
                    <option value="modern">Modern</option>
                    <option value="narrow">Narrow</option>
                    <option value="cute">Cute</option>
                    <option value="print">Print</option>
                  </select>
                </div>

                <div className="style-selector">
                  <label className="selector-label">Size:</label>
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
                  <label className="selector-label">Spacing:</label>
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
                  <label className="selector-label">Style:</label>
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
                  <label className="selector-label">Size:</label>
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
                  <label className="selector-label">Spacing:</label>
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
              className={`toggle-btn icon-btn toolbar-gear-btn${isScrollSettingsOpen ? ' is-active' : ''}`}
              type="button"
              title="View settings"
              aria-label="View settings"
              aria-expanded={isScrollSettingsOpen}
              onClick={() => setIsScrollSettingsOpen((open) => !open)}
            >
              <span className="toolbar-gear-glyph fa-solid fa-gear" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          className={`toolbar-flyout-panel${isScrollSettingsOpen ? ' is-open' : ''}`}
          aria-label="Toolbar flyout panel"
          aria-hidden={!isScrollSettingsOpen}
        >
          <div className="toolbar-flyout-panel-inner">
            <div
              className={`toolbar-flyout-content ${isPreviewMode ? 'mode-view' : 'mode-edit'}`}
              aria-label="Settings panel"
            >
              <section className="toolbar-flyout-section toolbar-flyout-section-scrolling display-in-view display-in-edit" aria-label="Scrolling settings">
                <div className="panel-placeholder-title">Scrolling</div>
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
              </section>

              <section className="toolbar-flyout-section toolbar-flyout-section-colors display-in-edit" aria-label="Color settings">
                <div className="panel-placeholder-title">Colors</div>

                <div className="toolbar-flyout-color-layout" aria-label="HSVA color controls">
                  <div className="toolbar-flyout-color-grid toolbar-flyout-element-grid" role="group" aria-label="Editor highlight elements">
                    {HIGHLIGHT_COLOR_ORDER.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`toolbar-btn-icon toolbar-flyout-color-swatch${armedColorSource?.kind === 'element' && armedColorSource.key === key ? ' active' : ''}`}
                        onClick={() => {
                          if (armedColorSource?.kind === 'element') {
                            applyElementColorToElement(armedColorSource.key, key)
                            setActiveHighlightColorKey(key)
                            return
                          }

                          if (armedColorSource?.kind === 'hsva') {
                            applyHsvaValueToElement(armedColorSource.key, key)
                            setActiveHighlightColorKey(key)
                            return
                          }

                          if (armedColorSource?.kind === 'active-color') {
                            applyActiveColorToElement(key)
                            setActiveHighlightColorKey(key)
                            return
                          }

                          updateHighlightColor(key, activeColorRgba)
                          setActiveHighlightColorKey(key)
                        }}
                        onMouseDown={(event) => startColorArmHold({ kind: 'element', key }, event)}
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
                        style={{ background: highlightColors[key] }}
                        title={HIGHLIGHT_COLOR_TITLES[key]}
                      >
                        <span className={`toolbar-flyout-color-swatch-glyph ${HIGHLIGHT_COLOR_ICONS[key]}`} aria-hidden="true" />
                      </button>
                    ))}
                  </div>

                  <span className="toolbar-flyout-color-separator" aria-hidden="true" />

                  <div className="toolbar-flyout-color-grid toolbar-flyout-hsva-grid" role="group" aria-label="HSVA value controls">
                    <button
                      type="button"
                      className={`toolbar-btn-icon toolbar-flyout-color-swatch toolbar-flyout-hsva-control${hsvaDragState?.control === 'h' ? ' is-dragging' : ''}${armedColorSource?.kind === 'hsva' && armedColorSource.key === 'h' ? ' active' : ''}`}
                      style={{ background: hsvaDisplayColors.hColor }}
                      title="Hue"
                      onClick={() => {
                        if (armedColorSource?.kind !== 'element') return
                        applyElementValueToHsvaControl(armedColorSource.key, 'h')
                      }}
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
                    ><span className="toolbar-flyout-hsva-glyph fa-solid fa-circle-notch" aria-hidden="true" /></button>
                    <button
                      type="button"
                      className={`toolbar-btn-icon toolbar-flyout-color-swatch toolbar-flyout-hsva-control${hsvaDragState?.control === 's' ? ' is-dragging' : ''}${armedColorSource?.kind === 'hsva' && armedColorSource.key === 's' ? ' active' : ''}`}
                      style={{ background: hsvaDisplayColors.sColor }}
                      title="Saturation"
                      onClick={() => {
                        if (armedColorSource?.kind !== 'element') return
                        applyElementValueToHsvaControl(armedColorSource.key, 's')
                      }}
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
                    ><span className="toolbar-flyout-hsva-glyph fa-solid fa-droplet" aria-hidden="true" /></button>
                    <button
                      type="button"
                      className={`toolbar-btn-icon toolbar-flyout-color-swatch toolbar-flyout-hsva-control${hsvaDragState?.control === 'v' ? ' is-dragging' : ''}${armedColorSource?.kind === 'hsva' && armedColorSource.key === 'v' ? ' active' : ''}`}
                      style={{ background: hsvaDisplayColors.vColor }}
                      title="Value"
                      onClick={() => {
                        if (armedColorSource?.kind !== 'element') return
                        applyElementValueToHsvaControl(armedColorSource.key, 'v')
                      }}
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
                    ><span className="toolbar-flyout-hsva-glyph fa-solid fa-sun" aria-hidden="true" /></button>
                    <button
                      type="button"
                      className={`toolbar-btn-icon toolbar-flyout-color-swatch toolbar-flyout-hsva-control toolbar-flyout-hsva-alpha${hsvaDragState?.control === 'a' ? ' is-dragging' : ''}${armedColorSource?.kind === 'hsva' && armedColorSource.key === 'a' ? ' active' : ''}`}
                      style={{ background: 'var(--color-background-light)', color: hsvaDisplayColors.aGhostColor }}
                      title="Alpha"
                      onClick={() => {
                        if (armedColorSource?.kind !== 'element') return
                        applyElementValueToHsvaControl(armedColorSource.key, 'a')
                      }}
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
                    ><span className="toolbar-flyout-hsva-ghost fa-solid fa-ghost" aria-hidden="true" /></button>
                    <button
                      type="button"
                      className={`toolbar-btn-icon toolbar-flyout-color-swatch toolbar-flyout-active-color${armedColorSource?.kind === 'active-color' ? ' active' : ''}`}
                      title="Active color"
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
                      onClick={() => {
                        if (armedColorSource?.kind === 'element') {
                          applyElementColorToActiveColor(armedColorSource.key)
                          return
                        }
                        updateHighlightColor(activeHighlightColorKey, activeColorRgba)
                      }}
                    />
                  </div>
                </div>
              </section>

              <section className="toolbar-flyout-section toolbar-flyout-section-layout display-in-edit" aria-label="Layout settings">
                <div className="panel-placeholder-title">Layout</div>
                <div className="utility-setting-slider-stack" aria-label="Layout settings controls">
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
              </section>

              <section className="toolbar-flyout-section toolbar-flyout-section-placeholder display-in-view" aria-label="Render settings placeholder">
                <div className="panel-placeholder-title">Render</div>
                <div className="toolbar-flyout-placeholder-text">Soon</div>
              </section>

              <section className="toolbar-flyout-section toolbar-flyout-section-placeholder display-in-view" aria-label="Navigation settings placeholder">
                <div className="panel-placeholder-title">Navigation</div>
                <div className="toolbar-flyout-placeholder-text">Smooth</div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <div className="editor-viewer-frame" style={{ gridArea: 'viewer' }}>
        <main className="editor-shell">
          <div className={`editor-stage${isPreviewMode ? ' is-preview-mode' : ''}`}>
            {!isPreviewMode ? (
              <Editor
                key={activeNoteId ?? 'no-active-note'}
                bindings={bindings}
                adapterRef={adapterRef}
                initialText={activeNoteText}
                scrollbarHost={scrollbarHostEl}
                fontFamily={editorFontFamily}
                fontSizePx={editorRuntimeMetrics.fontSizePx}
                lineHeightPx={editorRuntimeMetrics.lineHeightPx}
                glyphWidthPx={editorRuntimeMetrics.glyphWidthPx}
                cellWidthPx={editorRuntimeMetrics.cellWidthPx}
              />
            ) : (
              <div
                ref={previewScrollRef}
                className={`markdown-preview measly-custom-scrollbar style-${viewStyle} size-${viewFontSize} spacing-${viewSpacing}`}
              >
                {previewMarkdownElement}
              </div>
            )}
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
      </div>
    </div>
  )
}

export default App


