import { useCallback, useMemo, type ReactNode } from 'react'
import { AccordionCount, AccordionDivider, AccordionSection } from '@thockdown/interaction/AccordionSection'
import { areStringArraysEqual } from '../shared/stringArrays'
import { GENERAL_SECONDARY_NAME, type TagPrimaryGroup } from '../shared/tagHierarchy'

/**
 * The folds that differ from the tree's default (`startsFolded`): with the
 * tree folded by default these are the open sections and dividers, with it
 * open by default the folded ones. Stored as the difference so a tag that
 * appears later takes the default rather than whatever the lists happen to
 * say about tags they never saw.
 */
export type CategoryTreeFolds = { primary: string[]; secondary: string[] }

type CategoryTreeProps<T> = {
  groups: TagPrimaryGroup<T>[]
  renderItem: (item: T) => ReactNode
  /** Every section and divider starts folded (true) or open (false). */
  startsFolded: boolean
  folds: CategoryTreeFolds
  onFoldsChange: (next: CategoryTreeFolds) => void
  emptyLabel: string
  ariaLabel: string
}

/**
 * The sidebar's category tree (see `shared/tagHierarchy.ts` for the
 * grouping), for any kind of item, drawn in the options panel's language --
 * the same as the music set list: a primary tag is a SECTION, a secondary tag
 * a folding DIVIDER (the unlabelled general group sits under the section's
 * heading with no divider), and an item an entry row. Both levels fold the
 * way a section does: a left press opens one and closes its siblings, a
 * right press toggles it alone. The fold state is the caller's, so each
 * tree decides whether it is remembered; the folds only ask
 * (AccordionSection's controlled mode). The tree never moves on its own:
 * it does not unfold or scroll to follow the active item.
 */
export function CategoryTree<T>({
  groups,
  renderItem,
  startsFolded,
  folds,
  onFoldsChange,
  emptyLabel,
  ariaLabel,
}: CategoryTreeProps<T>) {
  const flippedPrimary = useMemo(() => new Set(folds.primary), [folds.primary])
  const flippedSecondary = useMemo(() => new Set(folds.secondary), [folds.secondary])
  const commit = useCallback((nextPrimary: Set<string>, nextSecondary: Set<string>) => {
    const primary = [...nextPrimary]
    const secondary = [...nextSecondary]
    if (areStringArraysEqual(primary, folds.primary) && areStringArraysEqual(secondary, folds.secondary)) return
    onFoldsChange({ primary, secondary })
  }, [folds, onFoldsChange])

  const requestPrimary = useCallback((primaryName: string, open: boolean, exclusive: boolean) => {
    const nextPrimary = new Set(flippedPrimary)
    setOpen(nextPrimary, primaryName, open, startsFolded)
    if (open && exclusive) {
      for (const group of groups) if (group.name !== primaryName) setOpen(nextPrimary, group.name, false, startsFolded)
    }
    commit(nextPrimary, flippedSecondary)
  }, [commit, flippedPrimary, flippedSecondary, groups, startsFolded])

  const requestSecondary = useCallback((primaryName: string, secondaryName: string, open: boolean, exclusive: boolean) => {
    const nextSecondary = new Set(flippedSecondary)
    setOpen(nextSecondary, secondaryKey(primaryName, secondaryName), open, startsFolded)
    if (open && exclusive) {
      const siblings = groups.find((group) => group.name === primaryName)?.secondary ?? []
      for (const sibling of siblings) {
        if (sibling.name !== secondaryName && sibling.name !== GENERAL_SECONDARY_NAME) setOpen(nextSecondary, secondaryKey(primaryName, sibling.name), false, startsFolded)
      }
    }
    commit(flippedPrimary, nextSecondary)
  }, [commit, flippedPrimary, flippedSecondary, groups, startsFolded])

  if (groups.length === 0) {
    return <div className="notes-empty-state">{emptyLabel}</div>
  }

  return (
    <div className="category-tree-root" aria-label={ariaLabel}>
      {groups.map((primary) => (
        <AccordionSection
          key={primary.name}
          heading={<span className="options-music-song-heading">{primary.name}</span>}
          ariaLabel={primary.name}
          iconClass="fa-tag"
          open={isOpen(flippedPrimary, primary.name, startsFolded)}
          onRequestOpenChange={(open, exclusive) => requestPrimary(primary.name, open, exclusive)}
        >
          {/* The general group is the section's own contents, so it leads, under the heading. */}
          {generalFirst(primary.secondary).map((secondary) => (
            secondary.name === GENERAL_SECONDARY_NAME ? (
              <div key={secondary.name} className="options-curve-rows category-tree-rows">
                {secondary.items.map(renderItem)}
              </div>
            ) : (
              <AccordionDivider
                key={secondary.name}
                label={secondary.name}
                marker={<AccordionCount count={secondary.items.length} />}
                open={isOpen(flippedSecondary, secondaryKey(primary.name, secondary.name), startsFolded)}
                onRequestOpenChange={(open, exclusive) => requestSecondary(primary.name, secondary.name, open, exclusive)}
              >
                <div className="options-curve-rows category-tree-rows">
                  {secondary.items.map(renderItem)}
                </div>
              </AccordionDivider>
            )
          ))}
        </AccordionSection>
      ))}
    </div>
  )
}

const generalFirst = <T,>(secondary: TagPrimaryGroup<T>['secondary']) => [
  ...secondary.filter((group) => group.name === GENERAL_SECONDARY_NAME),
  ...secondary.filter((group) => group.name !== GENERAL_SECONDARY_NAME),
]

const secondaryKey = (primaryName: string, secondaryName: string) => `${primaryName}:${secondaryName}`

function isOpen(flipped: Set<string>, key: string, startsFolded: boolean): boolean {
  return flipped.has(key) === startsFolded
}

function setOpen(flipped: Set<string>, key: string, open: boolean, startsFolded: boolean): void {
  if (open === startsFolded) flipped.add(key)
  else flipped.delete(key)
}
