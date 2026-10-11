/**
 * The layers a theme draws over the app, as computed by
 * shared/loadoutTheme.ts's themeFrame. Shared by the desktop app and the
 * mobile soundscape app, so both stack them the same way.
 */
import { IMAGE_CORRECTION_FILTER_ID } from './imageCorrection'
import type { ThemeFrame, ThemeGlazeImages } from './loadoutTheme'

/**
 * The glaze layers, for inside the filter wrapper. Their images come from
 * CSS variables on the root (themeFrame's rootVariables); this only decides
 * which layers exist. mix-blend-mode makes the browser blend against every
 * repaint underneath (every keystroke's repaint of the editor), so a layer is
 * mounted only when its glaze setting is active.
 */
export function ThemeGlazeLayers({ glaze, radialAboveLinear }: { glaze: ThemeGlazeImages; radialAboveLinear: boolean }) {
  return (
    <div className={`glaze-overlay-stack${radialAboveLinear ? ' radial-above-linear' : ''}`} aria-hidden="true">
      {glaze.linear !== 'none' && <div className="glaze-overlay-layer glaze-overlay-layer-linear" />}
      {glaze.radial !== 'none' && <div className="glaze-overlay-layer glaze-overlay-layer-radial" />}
      {glaze.gloom !== 'none' && <div className="glaze-overlay-layer glaze-overlay-layer-gloom" />}
    </div>
  )
}

/** The invert and colorize overlays, for after everything else inside the filter wrapper. */
export function ThemeBlendOverlays({ theme }: { theme: Pick<ThemeFrame, 'invertViaBlendMode' | 'colorize'> }) {
  return (
    <>
      {theme.invertViaBlendMode && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: '#fff',
            // 'difference' against solid white is an exact per-channel invert
            // (|255 - c| = 255 - c), and a compositor blend rather than a
            // filter that re-rasterizes the subtree on every repaint (see
            // themeFrame).
            mixBlendMode: 'difference',
            pointerEvents: 'none',
            zIndex: 9998,
          }}
          aria-hidden="true"
        />
      )}
      {theme.colorize && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            // 50% saturation gives a GIMP-colorize-like result: strong enough to
            // be visible on neutral text colours, not so strong it oversaturates
            // already-colourful UI elements. Lightness 50% keeps the hue pure.
            background: `hsl(${theme.colorize.hueDeg}deg, 50%, 50%)`,
            opacity: theme.colorize.opacity,
            // 'color' blend mode takes hue and saturation from this overlay and
            // keeps only the backdrop's luminosity; unlike 'hue', it still
            // colorizes near-neutral pixels (e.g. text at #222), since the
            // saturation comes entirely from the overlay.
            mixBlendMode: 'color',
            pointerEvents: 'none',
            zIndex: 9999,
          }}
          aria-hidden="true"
        />
      )}
    </>
  )
}

/**
 * The SVG filter the shell's `--image-correction` variable points at
 * (imageCorrection.ts says what it undoes and why it is a matrix).
 * `color-interpolation-filters="sRGB"` because the CSS shorthands the matrix
 * inverts operate in sRGB; SVG's default is linearRGB, which would invert a
 * different map.
 */
export function ImageCorrectionFilter({ theme }: { theme: Pick<ThemeFrame, 'imageCorrection'> }) {
  if (!theme.imageCorrection) return null
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id={IMAGE_CORRECTION_FILTER_ID} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={theme.imageCorrection} />
      </filter>
    </svg>
  )
}
