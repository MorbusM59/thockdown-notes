/**
 * The Soundstages tab: the desktop's Options > Sound > Soundstages, promoted,
 * the preset grid and the active stage's controls (SoundstageControls, its
 * groups as accordions), over the
 * phone's own soundstage list; the active stage's dock (SoundstagesDock) sits
 * below the page, in the frame's dock. The active stage is what the native
 * music plays (MobileSoundscapeApp sends it on every change).
 */
import type { ReactNode } from 'react'
import { AccordionGroup } from '@thockdown/interaction/AccordionSection'
import { OptionsFixedSection } from '@thockdown/interaction/OptionsFixedSection'
import { PresetDock, PresetGrid, PresetIconPicker } from '@thockdown/interaction/PresetListControls'
import { editActivePreset } from '@thockdown/interaction/presetList'
import {
  activeSoundstage,
  NEUTRAL_SOUNDSTAGE,
  SOUNDSTAGE_KIND,
  withActiveSoundstage,
  type SoundstagePreferences,
} from '@thockdown/visualizer/shared/soundstages'
import { SoundstageControls } from '@thockdown/visualizer/soundstage/SoundstageControls'

export function SoundstagesTab({ preferences, onChange }: { preferences: SoundstagePreferences; onChange: (next: SoundstagePreferences) => void }) {
  const stage = activeSoundstage(preferences).settings
  const changeList = (list: Parameters<typeof withActiveSoundstage>[1]) => onChange(withActiveSoundstage(preferences, list))
  return (
    <>
      <OptionsFixedSection heading="Presets" iconClass="fa-star">
        <PresetGrid kind={SOUNDSTAGE_KIND} list={preferences} onChange={changeList} idPrefix="stage" label="Soundstages" plural="a soundstage" />
        <PresetIconPicker kind={SOUNDSTAGE_KIND} list={preferences} onChange={changeList} pickKind="soundstage" query="" />
      </OptionsFixedSection>
      <AccordionGroup>
      <SoundstageControls
        folds
        stage={stage}
        onEdit={(field, value) => changeList(editActivePreset(SOUNDSTAGE_KIND, preferences, { ...stage, [field]: value }))}
      />
      </AccordionGroup>
    </>
  )
}

/** The active soundstage's dock (icon, name, reset, hold to trash or restore), for the frame's dock slot. */
export function SoundstagesDock({ preferences, onChange, trailing }: { preferences: SoundstagePreferences; onChange: (next: SoundstagePreferences) => void; trailing?: ReactNode }) {
  const changeList = (list: Parameters<typeof withActiveSoundstage>[1]) => onChange(withActiveSoundstage(preferences, list))
  return <PresetDock kind={SOUNDSTAGE_KIND} list={preferences} onChange={changeList} pickKind="soundstage" resetTo={NEUTRAL_SOUNDSTAGE} trailing={trailing} />
}
