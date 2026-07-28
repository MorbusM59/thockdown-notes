/**
 * A persistent, incrementally-maintained index from paragraph identity to
 * its canonical-text prefix offset -- the O(log n) replacement for walking
 * every paragraph in the document (see SelectionOffsets.ts's
 * getOffsetWithinRoot and ContractBridgePlugin.tsx's readCanonicalRootText,
 * both currently O(document length) per call). Backed by a positional
 * ("implicit") treap: a randomized balanced binary search tree ordered
 * purely by structural position, not by any comparable key -- paragraphs
 * have no natural sort key other than "where they currently are," which is
 * exactly the quantity this structure exists to answer efficiently.
 *
 * Randomized (treap) balancing, not a strictly-balanced tree (AVL/red-black):
 * expected O(log n) depth, not worst-case guaranteed, but the standard,
 * well-understood tradeoff for a structure this much simpler to implement
 * correctly -- no rotation-balancing casework, only a single well-known
 * split/merge pair. For a document with even 100,000 paragraphs, expected
 * depth is a few dozen; this is not a case where the worst-case gap matters.
 *
 * Every paragraph is modeled as contributing `length + 1` to total document
 * length -- its own canonical text length, plus one trailing LF separator.
 * That's correct for every paragraph *except* the very last one (no trailing
 * separator after the final paragraph) -- prefixOffset() below never needs
 * to special-case this (a paragraph before the last one always has a real
 * separator after it), and totalLength() is the one place that subtracts
 * the phantom trailing separator.
 */

interface TreapNode {
  key: string
  length: number
  priority: number
  left: TreapNode | null
  right: TreapNode | null
  parent: TreapNode | null
  subtreeCount: number
  subtreeWeight: number
}

function createNode(key: string, length: number): TreapNode {
  return {
    key,
    length,
    priority: Math.random(),
    left: null,
    right: null,
    parent: null,
    subtreeCount: 1,
    subtreeWeight: length + 1,
  }
}

function pull(node: TreapNode): void {
  const leftCount = node.left?.subtreeCount ?? 0
  const rightCount = node.right?.subtreeCount ?? 0
  const leftWeight = node.left?.subtreeWeight ?? 0
  const rightWeight = node.right?.subtreeWeight ?? 0
  node.subtreeCount = 1 + leftCount + rightCount
  node.subtreeWeight = (node.length + 1) + leftWeight + rightWeight
}

function setLeft(node: TreapNode, child: TreapNode | null): void {
  node.left = child
  if (child) child.parent = node
}

function setRight(node: TreapNode, child: TreapNode | null): void {
  node.right = child
  if (child) child.parent = node
}

/** Max-heap on priority. Neither input's `.parent` is trusted or fixed up except at the very top (the caller's job). */
function merge(left: TreapNode | null, right: TreapNode | null): TreapNode | null {
  if (left === null) return right
  if (right === null) return left
  if (left.priority >= right.priority) {
    setRight(left, merge(left.right, right))
    pull(left)
    return left
  }
  setLeft(right, merge(left, right.left))
  pull(right)
  return right
}

/** Splits into (first `count` nodes in-order, the rest). Requires 0 <= count <= (node?.subtreeCount ?? 0). */
function splitByCount(node: TreapNode | null, count: number): [TreapNode | null, TreapNode | null] {
  if (node === null) return [null, null]
  const leftCount = node.left?.subtreeCount ?? 0
  if (leftCount < count) {
    const [rightLeft, rightRight] = splitByCount(node.right, count - leftCount - 1)
    setRight(node, rightLeft)
    pull(node)
    return [node, rightRight]
  }
  const [leftLeft, leftRight] = splitByCount(node.left, count)
  setLeft(node, leftRight)
  pull(node)
  return [leftLeft, node]
}

/** 0-based position of `node` in the overall in-order sequence, via parent-pointer walk. O(log n) expected. */
function rankOf(node: TreapNode): number {
  let rank = node.left?.subtreeCount ?? 0
  let current = node
  while (current.parent !== null) {
    const parent = current.parent
    if (parent.right === current) {
      rank += (parent.left?.subtreeCount ?? 0) + 1
    }
    current = parent
  }
  return rank
}

/** Sum of (length + 1) for every node strictly before `node` in-order. O(log n) expected. */
function prefixWeightOf(node: TreapNode): number {
  let weight = node.left?.subtreeWeight ?? 0
  let current = node
  while (current.parent !== null) {
    const parent = current.parent
    if (parent.right === current) {
      weight += (parent.left?.subtreeWeight ?? 0) + (parent.length + 1)
    }
    current = parent
  }
  return weight
}

export class ParagraphOffsetIndex {
  private root: TreapNode | null = null
  private readonly nodesByKey = new Map<string, TreapNode>()

  size(): number {
    return this.root?.subtreeCount ?? 0
  }

  has(key: string): boolean {
    return this.nodesByKey.has(key)
  }

  clear(): void {
    this.root = null
    this.nodesByKey.clear()
  }

  /** Total canonical text length across every indexed paragraph, LF separators included. */
  totalLength(): number {
    const weight = this.root?.subtreeWeight ?? 0
    return weight > 0 ? weight - 1 : 0
  }

  /** Insert a new paragraph immediately after `afterKey` (or at the very start if `afterKey` is null). */
  insertAfter(afterKey: string | null, newKey: string, length: number): void {
    if (this.nodesByKey.has(newKey)) {
      throw new Error(`ParagraphOffsetIndex: key "${newKey}" is already indexed`)
    }
    const newNode = createNode(newKey, length)
    if (afterKey === null) {
      this.root = merge(newNode, this.root)
    } else {
      const afterNode = this.nodesByKey.get(afterKey)
      if (!afterNode) throw new Error(`ParagraphOffsetIndex: insertAfter reference key "${afterKey}" not found`)
      const rank = rankOf(afterNode)
      const [left, right] = splitByCount(this.root, rank + 1)
      this.root = merge(merge(left, newNode), right)
    }
    if (this.root) this.root.parent = null
    this.nodesByKey.set(newKey, newNode)
  }

