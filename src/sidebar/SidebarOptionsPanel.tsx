import type { MouseEvent, MutableRefObject, PointerEvent } from 'react'
import type * as React from 'react'
import { AccordionGroup, AccordionSection } from '../components/AccordionSection'
import { CompactScrollbarSlider } from '../components/CompactScrollbarSlider'
import { type RgbaColor, type HsvaColor, rgbaToCssColor, hsvaToRgba } from '../shared/colorMath'
import type { HighlightColorKey, HighlightColors } from '../shared/highlightColors'
import {
  BORDER_RADIUS_REGULAR_MIN_PX,
  BORDER_RADIUS_REGULAR_MAX_PX,
  BORDER_RADIUS_REGULAR_DEFAULT_PX,
  SPACING_REGULAR_MIN_PX,
  SPACING_REGULAR_MAX_PX,
  SPACING_REGULAR_DEFAULT_PX,
  BORDER_ALPHA_PERCENT_MIN,
  BORDER_ALPHA_PERCENT_MAX,
  BORDER_ALPHA_PERCENT_DEFAULT,
  BOX_SHADOW_ALPHA_PERCENT_MIN,
  BOX_SHADOW_ALPHA_PERCENT_MAX,
  BOX_SHADOW_ALPHA_PERCENT_DEFAULT,
} from '../shared/uiBounds'
import {
  TEXTURE_GRANULARITY_MIN,
  TEXTURE_GRANULARITY_MAX,
  TEXTURE_VSTEPS_MIN,
  TEXTURE_VSTEPS_MAX,
  type TextureSurfaceKey,
  type TextureMaterialsBySurface,
  type TextureMaterialSettings,
} from '../textures/types'
import {
  EDITOR_GLYPH_PADDING_MIN_PX,
  EDITOR_GLYPH_PADDING_MAX_PX,
  EDITOR_GLYPH_PADDING_STEP_PX,
  roundEditorGlyphPaddingPx,
  DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX,
  EDITOR_FONT_SIZE_MIN_PX,
  EDITOR_FONT_SIZE_MAX_PX,
  EDITOR_FONT_SIZE_STEP_PX,
  DEFAULT_EDITOR_FONT_SIZE_PX,
  EDITOR_LINE_HEIGHT_MULTIPLIER_MIN,
  EDITOR_LINE_HEIGHT_MULTIPLIER_MAX,
  EDITOR_LINE_HEIGHT_MULTIPLIER_STEP,
  DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER,
  roundEditorFontSizePx,
  roundLineHeightMultiplier,
  VIEW_LETTER_SPACING_MIN_EM,
  VIEW_LETTER_SPACING_MAX_EM,
  VIEW_LETTER_SPACING_STEP_EM,
  DEFAULT_VIEW_LETTER_SPACING_EM,
  roundViewLetterSpacingEm,
  EDITOR_STYLE_OPTIONS,
  type EditorStyleKey,
} from '../editor/EditorTypography'
import {
  UI_FONT_OPTIONS,
  UI_FONT_SCALE_MIN,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_STEP,
  DEFAULT_UI_FONT_SCALE,
  roundUiFontScale,
  type UiFontKey,
} from '../shared/UiTypography'
import { RENDER_SCROLL_SKEW_MIN, RENDER_SCROLL_SKEW_MAX } from '../editor/NonQuantizedSmoothScroll'
import {
  CURSOR_DOT_COUNT_MIN,
  CURSOR_DOT_COUNT_MAX,
  CURSOR_DOT_COUNT_DEFAULT,
  CURSOR_RADIUS_MIN_PX,
  CURSOR_RADIUS_MAX_PX,
  CURSOR_RADIUS_DEFAULT_PX,
  CURSOR_SPIN_HZ_MIN,
  CURSOR_SPIN_HZ_MAX,
  CURSOR_SPIN_HZ_STEP,
  CURSOR_SPIN_HZ_DEFAULT,
  CURSOR_TRAIL_THICKNESS_MIN_PX,
  CURSOR_TRAIL_THICKNESS_MAX_PX,
  CURSOR_TRAIL_THICKNESS_DEFAULT_PX,
  CURSOR_TRAIL_FADE_MIN_MS,
  CURSOR_TRAIL_FADE_MAX_MS,
  CURSOR_TRAIL_FADE_STEP_MS,
  CURSOR_TRAIL_FADE_DEFAULT_MS,
  CURSOR_DOT_SIZE_MIN_PX,
  CURSOR_DOT_SIZE_MAX_PX,
  CURSOR_DOT_SIZE_DEFAULT_PX,
  CURSOR_CENTER_SIZE_MIN_PX,
  CURSOR_CENTER_SIZE_MAX_PX,
  CURSOR_CENTER_SIZE_DEFAULT_PX,
  CURSOR_HALO_RADIUS_MIN_PX,
  CURSOR_HALO_RADIUS_MAX_PX,
  CURSOR_HALO_RADIUS_DEFAULT_PX,
  CURSOR_HALO_FALLOFF_MIN,
  CURSOR_HALO_FALLOFF_MAX,
  CURSOR_HALO_FALLOFF_STEP,
  CURSOR_HALO_FALLOFF_DEFAULT,
  CURSOR_PULSE_MAGNITUDE_MIN,
  CURSOR_PULSE_MAGNITUDE_MAX,
  CURSOR_PULSE_MAGNITUDE_STEP,
  CURSOR_PULSE_MAGNITUDE_DEFAULT,
  CURSOR_PULSE_HZ_MIN,
  CURSOR_PULSE_HZ_MAX,
  CURSOR_PULSE_HZ_STEP,
  CURSOR_PULSE_HZ_DEFAULT,
  CURSOR_CLICK_RAMP_MIN,
  CURSOR_CLICK_RAMP_MAX,
  CURSOR_CLICK_RAMP_DEFAULT,
  CURSOR_CLICK_SKEW_MIN,
  CURSOR_CLICK_SKEW_MAX,
  CURSOR_CLICK_SKEW_DEFAULT,
  CURSOR_CLICK_SPEED_X_MIN,
  CURSOR_CLICK_SPEED_X_MAX,
  CURSOR_CLICK_SPEED_X_STEP,
  CURSOR_CLICK_SPEED_X_DEFAULT,
  CURSOR_CLICK_MAX_SPEED_MIN,
  CURSOR_CLICK_MAX_SPEED_MAX,
  CURSOR_CLICK_MAX_SPEED_STEP,
  CURSOR_CLICK_MAX_SPEED_DEFAULT,
  CURSOR_CLICK_MIN_HOLD_MIN_MS,
  CURSOR_CLICK_MIN_HOLD_MAX_MS,
  CURSOR_CLICK_MIN_HOLD_STEP_MS,
  CURSOR_CLICK_MIN_HOLD_DEFAULT_MS,
  CURSOR_CLICK_BALANCE_MIN,
  CURSOR_CLICK_BALANCE_MAX,
  CURSOR_CLICK_BALANCE_STEP,
  CURSOR_CLICK_BALANCE_DEFAULT,
} from '../shared/cursorSettings'
import {
  GLAZE_GLOOM_OPACITY_MAX,
  GLAZE_LINEAR_OPACITY_MAX,
  GLAZE_RADIAL_OPACITY_MAX,
  GLAZE_SHEEN_OPACITY_MAX,
  DEFAULT_GLAZE_SETTINGS,
  type GlazeSettings,
} from '../shared/glaze'
import { LOADOUT_FACTORY_PRESET_COUNT, type UiLoadoutEntry } from '../shared/loadouts'
import { typingSoundManager } from '../sound/TypingSoundManager'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// ── Locally-scoped types ───────────────────────────────────────────────────
// Trivial unions/shapes duplicated here rather than imported back from
// App.tsx, to avoid a circular module dependency (App.tsx renders this
// component). Keep in sync with the equivalents in App.tsx if either changes.

type ViewStyleKey =
  | 'modern'
  | 'narrow'
  | 'cute'
  | 'xkcd'
  | 'print'
  | 'calibrilight'
  | 'opensans'
  | 'notoserif'
  | 'neuton'
  | 'faunaone'
  | 'fredericka'
  | 'bubblerone'
type EditorTextColorTargetKey = 'editorEditText' | 'editorRenderText'
type HsvaControlKey = 'h' | 's' | 'v' | 'a'
type TextureControlKey = 'granularity' | 'smoothness'
type CursorColorTargetKey = 'dot' | 'center' | 'trail' | 'halo'

type HsvaDragState = {
  control: HsvaControlKey
  pointerId: number
  startY: number
  baseValue: number
}

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

// ── Panel-local option/lookup data ─────────────────────────────────────────
// Only ever read by this panel, so these live here rather than in a shared
// module (unlike the analogous EDITOR_STYLE_OPTIONS etc., which App.tsx
// also needs for the editor itself).

