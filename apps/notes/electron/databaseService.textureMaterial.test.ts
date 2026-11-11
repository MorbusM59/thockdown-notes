import { describe, expect, it } from 'vitest'
import { LIGHT_FACTORY_PRESETS } from '@thockdown/look/presets'
import { normalizeUiLayoutLoadout } from './databaseService'

describe('UI loadout texture settings', () => {
  it('migrates a disabled texture to zero strength', () => {
    const base = LIGHT_FACTORY_PRESETS[0]
    const loadout = normalizeUiLayoutLoadout({
      ...base,
      textureMaterials: {
        ...base.textureMaterials,
        sidebarContent: { ...base.textureMaterials.sidebarContent, enabled: false },
      },
    })

    expect(loadout?.textureMaterials.sidebarContent.textureStrength).toBe(0)
    expect(loadout?.textureMaterials.sidebarContent).not.toHaveProperty('enabled')
  })
})
