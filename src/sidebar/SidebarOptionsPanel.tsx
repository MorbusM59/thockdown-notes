import type { MouseEvent, MutableRefObject, PointerEvent } from 'react'
import type * as React from 'react'
import { AccordionGroup, AccordionSection } from '../components/AccordionSection'
import { CompactScrollbarSlider } from '../components/CompactScrollbarSlider'
import { type RgbaColor, type HsvaColor, rgbaToCssColor, hsvaToRgba } from '../shared/colorMath'
import type { HighlightColorKey, HighlightColors } from '../shared/highlightColors'
import { BORDER_RADIUS_REGULAR_MIN_PX, BORDER_RADIUS_REGULAR_MAX_PX } from '../shared/uiBounds'
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
  EDITOR_STYLE_OPTIONS,
  EDITOR_FONT_SIZE_OPTIONS,
  EDITOR_SPACING_OPTIONS,
  type EditorStyleKey,
  type EditorFontSizeKey,
  type EditorSpacingKey,
} from '../editor/EditorTypography'
import { RENDER_SCROLL_SKEW_MIN, RENDER_SCROLL_SKEW_MAX } from '../editor/NonQuantizedSmoothScroll'
import {
  GLAZE_GLOOM_OPACITY_MAX,
  GLAZE_LINEAR_OPACITY_MAX,
  GLAZE_RADIAL_OPACITY_MAX,
  GLAZE_SHEEN_OPACITY_MAX,
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

type ViewStyleKey = 'modern' | 'narrow' | 'cute' | 'xkcd' | 'print'
type ViewSizeKey = 'xs' | 's' | 'm' | 'l' | 'xl'
type ViewSpacingKey = 'tight' | 'compact' | 'cozy' | 'wide'
type EditorTextColorTargetKey = 'editorEditText' | 'editorRenderText'
type HsvaControlKey = 'h' | 's' | 'v' | 'a'
type TextureControlKey = 'granularity' | 'smoothness'

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
]

const VIEW_FONT_SIZE_OPTIONS: Array<{ key: ViewSizeKey; label: string }> = [
  { key: 'xs', label: 'XS' },
  { key: 's', label: 'S' },
  { key: 'm', label: 'M' },
  { key: 'l', label: 'L' },
  { key: 'xl', label: 'XL' },
]