const VIEW_STYLE_OPTIONS: Array<{ key: ViewStyleKey; label: string; family: string }> = [
  { key: 'modern', label: 'Modern', family: "'Quicksand', 'Segoe UI', sans-serif" },
  { key: 'narrow', label: 'Narrow', family: "'Roboto Condensed', 'Segoe UI', sans-serif" },
  { key: 'cute', label: 'Cute', family: "'Sour Gummy', 'Quicksand', 'Segoe UI', sans-serif" },
  { key: 'xkcd', label: 'xkcd', family: "'xkcd', 'Comic Sans MS', 'Chalkboard SE', cursive" },
  { key: 'print', label: 'Print', family: "'Big Shoulders', 'Times New Roman', Georgia, serif" },
  { key: 'calibrilight', label: 'Calibri Light (Carlito)', family: "'Carlito', 'Calibri Light', 'Segoe UI', sans-serif" },
  { key: 'opensans', label: 'Open Sans', family: "'Open Sans', 'Segoe UI', sans-serif" },
  { key: 'notoserif', label: 'Noto Serif', family: "'Noto Serif', Georgia, serif" },
  { key: 'neuton', label: 'Neuton', family: "'Neuton', Georgia, serif" },
  { key: 'faunaone', label: 'Fauna One', family: "'Fauna One', Georgia, serif" },
  { key: 'fredericka', label: 'Fredericka', family: "'Fredericka the Great', 'Comic Sans MS', cursive" },
  { key: 'bubblerone', label: 'Bubbler One', family: "'Bubbler One', 'Segoe UI', sans-serif" },
]

const BOX_HIGHLIGHT_COLOR_ORDER: HighlightColorKey[] = ['background', 'grid', 'gridOutline', 'topBackground', 'bottomBackground', 'gutterBackground', 'reviewLine', 'warningLine', 'lineNumber']
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
  gutterBackground: 'Gutter Background',
  reviewLine: 'Review Flag Color',
  warningLine: 'Warning Flag Color',
  lineNumber: 'Line Number Color',
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
  gutterBackground: 'fa-solid fa-list-ol',
  reviewLine: 'fa-solid fa-question',
  warningLine: 'fa-solid fa-triangle-exclamation',
  lineNumber: 'fa-solid fa-hashtag',
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
  'fa-solid fa-mound',
  'fa-solid fa-leaf',
  'fa-regular fa-file',
  'fa-solid fa-ring',
]

const DARK_PRESET_ICONS: string[] = [
  'fa-solid fa-moon',
  'fa-solid fa-archway',
  'fa-solid fa-droplet',
  'fa-solid fa-burst',
  'fa-solid fa-shield',
]

// Names for the 5 factory presets per mode, indexed by abs(id) - 1 (0-based).
const LIGHT_PRESET_THEMES: string[] = [
  'Light (Default)',
  'Sand',
  'Forest',
  'Paper',
  'Gold',
]

