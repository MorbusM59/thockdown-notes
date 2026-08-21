/* eslint-disable react-refresh/only-export-components -- this module exports
   pure preview-markdown primitives (rehype plugins, link parsing, the
   ReactMarkdown component-renderer factory) shared with the PDF/MD export
   path; none of the top-level exports is itself a component, so there's
   nothing here for Fast Refresh to preserve state across. */
import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Root } from 'hast'
import { visit } from 'unist-util-visit'
import remarkGfm from 'remark-gfm'
import { parseInternalNoteLink, type ParsedInternalNoteLink } from '../shared/internalNoteLinks'
import { GROUP_MARKER_PREFIX, GROUP_MARKER_SUFFIX } from '../shared/openItemsText'

// The rehype plugins below walk/splice hast trees generically across
// root/element/text nodes without narrowing to hast's discriminated union,
// so they share this loose structural shape instead of `any`.
interface RehypeAstNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: RehypeAstNode[]
  position?: { start?: { line?: number }; end?: { line?: number } }
}

function isSafePreviewHref(href: string | undefined): boolean {
  if (!href) return false
  try {
    const parsed = new URL(href)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' || parsed.protocol === 'tel:'
  } catch {
    return false
  }
}

function isSafePreviewImageSrc(src: string | undefined): boolean {
  if (!src) return false
  if (src.startsWith('data:')) return true
  if (src.startsWith('file:')) return true
  try {
    const parsed = new URL(src)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// ── Internal note/anchor links ────────────────────────────────────────────
//
// Link destinations of the form `#anchor-id`, `$#anchor-id`, `$NOTE-ID`, or
// `$NOTE-ID#anchor-id` are handled entirely in-app instead of being treated
// as external URLs. A bare `#anchor-id` (no leading `$`) is never a link —
// it's how `[Anchor Text](#anchor-id)` DEFINES an anchor at that spot,
// rendered inert. Every destination that actually navigates starts with
// `$`: `$` alone selects "this note" (an empty note-id slot can never
// collide with a real one, since assigned IDs are never empty — see
// setNoteAssignedId), or `$NOTE-ID` selects another note by its
// user-assignable internal ID. An optional `§CHAPTER-ID` segment right
// after the note id (or right after the bare `$` for a chapter of "this
// note") drills into one of that note's chapters by its own user-assignable
// id (same normalization/dedup rules as a note id, scoped per parent -- see
// setChapterId). An optional trailing `#anchor-id` on any of these jumps to
// the matching `[Anchor Text](#anchor-id)` definition once the target note
// (or chapter) is open. Because every form here is an ordinary Markdown
// link — not a separate text-scanning syntax — an example shown inside a
// code span is never mistaken for a live one.

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Mirrors the desktop's note-ID normalization so `$meeting-2` in a link matches a stored `MEETING-2` ID regardless of case. */
export function normalizeInternalIdForLookup(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '-')
}

/** A `[Anchor Text](#anchor-id)` definition — rendered inert, never clickable. */
export interface ParsedAnchorDefinition {
  kind: 'anchor-definition'
  anchorId: string
}

/**
 * A `$` / `$#anchor-id` / `$NOTE-ID` / `$NOTE-ID#anchor-id` /
 * `$NOTE-ID§CHAPTER-ID` / `$NOTE-ID§CHAPTER-ID#anchor-id` navigable link
 * (and the `$§CHAPTER-ID...` variants, a chapter of "this note").
 * `noteIdRaw === null` means "this note"; `chapterIdRaw === null` means no
 * (non-empty) chapter segment was present.
 */
export interface ParsedInternalPreviewLink {
  kind: 'internal-link'
  noteIdRaw: string | null
  chapterIdRaw: string | null
  anchorId: string | null
}

export type ParsedPreviewHref = ParsedAnchorDefinition | ParsedInternalPreviewLink

/** Parses a preview link href into an anchor definition or a navigable internal link, or null if it isn't one of ours. */
export function parseInternalPreviewHref(rawHref: string): ParsedPreviewHref | null {
  // mdast-util-to-hast's CommonMark-spec-mandated destination percent-encoding
  // (https://spec.commonmark.org/0.31.2/#example-599) leaves ASCII `$`/`#`
  // alone but always percent-encodes non-ASCII characters -- so a `§`
  // chapter-segment separator survives markdown parsing as `%C2%A7`, not the
  // literal character, by the time it reaches this function as `href`.
  // Decoding first (falling back to the raw string on a malformed sequence)
  // makes every downstream check below operate on what the user actually
  // typed, regardless of that encoding step.
  let href = rawHref
  try {
    href = decodeURIComponent(rawHref)
  } catch {
    // Malformed percent-encoding -- fall back to the raw string rather than throwing.
  }

  const definitionMatch = /^#([^#]+)$/.exec(href)
  if (definitionMatch) {
    return { kind: 'anchor-definition', anchorId: definitionMatch[1] }
  }

  const linkMatch = /^\$([^#§]*)(?:§([^#]*))?(?:#([^#]+))?$/.exec(href)
  if (linkMatch) {
    const noteIdRaw = linkMatch[1].length > 0 ? linkMatch[1] : null
    const chapterIdRaw = linkMatch[2] != null && linkMatch[2].length > 0 ? linkMatch[2] : null
    const anchorId = linkMatch[3] ?? null
    if (noteIdRaw === null && chapterIdRaw === null && anchorId === null) return null
    return { kind: 'internal-link', noteIdRaw, chapterIdRaw, anchorId }
  }

  return null
}

/** Exact match only — a link to `#anchor-id` resolves only a `](#anchor-id)` definition with that exact id. */
export function noteContainsAnchorDefinition(contentText: string, anchorId: string): boolean {
  const pattern = new RegExp(`\\]\\(#${escapeRegExpLiteral(anchorId)}\\)`)
  return pattern.test(contentText)
}

/**
 * 0-indexed source line of a `](#anchor-id)` definition, or null if absent --
 * same exact-match rule as noteContainsAnchorDefinition, and the same
 * 0-indexed-line convention PreviewBlockSplit.ts uses for `startLine`. Lets
 * preview-link navigation resolve a target block index before the anchor's
 * own element is necessarily mounted (see scrollToAnchorInPreview).
 */
export function findAnchorDefinitionLine(contentText: string, anchorId: string): number | null {
  const pattern = new RegExp(`\\]\\(#${escapeRegExpLiteral(anchorId)}\\)`)
  const match = pattern.exec(contentText)
  if (!match) return null
  let line = 0
  for (let index = 0; index < match.index; index += 1) {
    if (contentText.charCodeAt(index) === 10 /* \n */) {
      line += 1
    }
  }
  return line
}

// Stable references for ReactMarkdown so per-frame App re-renders (e.g. from
// scroll-driven thumb state updates) don't force a full markdown reconciliation.
export const PREVIEW_MARKDOWN_REMARK_PLUGINS = [remarkGfm]

// The PDF-export render path (renderToStaticMarkup) never dispatches click
// events, so it gets a no-op navigator instead of threading live app state
// into a static export.
export const PREVIEW_MARKDOWN_NOOP_NAVIGATE = (): void => {}

/** Flattens a react-markdown children tree down to its plain text -- used only to recognize the Open Items marker line below, which is always a lone text node. */
function extractPlainText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractPlainText).join('')
  return ''
}

// The Open Items chapter (openItemsText.ts's assembleOpenItemsText) writes a
// `[open-items-group:noteId]` marker line ahead of each note's own group, so
// parseOpenItemsGroups can patch/reorder one note's group without
// re-deriving every other note's. It has to be real document text (not an
// HTML comment) to survive textSanitization.ts's sanitizeDocumentText -- see
// openItemsText.ts's own comment on GROUP_MARKER_PREFIX for why -- but it's
// never meant for a reader to see, so it's rendered as nothing here rather
// than as a stray "[open-items-group:...]" line under every heading.
function isOpenItemsGroupMarkerText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith(GROUP_MARKER_PREFIX) && trimmed.endsWith(GROUP_MARKER_SUFFIX)
}

