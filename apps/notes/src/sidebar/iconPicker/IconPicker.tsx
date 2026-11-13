import { useEffect, useMemo, useState } from 'react'
import { filterSolidIcons } from './iconPick'

type SolidIconCatalog = ReadonlyArray<readonly [string, string]>
let catalogLoad: Promise<SolidIconCatalog> | null = null
/** The catalog is 180 KB, so it is its own chunk, fetched when a picker first opens. */
function loadSolidIconCatalog(): Promise<SolidIconCatalog> {
  catalogLoad ??= import('./solidIconCatalog.json').then((module) => module.default as unknown as SolidIconCatalog)
  return catalogLoad
}

/**
 * Every solid icon, in one unfolded section in place of a view's list,
 * filtered by the sidebar's filter field (iconPick.ts). `current` is the
 * entry's picked icon (`fa-guitar`) or null; a press hands the pressed one
 * to `onPick`, which closes the picker.
 */
export function IconPicker({ label, current, query, onPick }: { label: string; current: string | null; query: string; onPick: (icon: string) => void }) {
  const [catalog, setCatalog] = useState<SolidIconCatalog | null>(null)
  useEffect(() => {
    let live = true
    void loadSolidIconCatalog().then((loaded) => { if (live) setCatalog(loaded) })
    return () => { live = false }
  }, [])
  const names = useMemo(() => (catalog ? filterSolidIcons(catalog, query) : []), [catalog, query])
  return (
    <div className="options-content sidebar-options-content" aria-label={`Icons for ${label}`}>
      <div className="preset-section">
        <div className="options-loadout-grid icon-picker-grid" role="listbox" aria-label={`Icons for ${label}`}>
          {names.map((name) => {
            const icon = `fa-${name}`
            const words = name.replace(/-/g, ' ')
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={current === icon}
                className={`btn-icon options-color-swatch options-loadout-btn${current === icon ? ' is-active' : ''}`}
                data-tooltip={words}
                aria-label={words}
                onClick={() => onPick(icon)}
              >
                <span className={`fa-solid ${icon}`} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