const VIEW_SPACING_OPTIONS: Array<{ key: ViewSpacingKey; label: string }> = [
  { key: 'tight', label: 'Tight' },
  { key: 'compact', label: 'Compact' },
  { key: 'cozy', label: 'Cozy' },
  { key: 'wide', label: 'Wide' },
]

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
  viewFontSize: ViewSizeKey
  setViewFontSize: (key: ViewSizeKey) => void
  viewSpacing: ViewSpacingKey
  setViewSpacing: (key: ViewSpacingKey) => void
  editorStyle: EditorStyleKey
  setEditorStyle: (key: EditorStyleKey) => void
  editorFontSize: EditorFontSizeKey
  setEditorFontSize: (key: EditorFontSizeKey) => void
  editorSpacing: EditorSpacingKey
  setEditorSpacing: (key: EditorSpacingKey) => void
  scheduleFocusEditorInEditMode: () => void

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
  renderScrollResponsiveness: number
  setRenderScrollResponsiveness: (value: number) => void
  renderScrollTotalTimeSec: number
  setRenderScrollTotalTimeSec: (value: number) => void
  renderScrollMaxSpeedPxPerSec: number
  setRenderScrollMaxSpeedPxPerSec: (value: number) => void
  renderScrollSkew: number
  setRenderScrollSkew: (value: number) => void

  typingSoundEnabled: boolean
  setTypingSoundEnabled: (value: boolean) => void
  typingSoundSet: 'A' | 'B' | 'C'
  setTypingSoundSet: (value: 'A' | 'B' | 'C') => void
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

  musicAccordionNonce: number
  musicVolume: number
  setMusicVolume: (value: number) => void
  musicReverbAmount: number
  setMusicReverbAmount: (value: number) => void
  musicReverbRoom: number
  setMusicReverbRoom: (value: number) => void

  borderRadiusRegularPx: number
  setBorderRadiusRegularPx: (value: number) => void
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
  editorStyle,
  setEditorStyle,
  editorFontSize,
  setEditorFontSize,
  editorSpacing,
  setEditorSpacing,
  scheduleFocusEditorInEditMode,
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
  renderScrollResponsiveness,
  setRenderScrollResponsiveness,
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
  musicAccordionNonce,
  musicVolume,
  setMusicVolume,
  musicReverbAmount,
  setMusicReverbAmount,
  musicReverbRoom,
  setMusicReverbRoom,
  borderRadiusRegularPx,
  setBorderRadiusRegularPx,
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
          className={`btn-icon options-color-swatch${key === 'textBase' ? ' text-ui-icon' : ''}`}
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
      <div className="typography-section">
        {isPreviewMode ? (
          <div className="typography-grid" role="group" aria-label="Render typography">
            {VIEW_STYLE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`btn-icon typography-font-btn${viewStyle === option.key ? ' active' : ''}`}
                title={option.label}
                aria-label={option.label}
                aria-pressed={viewStyle === option.key}
                onClick={() => setViewStyle(option.key)}
              >
                <span className="typography-font-glyph" style={{ fontFamily: option.family }} aria-hidden="true">Aa</span>
              </button>
            ))}
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="typography-font-size"
                min={0}
                max={VIEW_FONT_SIZE_OPTIONS.length - 1}
                step={1}
                value={VIEW_FONT_SIZE_OPTIONS.findIndex((option) => option.key === viewFontSize)}
                trackLabel="size"
                ariaLabel="Render font size"
                onCommit={(value) => {
                  const index = Math.max(0, Math.min(VIEW_FONT_SIZE_OPTIONS.length - 1, Math.round(value)))
                  setViewFontSize(VIEW_FONT_SIZE_OPTIONS[index]!.key)
                }}
              />
            </div>
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="typography-spacing"
                min={0}
                max={VIEW_SPACING_OPTIONS.length - 1}
                step={1}
                value={VIEW_SPACING_OPTIONS.findIndex((option) => option.key === viewSpacing)}
                trackLabel="spacing"
                ariaLabel="Render spacing"
                onCommit={(value) => {
                  const index = Math.max(0, Math.min(VIEW_SPACING_OPTIONS.length - 1, Math.round(value)))
                  setViewSpacing(VIEW_SPACING_OPTIONS[index]!.key)
                }}
              />
            </div>
          </div>
        ) : (
          <div className="typography-grid" role="group" aria-label="Editor typography">
            {EDITOR_STYLE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`btn-icon typography-font-btn${editorStyle === option.key ? ' active' : ''}`}
                title={option.label}
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
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="typography-font-size"
                min={0}
                max={EDITOR_FONT_SIZE_OPTIONS.length - 1}
                step={1}
                value={EDITOR_FONT_SIZE_OPTIONS.findIndex((option) => option.key === editorFontSize)}
                trackLabel="size"
                ariaLabel="Editor font size"
                onCommit={(value) => {
                  const index = Math.max(0, Math.min(EDITOR_FONT_SIZE_OPTIONS.length - 1, Math.round(value)))
                  setEditorFontSize(EDITOR_FONT_SIZE_OPTIONS[index]!.key)
                  scheduleFocusEditorInEditMode()
                }}
              />
            </div>
            <div className="typography-slider">
              <CompactScrollbarSlider
                id="typography-spacing"
                min={0}
                max={EDITOR_SPACING_OPTIONS.length - 1}
                step={1}
                value={EDITOR_SPACING_OPTIONS.findIndex((option) => option.key === editorSpacing)}
                trackLabel="spacing"
                ariaLabel="Editor spacing"
                onCommit={(value) => {
                  const index = Math.max(0, Math.min(EDITOR_SPACING_OPTIONS.length - 1, Math.round(value)))
                  setEditorSpacing(EDITOR_SPACING_OPTIONS[index]!.key)
                  scheduleFocusEditorInEditMode()
                }}
              />
            </div>
          </div>
        )}
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
              className={`btn-icon options-color-swatch options-loadout-btn${activeEntryForCurrentMode?.id === entry.id ? ' active' : ''}${primedCustomLayoutId === entry.id ? ' primed' : ''}`}
              title={`Custom Layout ${Math.abs(entry.id) - LOADOUT_FACTORY_PRESET_COUNT - 2}\nClick RMB to mark for deletion. \nHold RMB to export.`}
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
              className={`btn-icon options-color-swatch options-hsva-control${hsvaDragState?.control === 'h' ? ' is-dragging' : ''}${primedColorSource.kind === 'hsva' && primedColorSource.key === 'h' ? ' active' : ''}`}
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
              className={`btn-icon options-color-swatch options-hsva-control${hsvaDragState?.control === 's' ? ' is-dragging' : ''}${primedColorSource.kind === 'hsva' && primedColorSource.key === 's' ? ' active' : ''}`}
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
              className={`btn-icon options-color-swatch options-hsva-control${hsvaDragState?.control === 'v' ? ' is-dragging' : ''}${primedColorSource.kind === 'hsva' && primedColorSource.key === 'v' ? ' active' : ''}`}
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
                primedColorSource.kind === 'hsva' && primedColorSource.key === 'a' ? 'active' : '',
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
              className={`btn-icon options-color-swatch options-active-color${primedColorSource.kind === 'active-color' ? ' active' : ''}`}
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
                className={`btn-icon options-color-swatch options-active-color options-texture-preview${primedColorSource.kind === 'texture-preview' ? ' active' : ''}`}
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
            id="audio-key-variance"
            min={0}
            max={0.5}
            step={0.005}
            value={audioKeyVariance}
            trackLabel="variance"
            ariaLabel="Key sound variance"
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
            id="ui-border-radius"
            min={BORDER_RADIUS_REGULAR_MIN_PX}
            max={BORDER_RADIUS_REGULAR_MAX_PX}
            step={1}
            value={borderRadiusRegularPx}
            trackLabel="radius"
            ariaLabel="UI border radius in pixels"
            onCommit={(value) => setBorderRadiusRegularPx(
              clamp(
                Math.round(value),
                BORDER_RADIUS_REGULAR_MIN_PX,
                BORDER_RADIUS_REGULAR_MAX_PX,
              ),
            )}
          />
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
