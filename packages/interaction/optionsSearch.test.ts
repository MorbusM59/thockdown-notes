// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { SEARCH_HIDDEN_ATTR, SEARCH_LEAD_ATTR, applyOptionsSelection, indexOptionsSection, selectOptions } from './optionsSearch'

function panel() {
  document.body.innerHTML = `
    <section id="a"><summary>Mouse</summary><div class="body">
      <div id="lead" data-tooltip="Cursor size">size</div>
      <div class="stack">
        <div class="options-subsection-label" id="trail">Trail</div>
        <div id="trail-row"><button data-tooltip="Trail length"></button></div>
        <div class="options-subsection-label" id="click">Click</div>
        <div id="click-row"><button data-tooltip="Click speed"></button></div>
      </div>
    </div></section>
    <section id="b"><summary>Audio</summary><div class="body">
      <div class="options-subsection-label" id="keys">Keys</div>
      <div id="keys-row" data-tooltip="Key volume"></div>
    </div></section>`
  const $ = (id: string) => document.getElementById(id)!
  const index = ['a', 'b'].map((id) => indexOptionsSection($(id), $(id).querySelector('summary')!, $(id).querySelector('.body')!))
  return { $, index }
}

describe('options search', () => {
  it('groups a section by its labels, with a lead group before the first', () => {
    const { index } = panel()
    expect(index[0].groups.map((g) => g.label?.id ?? null)).toEqual([null, 'trail', 'click'])
    expect(index[1].groups.map((g) => g.label?.id ?? null)).toEqual(['keys'])
  })

  it('keeps a whole section on a title hit and only matching groups otherwise, ignoring case', () => {
    const { index } = panel()
    expect(selectOptions(index, 'MOUSE')).toEqual([[0, 1, 2], []])
    expect(selectOptions(index, 'speed')).toEqual([[2], []])
    expect(selectOptions(index, 'volume')).toEqual([[], [0]])
  })

  it('hides what is filtered out, sets the first standing label flush, and restores everything when lifted', () => {
    const { $, index } = panel()
    applyOptionsSelection(index, selectOptions(index, 'click'))
    expect($('b').hasAttribute(SEARCH_HIDDEN_ATTR)).toBe(true)
    expect(['lead', 'trail', 'trail-row'].every((id) => $(id).hasAttribute(SEARCH_HIDDEN_ATTR))).toBe(true)
    expect($('click-row').hasAttribute(SEARCH_HIDDEN_ATTR)).toBe(false)
    expect($('click').hasAttribute(SEARCH_LEAD_ATTR)).toBe(true)
    applyOptionsSelection(index, null)
    expect(document.querySelectorAll(`[${SEARCH_HIDDEN_ATTR}], [${SEARCH_LEAD_ATTR}]`).length).toBe(0)
  })
})