const DARK_PRESET_THEMES: string[] = [
  'Dark (Default)',
  'Ancient',
  'Ocean',
  'Bubblegum',
  'Metal',
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

export interface SidebarOptionsPanelProps {
  isPreviewMode: boolean
  uiMode: 'light' | 'dark'
  optionsContentRef: MutableRefObject<HTMLDivElement | null>

  viewStyle: ViewStyleKey
  setViewStyle: (key: ViewStyleKey) => void
  viewFontSize: number
  setViewFontSize: (px: number) => void
  viewSpacing: number
  setViewSpacing: (multiplier: number) => void
  viewLetterSpacingEm: number
  setViewLetterSpacingEm: (em: number) => void
  editorStyle: EditorStyleKey
  setEditorStyle: (key: EditorStyleKey) => void
  editorFontSize: number
  setEditorFontSize: (px: number) => void
  editorSpacing: number
  setEditorSpacing: (multiplier: number) => void
  scheduleFocusEditorInEditMode: () => void
  uiFontStyle: UiFontKey
  setUiFontStyle: (key: UiFontKey) => void
  uiFontScale: number
  setUiFontScale: (scale: number) => void

  factoryPresetEntriesForCurrentMode: UiLoadoutEntry[]
  activeEntryForCurrentMode: UiLoadoutEntry | null
  selectLoadoutPreset: (id: number) => Promise<void>
  isDynamicCustomPresetActive: boolean
  selectDynamicCustomPreset: () => void
  customSlotEntriesForCurrentMode: UiLoadoutEntry[]
  primedCustomLayoutId: number | null
  handleCustomLoadoutSlotClick: (id: number) => void
  handleCustomLoadoutSlotRightMouseDown: (event: MouseEvent<HTMLButtonElement>, id: number) => void
  handleCustomLoadoutSlotRightMouseUp: (event: MouseEvent<HTMLButtonElement>, id: number) => void
  handleCustomLoadoutSlotMouseLeave: () => void
  handleCustomLoadoutSlotContextMenu: (event: MouseEvent<HTMLButtonElement>, id: number) => void
  hasUnsavedUiLoadoutChanges: boolean
  saveCustomLoadout: () => Promise<void>
  resetCustomLoadout: () => Promise<void>

  primedColorSource: ColorArmSource
  setPrimedColorSource: (source: ColorArmSource) => void
  highlightColors: HighlightColors
  editorTextColors: Record<EditorTextColorTargetKey, string>
  applyActiveColorToElement: (key: HighlightColorKey) => void
  updateHighlightColor: (key: HighlightColorKey, color: RgbaColor) => void
  applyHsvaValueToElement: (sourceKey: HsvaControlKey, targetKey: HighlightColorKey) => void
  applyActiveColorToEditorText: (key: EditorTextColorTargetKey) => void
  updateEditorTextColor: (key: EditorTextColorTargetKey, color: RgbaColor) => void
  applyHsvaValueToEditorText: (sourceKey: HsvaControlKey, targetKey: EditorTextColorTargetKey) => void
  startElementPreviewCopyHold: (source: ElementPreviewCopySource, event: MouseEvent<HTMLButtonElement>) => void
  clearColorArmTimer: () => void
  hsvaDragState: HsvaDragState | null
  hsvaDisplayColors: { hColor: string; sColor: string; vColor: string; aGhostColor: string }
  activeColorHsva: HsvaColor
  activeColorHex: string
  activeColorCss: string
  startHsvaDrag: (control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => void
  handleHsvaDragMove: (control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => void
  stopHsvaDrag: (control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => void
  startColorArmHold: (source: ColorArmSource, event: MouseEvent<HTMLButtonElement>) => void
  wheelAdjustHsvaControl: (control: HsvaControlKey, event: React.WheelEvent<HTMLButtonElement>) => void

  applyActiveColorToTexture: (surface: TextureSurfaceKey) => void
  applyTexturePreviewToSurface: (surface: TextureSurfaceKey) => void
  applyHsvaValueToTexture: (sourceKey: HsvaControlKey, surface: TextureSurfaceKey) => void
  textureMaterials: TextureMaterialsBySurface
  texturePreviewMaterial: TextureMaterialSettings
  texturePreviewHex: string
  texturePreviewTintCss: string
  texturePreviewCss: string
  isTextureSeedEditing: boolean
  textureSeedInputRef: MutableRefObject<HTMLInputElement | null>
  textureSeedInput: string
  setTextureSeedInput: (value: string) => void
  commitTextureSeedEdit: () => void
  cancelTextureSeedEdit: () => void
  randomizeTextureSeed: () => void
  startTextureSeedEdit: () => void
  isAllowedNonEditorFocusTarget: (target: EventTarget | null) => boolean
  textureControlDragState: TextureControlDragState | null
  startTextureControlDrag: (control: TextureControlKey, event: PointerEvent<HTMLButtonElement>) => void
  handleTextureControlDragMove: (control: TextureControlKey, event: PointerEvent<HTMLButtonElement>) => void
  stopTextureControlDrag: (control: TextureControlKey, event: PointerEvent<HTMLButtonElement>) => void
  wheelAdjustTextureControl: (control: TextureControlKey, event: React.WheelEvent<HTMLButtonElement>) => void

  glazeSettings: GlazeSettings
  setGlazeSettings: (updater: (previous: GlazeSettings) => GlazeSettings) => void
  isGlazeLinearSeedEditing: boolean
  glazeLinearSeedInputRef: MutableRefObject<HTMLInputElement | null>
  glazeLinearSeedInput: string
  setGlazeLinearSeedInput: (value: string) => void
  commitGlazeLinearSeedEdit: () => void
  cancelGlazeLinearSeedEdit: () => void
  randomizeGlazeLinearSeed: () => void
  startGlazeLinearSeedEdit: () => void
  isGlazeRadialSeedEditing: boolean
  glazeRadialSeedInputRef: MutableRefObject<HTMLInputElement | null>
  glazeRadialSeedInput: string
  setGlazeRadialSeedInput: (value: string) => void
  commitGlazeRadialSeedEdit: () => void
  cancelGlazeRadialSeedEdit: () => void
  randomizeGlazeRadialSeed: () => void
  startGlazeRadialSeedEdit: () => void

  filterInvert: number
  setFilterInvert: (value: number) => void
  filterSepia: number
  setFilterSepia: (value: number) => void
  filterHueRotate: number
  setFilterHueRotate: (value: number) => void
  filterBrightness: number
  setFilterBrightness: (value: number) => void
  filterContrast: number
  setFilterContrast: (value: number) => void
  filterSaturate: number
  setFilterSaturate: (value: number) => void
  filterColorize: number
  setFilterColorize: (value: number) => void

  renderScrollDynamic: number
  setRenderScrollDynamic: (value: number) => void
  renderScrollTotalTimeSec: number
  setRenderScrollTotalTimeSec: (value: number) => void
  renderScrollMaxSpeedPxPerSec: number
  setRenderScrollMaxSpeedPxPerSec: (value: number) => void
  renderScrollSkew: number
  setRenderScrollSkew: (value: number) => void

  typingSoundEnabled: boolean
  setTypingSoundEnabled: (value: boolean) => void
  typingSoundSet: 'A' | 'B' | 'C' | 'D'
  setTypingSoundSet: (value: 'A' | 'B' | 'C' | 'D') => void
  audioKeyVolume: number
  setAudioKeyVolume: (value: number) => void
  audioKeyVariance: number
  setAudioKeyVariance: (value: number) => void
  audioPitch: number
  setAudioPitch: (value: number) => void
  audioBassVolume: number
  setAudioBassVolume: (value: number) => void
  audioTrebleVolume: number
  setAudioTrebleVolume: (value: number) => void
  audioReverbStrength: number
  setAudioReverbStrength: (value: number) => void
  audioReverbSpace: number
  setAudioReverbSpace: (value: number) => void
  pitchJitterAmount: number
  setPitchJitterAmount: (value: number) => void
  reduceVisualEffects: boolean
  setReduceVisualEffects: (value: boolean) => void
  reducedCaretAnimation: boolean
  setReducedCaretAnimation: (value: boolean) => void
  deferPreviewOnRapidInput: boolean
  setDeferPreviewOnRapidInput: (value: boolean) => void

  musicAccordionNonce: number
  musicVolume: number
  setMusicVolume: (value: number) => void
  musicReverbAmount: number
  setMusicReverbAmount: (value: number) => void
  musicReverbRoom: number
  setMusicReverbRoom: (value: number) => void

  borderRadiusRegularPx: number
  setBorderRadiusRegularPx: (value: number) => void
  spacingRegularPx: number
  setSpacingRegularPx: (value: number) => void
  borderAlphaPercent: number
  setBorderAlphaPercent: (value: number) => void
  boxShadowAlphaPercent: number
  setBoxShadowAlphaPercent: (value: number) => void
  editorGlyphPaddingPx: number
  setEditorGlyphPaddingPx: (value: number) => void

  syncExistingNotes: () => void
  importNotes: () => void
  exportLayoutsTdl: () => Promise<void>
  importLayoutsTdl: () => Promise<void>

  debuggingEnabled: boolean
  setDebuggingEnabled: (value: boolean) => void
  debugNoteIdRef: MutableRefObject<string | null>
  queueAppStateSave: (selectedNoteId: string | null) => void
  activeNoteId: string | null

  customCursorEnabled: boolean
  setCustomCursorEnabled: (value: boolean) => void
  customCursorDotColor: string
  customCursorCenterColor: string
  customCursorTrailColor: string
  customCursorDotCount: number
  setCustomCursorDotCount: (value: number) => void
  customCursorRadiusPx: number
  setCustomCursorRadiusPx: (value: number) => void
  customCursorSpinHz: number
  setCustomCursorSpinHz: (value: number) => void
  customCursorTrailThicknessPx: number
  setCustomCursorTrailThicknessPx: (value: number) => void
  customCursorTrailFadeMs: number
  setCustomCursorTrailFadeMs: (value: number) => void
  customCursorDotSizePx: number
  setCustomCursorDotSizePx: (value: number) => void
  customCursorCenterSizePx: number
  setCustomCursorCenterSizePx: (value: number) => void
  customCursorHaloColor: string
  customCursorHaloRadiusPx: number
  setCustomCursorHaloRadiusPx: (value: number) => void
  customCursorHaloFalloff: number
  setCustomCursorHaloFalloff: (value: number) => void
  customCursorPulseMagnitude: number
  setCustomCursorPulseMagnitude: (value: number) => void
  customCursorPulseHz: number
  setCustomCursorPulseHz: (value: number) => void
  customCursorClickRamp: number
  setCustomCursorClickRamp: (value: number) => void
  customCursorClickSkew: number
  setCustomCursorClickSkew: (value: number) => void
  customCursorClickSpeedX: number
  setCustomCursorClickSpeedX: (value: number) => void
  customCursorClickMaxSpeed: number
  setCustomCursorClickMaxSpeed: (value: number) => void
  customCursorClickMinHoldMs: number
  setCustomCursorClickMinHoldMs: (value: number) => void
  customCursorClickBalance: number
  setCustomCursorClickBalance: (value: number) => void
  cursorColorHsva: HsvaColor
  cursorHsvaDisplayColors: { hColor: string; sColor: string; vColor: string; aGhostColor: string }
  cursorHsvaDragState: HsvaDragState | null
  startCursorHsvaDrag: (control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => void
  handleCursorHsvaDragMove: (control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => void
  stopCursorHsvaDrag: (control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => void
  wheelAdjustCursorHsvaControl: (control: HsvaControlKey, event: React.WheelEvent<HTMLButtonElement>) => void
  applyCursorColorToTarget: (target: CursorColorTargetKey) => void
  startCursorColorCopyHold: (target: CursorColorTargetKey, event: MouseEvent<HTMLButtonElement>) => void
  clearCursorColorArmTimer: () => void
}

/**
 * The Settings/Options sidebar view -- typography, UI presets, colors,
 * textures, glaze, filters, scroll feel, audio, music, and misc tuning.
 * Purely App-global (no per-section state), extracted verbatim from
 * App.tsx with zero behavior change.
 */
export function SidebarOptionsPanel({
  isPreviewMode,
  uiMode,
  optionsContentRef,
  viewStyle,
  setViewStyle,
  viewFontSize,
  setViewFontSize,
  viewSpacing,
  setViewSpacing,
  viewLetterSpacingEm,
  setViewLetterSpacingEm,
  editorStyle,
  setEditorStyle,
  editorFontSize,
  setEditorFontSize,
  editorSpacing,
  setEditorSpacing,
  scheduleFocusEditorInEditMode,
  uiFontStyle,
  setUiFontStyle,
  uiFontScale,
  setUiFontScale,
  factoryPresetEntriesForCurrentMode,
  activeEntryForCurrentMode,
  selectLoadoutPreset,
  isDynamicCustomPresetActive,
  selectDynamicCustomPreset,
  customSlotEntriesForCurrentMode,
  primedCustomLayoutId,
  handleCustomLoadoutSlotClick,
  handleCustomLoadoutSlotRightMouseDown,
  handleCustomLoadoutSlotRightMouseUp,
  handleCustomLoadoutSlotMouseLeave,
  handleCustomLoadoutSlotContextMenu,
  hasUnsavedUiLoadoutChanges,
  saveCustomLoadout,
  resetCustomLoadout,
  primedColorSource,
  setPrimedColorSource,
  highlightColors,
  editorTextColors,
  applyActiveColorToElement,
  updateHighlightColor,
  applyHsvaValueToElement,
  applyActiveColorToEditorText,
  updateEditorTextColor,
  applyHsvaValueToEditorText,
  startElementPreviewCopyHold,
  clearColorArmTimer,
  hsvaDragState,
  hsvaDisplayColors,
  activeColorHsva,
  activeColorHex,
  activeColorCss,
  startHsvaDrag,
  handleHsvaDragMove,
  stopHsvaDrag,
  startColorArmHold,
  wheelAdjustHsvaControl,
  applyActiveColorToTexture,
  applyTexturePreviewToSurface,
  applyHsvaValueToTexture,
  textureMaterials,
  texturePreviewMaterial,
  texturePreviewHex,
  texturePreviewTintCss,
  texturePreviewCss,
  isTextureSeedEditing,
  textureSeedInputRef,
  textureSeedInput,
  setTextureSeedInput,
  commitTextureSeedEdit,
  cancelTextureSeedEdit,
  randomizeTextureSeed,
  startTextureSeedEdit,
  isAllowedNonEditorFocusTarget,
  textureControlDragState,
  startTextureControlDrag,
  handleTextureControlDragMove,
  stopTextureControlDrag,
  wheelAdjustTextureControl,
  glazeSettings,
  setGlazeSettings,
  isGlazeLinearSeedEditing,
  glazeLinearSeedInputRef,
  glazeLinearSeedInput,
  setGlazeLinearSeedInput,
  commitGlazeLinearSeedEdit,
  cancelGlazeLinearSeedEdit,
  randomizeGlazeLinearSeed,
  startGlazeLinearSeedEdit,
  isGlazeRadialSeedEditing,
  glazeRadialSeedInputRef,
  glazeRadialSeedInput,
  setGlazeRadialSeedInput,
  commitGlazeRadialSeedEdit,
  cancelGlazeRadialSeedEdit,
  randomizeGlazeRadialSeed,
  startGlazeRadialSeedEdit,
  filterInvert,
  setFilterInvert,
  filterSepia,
  setFilterSepia,
  filterHueRotate,
  setFilterHueRotate,
  filterBrightness,
  setFilterBrightness,
  filterContrast,
  setFilterContrast,
  filterSaturate,
  setFilterSaturate,
  filterColorize,
  setFilterColorize,
  renderScrollDynamic,
  setRenderScrollDynamic,
  renderScrollTotalTimeSec,
  setRenderScrollTotalTimeSec,
  renderScrollMaxSpeedPxPerSec,
  setRenderScrollMaxSpeedPxPerSec,
  renderScrollSkew,
  setRenderScrollSkew,
  typingSoundEnabled,
  setTypingSoundEnabled,
  typingSoundSet,
  setTypingSoundSet,
  audioKeyVolume,
  setAudioKeyVolume,
  audioKeyVariance,
  setAudioKeyVariance,
  audioPitch,
  setAudioPitch,
  audioBassVolume,
  setAudioBassVolume,
  audioTrebleVolume,
  setAudioTrebleVolume,
  audioReverbStrength,
  setAudioReverbStrength,
  audioReverbSpace,
  setAudioReverbSpace,
  pitchJitterAmount,
  setPitchJitterAmount,
  reduceVisualEffects,
  setReduceVisualEffects,
  reducedCaretAnimation,
  setReducedCaretAnimation,
  deferPreviewOnRapidInput,
  setDeferPreviewOnRapidInput,
  musicAccordionNonce,
  musicVolume,
  setMusicVolume,
  musicReverbAmount,
  setMusicReverbAmount,
  musicReverbRoom,
  setMusicReverbRoom,
  borderRadiusRegularPx,
  setBorderRadiusRegularPx,
  spacingRegularPx,
  setSpacingRegularPx,
  borderAlphaPercent,
  setBorderAlphaPercent,
  boxShadowAlphaPercent,
  setBoxShadowAlphaPercent,
  editorGlyphPaddingPx,
  setEditorGlyphPaddingPx,
  syncExistingNotes,
  importNotes,
  exportLayoutsTdl,
  importLayoutsTdl,
  debuggingEnabled,
  setDebuggingEnabled,
  debugNoteIdRef,
  queueAppStateSave,
  activeNoteId,
  customCursorEnabled,
  setCustomCursorEnabled,
  customCursorDotColor,
  customCursorCenterColor,
  customCursorTrailColor,
  customCursorDotCount,
  setCustomCursorDotCount,
  customCursorRadiusPx,
  setCustomCursorRadiusPx,
  customCursorSpinHz,
  setCustomCursorSpinHz,
  customCursorTrailThicknessPx,
  setCustomCursorTrailThicknessPx,
  customCursorTrailFadeMs,
  setCustomCursorTrailFadeMs,
  customCursorDotSizePx,
  setCustomCursorDotSizePx,
  customCursorCenterSizePx,
  setCustomCursorCenterSizePx,
  customCursorHaloColor,
  customCursorHaloRadiusPx,
  setCustomCursorHaloRadiusPx,
  customCursorHaloFalloff,
  setCustomCursorHaloFalloff,
  customCursorPulseMagnitude,
  setCustomCursorPulseMagnitude,
  customCursorPulseHz,
  setCustomCursorPulseHz,
  customCursorClickRamp,
  setCustomCursorClickRamp,
  customCursorClickSkew,
  setCustomCursorClickSkew,
  customCursorClickSpeedX,
  setCustomCursorClickSpeedX,
  customCursorClickMaxSpeed,
  setCustomCursorClickMaxSpeed,
  customCursorClickMinHoldMs,
  setCustomCursorClickMinHoldMs,
  customCursorClickBalance,
  setCustomCursorClickBalance,
  cursorColorHsva,
  cursorHsvaDisplayColors,
  cursorHsvaDragState,
  startCursorHsvaDrag,
  handleCursorHsvaDragMove,
  stopCursorHsvaDrag,
  wheelAdjustCursorHsvaControl,
  applyCursorColorToTarget,
  startCursorColorCopyHold,
  clearCursorColorArmTimer,
}: SidebarOptionsPanelProps) {
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
          className={`btn-icon options-color-swatch${key === 'textBase' ? ' text-ui-icon' : ''}${key === 'lineNumber' ? ' text-icon' : ''}`}
          onClick={() => {
            if (primedColorSource.kind === 'active-color') {
              applyActiveColorToElement(resolvedKey)
              return
            }

            if (primedColorSource.kind === 'texture-preview') {
              updateHighlightColor(resolvedKey, hsvaToRgba(texturePreviewMaterial.color))
              return
            }

            if (primedColorSource.kind === 'hsva') {
              applyHsvaValueToElement(primedColorSource.key, resolvedKey)
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
          data-tooltip={buttonTitle}
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
          if (primedColorSource.kind === 'active-color') {
            applyActiveColorToTexture(surface)
            return
          }

          if (primedColorSource.kind === 'texture-preview') {
            applyTexturePreviewToSurface(surface)
            return
          }

          if (primedColorSource.kind === 'hsva') {
            applyHsvaValueToTexture(primedColorSource.key, surface)
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
        data-tooltip={TEXTURE_SURFACE_TITLES[surface]}
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
            defaultValue={0.8}
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
            defaultValue={0}
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
            defaultValue={0.3}
            onCommit={(value) => setMusicReverbRoom(clamp(value, 0, 1))}
          />
        </div>
      </AccordionSection>

      <div className="typography-section">
        {isPreviewMode ? (
          <div className="typography-grid" role="group" aria-label="Render typography">
            {VIEW_STYLE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`btn-icon typography-font-btn${viewStyle === option.key ? ' is-active' : ''}`}
                data-tooltip={option.label}
                aria-label={option.label}
                aria-pressed={viewStyle === option.key}
                onClick={() => setViewStyle(option.key)}
              >
                <span className="typography-font-glyph" style={{ fontFamily: option.family }} aria-hidden="true">Aa</span>
              </button>
            ))}
          </div>
        ) : null}
        {isPreviewMode ? (
          <div className="typography-sliders">
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="typography-font-size"
                min={EDITOR_FONT_SIZE_MIN_PX}
                max={EDITOR_FONT_SIZE_MAX_PX}
                step={EDITOR_FONT_SIZE_STEP_PX}
                value={viewFontSize}
                trackLabel="size"
                ariaLabel="Render font size"
                defaultValue={DEFAULT_EDITOR_FONT_SIZE_PX}
                onCommit={(value) => setViewFontSize(
                  clamp(roundEditorFontSizePx(value), EDITOR_FONT_SIZE_MIN_PX, EDITOR_FONT_SIZE_MAX_PX),
                )}
              />
            </div>
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="view-letter-spacing"
                min={VIEW_LETTER_SPACING_MIN_EM}
                max={VIEW_LETTER_SPACING_MAX_EM}
                step={VIEW_LETTER_SPACING_STEP_EM}
                value={viewLetterSpacingEm}
                trackLabel="spacing"
                ariaLabel="Render letter spacing in em"
                defaultValue={DEFAULT_VIEW_LETTER_SPACING_EM}
                onCommit={(value) => setViewLetterSpacingEm(
                  clamp(roundViewLetterSpacingEm(value), VIEW_LETTER_SPACING_MIN_EM, VIEW_LETTER_SPACING_MAX_EM),
                )}
              />
            </div>
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="typography-spacing"
                min={EDITOR_LINE_HEIGHT_MULTIPLIER_MIN}
                max={EDITOR_LINE_HEIGHT_MULTIPLIER_MAX}
                step={EDITOR_LINE_HEIGHT_MULTIPLIER_STEP}
                value={viewSpacing}
                trackLabel="height"
                ariaLabel="Render line height"
                defaultValue={DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER}
                onCommit={(value) => setViewSpacing(
                  clamp(roundLineHeightMultiplier(value), EDITOR_LINE_HEIGHT_MULTIPLIER_MIN, EDITOR_LINE_HEIGHT_MULTIPLIER_MAX),
                )}
              />
            </div>
          </div>
        ) : null}
        {!isPreviewMode ? (
          <div className="typography-grid" role="group" aria-label="Editor typography">
            {EDITOR_STYLE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`btn-icon typography-font-btn${editorStyle === option.key ? ' is-active' : ''}`}
                data-tooltip={option.label}
                aria-label={option.label}
                aria-pressed={editorStyle === option.key}
                onClick={() => {
                  setEditorStyle(option.key)
                  scheduleFocusEditorInEditMode()
                }}
              >
                <span className="typography-font-glyph" style={{ fontFamily: option.family }} aria-hidden="true">Aa</span>
              </button>
            ))}
          </div>
        ) : null}
        {!isPreviewMode ? (
          <div className="typography-sliders">
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="typography-font-size"
                min={EDITOR_FONT_SIZE_MIN_PX}
                max={EDITOR_FONT_SIZE_MAX_PX}
                step={EDITOR_FONT_SIZE_STEP_PX}
                value={editorFontSize}
                trackLabel="size"
                ariaLabel="Editor font size"
                defaultValue={DEFAULT_EDITOR_FONT_SIZE_PX}
                onCommit={(value) => {
                  setEditorFontSize(
                    clamp(roundEditorFontSizePx(value), EDITOR_FONT_SIZE_MIN_PX, EDITOR_FONT_SIZE_MAX_PX),
                  )
                  scheduleFocusEditorInEditMode()
                }}
              />
            </div>
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="editor-glyph-padding"
                min={EDITOR_GLYPH_PADDING_MIN_PX}
                max={EDITOR_GLYPH_PADDING_MAX_PX}
                step={EDITOR_GLYPH_PADDING_STEP_PX}
                value={editorGlyphPaddingPx}
                trackLabel="x-box"
                ariaLabel="Editor glyph box horizontal padding in pixels"
                defaultValue={DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX}
                onCommit={(value) => {
                  setEditorGlyphPaddingPx(
                    clamp(
                      roundEditorGlyphPaddingPx(value),
                      EDITOR_GLYPH_PADDING_MIN_PX,
                      EDITOR_GLYPH_PADDING_MAX_PX,
                    ),
                  )
                  scheduleFocusEditorInEditMode()
                }}
              />
            </div>
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="typography-spacing"
                min={EDITOR_LINE_HEIGHT_MULTIPLIER_MIN}
                max={EDITOR_LINE_HEIGHT_MULTIPLIER_MAX}
                step={EDITOR_LINE_HEIGHT_MULTIPLIER_STEP}
                value={editorSpacing}
                trackLabel="y-box"
                ariaLabel="Editor spacing"
                defaultValue={DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER}
                onCommit={(value) => {
                  setEditorSpacing(
                    clamp(roundLineHeightMultiplier(value), EDITOR_LINE_HEIGHT_MULTIPLIER_MIN, EDITOR_LINE_HEIGHT_MULTIPLIER_MAX),
                  )
                  scheduleFocusEditorInEditMode()
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
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
                className={`btn-icon options-color-swatch options-loadout-btn${activeEntryForCurrentMode?.id === entry.id ? ' is-active' : ''}`}
                data-tooltip={theme}
                aria-label={theme}
                onClick={() => void selectLoadoutPreset(entry.id)}
              >
                <span className={icon} aria-hidden="true" />
              </button>
            )
          })}
          <button
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn${isDynamicCustomPresetActive ? ' is-active' : ''}`}
            data-tooltip="Custom"
            aria-label="Custom Layout"
            onClick={selectDynamicCustomPreset}
          >
            <span className="fa-solid fa-marker" aria-hidden="true" />
          </button>
        </div>
      </div>
      <AccordionGroup>
      <AccordionSection
        className="sidebar-options-section-layouts"
        ariaLabel="Custom Layouts"
        heading="Custom Layouts"
        iconClass="fa-floppy-disk"
        iconTooltip=""
      >
        <div className="options-loadout-grid" role="group" aria-label="Custom UI Layouts">
          {customSlotEntriesForCurrentMode.map((entry) => (
            <button
              key={`custom-${entry.id}`}
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn${activeEntryForCurrentMode?.id === entry.id ? ' is-active' : ''}${primedCustomLayoutId === entry.id ? ' primed' : ''}`}
              data-tooltip={`Custom Layout ${Math.abs(entry.id) - LOADOUT_FACTORY_PRESET_COUNT - 2}\nClick RMB to mark for deletion. \nHold RMB to export.`}
              onClick={() => {
                handleCustomLoadoutSlotClick(entry.id)
              }}
              onMouseDown={(event) => {
                handleCustomLoadoutSlotRightMouseDown(event, entry.id)
              }}
              onMouseUp={(event) => {
                handleCustomLoadoutSlotRightMouseUp(event, entry.id)
              }}
              onMouseLeave={handleCustomLoadoutSlotMouseLeave}
              onContextMenu={(event) => {
                handleCustomLoadoutSlotContextMenu(event, entry.id)
              }}
            >
              <span className="options-loadout-index">{Math.abs(entry.id) - LOADOUT_FACTORY_PRESET_COUNT - 2}</span>
            </button>
          ))}

          <button
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn options-loadout-plus${hasUnsavedUiLoadoutChanges ? ' is-active' : ''}`}
            data-tooltip="Save current settings as a new custom layout"
            aria-label="Save current settings as a new custom layout"
            onClick={() => void saveCustomLoadout()}
          >
            <span className="options-loadout-plus-glyph fa-solid fa-plus" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            data-tooltip="Reset custom layout to defaults"
            aria-label="Reset custom layout to defaults"
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
        iconClass="fa-rectangle-list"
        iconTooltip="These settings are layout specific and will be lost when changing layouts. You can store them by creating a custom layout."
      >
        <div className="options-color-layout" aria-label="Color and texture controls">
          <div className="options-color-grid options-hsva-grid" role="group" aria-label="HSVA value controls">
            <button
              type="button"
              className={`btn-icon options-color-swatch options-hsva-control${hsvaDragState?.control === 'h' ? ' is-dragging' : ''}${primedColorSource.kind === 'hsva' && primedColorSource.key === 'h' ? ' is-active' : ''}`}
              style={{ background: hsvaDisplayColors.hColor }}
              data-live-tooltip={`Hue: ${Math.round(activeColorHsva.h)}\n${activeColorHex}`}
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
              className={`btn-icon options-color-swatch options-hsva-control${hsvaDragState?.control === 's' ? ' is-dragging' : ''}${primedColorSource.kind === 'hsva' && primedColorSource.key === 's' ? ' is-active' : ''}`}
              style={{ background: hsvaDisplayColors.sColor }}
              data-live-tooltip={`Saturation: ${Math.round(activeColorHsva.s * 255)}\n${activeColorHex}`}
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
              className={`btn-icon options-color-swatch options-hsva-control${hsvaDragState?.control === 'v' ? ' is-dragging' : ''}${primedColorSource.kind === 'hsva' && primedColorSource.key === 'v' ? ' is-active' : ''}`}
              style={{ background: hsvaDisplayColors.vColor }}
              data-live-tooltip={`Value: ${Math.round(activeColorHsva.v * 255)}\n${activeColorHex}`}
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
                primedColorSource.kind === 'hsva' && primedColorSource.key === 'a' ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ background: 'var(--color-background-light)', color: hsvaDisplayColors.aGhostColor }}
              data-live-tooltip={`Alpha: ${Math.round(activeColorHsva.a * 255)}\n${activeColorHex}`}
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
              className={`btn-icon options-color-swatch options-active-color${primedColorSource.kind === 'active-color' ? ' is-active' : ''}`}
              data-tooltip={`Active color:\n${activeColorHex}`}
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
                className={`btn-icon options-color-swatch options-active-color options-texture-preview${primedColorSource.kind === 'texture-preview' ? ' is-active' : ''}`}
                data-tooltip={`Texture preview: ${texturePreviewHex}`}
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
                  setPrimedColorSource({ kind: 'texture-preview' })
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
                    data-tooltip="Left click: random seed. Right click: edit seed."
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
              data-live-tooltip={`Granularity (${texturePreviewMaterial.granularity})`}
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
              data-live-tooltip={`Smoothness (${texturePreviewMaterial.vSteps})`}
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

              if (primedColorSource.kind === 'active-color') {
                applyActiveColorToEditorText(target)
                return
              }

              if (primedColorSource.kind === 'texture-preview') {
                updateEditorTextColor(target, hsvaToRgba(texturePreviewMaterial.color))
                return
              }

              if (primedColorSource.kind === 'hsva') {
                applyHsvaValueToEditorText(primedColorSource.key, target)
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
            data-tooltip={isPreviewMode ? 'Render mode text color' : 'Edit mode text color'}
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
        iconClass="fa-rectangle-list"
        iconTooltip="These settings are layout specific and will be lost when changing layouts. You can store them by creating a custom layout."
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
                  data-tooltip="Left click: random seed. Right click: edit seed."
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
              className={`btn-icon options-color-swatch options-glaze-layer-order-btn${glazeSettings.radialAboveLinear ? ' is-active' : ''}`}
              aria-label={glazeSettings.radialAboveLinear ? 'Display flair above glare.' : 'Display flair above glare.'}
              data-tooltip={glazeSettings.radialAboveLinear ? 'Display flair above glare.' : 'Display flair above glare.'}
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
                  data-tooltip="Left click: random seed. Right click: edit seed."
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.linearStackCount}
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.radialCount}
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.linearOpacity}
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.radialOpacity}
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.gloomPosition}
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.gloomShape}
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.gloomOpacity}
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.sheenPosition}
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.sheenShape}
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
              defaultValue={DEFAULT_GLAZE_SETTINGS.sheenOpacity}
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
        iconClass="fa-rectangle-list"
        iconTooltip="These settings are layout specific and will be lost when changing layouts. You can store them by creating a custom layout."
      >
<div className="utility-setting-slider-stack" aria-label="CSS filter controls">
          <CompactScrollbarSlider id="filter-invert" min={0} max={1} step={0.01} value={filterInvert} trackLabel="invert" ariaLabel="Invert" defaultValue={0} onCommit={setFilterInvert} />
          <CompactScrollbarSlider id="filter-sepia" min={0} max={1} step={0.01} value={filterSepia} trackLabel="sepia" ariaLabel="Sepia" defaultValue={0} onCommit={setFilterSepia} />
          <CompactScrollbarSlider id="filter-hue-rotate" min={0} max={360} step={1} value={filterHueRotate} trackLabel="hue-rotate" ariaLabel="Hue rotate (degrees)" defaultValue={0} onCommit={setFilterHueRotate} />
          <CompactScrollbarSlider id="filter-brightness" min={0} max={2} step={0.01} value={filterBrightness} trackLabel="brightness" ariaLabel="Brightness" defaultValue={1} onCommit={setFilterBrightness} />
          <CompactScrollbarSlider id="filter-contrast" min={0} max={2} step={0.01} value={filterContrast} trackLabel="contrast" ariaLabel="Contrast" defaultValue={1} onCommit={setFilterContrast} />
          <CompactScrollbarSlider id="filter-saturate" min={0} max={1} step={0.001} value={filterSaturate} trackLabel="saturate" ariaLabel="Saturate" defaultValue={0.5} onCommit={setFilterSaturate} />
          <CompactScrollbarSlider id="filter-colorize" min={0} max={1} step={0.01} value={filterColorize} trackLabel="colorize" ariaLabel="Colorize opacity" defaultValue={0} onCommit={setFilterColorize} />
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-misc"
        ariaLabel="Borders & Spacing"
        heading="Borders & Spacing"
        iconClass="fa-rectangle-list"
        iconTooltip="These settings are layout specific and will be lost when changing layouts. You can store them by creating a custom layout."
      >
<div className="utility-setting-slider-stack" aria-label="Borders and spacing controls">
          <CompactScrollbarSlider
            id="ui-border-radius"
            min={BORDER_RADIUS_REGULAR_MIN_PX}
            max={BORDER_RADIUS_REGULAR_MAX_PX}
            step={1}
            value={borderRadiusRegularPx}
            trackLabel="radius"
            ariaLabel="UI border radius in pixels"
            defaultValue={BORDER_RADIUS_REGULAR_DEFAULT_PX}
            onCommit={(value) => setBorderRadiusRegularPx(
              clamp(
                Math.round(value),
                BORDER_RADIUS_REGULAR_MIN_PX,
                BORDER_RADIUS_REGULAR_MAX_PX,
              ),
            )}
          />
          <CompactScrollbarSlider
            id="ui-spacing-regular"
            min={SPACING_REGULAR_MIN_PX}
            max={SPACING_REGULAR_MAX_PX}
            step={1}
            value={spacingRegularPx}
            trackLabel="spacing"
            ariaLabel="UI spacing in pixels"
            defaultValue={SPACING_REGULAR_DEFAULT_PX}
            onCommit={(value) => setSpacingRegularPx(
              clamp(
                Math.round(value),
                SPACING_REGULAR_MIN_PX,
                SPACING_REGULAR_MAX_PX,
              ),
            )}
          />
          <CompactScrollbarSlider
            id="ui-border-alpha"
            min={BORDER_ALPHA_PERCENT_MIN}
            max={BORDER_ALPHA_PERCENT_MAX}
            step={1}
            value={borderAlphaPercent}
            trackLabel="border α"
            ariaLabel="Border alpha adjustment, percent"
            defaultValue={BORDER_ALPHA_PERCENT_DEFAULT}
            onCommit={(value) => setBorderAlphaPercent(
              clamp(
                Math.round(value),
                BORDER_ALPHA_PERCENT_MIN,
                BORDER_ALPHA_PERCENT_MAX,
              ),
            )}
          />
          <CompactScrollbarSlider
            id="ui-box-shadow-alpha"
            min={BOX_SHADOW_ALPHA_PERCENT_MIN}
            max={BOX_SHADOW_ALPHA_PERCENT_MAX}
            step={1}
            value={boxShadowAlphaPercent}
            trackLabel="shadow α"
            ariaLabel="Box shadow alpha adjustment, percent"
            defaultValue={BOX_SHADOW_ALPHA_PERCENT_DEFAULT}
            onCommit={(value) => setBoxShadowAlphaPercent(
              clamp(
                Math.round(value),
                BOX_SHADOW_ALPHA_PERCENT_MIN,
                BOX_SHADOW_ALPHA_PERCENT_MAX,
              ),
            )}
          />
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-ui-font"
        ariaLabel="UI Font"
        heading="UI Font"
        iconClass="fa-font"
        iconTooltip="These settings are global and persist across layouts."
      >
        <div className="typography-grid" role="group" aria-label="UI font family">
          {UI_FONT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`btn-icon typography-font-btn${uiFontStyle === option.key ? ' is-active' : ''}`}
              data-tooltip={option.label}
              aria-label={option.label}
              aria-pressed={uiFontStyle === option.key}
              onClick={() => setUiFontStyle(option.key)}
            >
              <span className="typography-font-glyph" style={{ fontFamily: option.family }} aria-hidden="true">Aa</span>
            </button>
          ))}
        </div>
        <div className="typography-sliders">
          <div className="typography-slider">
            <CompactScrollbarSlider
              id="ui-font-scale"
              min={UI_FONT_SCALE_MIN}
              max={UI_FONT_SCALE_MAX}
              step={UI_FONT_SCALE_STEP}
              value={uiFontScale}
              trackLabel="size"
              ariaLabel="UI font size"
              defaultValue={DEFAULT_UI_FONT_SCALE}
              onCommit={(value) => setUiFontScale(
                clamp(roundUiFontScale(value), UI_FONT_SCALE_MIN, UI_FONT_SCALE_MAX),
              )}
            />
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-mouse"
        ariaLabel="Mouse Options"
        heading="Mouse Options"
        iconClass="fa-rectangle-list"
        iconTooltip="These settings are layout specific and will be lost when changing layouts. You can store them by creating a custom layout."
      >
        <div className="options-mouse-settings-grid" role="group" aria-label="Custom cursor color controls">
          <button
            type="button"
            className="btn-icon options-color-swatch "
            style={{ background: customCursorCenterColor }}
            data-tooltip="Center dot color -- click to apply, hold right-click to copy"
            onClick={() => applyCursorColorToTarget('center')}
            onMouseDown={(event) => startCursorColorCopyHold('center', event)}
            onMouseUp={(event) => { if (event.button !== 2) return; clearCursorColorArmTimer() }}
            onMouseLeave={clearCursorColorArmTimer}
            onContextMenu={(event) => { event.preventDefault(); clearCursorColorArmTimer() }}
          ><span className="options-color-swatch-glyph fa-regular fa-circle-dot" aria-hidden="true" /></button>
          <button
            type="button"
            className="btn-icon options-color-swatch"
            style={{ background: customCursorHaloColor }}
            data-tooltip="Halo color -- click to apply, hold right-click to copy"
            onClick={() => applyCursorColorToTarget('halo')}
            onMouseDown={(event) => startCursorColorCopyHold('halo', event)}
            onMouseUp={(event) => { if (event.button !== 2) return; clearCursorColorArmTimer() }}
            onMouseLeave={clearCursorColorArmTimer}
            onContextMenu={(event) => { event.preventDefault(); clearCursorColorArmTimer() }}
          ><span className="options-color-swatch-glyph fa-solid fa-circle" aria-hidden="true" /></button>

          <div className="options-mouse-center-grid" aria-hidden="true">
            <div className="options-glaze-cell options-glaze-cell-span-2">
              <CompactScrollbarSlider
                id="cursor-trail-thickness"
                min={CURSOR_TRAIL_THICKNESS_MIN_PX}
                max={CURSOR_TRAIL_THICKNESS_MAX_PX}
                step={1}
                value={customCursorTrailThicknessPx}
                trackLabel="trail"
                ariaLabel="Trail thickness in pixels"
                defaultValue={CURSOR_TRAIL_THICKNESS_DEFAULT_PX}
                onCommit={(value) => setCustomCursorTrailThicknessPx(clamp(value, CURSOR_TRAIL_THICKNESS_MIN_PX, CURSOR_TRAIL_THICKNESS_MAX_PX))}
              />
            </div>
            <div className="options-glaze-cell options-glaze-cell-span-2">
              <CompactScrollbarSlider
                id="cursor-dot-size"
                min={CURSOR_DOT_SIZE_MIN_PX}
                max={CURSOR_DOT_SIZE_MAX_PX}
                step={1}
                value={customCursorDotSizePx}
                trackLabel="dot size"
                ariaLabel="Circling dot size in pixels"
                defaultValue={CURSOR_DOT_SIZE_DEFAULT_PX}
                onCommit={(value) => setCustomCursorDotSizePx(clamp(value, CURSOR_DOT_SIZE_MIN_PX, CURSOR_DOT_SIZE_MAX_PX))}
              />
            </div>
            <div className="options-glaze-cell options-glaze-cell-span-2">
              <CompactScrollbarSlider
                id="cursor-center-size"
                min={CURSOR_CENTER_SIZE_MIN_PX}
                max={CURSOR_CENTER_SIZE_MAX_PX}
                step={1}
                value={customCursorCenterSizePx}
                trackLabel="center"
                ariaLabel="Center dot size in pixels"
                defaultValue={CURSOR_CENTER_SIZE_DEFAULT_PX}
                onCommit={(value) => setCustomCursorCenterSizePx(clamp(value, CURSOR_CENTER_SIZE_MIN_PX, CURSOR_CENTER_SIZE_MAX_PX))}
              />
            </div>

          </div>

          <button
            type="button"
            className={`btn-icon options-color-swatch options-hsva-control${cursorHsvaDragState?.control === 'h' ? ' is-dragging' : ''}`}
            style={{ background: cursorHsvaDisplayColors.hColor }}
            data-live-tooltip={`Hue: ${Math.round(cursorColorHsva.h)}`}
            onPointerDown={(event) => startCursorHsvaDrag('h', event)}
            onPointerMove={(event) => handleCursorHsvaDragMove('h', event)}
            onPointerUp={(event) => stopCursorHsvaDrag('h', event)}
            onPointerCancel={(event) => stopCursorHsvaDrag('h', event)}
            onLostPointerCapture={(event) => stopCursorHsvaDrag('h', event)}
            onWheel={(event) => wheelAdjustCursorHsvaControl('h', event)}
          ><span className="options-hsva-glyph fa-solid fa-rainbow" aria-hidden="true" /></button>
          <button
            type="button"
            className={`btn-icon options-color-swatch options-hsva-control${cursorHsvaDragState?.control === 's' ? ' is-dragging' : ''}`}
            style={{ background: cursorHsvaDisplayColors.sColor }}
            data-live-tooltip={`Saturation: ${Math.round(cursorColorHsva.s * 255)}`}
            onPointerDown={(event) => startCursorHsvaDrag('s', event)}
            onPointerMove={(event) => handleCursorHsvaDragMove('s', event)}
            onPointerUp={(event) => stopCursorHsvaDrag('s', event)}
            onPointerCancel={(event) => stopCursorHsvaDrag('s', event)}
            onLostPointerCapture={(event) => stopCursorHsvaDrag('s', event)}
            onWheel={(event) => wheelAdjustCursorHsvaControl('s', event)}
          ><span className="options-hsva-glyph fa-solid fa-droplet" aria-hidden="true" /></button>

          <button
            type="button"
            className="btn-icon options-color-swatch"
            style={{ background: customCursorDotColor }}
            data-tooltip="Circling dots color -- click to apply, hold right-click to copy"
            onClick={() => applyCursorColorToTarget('dot')}
            onMouseDown={(event) => startCursorColorCopyHold('dot', event)}
            onMouseUp={(event) => { if (event.button !== 2) return; clearCursorColorArmTimer() }}
            onMouseLeave={clearCursorColorArmTimer}
            onContextMenu={(event) => { event.preventDefault(); clearCursorColorArmTimer() }}
          ><span className="options-color-swatch-glyph fa-solid fa-spinner" aria-hidden="true" /></button>
          <button
            type="button"
            className="btn-icon options-color-swatch"
            style={{ background: customCursorTrailColor }}
            data-tooltip="Trail color -- click to apply, hold right-click to copy"
            onClick={() => applyCursorColorToTarget('trail')}
            onMouseDown={(event) => startCursorColorCopyHold('trail', event)}
            onMouseUp={(event) => { if (event.button !== 2) return; clearCursorColorArmTimer() }}
            onMouseLeave={clearCursorColorArmTimer}
            onContextMenu={(event) => { event.preventDefault(); clearCursorColorArmTimer() }}
          ><span className="options-color-swatch-glyph fa-solid fa-cancer" aria-hidden="true" /></button>

          <button
            type="button"
            className={`btn-icon options-color-swatch options-hsva-control${cursorHsvaDragState?.control === 'v' ? ' is-dragging' : ''}`}
            style={{ background: cursorHsvaDisplayColors.vColor }}
            data-live-tooltip={`Value: ${Math.round(cursorColorHsva.v * 255)}`}
            onPointerDown={(event) => startCursorHsvaDrag('v', event)}
            onPointerMove={(event) => handleCursorHsvaDragMove('v', event)}
            onPointerUp={(event) => stopCursorHsvaDrag('v', event)}
            onPointerCancel={(event) => stopCursorHsvaDrag('v', event)}
            onLostPointerCapture={(event) => stopCursorHsvaDrag('v', event)}
            onWheel={(event) => wheelAdjustCursorHsvaControl('v', event)}
          ><span className="options-hsva-glyph fa-solid fa-circle-half-stroke" aria-hidden="true" /></button>
          <button
            type="button"
            className={`btn-icon options-color-swatch options-hsva-control options-hsva-alpha${cursorHsvaDragState?.control === 'a' ? ' is-dragging' : ''}`}
            style={{ background: 'var(--color-background-light)', color: cursorHsvaDisplayColors.aGhostColor }}
            data-live-tooltip={`Alpha: ${Math.round(cursorColorHsva.a * 255)}`}
            onPointerDown={(event) => startCursorHsvaDrag('a', event)}
            onPointerMove={(event) => handleCursorHsvaDragMove('a', event)}
            onPointerUp={(event) => stopCursorHsvaDrag('a', event)}
            onPointerCancel={(event) => stopCursorHsvaDrag('a', event)}
            onLostPointerCapture={(event) => stopCursorHsvaDrag('a', event)}
            onWheel={(event) => wheelAdjustCursorHsvaControl('a', event)}
          ><span className="options-hsva-glyph fa-solid fa-eye" aria-hidden="true" /></button>


          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="cursor-dot-count"
              min={CURSOR_DOT_COUNT_MIN}
              max={CURSOR_DOT_COUNT_MAX}
              step={1}
              value={customCursorDotCount}
              trackLabel="dots"
              ariaLabel="Number of circling dots"
              defaultValue={CURSOR_DOT_COUNT_DEFAULT}
              onCommit={(value) => setCustomCursorDotCount(clamp(Math.round(value), CURSOR_DOT_COUNT_MIN, CURSOR_DOT_COUNT_MAX))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="cursor-spin-hz"
              min={CURSOR_SPIN_HZ_MIN}
              max={CURSOR_SPIN_HZ_MAX}
              step={CURSOR_SPIN_HZ_STEP}
              value={customCursorSpinHz}
              trackLabel="spin"
              ariaLabel="Spin frequency in hertz"
              defaultValue={CURSOR_SPIN_HZ_DEFAULT}
              onCommit={(value) => setCustomCursorSpinHz(clamp(value, CURSOR_SPIN_HZ_MIN, CURSOR_SPIN_HZ_MAX))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="cursor-radius"
              min={CURSOR_RADIUS_MIN_PX}
              max={CURSOR_RADIUS_MAX_PX}
              step={1}
              value={customCursorRadiusPx}
              trackLabel="radius"
              ariaLabel="Orbit radius in pixels"
              defaultValue={CURSOR_RADIUS_DEFAULT_PX}
              onCommit={(value) => setCustomCursorRadiusPx(clamp(value, CURSOR_RADIUS_MIN_PX, CURSOR_RADIUS_MAX_PX))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="cursor-trail-fade"
              min={CURSOR_TRAIL_FADE_MIN_MS}
              max={CURSOR_TRAIL_FADE_MAX_MS}
              step={CURSOR_TRAIL_FADE_STEP_MS}
              value={customCursorTrailFadeMs}
              trackLabel="trail fade"
              ariaLabel="Trail fade duration in milliseconds -- how long a trail particle takes to decay after the head passes it"
              defaultValue={CURSOR_TRAIL_FADE_DEFAULT_MS}
              onCommit={(value) => setCustomCursorTrailFadeMs(clamp(value, CURSOR_TRAIL_FADE_MIN_MS, CURSOR_TRAIL_FADE_MAX_MS))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="cursor-halo-radius"
              min={CURSOR_HALO_RADIUS_MIN_PX}
              max={CURSOR_HALO_RADIUS_MAX_PX}
              step={1}
              value={customCursorHaloRadiusPx}
              trackLabel="halo"
              ariaLabel="Halo radius in pixels -- 0 disables the halo"
              defaultValue={CURSOR_HALO_RADIUS_DEFAULT_PX}
              onCommit={(value) => setCustomCursorHaloRadiusPx(clamp(value, CURSOR_HALO_RADIUS_MIN_PX, CURSOR_HALO_RADIUS_MAX_PX))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="cursor-halo-falloff"
              min={CURSOR_HALO_FALLOFF_MIN}
              max={CURSOR_HALO_FALLOFF_MAX}
              step={CURSOR_HALO_FALLOFF_STEP}
              value={customCursorHaloFalloff}
              trackLabel="fall-off"
              ariaLabel="Halo fall-off -- higher keeps the glow near-opaque further out before it fades at the rim"
              defaultValue={CURSOR_HALO_FALLOFF_DEFAULT}
              onCommit={(value) => setCustomCursorHaloFalloff(clamp(Math.round(value), CURSOR_HALO_FALLOFF_MIN, CURSOR_HALO_FALLOFF_MAX))}
            />
          </div>


          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="cursor-pulse-magnitude"
              min={CURSOR_PULSE_MAGNITUDE_MIN}
              max={CURSOR_PULSE_MAGNITUDE_MAX}
              step={CURSOR_PULSE_MAGNITUDE_STEP}
              value={customCursorPulseMagnitude}
              trackLabel="pulse size"
              ariaLabel="Pulse magnitude"
              defaultValue={CURSOR_PULSE_MAGNITUDE_DEFAULT}
              onCommit={(value) => setCustomCursorPulseMagnitude(clamp(value, CURSOR_PULSE_MAGNITUDE_MIN, CURSOR_PULSE_MAGNITUDE_MAX))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-3">
            <CompactScrollbarSlider
              id="cursor-pulse-hz"
              min={CURSOR_PULSE_HZ_MIN}
              max={CURSOR_PULSE_HZ_MAX}
              step={CURSOR_PULSE_HZ_STEP}
              value={customCursorPulseHz}
              trackLabel="pulse speed"
              ariaLabel="Pulse frequency in hertz"
              defaultValue={CURSOR_PULSE_HZ_DEFAULT}
              onCommit={(value) => setCustomCursorPulseHz(clamp(value, CURSOR_PULSE_HZ_MIN, CURSOR_PULSE_HZ_MAX))}
            />
          </div>

          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="cursor-click-ramp"
              min={CURSOR_CLICK_RAMP_MIN}
              max={CURSOR_CLICK_RAMP_MAX}
              step={0.05}
              value={customCursorClickRamp}
              trackLabel="ramp"
              ariaLabel="Click response curve dynamic parameter a"
              defaultValue={CURSOR_CLICK_RAMP_DEFAULT}
              onCommit={(value) => setCustomCursorClickRamp(clamp(value, CURSOR_CLICK_RAMP_MIN, CURSOR_CLICK_RAMP_MAX))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="cursor-click-skew"
              min={CURSOR_CLICK_SKEW_MIN}
              max={CURSOR_CLICK_SKEW_MAX}
              step={0.01}
              value={customCursorClickSkew}
              trackLabel="shape"
              ariaLabel="Click response curve skew (apex bias)"
              defaultValue={CURSOR_CLICK_SKEW_DEFAULT}
              onCommit={(value) => setCustomCursorClickSkew(clamp(value, CURSOR_CLICK_SKEW_MIN, CURSOR_CLICK_SKEW_MAX))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="cursor-click-speed"
              min={CURSOR_CLICK_SPEED_X_MIN}
              max={CURSOR_CLICK_SPEED_X_MAX}
              step={CURSOR_CLICK_SPEED_X_STEP}
              value={customCursorClickSpeedX}
              trackLabel="speed"
              ariaLabel="Click response speed -- higher is faster, with finer control as it approaches instant"
              defaultValue={CURSOR_CLICK_SPEED_X_DEFAULT}
              onCommit={(value) => setCustomCursorClickSpeedX(clamp(value, CURSOR_CLICK_SPEED_X_MIN, CURSOR_CLICK_SPEED_X_MAX))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="cursor-click-min-hold"
              min={CURSOR_CLICK_MIN_HOLD_MIN_MS}
              max={CURSOR_CLICK_MIN_HOLD_MAX_MS}
              step={CURSOR_CLICK_MIN_HOLD_STEP_MS}
              value={customCursorClickMinHoldMs}
              trackLabel="min impact"
              ariaLabel="Minimum internal hold duration in milliseconds, regardless of how brief the physical click was"
              defaultValue={CURSOR_CLICK_MIN_HOLD_DEFAULT_MS}
              onCommit={(value) => setCustomCursorClickMinHoldMs(clamp(Math.round(value), CURSOR_CLICK_MIN_HOLD_MIN_MS, CURSOR_CLICK_MIN_HOLD_MAX_MS))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="cursor-click-max-speed"
              min={CURSOR_CLICK_MAX_SPEED_MIN}
              max={CURSOR_CLICK_MAX_SPEED_MAX}
              step={CURSOR_CLICK_MAX_SPEED_STEP}
              value={customCursorClickMaxSpeed}
              trackLabel="max impact"
              ariaLabel="Maximum click response speed while held"
              defaultValue={CURSOR_CLICK_MAX_SPEED_DEFAULT}
              onCommit={(value) => setCustomCursorClickMaxSpeed(clamp(value, CURSOR_CLICK_MAX_SPEED_MIN, CURSOR_CLICK_MAX_SPEED_MAX))}
            />
          </div>
          <div className="options-glaze-cell options-glaze-cell-span-2">
            <CompactScrollbarSlider
              id="cursor-click-balance"
              min={CURSOR_CLICK_BALANCE_MIN}
              max={CURSOR_CLICK_BALANCE_MAX}
              step={CURSOR_CLICK_BALANCE_STEP}
              value={customCursorClickBalance}
              trackLabel="balance"
              ariaLabel="Click response balance between radius and spin -- left affects radius only, right affects spin only, center affects both"
              defaultValue={CURSOR_CLICK_BALANCE_DEFAULT}
              onCommit={(value) => setCustomCursorClickBalance(clamp(value, CURSOR_CLICK_BALANCE_MIN, CURSOR_CLICK_BALANCE_MAX))}
            />
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-audio"
        ariaLabel="Keystroke Sounds"
        heading="Keystroke Sounds"
        iconClass="fa-rectangle-list"
        iconTooltip="These settings are layout specific and will be lost when changing layouts. You can store them by creating a custom layout."
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
              data-tooltip="No Key Sounds"
            >
              <span className="fa-solid fa-ban" aria-hidden="true" />
            </button>
            {(['A', 'B', 'C', 'D'] as const).map((setId) => (
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
                data-tooltip={`${setId === 'A' ? 'Pops' : ''}${setId === 'B' ? 'Pins' : ''}${setId === 'C' ? 'Creamy' : ''}${setId === 'D' ? 'Forge' : ''}`}
              >
                <span className={`${setId === 'A' ? 'fa-solid fa-burst' : ''}${setId === 'B' ? 'fa-solid fa-map-pin' : ''}${setId === 'C' ? 'fa-solid fa-ice-cream' : ''}${setId === 'D' ? 'fa-solid fa-hammer' : ''}`} aria-hidden="true" />
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
            defaultValue={0.5}
            onCommit={(value) => setAudioKeyVolume(clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="audio-key-variance"
            min={0}
            max={0.5}
            step={0.005}
            value={audioKeyVariance}
            trackLabel="variance"
            ariaLabel="Key sound variance"
            defaultValue={0}
            onCommit={(value) => {
              const nextValue = clamp(value, 0, 0.5)
              setAudioKeyVariance(nextValue)
              typingSoundManager.setTypingSoundVariance(nextValue)
            }}
          />
          <CompactScrollbarSlider
            id="audio-pitch"
            min={-100}
            max={100}
            step={1}
            value={audioPitch}
            trackLabel="pitch"
            ariaLabel="Global pitch"
            defaultValue={0}
            onCommit={(value) => {
              const nextValue = clamp(value, -100, 100)
              setAudioPitch(nextValue)
              typingSoundManager.setTypingSoundPitch(nextValue)
            }}
          />
          <CompactScrollbarSlider
            id="audio-bass-volume"
            min={0}
            max={1}
            step={0.01}
            value={audioBassVolume}
            trackLabel="bass"
            ariaLabel="Bass volume"
            defaultValue={0}
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
            defaultValue={0}
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
            defaultValue={0}
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
            defaultValue={0}
            onCommit={(value) => setAudioReverbSpace(clamp(value, 0, 1))}
          />
          <CompactScrollbarSlider
            id="audio-pitch-jitter"
            min={0}
            max={0.5}
            step={0.01}
            value={pitchJitterAmount}
            trackLabel="jitter"
            ariaLabel="Pitch jitter"
            defaultValue={0}
            onCommit={(value) => {
              const nextValue = clamp(value, 0, 0.5)
              setPitchJitterAmount(nextValue)
              typingSoundManager.setPitchJitterAmount(nextValue)
            }}
          />
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
            defaultValue={5 / 3}
            onCommit={(value) => setRenderScrollDynamic(clamp(value, 0.1, 5))}
          />
          <CompactScrollbarSlider
            id="render-scroll-skew"
            min={RENDER_SCROLL_SKEW_MIN}
            max={RENDER_SCROLL_SKEW_MAX}
            step={0.01}
            value={renderScrollSkew}
            trackLabel="shape"
            ariaLabel="Curve skew (apex bias)"
            defaultValue={0.5}
            onCommit={(value) => setRenderScrollSkew(
              Math.max(RENDER_SCROLL_SKEW_MIN, Math.min(RENDER_SCROLL_SKEW_MAX, value)),
            )}
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
            defaultValue={0.4}
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
            defaultValue={80000}
            onCommit={(value) => setRenderScrollMaxSpeedPxPerSec(clamp(value, 1000, 100000))}
          />
        </div>
      </AccordionSection>

      <AccordionSection
        className="sidebar-options-section-performance"
        ariaLabel="Performance"
        heading="Performance"
      >
<div className="utility-setting-button-row" role="group" aria-label="Performance controls">
          <button
            type="button"
            className={`btn-icon${reduceVisualEffects ? ' is-active' : ''}`}
            onClick={() => {
              const next = !reduceVisualEffects
              setReduceVisualEffects(next)
              queueAppStateSave(activeNoteId)
            }}
            aria-pressed={reduceVisualEffects}
            data-tooltip="Reduce visual effects"
          >
            <span className="fa-solid fa-spray-can-sparkles" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`btn-icon${!customCursorEnabled ? ' is-active' : ''}`}
            onClick={() => setCustomCursorEnabled(!customCursorEnabled)}
            aria-pressed={!customCursorEnabled}
            data-tooltip="Disable custom mouse cursor"
          >
            <span className="fa-solid fa-computer-mouse" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`btn-icon${deferPreviewOnRapidInput ? ' is-active' : ''}`}
            onClick={() => {
              const next = !deferPreviewOnRapidInput
              setDeferPreviewOnRapidInput(next)
              queueAppStateSave(activeNoteId)
            }}
            aria-pressed={deferPreviewOnRapidInput}
            data-tooltip="Allow asynchronous input"
          >
            <span className="fa-solid fa-gauge-high" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`btn-icon${reducedCaretAnimation ? ' is-active' : ''}`}
            onClick={() => {
              const next = !reducedCaretAnimation
              setReducedCaretAnimation(next)
              queueAppStateSave(activeNoteId)
            }}
            aria-pressed={reducedCaretAnimation}
            data-tooltip="Reduce caret animation"
          >
            <span className="fa-solid fa-square" aria-hidden="true" />
          </button>
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
            data-tooltip="Sync stored note files"
            aria-label="Sync stored note files"
          >
            <span className="fa-solid fa-rotate" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            onClick={importNotes}
            data-tooltip="Import notes from files or folders"
            aria-label="Import notes from files or folders"
          >
            <span className="fa-solid fa-file-import" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            onClick={() => void exportLayoutsTdl()}
            data-tooltip="Export custom layouts to a .tdl file"
            aria-label="Export custom layouts to a .tdl file"
          >
            <span className="fa-solid fa-file-export" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            onClick={() => void importLayoutsTdl()}
            data-tooltip="Import layouts from a .tdl file"
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
            data-tooltip={debuggingEnabled ? 'Disable debug logging' : 'Enable debug logging to a note'}
            aria-label={debuggingEnabled ? 'Disable debug logging' : 'Enable debug logging to a note'}
            aria-pressed={debuggingEnabled}
          >
            <span className="fa-solid fa-bug" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon options-color-swatch options-loadout-btn"
            onClick={() => window.windowControls?.toggleDevTools()}
            data-tooltip="Open DevTools (detached window)"
            aria-label="Open DevTools (detached window)"
          >
            <span className="fa-solid fa-code" aria-hidden="true" />
          </button>
        </div>
      </AccordionSection>
      </AccordionGroup>
    </div>
    )
}
