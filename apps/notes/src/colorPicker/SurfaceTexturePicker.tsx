/**
 * The surface textures: the four surfaces that carry a texture, and the one
 * editor they share. Two rows of the six-column grid:
 *
 *   grid    | edit   | preview | preview | seed            | seed
 *   sidebar | render | preview | preview | granularity over smoothness
 *
 * The four surfaces are colour targets like every other (ColorTargetButton):
 * a left click links one, which makes it the surface the preview, the seed
 * and the sliders edit, and a right click writes the staged colour into a
 * texture's colour. With nothing linked there is nothing to edit, so the
 * seed and sliders are disabled.
 *
 * A seed or slider change shows in the preview at once and is written to
 * the surface TEXTURE_WRITE_DEBOUNCE_MS after the last change, because a
 * written texture is regenerated on the surface itself; a pending change is
 * written at once when the link moves or the panel closes, so none is lost.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { hsvaToRgba, parseCssColorToRgba, rgbaToCssColor, rgbaToHsva } from '@thockdown/look/colorMath'
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
import { ColorTargetButton } from './ColorTargetButton'
import { useLinkedId } from './colorStaging'

export const TEXTURE_WRITE_DEBOUNCE_MS = 300
const TEXTURE_SEED_MAX = 1000000

const SURFACES: ReadonlyArray<{ surface: TextureSurfaceKey; glyph: string; name: string }> = [
  { surface: 'appGrid', glyph: 'fa-solid fa-table-columns', name: 'Grid' },
  { surface: 'editorEditText', glyph: 'fa-solid fa-pen', name: 'Edit view' },
  { surface: 'sidebarContent', glyph: 'fa-solid fa-list', name: 'Sidebar' },
  { surface: 'editorRenderText', glyph: 'fa-solid fa-book-open', name: 'Render view' },
]

const linkIdOf = (surface: TextureSurfaceKey) => `texture:${surface}`

export function SurfaceTexturePicker({ materials, onWrite }: {
  materials: TextureMaterialsBySurface
  onWrite: (surface: TextureSurfaceKey, material: TextureMaterialSettings) => void
}) {
  const linkedId = useLinkedId()
  const active = SURFACES.find(({ surface }) => linkIdOf(surface) === linkedId)?.surface ?? null
  const [draft, setDraft] = useState<{ surface: TextureSurfaceKey; material: TextureMaterialSettings } | null>(null)
  const [seedEntry, setSeedEntry] = useState<string | null>(null)
  const shown = active === null ? null : draft?.surface === active ? draft.material : materials[active]

  // The pending write, kept in a ref so a flush can run from a press, a
  // timer or an unmount with the same value in hand.
  const pendingRef = useRef<{ surface: TextureSurfaceKey; material: TextureMaterialSettings; timer: number } | null>(null)
  const onWriteRef = useRef(onWrite)
  onWriteRef.current = onWrite
  const materialsRef = useRef(materials)
  materialsRef.current = materials

  const flush = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    window.clearTimeout(pending.timer)
    onWriteRef.current(pending.surface, pending.material)
  }, [])

  useEffect(() => flush, [flush])
  // The link moved: what was pending belongs to the surface it left.
  useEffect(() => {
    flush()
    setDraft(null)
  }, [active, flush])

  /** Changes `surface`'s texture: shown at once, written after the debounce. */
  const edit = (surface: TextureSurfaceKey, update: (current: TextureMaterialSettings) => TextureMaterialSettings) => {
    const pending = pendingRef.current
    const current = pending?.surface === surface ? pending.material : materialsRef.current[surface]
    const next = { ...update(current), enabled: true }
    if (pending) window.clearTimeout(pending.timer)
    if (pending && pending.surface !== surface) onWriteRef.current(pending.surface, pending.material)
    pendingRef.current = { surface, material: next, timer: window.setTimeout(flush, TEXTURE_WRITE_DEBOUNCE_MS) }
    setDraft({ surface, material: next })
  }

  const setColor = (surface: TextureSurfaceKey, css: string) => {
    const rgba = parseCssColorToRgba(css)
    if (rgba) edit(surface, (current) => ({ ...current, color: rgbaToHsva(rgba) }))
  }

  const previewCss = useTextureSurface({
    enabled: shown !== null,
    surface: active ?? 'appGrid',
    material: shown ?? materials.appGrid,
    usePersistentCache: false,
  })

  return (
    <div className="options-surface-textures" role="group" aria-label="Surface textures">
      {SURFACES.map(({ surface, glyph, name }) => (
        <ColorTargetButton
          key={surface}
          linkId={linkIdOf(surface)}
          glyph={glyph}
          tooltip={`${name} texture`}
          color={rgbaToCssColor(hsvaToRgba((draft?.surface === surface ? draft.material : materials[surface]).color))}
          onApply={(css) => setColor(surface, css)}
        />
      ))}
      <div
        className="options-color-swatch options-texture-preview options-surface-texture-preview"
        aria-hidden="true"
        style={shown ? { '--texture-preview-color': rgbaToCssColor(hsvaToRgba(shown.color)), '--texture-preview-mask': previewCss } as CSSProperties : undefined}
      />
      <div className="options-surface-texture-seed">
        <button
          type="button"
          className="options-seed-btn"
          disabled={!shown}
          data-live-tooltip={shown ? `Seed: ${shown.seed}\nClick: random. Right click: type one in` : 'Select a surface'}
          aria-label={shown ? `Texture seed ${shown.seed}` : 'Texture seed'}
          onClick={() => {
            if (active) edit(active, (current) => ({ ...current, seed: Math.floor(Math.random() * (TEXTURE_SEED_MAX + 1)) }))
          }}
          data-secondary-press="action"
          onContextMenu={(event) => {
            event.preventDefault()
            if (shown) setSeedEntry(String(shown.seed))
          }}
        ><span className="fa-solid fa-seedling" aria-hidden="true" /></button>
        {seedEntry !== null && active ? (
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
                if (Number.isFinite(parsed)) edit(active, (current) => ({ ...current, seed: Math.min(TEXTURE_SEED_MAX, Math.max(0, parsed)) }))
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
          value={shown?.granularity ?? TEXTURE_GRANULARITY_MIN}
          trackLabel="granularity"
          ariaLabel="Texture granularity"
          secondaryPress="type"
          disabled={!active}
          onCommit={(value) => {
            if (active) edit(active, (current) => ({ ...current, granularity: value }))
          }}
        />
        <CompactScrollbarSlider
          id="texture-smoothness"
          min={TEXTURE_VSTEPS_MIN}
          max={TEXTURE_VSTEPS_MAX}
          step={1}
          value={shown?.vSteps ?? TEXTURE_VSTEPS_MIN}
          trackLabel="smoothness"
          ariaLabel="Texture smoothness"
          secondaryPress="type"
          disabled={!active}
          onCommit={(value) => {
            if (active) edit(active, (current) => ({ ...current, vSteps: value }))
          }}
        />
      </div>
    </div>
  )
}