/** Only ever passed while the note being rendered is the auto-Open-Items chapter -- see OpenItemCheckbox's own doc comment for what clicking one does. */
export interface OpenItemsToggleHandlers {
  /** Whether `sourceLine`'s own checkbox has been toggled this viewing session -- state the CALLER owns (usePreviewMarkdownRendering.tsx's OpenItemsToggleStore), not this component: react-virtual unmounts/remounts blocks that scroll out of and back into view, so any state kept here in a per-checkbox useState would silently reset on scroll even though the real source-note edit had already gone through. */
  isChecked: (sourceLine: number) => boolean
  /** Subscribes to just `sourceLine`'s own checked-state changes, useSyncExternalStore-style -- lets one checkbox re-render on its own toggle without the caller's own memo (shared by every rendered block) needing to change identity for it. */
  subscribe: (sourceLine: number, listener: () => void) => () => void
  onToggle: (sourceLine: number) => void
}

// The checkbox glyph for one checklist item, interactive while either
// `toggle` (the auto-Open-Items chapter's own overlay-store mechanism) or
// `onToggleAtLine` (the direct, regular-preview mechanism -- see
// usePreviewMarkdownRendering.tsx's handleToggleChecklistAtLine) is
// provided; the two are mutually exclusive at the call site
// (createPreviewMarkdownComponents below only ever wires one or the other
// for a given note).
//
// Open Items' own generated markdown only ever contains UNCHECKED items to
// begin with (collectUncheckedItemsByHeading drops checked ones entirely),
// so the parsed-markdown `checked` prop is always false there --
// toggle.isChecked(sourceLine) is the only thing that can ever make the
// glyph look checked, and it's deliberately never synced back into the Open
// Items chapter's own text: the actual toggle write (toggle.onToggle) goes
// straight to the real source note with skipAutoChapterHooks, so the Open
// Items chapter stays exactly as it was while this view is open, letting
// the click be undone by clicking again. Only a real refresh (the
// manual-save button's regenerateAllOpenItems) drops a checked-off item
// from the list for real.
//
// A regular note's own preview has no such indirection: `onToggleAtLine`
// writes straight to this same note's live text (via
// applyProgrammaticEditorText), so the parsed-markdown `checked` prop is
// already correct and stays the single source of truth -- no overlay store
// needed, the glyph just re-parses along with the rest of the block the
// instant the underlying text changes, identically in edit mode too.
//
// Resolves its own `sourceLine` from the DOM (the nearest ancestor `<li
// data-source-line="N">`, tagged by createPreviewSourceAnchorRehypePlugin)
// rather than taking it as a prop computed from the checkbox's own hast
// node: remark-gfm's task-list checkbox `<input>` is *synthesized* during
// the mdast-to-hast conversion from the enclosing list item's own `checked`
// property, not parsed as its own node with source position -- so it never
// carries a `position`, and any attempt to tag it directly (as this once
// did) silently never fires. The parent `<li>` is a real parsed node and
// reliably has one.
function OpenItemCheckbox({
  checked,
  className,
  toggle,
  onToggleAtLine,
}: {
  checked?: boolean
  className?: string
  toggle?: OpenItemsToggleHandlers
  onToggleAtLine?: (sourceLine: number) => void
}) {
  const [sourceLine, setSourceLine] = useState<number | null>(null)

  // A callback ref (not useLayoutEffect) so this re-resolves every time the
  // span itself (re)mounts -- including after react-virtual remounts a
  // scrolled-back-into-view block -- always finding the same line, since
  // Open Items' own text never changes while this view stays open.
  const resolveSourceLineRef = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return
    const li = node.closest('li[data-source-line]')
    const raw = li?.getAttribute('data-source-line')
    const parsed = raw !== null && raw !== undefined ? Number(raw) : NaN
    setSourceLine(Number.isNaN(parsed) ? null : parsed)
  }, [])

  // Whether this checkbox is toggleable AT ALL -- independent of sourceLine,
  // which only resolves via the ref attached in the interactive branch
  // below. Branching on sourceLine here instead (as `canToggle` briefly did)
  // is a deadlock: the non-interactive branch never attaches that ref, so
  // sourceLine would never resolve, so it could never become toggleable --
  // confirmed live. `toggle`/`onToggleAtLine` presence, decided by the
  // caller up front, is what has to gate the branch; sourceLine only gates
  // whether a click actually does anything yet.
  const hasToggleCapability = toggle !== undefined || onToggleAtLine !== undefined
  const canToggleViaStore = toggle !== undefined && sourceLine !== null

  // Subscribed rather than read directly: toggle.isChecked(sourceLine)'s own
  // underlying store never triggers a React re-render on its own (see
  // usePreviewMarkdownRendering.tsx's OpenItemsToggleStore) -- this is what
  // makes THIS ONE checkbox re-render on its own toggle without forcing
  // every other mounted block to. Always called (never behind
  // `canToggleViaStore`, which depends on state resolved after mount) to
  // keep this component's hook order unconditional; subscribe/getSnapshot
  // are no-ops until sourceLine resolves or when toggling directly instead.
  const storeChecked = useSyncExternalStore(
    useCallback((listener) => (
      canToggleViaStore ? toggle.subscribe(sourceLine, listener) : () => {}
    ), [canToggleViaStore, toggle, sourceLine]),
    useCallback(() => (
      canToggleViaStore ? toggle.isChecked(sourceLine) : false
    ), [canToggleViaStore, toggle, sourceLine]),
  )

  // Direct mode has no overlay to consult -- `checked` is already the real,
  // current state, parsed straight from this note's own text.
  const isChecked = canToggleViaStore ? storeChecked : Boolean(checked)

  const mergedClassName = [
    className,
    'markdown-task-checkbox-icon',
    isChecked ? 'markdown-task-checkbox-checked' : 'markdown-task-checkbox-unchecked',
    hasToggleCapability ? 'markdown-task-checkbox-interactive' : '',
  ]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' ')

  if (!hasToggleCapability) {
    return (
      <span className={mergedClassName} aria-hidden="true">
        {isChecked ? '☑' : '☐'}
      </span>
    )
  }

  const activate = () => {
    if (sourceLine === null) return
    if (toggle) {
      toggle.onToggle(sourceLine)
    } else {
      onToggleAtLine?.(sourceLine)
    }
  }

  return (
    <span
      ref={resolveSourceLineRef}
      className={mergedClassName}
      role="checkbox"
      aria-checked={isChecked}
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        activate()
      }}
    >
      {isChecked ? '☑' : '☐'}
    </span>
  )
}

