import { presetMarkOf, type Preset } from './presetList'

/** A preset's mark (`presetMarkOf`): its solid icon, or its name's initials. */
export function PresetMark({ preset, lettersClassName }: { preset: Pick<Preset<unknown>, 'name' | 'icon'>; lettersClassName?: string }) {
  const mark = presetMarkOf(preset)
  return 'iconClass' in mark
    ? <span className={mark.iconClass} aria-hidden="true" />
    : <span className={lettersClassName} aria-hidden="true">{mark.letters}</span>
}
