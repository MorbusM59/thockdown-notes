import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

export interface MouseCursorOverlayProps {
  stageRef: MutableRefObject<HTMLDivElement | null>
  // defaults baked per user's request; later make configurable
  radius?: number
  thickness?: number
  frequencyHz?: number
  fadeMs?: number
  /** Dots are spaced evenly around the orbit (nth complex roots of unity), not independently positioned. */
  dotCount?: number
  trailDegrees?: number
  color?: string
}

/** Resolves any CSS color string to its rgb components via a throwaway probe element, so `color` can be a name/hex/var()/etc, not just a value this file already knows how to parse. */
function resolveColorRgb(color: string, doc: Document): [number, number, number] {
  const probe = doc.createElement('span')
  probe.style.color = color
  probe.style.display = 'none'
  doc.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  doc.body.removeChild(probe)
  const match = computed.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [255, 255, 255]
}

/**
 * Rendered by SectionEditorArea as a plain JSX child of `.editor-stage`
 * (a sibling of the edit/preview panes, painting over both via that
 * element's own `.editor-stage > *` z-index rule) -- not a `document.body`
 * portal. The previous version detached its canvas to `document.body` with
 * manual `position: fixed` + window scroll/resize tracking to fake what
 * `.editor-stage`'s own `position: relative`/`overflow: hidden` already
 * gives it for free, and hid the native cursor by calling
 * `stageEl.classList.add('hide-native-cursor')` directly on a DOM node
 * whose `className` is a React-owned template string in SectionEditorArea
 * -- every re-render of that component (i.e. every keystroke) reset
 * `className` back to its own computed value, silently dropping the class
 * again. The class is now baked into that template string instead (see
 * SectionEditorArea.tsx), so this component never touches another
 * component's DOM node.
 *
 * Visual model: `dotCount` dots orbit the cursor position at `frequencyHz`
 * revolutions/sec, evenly spaced (nth complex roots of unity), each one
 * dragging a fading `trailDegrees`-long arc behind it via a conic gradient
 * (transparent tail -> opaque head) -- one moving dot with a trail, not the
 * previous design's discrete periodic ping arcs. The rAF loop only runs
 * while the pointer is actually over the stage or fading out afterwards
 * (`fadeMs`), not continuously for the component's whole lifetime.
 */
export function MouseCursorOverlay({
  stageRef,
  radius = 10,
  thickness = 2,
  frequencyHz = 0.8,
  fadeMs = 350,
  dotCount = 3,
  trailDegrees = 100,
  color = '#ffffff',
}: MouseCursorOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const posRef = useRef<{ x: number; y: number } | null>(null)
  const stageRectRef = useRef<DOMRect | null>(null)
  const rafRef = useRef<number | null>(null)
  const activeSinceRef = useRef<number | null>(null)
  const leftAtRef = useRef<number | null>(null)

  useEffect(() => {
    const stageEl = stageRef.current
    const canvas = canvasRef.current
    if (!stageEl || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const [r, g, b] = resolveColorRgb(color, stageEl.ownerDocument)
    const trailRad = (trailDegrees * Math.PI) / 180
    const angleStep = (Math.PI * 2) / Math.max(1, dotCount)

    function updateCanvasResolution() {
      const rect = stageEl!.getBoundingClientRect()
      stageRectRef.current = rect
      canvas!.width = Math.max(1, Math.round(rect.width * dpr))
      canvas!.height = Math.max(1, Math.round(rect.height * dpr))
    }

    updateCanvasResolution()

    function ensureLoopRunning() {
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(draw)
      }
    }

    function draw(now: number) {
      const pos = posRef.current
      const activeSince = activeSinceRef.current
      const leftAt = leftAtRef.current

      if (!pos || activeSince === null) {
        ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
        rafRef.current = null
        return
      }

      let alpha = 1
      if (leftAt !== null) {
        alpha = Math.max(0, 1 - (now - leftAt) / fadeMs)
        if (alpha <= 0) {
          ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
          rafRef.current = null
          return
        }
      }

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      const cx = pos.x * dpr
      const cy = pos.y * dpr
      const orbitRadius = radius * dpr
      const revolutions = ((now - activeSince) / 1000) * frequencyHz
      const rotation = (revolutions % 1) * Math.PI * 2

      for (let i = 0; i < dotCount; i += 1) {
        const headAngle = rotation + i * angleStep
        const tailAngle = headAngle - trailRad

        const gradient = ctx!.createConicGradient(tailAngle, cx, cy)
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`)
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${alpha})`)

        ctx!.save()
        ctx!.lineWidth = Math.max(1, thickness * dpr)
        ctx!.lineCap = 'round'
        ctx!.strokeStyle = gradient
        ctx!.beginPath()
        ctx!.arc(cx, cy, orbitRadius, tailAngle, headAngle)
        ctx!.stroke()
        ctx!.restore()

        const headX = cx + Math.cos(headAngle) * orbitRadius
        const headY = cy + Math.sin(headAngle) * orbitRadius
        ctx!.save()
        ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
        ctx!.beginPath()
        ctx!.arc(headX, headY, Math.max(1, thickness * dpr * 0.75), 0, Math.PI * 2)
        ctx!.fill()
        ctx!.restore()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    function handlePointerMove(event: PointerEvent) {
      const rect = stageRectRef.current
      if (!rect) return
      posRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      ensureLoopRunning()
    }

    function handlePointerEnter() {
      activeSinceRef.current = performance.now()
      leftAtRef.current = null
      ensureLoopRunning()
    }

    function handlePointerLeave() {
      leftAtRef.current = performance.now()
      ensureLoopRunning()
    }

    stageEl.addEventListener('pointermove', handlePointerMove, { passive: true })
    stageEl.addEventListener('pointerenter', handlePointerEnter)
    stageEl.addEventListener('pointerleave', handlePointerLeave)

    const resizeObserver = new ResizeObserver(updateCanvasResolution)
    resizeObserver.observe(stageEl)

    return () => {
      stageEl.removeEventListener('pointermove', handlePointerMove)
      stageEl.removeEventListener('pointerenter', handlePointerEnter)
      stageEl.removeEventListener('pointerleave', handlePointerLeave)
      resizeObserver.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      activeSinceRef.current = null
      leftAtRef.current = null
    }
  }, [stageRef, radius, thickness, frequencyHz, fadeMs, dotCount, trailDegrees, color])

  return <canvas ref={canvasRef} className="mouse-cursor-overlay-canvas" aria-hidden="true" />
}

export default MouseCursorOverlay