export function createPreviewMarkdownComponents(
  navigateToInternalLink: (target: ParsedInternalPreviewLink) => void,
  navigateToInternalNoteLink: (target: ParsedInternalNoteLink) => void,
  /** Only ever passed while the note being rendered is the auto-Open-Items chapter -- see OpenItemCheckbox's own doc comment for what clicking one does. */
  openItemsToggle?: OpenItemsToggleHandlers,
  /** The regular-preview checkbox-click mechanism -- writes straight to the note currently on screen (usePreviewMarkdownRendering.tsx's handleToggleChecklistAtLine), never passed alongside `openItemsToggle` for the same note. Undefined while the active note isn't directly editable (a Time Machine snapshot preview, the timeless/auto-TOC/auto-Open-Items cases, a debug-tagged note), same as the real editor being read-only there. */
  onToggleChecklistAtLine?: (sourceLine: number) => void,
) {
  return {
    p: ({ children }: { children?: ReactNode }) => {
      if (isOpenItemsGroupMarkerText(extractPlainText(children))) {
        return null
      }
      return <p>{children}</p>
    },
    a: ({ children, href }: { children?: ReactNode; href?: string }) => {
      const normalizedHref = typeof href === 'string' ? href : undefined

      // `@noteId[#fragment]` -- the internal-only auto-TOC/Open-Items
      // addressing scheme (internalNoteLinks.ts), entirely separate from
      // the `$NOTE-ID§CHAPTER-ID` scheme below: never user-typed, never
      // gated on an assigned id. Checked first since its `@` sigil can
      // never collide with either of the user-facing forms.
      const internalNoteTarget = normalizedHref ? parseInternalNoteLink(normalizedHref) : null
      if (internalNoteTarget) {
        const handleInternalNoteLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault()
          navigateToInternalNoteLink(internalNoteTarget)
        }
        return (
          <a href={normalizedHref} rel="noopener noreferrer" onClick={handleInternalNoteLinkClick}>
            {children}
          </a>
        )
      }

      const parsedHref = normalizedHref ? parseInternalPreviewHref(normalizedHref) : null

      // `[Anchor Text](#anchor-id)` — a definition, never clickable. Rendered
      // as a plain span carrying the id as a data attribute, the same shape
      // scrollToAnchorInPreview looks for.
      if (parsedHref?.kind === 'anchor-definition') {
        return (
          <span className="note-anchor-marker" data-anchor-id={parsedHref.anchorId}>
            {children}
          </span>
        )
      }

      const isLiteralHrefChild =
        normalizedHref !== undefined &&
        typeof children === 'string' &&
        children.trim() === normalizedHref.trim()

      const internalTarget = parsedHref?.kind === 'internal-link' ? parsedHref : null

      const handleExternalLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        if (!normalizedHref) return
        if (window.ipcRenderer && typeof window.ipcRenderer.invoke === 'function') {
          void window.ipcRenderer.invoke('open-external-url', normalizedHref)
        } else {
          window.open(normalizedHref, '_blank', 'noopener,noreferrer')
        }
      }

      const handleInternalLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        if (internalTarget) navigateToInternalLink(internalTarget)
      }

      if (isLiteralHrefChild) {
        return <span>{children}</span>
      }

      if (internalTarget) {
        return (
          <a href={normalizedHref} rel="noopener noreferrer" onClick={handleInternalLinkClick}>
            {children}
          </a>
        )
      }

      if (isSafePreviewHref(normalizedHref)) {
        return (
          <a href={normalizedHref} rel="noopener noreferrer" onClick={handleExternalLinkClick}>
            {children}
          </a>
        )
      }

      return <span>{children}</span>
    },
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      const normalizedSrc = typeof src === 'string' ? src : undefined
      if (isSafePreviewImageSrc(normalizedSrc)) {
        return <img src={normalizedSrc} alt={alt ?? ''} />
      }
      return <span>{alt ?? 'Image'}</span>
    },
    input: ({ checked, type, className }: { checked?: boolean; type?: string; className?: string }) => {
      if (type !== 'checkbox') {
        return null
      }

      return (
        <OpenItemCheckbox
          checked={checked}
          className={className}
          toggle={openItemsToggle}
          onToggleAtLine={openItemsToggle ? undefined : onToggleChecklistAtLine}
        />
      )
    },
  } as const
}

