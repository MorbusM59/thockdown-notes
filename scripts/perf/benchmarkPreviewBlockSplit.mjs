#!/usr/bin/env node
// Isolated benchmark for the preview-block split cache that backs the
// edit->preview toggle warm-start. The full remark parse of a 1.5M-char
// document is the dominant cost of the first toggle; this harness measures
// the cold parse vs the cached reuse that useEditorSectionMount's background
// prewarm now provides.

import { performance } from 'node:perf_hooks'
import {
  splitMarkdownIntoPreviewBlocks,
  splitMarkdownIntoPreviewBlocksIncremental,
} from '../../src/editor/PreviewBlockSplit.ts'
import { generateSyntheticDocument } from './perfHarness.mjs'

const CHARS = Number(process.argv.find((a) => a.startsWith('--chars='))?.split('=')[1]) || 1_500_000
const RUNS = Number(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1]) || 3

const text = generateSyntheticDocument(CHARS)
console.log(`Document size: ${text.length.toLocaleString()} chars / ${text.split('\n').length.toLocaleString()} lines`)

function timeMs(fn) {
  const start = performance.now()
  fn()
  return performance.now() - start
}

// Cold full parse (what the first toggle paid before prewarm).
const coldTimes = []
for (let i = 0; i < RUNS; i += 1) {
  coldTimes.push(timeMs(() => splitMarkdownIntoPreviewBlocksIncremental(text, null)))
}

// Warm incremental reuse (what prewarm enables on first toggle).
const cache = splitMarkdownIntoPreviewBlocksIncremental(text, null)
const warmTimes = []
for (let i = 0; i < RUNS; i += 1) {
  warmTimes.push(timeMs(() => splitMarkdownIntoPreviewBlocksIncremental(text, cache)))
}

function summarize(label, times) {
  times.sort((a, b) => a - b)
  const min = times[0]
  const max = times[times.length - 1]
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  console.log(`${label}: min=${min.toFixed(1)}ms avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms`)
}

summarize('Cold split (no cache)', coldTimes)
summarize('Warm split (cached)', warmTimes)

const speedup = coldTimes.reduce((a, b) => a + b, 0) / warmTimes.reduce((a, b) => a + b, 0)
console.log(`Approximate speedup from cache: ${speedup.toFixed(1)}x`)