  /** Insert a new paragraph immediately before `beforeKey` (or at the very end if `beforeKey` is null). */
  insertBefore(beforeKey: string | null, newKey: string, length: number): void {
    if (this.nodesByKey.has(newKey)) {
      throw new Error(`ParagraphOffsetIndex: key "${newKey}" is already indexed`)
    }
    const newNode = createNode(newKey, length)
    if (beforeKey === null) {
      this.root = merge(this.root, newNode)
    } else {
      const beforeNode = this.nodesByKey.get(beforeKey)
      if (!beforeNode) throw new Error(`ParagraphOffsetIndex: insertBefore reference key "${beforeKey}" not found`)
      const rank = rankOf(beforeNode)
      const [left, right] = splitByCount(this.root, rank)
      this.root = merge(merge(left, newNode), right)
    }
    if (this.root) this.root.parent = null
    this.nodesByKey.set(newKey, newNode)
  }

  remove(key: string): void {
    const node = this.nodesByKey.get(key)
    if (!node) throw new Error(`ParagraphOffsetIndex: remove key "${key}" not found`)
    const rank = rankOf(node)
    const [left, mid] = splitByCount(this.root, rank)
    const [, right] = splitByCount(mid, 1)
    this.root = merge(left, right)
    if (this.root) this.root.parent = null
    this.nodesByKey.delete(key)
    node.left = null
    node.right = null
    node.parent = null
  }

  /** This paragraph's own canonical text length (not including its separator). O(1). */
  lengthOf(key: string): number {
    const node = this.nodesByKey.get(key)
    if (!node) throw new Error(`ParagraphOffsetIndex: lengthOf key "${key}" not found`)
    return node.length
  }

  updateLength(key: string, newLength: number): void {
    const node = this.nodesByKey.get(key)
    if (!node) throw new Error(`ParagraphOffsetIndex: updateLength key "${key}" not found`)
    node.length = newLength
    let current: TreapNode | null = node
    while (current) {
      pull(current)
      current = current.parent
    }
  }

  /** Canonical offset of the start of this paragraph -- sum of every prior paragraph's length plus its separator. */
  prefixOffset(key: string): number {
    const node = this.nodesByKey.get(key)
    if (!node) throw new Error(`ParagraphOffsetIndex: prefixOffset key "${key}" not found`)
    return prefixWeightOf(node)
  }

  /** In-order paragraph keys. O(n) -- for tests/debugging only, never called on a hot path. */
  toOrderedKeys(): string[] {
    const out: string[] = []
    const visit = (node: TreapNode | null): void => {
      if (!node) return
      visit(node.left)
      out.push(node.key)
      visit(node.right)
    }
    visit(this.root)
    return out
  }

  /**
   * Structural self-check: heap property, subtree aggregates, parent
   * pointers, and key-map consistency all hold. O(n) -- test-only, never
   * called from product code. Throws with a specific message on the first
   * violation found, rather than returning a boolean, so a failing fuzz
   * test immediately says *what* broke.
   */
  debugValidateInvariants(): void {
    const seen = new Set<string>()

    const visit = (node: TreapNode | null, parent: TreapNode | null): { count: number; weight: number } => {
      if (node === null) return { count: 0, weight: 0 }
      if (node.parent !== parent) {
        throw new Error(`ParagraphOffsetIndex invariant violation: node "${node.key}" has wrong parent pointer`)
      }
      if (node.left && node.left.priority > node.priority) {
        throw new Error(`ParagraphOffsetIndex invariant violation: heap property broken at "${node.key}" (left child "${node.left.key}")`)
      }
      if (node.right && node.right.priority > node.priority) {
        throw new Error(`ParagraphOffsetIndex invariant violation: heap property broken at "${node.key}" (right child "${node.right.key}")`)
      }
      if (seen.has(node.key)) {
        throw new Error(`ParagraphOffsetIndex invariant violation: key "${node.key}" appears more than once in the tree`)
      }
      seen.add(node.key)

      const left = visit(node.left, node)
      const right = visit(node.right, node)
      const expectedCount = 1 + left.count + right.count
      const expectedWeight = (node.length + 1) + left.weight + right.weight
      if (node.subtreeCount !== expectedCount) {
        throw new Error(`ParagraphOffsetIndex invariant violation: subtreeCount mismatch at "${node.key}" (got ${node.subtreeCount}, expected ${expectedCount})`)
      }
      if (node.subtreeWeight !== expectedWeight) {
        throw new Error(`ParagraphOffsetIndex invariant violation: subtreeWeight mismatch at "${node.key}" (got ${node.subtreeWeight}, expected ${expectedWeight})`)
      }
      return { count: expectedCount, weight: expectedWeight }
    }

    if (this.root && this.root.parent !== null) {
      throw new Error('ParagraphOffsetIndex invariant violation: root has a non-null parent')
    }
    visit(this.root, null)

    if (seen.size !== this.nodesByKey.size) {
      throw new Error(`ParagraphOffsetIndex invariant violation: tree has ${seen.size} nodes but nodesByKey has ${this.nodesByKey.size}`)
    }
    for (const key of this.nodesByKey.keys()) {
      if (!seen.has(key)) {
        throw new Error(`ParagraphOffsetIndex invariant violation: key "${key}" is in nodesByKey but not reachable from root`)
      }
    }
  }
}