export function createPreviewSearchHighlightRehypePlugin(needle: string, isCaseSensitive: boolean) {
  const normalizedNeedle = isCaseSensitive ? needle : needle.toLocaleLowerCase()
  if (!normalizedNeedle) {
    return () => () => {}
  }

  return () => {
    return (tree: RehypeAstNode) => {
      const transformNode = (node: RehypeAstNode, parent: RehypeAstNode | null, index: number | null) => {
        if (!node || typeof node !== 'object') return

        if (node.type === 'element') {
          const className = node.properties?.className
          const hasSearchHitClass = Array.isArray(className)
            ? className.includes('search-hit')
            : className === 'search-hit'
          if (hasSearchHitClass) return
        }

        if (node.type === 'text' && typeof node.value === 'string') {
          const textValue = node.value
          const haystack = isCaseSensitive ? textValue : textValue.toLocaleLowerCase()
          const needleLength = normalizedNeedle.length

          let cursor = 0
          const replacements: RehypeAstNode[] = []
          let matchIndex = haystack.indexOf(normalizedNeedle, cursor)
          while (matchIndex >= 0) {
            if (matchIndex > cursor) {
              replacements.push({ type: 'text', value: textValue.slice(cursor, matchIndex) })
            }
            replacements.push({
              type: 'element',
              tagName: 'span',
              properties: { className: ['search-hit'] },
              children: [{ type: 'text', value: textValue.slice(matchIndex, matchIndex + needleLength) }],
            })
            cursor = matchIndex + needleLength
            matchIndex = haystack.indexOf(normalizedNeedle, cursor)
          }

          if (replacements.length > 0) {
            if (cursor < textValue.length) {
              replacements.push({ type: 'text', value: textValue.slice(cursor) })
            }
            if (parent && Array.isArray(parent.children) && typeof index === 'number') {
              parent.children.splice(index, 1, ...replacements)
            }
            return
          }
        }

        if (Array.isArray(node.children)) {
          for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
            transformNode(node.children[childIndex], node, childIndex)
          }
        }
      }

      transformNode(tree, null, null)
    }
  }
}

