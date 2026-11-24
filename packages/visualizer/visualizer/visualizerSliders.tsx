/**
 * The slider groups the visualizer's settings are made of, shared by the
 * desktop's Options (Grid Beat, Visualizer) and the phone's Visualizer tab:
 * a block's FALL (shape and length), an element's MIX of the three trackers,
 * and a coloured block's whole set (mix, effect, fall, and an edge's
 * geometry). Each returns elements for OptionsSliderRows, which counts its
 * children, so the groups are arrays rather than fragments.
 */
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import { OptionsSubsection } from '@thockdown/interaction/OptionsSubsection'
import {
  EDGE_BLUR_MAX_PX,
  EDGE_SPREAD_MAX_PX,
  FALL_MAX_SEC,
  FALL_MIN_SEC,
  type VisualizerChannel,
  type VisualizerEdgeChannel,
  type VisualizerMix,
} from '@thockdown/look/visualizer'

type Fall = Pick<VisualizerChannel, 'shape' | 'fallSec'>

    // Every block's fall: its shape (visualizer.ts, `pulseCurve`) and its
    // length, the length on a log track so each step of it feels the same.
    // An array, not a fragment: OptionsSliderRows counts its children.
export function fallSliders(id: string, ariaPrefix: string, fall: Fall, defaults: Fall, what: string, onCommit: (patch: Partial<Fall>) => void) {
  return [
      <CompactScrollbarSlider
        key="shape"
        id={`${id}-shape`}
        min={-1}
        max={1}
        step={0.01}
        value={fall.shape}
        trackLabel="shape"
        tooltipLabel={`The shape of ${what}'s fall. Right of center a sharp point that drops at once into a long, low tail, like a ride cymbal; left of center it holds its full weight and then lets go, like a heavy thump`}
        ariaLabel={`${ariaPrefix}: fall shape`}
        defaultValue={defaults.shape}
        formatValue={(value) => value.toFixed(2)}
        onCommit={(value) => onCommit({ shape: value })}
      />,
      <CompactScrollbarSlider
        key="fall"
        id={`${id}-fall`}
        min={Math.log(FALL_MIN_SEC)}
        max={Math.log(FALL_MAX_SEC)}
        // A step that puts the default length exactly on the grid counted from the minimum, so a reset lands on it.
        step={Math.log(defaults.fallSec / FALL_MIN_SEC) / 90}
        value={Math.log(fall.fallSec)}
        trackLabel="fall"
        tooltipLabel={`Fall time of ${what} (ms)`}
        ariaLabel={`${ariaPrefix}: fall in milliseconds`}
        defaultValue={Math.log(defaults.fallSec)}
        formatValue={(value) => Math.round(Math.exp(value) * 1000).toString()}
        onCommit={(value) => onCommit({ fallSec: Math.exp(value) })}
      />,
    ]
}

    // An element's MIX of the three trackers (visualizer.ts, `mixResponse`):
    // one contribution per tracker side by side, added and capped at a full
    // response. Arrays, not fragments: OptionsSliderRows counts its children.
const MIX_TRACKERS = [
      { field: 'thump', what: 'the thump (the low end jumping: a kick, a bass stab)' },
      { field: 'pierce', what: 'the pierce (a sharp sound cutting through: a snare, a clap)' },
      { field: 'tick', what: 'the tick (the busy top: hats, shakers)' },
    ] as const
export function mixSliders(id: string, label: string, mix: VisualizerMix, defaults: VisualizerMix, onCommit: (mix: VisualizerMix) => void) {
      const percent = (value: number) => Math.round(value * 100).toString()
      return MIX_TRACKERS.map(({ field, what }) => (
        <CompactScrollbarSlider
          key={field}
          id={`${id}-mix-${field}`}
          min={0}
          max={1}
          step={0.01}
          value={mix[field]}
          trackLabel={field}
          tooltipLabel={`Share of ${what}`}
          ariaLabel={`${label}: contribution of ${field}, 0 to 100`}
          defaultValue={defaults[field]}
          formatValue={percent}
          onCommit={(value) => onCommit({ ...mix, [field]: value })}
        />
      ))
    }

    // The three trackers (visualizer.ts, `VisualizerTrackers`): what is
    // detected in the music, once, for every element below.
    // One coloured block: its mix, its effect and fall, plus the edge's spread and blur.
    // One block (an edge or a pane) of the grid beat or of the visualizer
    // mode: its mix, effect and fall, and for an edge its geometry. `id`
    // keeps every slider's id unique, the two sets being separate settings.
    // `group` is how the block is named (OptionsSubsection): a divider unless
    // the host promoted its groups to accordions.
export function beatChannelControls<C extends VisualizerChannel>(
      id: string,
      label: string,
      effect: string,
      channel: C,
      defaults: C,
      set: (patch: Partial<C>) => void,
      group: { iconClass: string, folds: boolean } = { iconClass: 'fa-sliders', folds: false },
    ) {
      const edge = 'spreadPx' in channel ? (channel as unknown as VisualizerEdgeChannel) : null
      const edgeDefaults = defaults as unknown as VisualizerEdgeChannel
      const setEdge = set as unknown as (patch: Partial<VisualizerEdgeChannel>) => void
      return (
        <OptionsSubsection label={label} iconClass={group.iconClass} folds={group.folds}>
          <div className="utility-setting-slider-stack" aria-label={`${label} settings`}>
            <OptionsSliderRows rows={edge ? [3, 3, 2] : [3, 3]}>
              {mixSliders(id, label, channel.mix, defaults.mix, (mix) => set({ mix } as Partial<C>))}
              <CompactScrollbarSlider
                id={`${id}-effect`}
                min={-1}
                max={1}
                step={0.01}
                value={channel.effect}
                trackLabel="effect"
                tooltipLabel={`How far ${effect} at a full response. Right of center a hit adds it; left of center it is inverted, resting at that much while music plays and a hit takes it away; the center turns it off`}
                ariaLabel={`${label}: effect, negative inverts`}
                defaultValue={defaults.effect}
                onCommit={(value) => set({ effect: value } as Partial<C>)}
              />
              {fallSliders(id, label, channel, defaults, 'each hit', (patch) => set(patch as Partial<C>))}
              {/* An array, not a fragment: OptionsSliderRows counts its children, and a fragment is one. */}
              {edge && [
                  <CompactScrollbarSlider
                    key="spread"
                    id={`${id}-spread`}
                    min={0}
                    max={EDGE_SPREAD_MAX_PX}
                    step={1}
                    value={edge.spreadPx}
                    trackLabel="spread"
                    tooltipLabel="Edge reach (px)"
                    ariaLabel={`${label}: spread in pixels`}
                    defaultValue={edgeDefaults.spreadPx}
                    onCommit={(value) => setEdge({ spreadPx: Math.round(value) })}
                  />,
                  <CompactScrollbarSlider
                    key="blur"
                    id={`${id}-blur`}
                    min={0}
                    max={EDGE_BLUR_MAX_PX}
                    step={1}
                    value={edge.blurPx}
                    trackLabel="blur"
                    tooltipLabel="Edge softness (px)"
                    ariaLabel={`${label}: blur in pixels`}
                    defaultValue={edgeDefaults.blurPx}
                    onCommit={(value) => setEdge({ blurPx: Math.round(value) })}
                  />,
              ]}
            </OptionsSliderRows>
          </div>
        </OptionsSubsection>
      )
    }
