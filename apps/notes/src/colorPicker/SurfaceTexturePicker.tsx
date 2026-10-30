/**
 * The surface textures: the four surfaces that carry a texture, and the one
 * editor they share. Two rows of the six-column grid:
 *
 *   grid    | edit   | preview | preview | seed            | seed
 *   sidebar | render | preview | preview | granularity over smoothness
 *
 * Exactly one surface is ACTIVE. Pressing a surface makes it the active one,
 * and the preview, the seed and the sliders show its texture. A seed or slider
 * change shows in the preview at once and is written to the active surface
 * TEXTURE_WRITE_DEBOUNCE_MS after the last change, because a written texture
 * is regenerated on the surface itself; a pending change is written at once
 * when another surface is chosen or the panel closes, so none is lost. A
 * held right click on another surface copies its whole texture to the active
 * one, and a click on the preview applies the staged colour (through the
 * channel mask, colorStaging.ts) to the active texture's colour.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { hsvaToRgba, rgbaToCssColor } from '@thockdown/look/colorMath'
import {
  TEXTURE_GRANULARITY_MAX,
  TEXTURE_GRANULARITY_MIN,
  TEXTURE_VSTEPS_MAX,
  TEXTURE_VSTEPS_MIN,
  type TextureMaterialSettings,
  type TextureMaterialsBySurface,
  type TextureSurfaceKey,
} from '@thockdown/look/textureTypes'
import { useTextureSurface } from '../textures/useTextureSurface'
import { applyStagedColor, getColorStaging } from './colorStaging'

export const TEXTURE_WRITE_DEBOUNCE_MS = 300
const TEXTURE_SEED_MAX = 1000000

const SURFACES: ReadonlyArray<{ surface: TextureSurfaceKey; glyph: string; name: string }> = [
  { surface: 'appGrid', glyph: 'fa-solid fa-table-columns', name: 'Grid' },
  { surface: 'editorEditText', glyph: 'fa-solid fa-pen', name: 'Edit view' },
  { surface: 'sidebarContent', glyph: 'fa-solid fa-list', name: 'Sidebar' },
  { surface: 'editorRenderText', glyph: 'fa-solid fa-book-open', name: 'Render view' },
]

export function SurfaceTexturePicker({ materials, onWrite }: {
  materials: TextureMaterialsBySurface
  onWrite: (surface: TextureSurfaceKey, material: TextureMaterialSettings) => void
}) {
  const [active, setActive] = useState<TextureSurfaceKey>('appGrid')
  const [draft, setDraft] = useState<TextureMaterialSettings | null>(null)
  const [seedEntry, setSeedEntry] = useState<string | null>(null)
  const shown = draft ?? materials[active]

  // The pending write, kept in a ref so a flush can run from a press, a
  // timer or an unmount with the same value in hand.
  const pendingRef = useRef<{ surface: TextureSurfaceKey; material: TextureMaterialSettings; timer: number } | null>(null)
  const onWriteRef = useRef(onWrite)
  onWriteRef.current = onWrite

  const flush = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    window.clearTimeout(pending.timer)
    onWriteRef.current(pending.surface, pending.material)
  }, [])

  useEffect(() => flush, [flush])

  // A draft is only a draft until it is written: once the surface holds it,
  // the surface is what is shown, so a change from elsewhere (a layout
  // switch) is not hidden behind a stale draft.
  useEffect(() => {
    if (draft && !pendingRef.current) setDraft(null)
  }, [draft, materials])

  const edit = (update: (current: TextureMaterialSettings) => TextureMaterialSettings) => {
    const next = { ...update(shown), enabled: true }
    setDraft(next)
    if (pendingRef.current) window.clearTimeout(pendingRef.current.timer)
    pendingRef.current = {
      surface: active,
      material: next,
      timer: window.setTimeout(flush, TEXTURE_WRITE_DEBOUNCE_MS),
    }
  }

  const writeNow = (material: TextureMaterialSettings) => {
    if (pendingRef.current) window.clearTimeout(pendingRef.current.timer)
    pendingRef.current = null
    setDraft(material)
    onWrite(active, { ...material, enabled: true })
  }

  const choose = (surface: TextureSurfaceKey) => {
    flush()
    setDraft(null)
    setActive(surface)
  }

  const previewCss = useTextureSurface({ enabled: true, surface: active, material: shown, usePersistentCache: false })
  const tint = rgbaToCssColor(hsvaToRgba(shown.color))

  return (
    <div className="options-surface-textures" role="group" aria-label="Surface textures">
      {SURFACES.map(({ surface, glyph, name }) => (
        <SurfaceButton
          key={surface}
          glyph={glyph}
          name={name}
          color={rgbaToCssColor(hsvaToRgba(materials[surface].color))}
          isActive={surface === active}
          onChoose={() => choose(surface)}
          onCopy={() => writeNow({ ...materials[surface] })}
        />
      ))}
      <button
        type="button"
        className="btn-icon options-color-swatch options-texture-preview options-surface-texture-preview"
        data-tooltip="Click to apply the staged colour"
        style={{ '--texture-preview-color': tint, '--texture-preview-mask': previewCss } as CSSProperties}
        onClick={() => {
          const { color, mask } = getColorStaging()
          writeNow({ ...shown, color: applyStagedColor(shown.color, color, mask) })
        }}
      />
      <div className="options-surface-texture-seed">
        <button
          type="button"
          className="options-seed-btn"
          data-live-tooltip={`Seed: ${shown.seed}\nClick: random. Right click: type one in`}
          aria-label={`Texture seed ${shown.seed}`}
          onClick={() => edit((current) => ({ ...current, seed: Math.floor(Math.random() * (TEXTURE_SEED_MAX + 1)) }))}
          data-secondary-press="action"
          onContextMenu={(event) => {
            event.preventDefault()
            setSeedEntry(String(shown.seed))
          }}
        ><span className="fa-solid fa-seedling" aria-hidden="true" /></button>
        {seedEntry !== null ? (
          <input
            className="utility-setting-scrollbar-entry"
            aria-label="Texture seed"
            inputMode="numeric"
            spellCheck={false}
            autoFocus
            value={seedEntry}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setSeedEntry(event.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                event.preventDefault()
                const parsed = Number.parseInt(seedEntry, 10)
                setSeedEntry(null)
                if (Number.isFinite(parsed)) edit((current) => ({ ...current, seed: Math.min(TEXTURE_SEED_MAX, Math.max(0, parsed)) }))
              } else if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault()
                setSeedEntry(null)
              }
            }}
            onBlur={() => setSeedEntry(null)}
          />
        ) : null}
      </div>
      <div className="options-surface-texture-sliders">
        <CompactScrollbarSlider
          id="texture-granularity"
          min={TEXTURE_GRANULARITY_MIN}
          max={TEXTURE_GRANULARITY_MAX}
          step={1}
          value={shown.granularity}
          trackLabel=""
          tooltipLabel="Granularity"
          ariaLabel="Texture granularity"
          secondaryPress="type"
          onCommit={(value) => edit((current) => ({ ...current, granularity: value }))}
        />
        <CompactScrollbarSlider
          id="texture-smoothness"
          min={TEXTURE_VSTEPS_MIN}
          max={TEXTURE_VSTEPS_MAX}
          step={1}
          value={shown.vSteps}
          trackLabel=""
          tooltipLabel="Smoothness"
          ariaLabel="Texture smoothness"
          secondaryPress="type"
          onCommit={(value) => edit((current) => ({ ...current, vSteps: value }))}
        />
      </div>
    </div>
  )
}

/** One surface: a press makes it active, a held right click copies its texture to the active one. */
function SurfaceButton({ glyph, name, color, isActive, onChoose, onCopy }: {
  glyph: string
  name: string
  color: string
  isActive: boolean
  onChoose: () => void
  onCopy: () => void
}) {
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = useCallback(() => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }, [])
  useEffect(() => cancelHold, [cancelHold])

  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-color-target${isActive ? ' is-active' : ''}`}
      style={{ '--options-swatch-color': color } as CSSProperties}
      data-tooltip={isActive ? `${name} texture` : `${name} texture. Hold right click to copy it to the one selected`}
      aria-pressed={isActive}
      onClick={onChoose}
      onPointerDown={(event) => {
        if (event.button !== 2 || isActive) return
        event.stopPropagation()
        cancelHold()
        cancelHoldRef.current = armHold(() => {
          cancelHoldRef.current = null
          onCopy()
        }, HOLD_CONFIRM_MS)
      }}
      onPointerUp={(event) => {
        if (event.button === 2) cancelHold()
      }}
      onMouseLeave={cancelHold}
      data-secondary-press={isActive ? 'none' : 'action'}
      onContextMenu={(event) => {
        event.preventDefault()
        cancelHold()
      }}
    >
      <span className={`options-color-swatch-glyph ${glyph}`} aria-hidden="true" />
    </button>
  )
}
