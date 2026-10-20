// OPTIONS SEARCH -- which sections and sub-sections of an accordion group a
// search term leaves standing.
//
// A section's sub-sections are not wrapped in elements of their own: an
// `OptionsSubsectionLabel` names the group of siblings that FOLLOWS it, up to
// the next label (see that component), and wrapping them would break the
// container rules the sections lay their controls out with. So the grouping is
// read off the rendered DOM, in document order: walking a section's body, a
// label opens a new group, an element holding no label belongs whole to the
// group currently open, and an element that holds labels is walked into. What
// precedes a section's first label is its LEAD group, which has no name.
//
// The index is built once per search (and again only when the panel's DOM
// gains or loses nodes), so a keystroke costs a substring test per group and
// an attribute write per element whose visibility actually changed.

const LABEL_SELECTOR = '.options-subsection-label'

/** The attribute that hides an element while a search is in force (interaction.css). */
export const SEARCH_HIDDEN_ATTR = 'data-options-search-hidden'
/** Marks the first label left standing in a section whose lead group is hidden, so it sits flush like a section's first label does. */
export const SEARCH_LEAD_ATTR = 'data-options-search-lead'

export interface OptionsSearchGroup {
  /** The group's label element; null for a section's lead group. */
  label: Element | null
  /** The elements to hide when the group is filtered out, label included. */
  units: Element[]
  /** Lower-cased searchable text: the label, every visible text and every tooltip. */
  text: string
}

export interface OptionsSearchSection {
  section: Element
  /** Lower-cased heading text. */
  title: string
  groups: OptionsSearchGroup[]
}

/** What the reader can read on or about an element: its text and its tooltips. */
function searchableTextOf(element: Element): string {
  let text = element.textContent ?? ''
  const tooltip = element.getAttribute('data-tooltip')
  if (tooltip) text += `\n${tooltip}`
  element.querySelectorAll('[data-tooltip]').forEach((node) => {
    text += `\n${node.getAttribute('data-tooltip')}`
  })
  return text.toLowerCase()
}

export function indexOptionsSection(section: Element, heading: Element, body: Element): OptionsSearchSection {
  const lead: OptionsSearchGroup = { label: null, units: [], text: '' }
  const groups: OptionsSearchGroup[] = [lead]
  let current = lead
  const walk = (container: Element) => {
    for (const child of Array.from(container.children)) {
      if (child.matches(LABEL_SELECTOR)) {
        current = { label: child, units: [child], text: searchableTextOf(child) }
        groups.push(current)
      } else if (child.querySelector(LABEL_SELECTOR)) {
        walk(child)
      } else {
        current.units.push(child)
        current.text += `\n${searchableTextOf(child)}`
      }
    }
  }
  walk(body)
  return {
    section,
    title: (heading.textContent ?? '').toLowerCase(),
    groups: lead.units.length > 0 ? groups : groups.slice(1),
  }
}

/** Per section, the indices of the groups left standing; empty when the section is filtered out. */
export type OptionsSearchSelection = number[][]

/**
 * A plain, case-insensitive substring match. A hit in a section's title keeps
 * the whole section; otherwise only the groups the term appears in.
 */
export function selectOptions(index: readonly OptionsSearchSection[], term: string): OptionsSearchSelection {
  const needle = term.trim().toLowerCase()
  return index.map(({ title, groups }) => {
    if (title.includes(needle)) return groups.map((_, i) => i)
    const kept: number[] = []
    groups.forEach((group, i) => { if (group.text.includes(needle)) kept.push(i) })
    return kept
  })
}

/** Writes a selection onto the DOM, touching only elements whose state changes. Pass null to lift the search. */
export function applyOptionsSelection(index: readonly OptionsSearchSection[], selection: OptionsSearchSelection | null) {
  const set = (element: Element, attr: string, on: boolean) => {
    if (element.hasAttribute(attr) !== on) {
      if (on) element.setAttribute(attr, '')
      else element.removeAttribute(attr)
    }
  }
  index.forEach(({ section, groups }, s) => {
    const kept = selection?.[s]
    set(section, SEARCH_HIDDEN_ATTR, kept !== undefined && kept.length === 0)
    let firstShown = true
    groups.forEach((group, g) => {
      const shown = kept === undefined || kept.includes(g)
      for (const unit of group.units) set(unit, SEARCH_HIDDEN_ATTR, !shown)
      if (group.label) set(group.label, SEARCH_LEAD_ATTR, shown && firstShown && kept !== undefined)
      if (shown) firstShown = false
    })
  })
}
