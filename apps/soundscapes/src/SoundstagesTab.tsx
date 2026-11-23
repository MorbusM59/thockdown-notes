/**
 * The Soundstages tab: the desktop's Options > Sound > Soundstages, the
 * preset grid, the active stage's controls (SoundstageControls) and its dock,
 * over the phone's own soundstage list. The active stage is what the native
 * music plays (MobileSoundscapeApp sends it on every change).
 */
import { OptionsSubsectionLabel } from '@thockdown/interaction/OptionsSubsectionLabel'
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
      <div className="utility-setting-slider-stack" aria-label="Soundstages">
        <OptionsSubsectionLabel>Soundstages</OptionsSubsectionLabel>
        <PresetGrid kind={SOUNDSTAGE_KIND} list={preferences} onChange={changeList} idPrefix="stage" label="Soundstages" plural="a soundstage" />
        <PresetIconPicker kind={SOUNDSTAGE_KIND} list={preferences} onChange={changeList} pickKind="soundstage" query="" />
        <PresetDock kind={SOUNDSTAGE_KIND} list={preferences} onChange={changeList} pickKind="soundstage" resetTo={NEUTRAL_SOUNDSTAGE} />
      </div>
      <SoundstageControls
        stage={stage}
        onEdit={(field, value) => changeList(editActivePreset(SOUNDSTAGE_KIND, preferences, { ...stage, [field]: value }))}
      />
    </>
  )
}
