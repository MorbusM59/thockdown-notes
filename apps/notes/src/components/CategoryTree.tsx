import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AccordionDivider, AccordionSection } from '@thockdown/interaction/AccordionSection'
import { areStringArraysEqual } from '../shared/stringArrays'
import { GENERAL_SECONDARY_NAME, type TagPrimaryGroup } from '../shared/tagHierarchy'

export type CategoryTreeCollapse = { collapsedPrimary: string[]; collapsedSecondary: string[] }

type CategoryTreeProps<T> = {
  groups: TagPrimaryGroup<T>[]
  itemId: (item: T) => string
  /** The CSS selector of an item's card, used to scroll the active item into view. */
  itemSelector: (id: string) => string
  renderItem: (item: T) => ReactNode
  activeItemId: string | null
  persistedCollapsedPrimary: string[]
  persistedCollapsedSecondary: string[]
  /** Each new value unfolds the active item's path and scrolls it into view; 0 never does. */
  focusRequestKey: number
  onCollapseChange: (next: CategoryTreeCollapse) => void
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
 * right press toggles it alone. The collapse state is the caller's, so each
 * tree decides whether it is remembered; the folds only ask
 * (AccordionSection's controlled mode).
 */
export function CategoryTree<T>({
  groups,
  itemId,
  itemSelector,
  renderItem,
  activeItemId,
  persistedCollapsedPrimary,
  persistedCollapsedSecondary,
  focusRequestKey,
  onCollapseChange,
  emptyLabel,
  ariaLabel,
}: CategoryTreeProps<T>) {
  const collapsedPrimary = useMemo(() => new Set(persistedCollapsedPrimary), [persistedCollapsedPrimary])
  const collapsedSecondary = useMemo(() => new Set(persistedCollapsedSecondary), [persistedCollapsedSecondary])
  const lastHandledFocusRequestKeyRef = useRef(focusRequestKey)

  const unfoldPathForActiveItem = useCallback(() => {
    if (!activeItemId || groups.length === 0) {
      return false
    }

    let targetPrimaryName: string | null = null
    let targetSecondaryName: string | null = null

    for (const primary of groups) {
      for (const secondary of primary.secondary) {
        if (secondary.items.some((item) => itemId(item) === activeItemId)) {
          targetPrimaryName = primary.name
          targetSecondaryName = secondary.name
          break
        }
      }

      if (targetPrimaryName) {
        break
      }
    }

    if (!targetPrimaryName || !targetSecondaryName) {
      return false
    }

    const nextCollapsedPrimary = new Set(
      groups
        .map((primary) => primary.name)
        .filter((primaryName) => primaryName !== targetPrimaryName),
    )

    const nextCollapsedSecondary = new Set<string>()
    for (const primary of groups) {
      for (const secondary of primary.secondary) {
        const keepOpen = primary.name === targetPrimaryName && secondary.name === targetSecondaryName
        if (!keepOpen) {
          nextCollapsedSecondary.add(secondaryKey(primary.name, secondary.name))
        }
      }
    }

    const nextCollapsedPrimaryList = [...nextCollapsedPrimary]
    const nextCollapsedSecondaryList = [...nextCollapsedSecondary]

    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return false
    }

    onCollapseChange({
      collapsedPrimary: nextCollapsedPrimaryList,
      collapsedSecondary: nextCollapsedSecondaryList,
    })
    return true
  }, [activeItemId, groups, itemId, onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])

  const ensureActiveItemVisible = useCallback(() => {
    if (!activeItemId) {
      return
    }

    const activeElement = document.querySelector<HTMLElement>(itemSelector(activeItemId))
    if (!activeElement) {
      return
    }

    const scrollContainer =
      activeElement.closest<HTMLElement>('.notes-list.tree-view')
      ?? activeElement.closest<HTMLElement>('.sidebar-content')

    if (!scrollContainer) {
      return
    }

    const containerRect = scrollContainer.getBoundingClientRect()
    const itemRect = activeElement.getBoundingClientRect()
    const visibilityPaddingPx = 8
    const visibleTop = containerRect.top + visibilityPaddingPx
    const visibleBottom = containerRect.bottom - visibilityPaddingPx

    if (itemRect.top < visibleTop) {
      scrollContainer.scrollTop -= (visibleTop - itemRect.top)
      return
    }

    if (itemRect.bottom > visibleBottom) {
      scrollContainer.scrollTop += (itemRect.bottom - visibleBottom)
    }
  }, [activeItemId, itemSelector])

  useEffect(() => {
    if (focusRequestKey <= 0) {
      return
    }

    if (focusRequestKey === lastHandledFocusRequestKeyRef.current) {
      return
    }

    lastHandledFocusRequestKeyRef.current = focusRequestKey

    unfoldPathForActiveItem()

    let cancelled = false
    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        if (cancelled) {
          return
        }
        ensureActiveItemVisible()
      })

      if (cancelled) {
        cancelAnimationFrame(secondFrame)
      }
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrame)
    }
  }, [ensureActiveItemVisible, focusRequestKey, unfoldPathForActiveItem])

  const commit = useCallback((nextPrimary: Set<string>, nextSecondary: Set<string>) => {
    const nextCollapsedPrimaryList = [...nextPrimary]
    const nextCollapsedSecondaryList = [...nextSecondary]
    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return
    }
    onCollapseChange({ collapsedPrimary: nextCollapsedPrimaryList, collapsedSecondary: nextCollapsedSecondaryList })
  }, [onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])

  const requestPrimary = useCallback((primaryName: string, open: boolean, exclusive: boolean) => {
    const nextPrimary = new Set(collapsedPrimary)
    if (open) {
      nextPrimary.delete(primaryName)
      if (exclusive) {
        for (const group of groups) if (group.name !== primaryName) nextPrimary.add(group.name)
      }
    } else {
      nextPrimary.add(primaryName)
    }
    commit(nextPrimary, collapsedSecondary)
  }, [collapsedPrimary, collapsedSecondary, commit, groups])

  const requestSecondary = useCallback((primaryName: string, secondaryName: string, open: boolean, exclusive: boolean) => {
    const key = secondaryKey(primaryName, secondaryName)
    const nextSecondary = new Set(collapsedSecondary)
    if (open) {
      nextSecondary.delete(key)
      if (exclusive) {
        const siblings = groups.find((group) => group.name === primaryName)?.secondary ?? []
        for (const sibling of siblings) {
          if (sibling.name !== secondaryName && sibling.name !== GENERAL_SECONDARY_NAME) nextSecondary.add(secondaryKey(primaryName, sibling.name))
        }
      }
    } else {
      nextSecondary.add(key)
    }
    commit(collapsedPrimary, nextSecondary)
  }, [collapsedPrimary, collapsedSecondary, commit, groups])

  if (groups.length === 0) {
    return <div className="notes-empty-state">{emptyLabel}</div>
  }

  return (
    <div className="sidebar-options-content category-tree-root" aria-label={ariaLabel}>
      {groups.map((primary) => (
        <AccordionSection
          key={primary.name}
          heading={<span className="options-music-song-heading">{primary.name}</span>}
          ariaLabel={primary.name}
          iconClass="fa-tag"
          open={!collapsedPrimary.has(primary.name)}
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
                open={!collapsedSecondary.has(secondaryKey(primary.name, secondary.name))}
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
