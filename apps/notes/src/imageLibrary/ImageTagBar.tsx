import { useEffect, useState, type KeyboardEvent } from 'react'
import { normalizeTagName } from '../shared/tags'
import { renameImage, setImageTags, useLibraryImage } from './imageLibraryStore'

// THE CHAPTER BAR WHILE A SLOT SHOWS AN IMAGE: the image's id, then its own
// tags, in the shape the note tag bar uses (TagBar.tsx) -- type a tag and
// press Enter to add it, click a tag twice to remove it. An image's tags are
// the library's categories; they are not the tags of the notes that use it.

export function ImageTagBar({ imageId }: { imageId: string }) {
  const { image } = useLibraryImage(imageId)
  const [draft, setDraft] = useState('')
  const [primedTag, setPrimedTag] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  const [renameProblem, setRenameProblem] = useState<string | null>(null)
  useEffect(() => { setDraft(''); setPrimedTag(null); setRenameDraft(null); setRenameProblem(null) }, [imageId])

  const commitRename = async (value: string) => {
    setRenameDraft(null)
    const wanted = value.trim()
    if (!wanted || !image) return
    const result = await renameImage(image.id, wanted)
    setRenameProblem(result.ok ? null
      : result.reason === 'taken' ? `${wanted} is another image's name`
      : result.reason === 'invalid' ? `${wanted} cannot be an image name` : null)
  }
  const tags = image?.tags ?? []

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const tag = normalizeTagName(draft)
    if (!tag || !image) return
    setDraft('')
    void setImageTags(image.id, [...tags.filter((each) => each !== tag), tag])
  }

  return (
    <div className="chapter-bar-row">
      {/* Right-click renames, as it does a note's id: every current note
          that uses the image is rewritten, and older text keeps working. */}
      <div className="section-identity-tab-shell">
        {renameDraft !== null ? (
          <input
            className="tag-pill note-identity-input"
            value={renameDraft}
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={() => setRenameDraft(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void commitRename(renameDraft)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setRenameDraft(null)
              }
            }}
            aria-label="Image id"
          />
        ) : (
          <button
            type="button"
            className={`tag-pill note-identity-tab${renameProblem ? ' is-auto-assigned' : ''}`}
            disabled={!image}
            data-secondary-press="action"
            onContextMenu={(event) => {
              event.preventDefault()
              setRenameProblem(null)
              setRenameDraft(imageId)
            }}
            data-tooltip={renameProblem ?? `Image ${imageId}. Right-click to rename it in every note that uses it`}
          >
            <span className="tag-pill-label">{imageId}</span>
          </button>
        )}
      </div>
      <div className="tab-mode-shell" role="group" aria-label="Image tags">
        <div className="tabbar-tag-input">
          <span className={`tabbar-tag-input-icon fa-solid fa-tag${draft ? ' is-hidden' : ''}`} aria-hidden="true" />
          <input
            className="tabbar-tag-input-field"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!image}
            aria-label="Image tag input"
          />
        </div>
        <div className="tabbar-tabs-scroll-shell">
          <div className="tabbar-tags-display" aria-live="polite">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`tag-pill is-active${primedTag === tag ? ' primed' : ''}`}
                data-secondary-press="none"
                data-tooltip={primedTag === tag ? `Click again to remove ${tag}` : `Click twice to remove ${tag}`}
                onMouseLeave={() => { if (primedTag === tag) setPrimedTag(null) }}
                onClick={() => {
                  if (primedTag !== tag) {
                    setPrimedTag(tag)
                    return
                  }
                  setPrimedTag(null)
                  if (image) void setImageTags(image.id, tags.filter((each) => each !== tag))
                }}
              >
                <span className="tag-pill-label">{tag}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
