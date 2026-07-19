import type { ReactNode } from 'react'
import { visit } from 'unist-util-visit'
import remarkGfm from 'remark-gfm'

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
// Link destinations of the form `$NOTE-ID`, `~anchorname`, `~anchorname#uid`,
// or `$NOTE-ID~anchorname[#uid]` are handled entirely in-app instead of being
// treated as external URLs. `$` selects another note by its user-assignable
// internal ID (see setNoteAssignedId); `~` jumps to an anchor marked with
// `[~anchorname]` (or `[~anchorname#uid]` to disambiguate repeated names)
// somewhere in the document, current or target.

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Mirrors the desktop's note-ID normalization so `$meeting-2` in a link matches a stored `MEETING-2` ID regardless of case. */
export function normalizeInternalIdForLookup(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '-')
}

/** Matches every `[~name]` / `[~name#uid]` anchor marker in a block of text. Free-text name/uid, only `]` and `#` are excluded so the grammar stays unambiguous. */
const NOTE_ANCHOR_DEFINITION_PATTERN = /\[~([^\]#]+)(?:#([^\]]+))?\]/g

export interface ParsedInternalPreviewLink {
  noteIdRaw: string | null
  anchorName: string | null
  anchorUid: string | null
}

/** Parses a preview link href into its `$id` / `~anchor[#uid]` parts, or null if it isn't one of ours. */
export function parseInternalPreviewHref(href: string): ParsedInternalPreviewLink | null {
  const match = /^(?:\$([^~]+))?(?:~(.+))?$/.exec(href)
  if (!match) return null

  const noteIdRaw = match[1] ?? null
  const anchorRaw = match[2] ?? null
  if (noteIdRaw === null && anchorRaw === null) return null

  if (anchorRaw === null) {
    return { noteIdRaw, anchorName: null, anchorUid: null }
  }

  const hashIndex = anchorRaw.indexOf('#')
  const anchorName = hashIndex === -1 ? anchorRaw : anchorRaw.slice(0, hashIndex)
  const anchorUid = hashIndex === -1 ? null : anchorRaw.slice(hashIndex + 1)
  if (!anchorName) return null

  return { noteIdRaw, anchorName, anchorUid }
}

/** Exact match only — a bare `~name` link resolves only a bare `[~name]` marker; disambiguated markers need the matching `#uid`. */
export function noteContainsAnchorDefinition(contentText: string, name: string, uid: string | null): boolean {
  const namePattern = escapeRegExpLiteral(name)
  const pattern = uid !== null
    ? new RegExp(`\\[~${namePattern}#${escapeRegExpLiteral(uid)}\\]`)
    : new RegExp(`\\[~${namePattern}\\]`)
  return pattern.test(contentText)
}

// Replaces `[~name]` / `[~name#uid]` occurrences in rendered text with a
// plain span carrying the anchor as data attributes — same manual
// text-node-splice technique as createPreviewSearchHighlightRehypePlugin,
// run first so search highlighting operates on the already-cleaned text.
export function createPreviewNoteAnchorMarkerRehypePlugin() {
  return () => {
    return (tree: any) => {
      const transformNode = (node: any, parent: any, index: number | null) => {
        if (!node || typeof node !== 'object') return

        if (node.type === 'text' && typeof node.value === 'string' && node.value.includes('[~')) {
          const textValue = node.value
          const replacements: any[] = []
          let cursor = 0
          NOTE_ANCHOR_DEFINITION_PATTERN.lastIndex = 0
          let match = NOTE_ANCHOR_DEFINITION_PATTERN.exec(textValue)
          while (match) {
            const [fullMatch, name, uid] = match
            if (match.index > cursor) {
              replacements.push({ type: 'text', value: textValue.slice(cursor, match.index) })
            }
            replacements.push({
              type: 'element',
              tagName: 'span',
              properties: {
                className: ['note-anchor-marker'],
                'data-note-anchor-name': name,
                'data-note-anchor-uid': uid ?? '',
              },
              children: [{ type: 'text', value: name }],
            })
            cursor = match.index + fullMatch.length
            match = NOTE_ANCHOR_DEFINITION_PATTERN.exec(textValue)
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

// Stable references for ReactMarkdown so per-frame App re-renders (e.g. from
// scroll-driven thumb state updates) don't force a full markdown reconciliation.
export const PREVIEW_MARKDOWN_REMARK_PLUGINS = [remarkGfm]

// The PDF-export render path (renderToStaticMarkup) never dispatches click
// events, so it gets a no-op navigator instead of threading live app state
// into a static export.
export const PREVIEW_MARKDOWN_NOOP_NAVIGATE = (): void => {}
export function createPreviewMarkdownComponents(navigateToInternalLink: (target: ParsedInternalPreviewLink) => void) {
  return {
    a: ({ children, href }: { children?: ReactNode; href?: string }) => {
      const normalizedHref = typeof href === 'string' ? href : undefined
      const isLiteralHrefChild =
        normalizedHref !== undefined &&
        typeof children === 'string' &&
        children.trim() === normalizedHref.trim()

      const internalTarget = normalizedHref ? parseInternalPreviewHref(normalizedHref) : null

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

      const mergedClassName = [
        className,
        'markdown-task-checkbox-icon',
        checked ? 'markdown-task-checkbox-checked' : 'markdown-task-checkbox-unchecked',
      ]
        .filter((value) => typeof value === 'string' && value.length > 0)
        .join(' ')

      return (
        <span className={mergedClassName} aria-hidden="true">
          {checked ? '☑' : '☐'}
        </span>
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
    return (tree: any) => {
      const transformNode = (node: any, parent: any, index: number | null) => {
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
          const replacements: any[] = []
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

export function createPreviewSourceAnchorRehypePlugin() {
  return () => {
    return (tree: any) => {
      const sourceAnchorTags = new Set([
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'blockquote', 'pre', 'table', 'hr', 'li',
      ])

      visit(tree, 'element', (node: any) => {
        if (typeof node.tagName !== 'string') return
        if (!sourceAnchorTags.has(node.tagName)) return
        const startLine = node.position?.start?.line
        const endLine = node.position?.end?.line
        if (typeof startLine !== 'number' || Number.isNaN(startLine)) return

        const normalizedStartLine = Math.max(0, Math.round(startLine - 1))
        const normalizedEndLine = typeof endLine === 'number' && !Number.isNaN(endLine)
          ? Math.max(normalizedStartLine, Math.round(endLine - 1))
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
