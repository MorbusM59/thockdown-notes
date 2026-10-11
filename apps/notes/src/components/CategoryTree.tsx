import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
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
 * The sidebar's three-level category tree (see `shared/tagHierarchy.ts` for
 * the grouping), for any kind of item. It owns the accordion: opening a
 * primary closes every other, and opening a secondary closes its siblings.
 * The collapse state is the caller's, so each tree decides whether it is
 * remembered.
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
        for (const tertiary of secondary.tertiary) {
          if (tertiary.items.some((item) => itemId(item) === activeItemId)) {
            targetPrimaryName = primary.name
            targetSecondaryName = secondary.name
            break
          }
        }

        if (targetPrimaryName) {
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
        const secondaryKey = `${primary.name}:${secondary.name}`
        const keepOpen = primary.name === targetPrimaryName && secondary.name === targetSecondaryName
        if (!keepOpen) {
          nextCollapsedSecondary.add(secondaryKey)
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

  const togglePrimaryCategory = useCallback((categoryName: string) => {
    const allPrimary = groups.map((group) => group.name)
    const selectedPrimary = groups.find((group) => group.name === categoryName)
    const secondaryKeys = (selectedPrimary?.secondary ?? []).map((secondary) => `${categoryName}:${secondary.name}`)
    const generalSecondaryKey = `${categoryName}:${GENERAL_SECONDARY_NAME}`

    const nextCollapsedPrimary = new Set<string>()
    const nextCollapsedSecondary = new Set(collapsedSecondary)

    if (collapsedPrimary.has(categoryName)) {
      allPrimary
        .filter((primaryName) => primaryName !== categoryName)
        .forEach((primaryName) => nextCollapsedPrimary.add(primaryName))

      // Keep the fallback/general bucket visible whenever a primary is expanded.
      nextCollapsedSecondary.delete(generalSecondaryKey)

      secondaryKeys.forEach((secondaryKey) => {
        if (secondaryKey !== generalSecondaryKey) {
          nextCollapsedSecondary.add(secondaryKey)
        }
      })
    } else {
      allPrimary
        .filter((primaryName) => primaryName !== categoryName)
        .forEach((primaryName) => nextCollapsedPrimary.add(primaryName))

      if (secondaryKeys.length > 0) {
        const allExpanded = secondaryKeys.every((secondaryKey) => !collapsedSecondary.has(secondaryKey))
        if (allExpanded) {
          secondaryKeys.forEach((secondaryKey) => nextCollapsedSecondary.add(secondaryKey))
        } else {
          secondaryKeys.forEach((secondaryKey) => nextCollapsedSecondary.delete(secondaryKey))
        }

        nextCollapsedSecondary.delete(generalSecondaryKey)
      }
    }

    const nextCollapsedPrimaryList = [...nextCollapsedPrimary]
    const nextCollapsedSecondaryList = [...nextCollapsedSecondary]
    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return
    }

    onCollapseChange({
      collapsedPrimary: nextCollapsedPrimaryList,
      collapsedSecondary: nextCollapsedSecondaryList,
    })
  }, [collapsedPrimary, collapsedSecondary, groups, onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])

  const toggleSecondaryCategory = useCallback((primaryName: string, secondaryName: string) => {
    const key = `${primaryName}:${secondaryName}`
    const allPrimary = groups.map((group) => group.name)
    const selectedPrimary = groups.find((group) => group.name === primaryName)
    const secondaryKeys = (selectedPrimary?.secondary ?? []).map((secondary) => `${primaryName}:${secondary.name}`)
    const nextCollapsedPrimary = new Set(allPrimary.filter((primary) => primary !== primaryName))
    const nextCollapsedSecondary = new Set(collapsedSecondary)

    if (nextCollapsedSecondary.has(key)) {
      secondaryKeys.forEach((secondaryKey) => {
        if (secondaryKey !== key) {
          nextCollapsedSecondary.add(secondaryKey)
        }
      })
      nextCollapsedSecondary.delete(key)
    } else {
      nextCollapsedSecondary.add(key)
    }

    const nextCollapsedPrimaryList = [...nextCollapsedPrimary]
    const nextCollapsedSecondaryList = [...nextCollapsedSecondary]
    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return
    }

    onCollapseChange({
      collapsedPrimary: nextCollapsedPrimaryList,
      collapsedSecondary: nextCollapsedSecondaryList,
    })
  }, [collapsedSecondary, groups, onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])


  if (groups.length === 0) {
    return <div className="notes-empty-state">{emptyLabel}</div>
  }

  return (
    <div className="category-tree-root" aria-label={ariaLabel}>
      {groups.map((primary) => (
        <details key={primary.name} className="category-primary" open={!collapsedPrimary.has(primary.name)}>
          <summary
            className="category-primary-summary"
            onClick={(event) => {
              event.preventDefault()
              togglePrimaryCategory(primary.name)
            }}
          >
            {primary.name}
          </summary>
          {primary.secondary.map((secondary) => (
            <details
              key={`${primary.name}:${secondary.name}`}
              className="category-secondary"
              open={!collapsedSecondary.has(`${primary.name}:${secondary.name}`)}
            >
              <summary
                className={`category-secondary-summary${secondary.name === GENERAL_SECONDARY_NAME ? ' is-general-secondary' : ''}`}
                aria-label={secondary.name === GENERAL_SECONDARY_NAME ? 'General' : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  toggleSecondaryCategory(primary.name, secondary.name)
                }}
              >
                {secondary.name === GENERAL_SECONDARY_NAME ? <span className="sr-only-mode-label">General</span> : secondary.name}
              </summary>
              {secondary.tertiary.map((tertiary) => (
                <div key={`${primary.name}:${secondary.name}:${tertiary.name}`} className="category-tertiary-block">
                  <div className="category-tertiary-heading">{tertiary.name}</div>
                  {tertiary.items.map(renderItem)}
                </div>
              ))}
            </details>
          ))}
        </details>
      ))}
    </div>
  )
}