/**
 * `lineOffset` shifts every reported line by a fixed amount -- used when
 * this runs over a single block sliced out of a larger document (see
 * PreviewBlockSplit.ts), where remark's own line numbers are relative to
 * that slice, not the full document. Defaults to 0 for a whole-document
 * parse.
 */
export function createPreviewSourceAnchorRehypePlugin(lineOffset: number = 0) {
  return () => {
    return (tree: Root) => {
      const sourceAnchorTags = new Set([
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'blockquote', 'pre', 'table', 'hr', 'li',
      ])

      visit(tree, 'element', (node) => {
        if (typeof node.tagName !== 'string') return
        if (!sourceAnchorTags.has(node.tagName)) return
        const startLine = node.position?.start?.line
        const endLine = node.position?.end?.line
        if (typeof startLine !== 'number' || Number.isNaN(startLine)) return

        const normalizedStartLine = Math.max(0, Math.round(startLine - 1) + lineOffset)
        const normalizedEndLine = typeof endLine === 'number' && !Number.isNaN(endLine)
          ? Math.max(normalizedStartLine, Math.round(endLine - 1) + lineOffset)
          : normalizedStartLine

        node.properties = node.properties ?? {}
        if (node.properties['data-source-line'] === undefined) {
          node.properties['data-source-line'] = String(normalizedStartLine)
        }
        if (node.properties['data-source-line-start'] === undefined) {
          node.properties['data-source-line-start'] = String(normalizedStartLine)
        }
        if (node.properties['data-source-line-end'] === undefined) {
          node.properties['data-source-line-end'] = String(normalizedEndLine)
        }
      })
    }
  }
}
