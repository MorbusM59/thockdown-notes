import { describe, expect, it } from 'vitest'
import { readFullRange } from './musicDecodeStream'

const file = Uint8Array.from({ length: 1000 }, (_, index) => index % 251)

/** A server whose bodies stop after `cut` bytes, optionally breaking off with an error instead of ending. */
function server(cut: number, breakOff: boolean) {
  const asked: number[] = []
  const fetchFrom = async (from: number) => {
    asked.push(from)
    const body = file.subarray(from, Math.min(file.length, from + cut))
    let sent = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent && body.length > 0) {
          sent = true
          controller.enqueue(body.slice())
        } else if (breakOff && from + cut < file.length) controller.error(new TypeError('Failed to fetch'))
        else controller.close()
      },
    })
    return new Response(stream, { status: 206 })
  }
  return { asked, fetchFrom }
}

describe('readFullRange', () => {
  it('continues short bodies until the range is whole', async () => {
    const { asked, fetchFrom } = server(300, false)
    expect(await readFullRange(fetchFrom, 100, 900)).toEqual(file.subarray(100, 900))
    expect(asked).toEqual([100, 400, 700])
  })

  it('keeps what a broken-off body delivered and continues from there', async () => {
    const { fetchFrom } = server(250, true)
    expect(await readFullRange(fetchFrom, 0, 1000)).toEqual(file)
  })

  it('fails on an answer that brings nothing', async () => {
    const { fetchFrom } = server(0, false)
    await expect(readFullRange(fetchFrom, 0, 10)).rejects.toThrow('no bytes')
  })
})
