/**
 * A note that exercises every pacing rule: headings, lists, checkboxes,
 * quotations, emphasis, links, sentence and clause ends, short lines and
 * blank lines, and long paragraphs, in a deterministic mix.
 */
export function syntheticNote(paragraphs: number): string {
  const words = ['the', 'reader', 'follows', 'a', 'line', 'of', 'text', 'across', 'the', 'page', 'and', 'back',
    'considerably', 'interesting', 'notes', 'keep', 'their', 'shape', 'while', 'we', 'read', 'them', 'quickly']
  let seed = 7
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const sentence = () => {
    const n = 3 + Math.floor(rand() * 14)
    const out: string[] = []
    for (let i = 0; i < n; i += 1) {
      let w = words[Math.floor(rand() * words.length)]
      const r = rand()
      if (r < 0.05) w = `**${w}**`
      else if (r < 0.08) w = `[${w}](https://example.com/${w})`
      else if (r < 0.15 && i < n - 1) w = `${w},`
      out.push(w)
    }
    const end = rand() < 0.8 ? '.' : rand() < 0.5 ? '?' : '!'
    const s = out.join(' ') + end
    return rand() < 0.1 ? `“${s}”` : s
  }
  const blocks: string[] = []
  for (let p = 0; p < paragraphs; p += 1) {
    const kind = rand()
    if (kind < 0.1) blocks.push(`## ${sentence().replace(/[.?!”“]/g, '')}`)
    else if (kind < 0.25) blocks.push(Array.from({ length: 3 }, () => `- ${sentence()}`).join('\n'))
    else if (kind < 0.3) blocks.push(`- [ ] ${sentence()}\n- [x] ${sentence()}`)
    else blocks.push(Array.from({ length: 1 + Math.floor(rand() * 6) }, sentence).join(' '))
  }
  return blocks.join('\n\n')
}

