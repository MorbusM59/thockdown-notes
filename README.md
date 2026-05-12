# Measly Notes - Markdown Note-Taking App

A full-featured Markdown-based note-taking application built with Electron, React 19, and TypeScript.

## Features

###  Auto-Save
- Automatic saving with 1-second debounce after typing stops
- Title-aware auto-save that pauses while editing the first line
- No manual Save button needed

###  Markdown Support
- Full Markdown editing with live preview
- Toggle between Edit and Preview modes
- Support for GitHub Flavored Markdown (GFM)
- Syntax highlighting for code blocks
- Tables, lists, blockquotes, and more

###  Tagging System
- Add multiple tags to notes with position-based hierarchy (primary, secondary, tertiary)
- Autocomplete suggestions when typing tags
- Active tags (#tag) - click to remove
- Suggested tags ($tag) - click to add from top 12 most-used tags
- Drag-and-drop to reorder tag positions
- Tags stored in SQLite database with proper relations

###  Smart Sidebar
- **Date Mode**: View notes chronologically with pagination (20 per page)
- **Category Mode**: Hierarchical tree view organized by tag positions
- Collapsible categories for easy navigation
- Note counts for each category

###  Search Functionality
- **Text Search**: Search across note titles and content
- **Tag Search**: Use `#tagname` to search by tags
- Results show ~50 character snippets around matches
- Tag search prioritizes by tag position (primary → secondary → tertiary)

###  Keyboard Shortcuts
- **Ctrl+N**: Create a new note with `# ` pre-filled

## Technical Stack

- **Electron** - Cross-platform desktop application framework
- **React 19** - UI framework
- **TypeScript** - Type-safe development
- **better-sqlite3** - Local SQLite database
- **react-markdown** - Markdown rendering
- **remark-gfm** - GitHub Flavored Markdown support
- **Electron Forge** - Build and packaging
- **Webpack** - Module bundler

## Database Schema

```sql
-- Notes table
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  filePath TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Tags table
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

-- Note-Tag relationships
CREATE TABLE note_tags (
  noteId INTEGER NOT NULL,
  tagId INTEGER NOT NULL,
  position INTEGER NOT NULL,  -- 0 = primary, 1 = secondary, 2 = tertiary
  PRIMARY KEY (noteId, tagId),
  FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tagId) REFERENCES tags(id)
);
```

## File Structure

```
src/
├── components/
│   ├── App.tsx                  # Main application component
│   ├── MarkdownEditor.tsx       # Markdown editor with auto-save
│   ├── TagInput.tsx             # Tag management UI
│   └── Sidebar.tsx              # Navigation sidebar
├── main/
│   ├── database.ts              # SQLite database operations
│   └── fileSystem.ts            # Note file operations (.md files)
├── shared/
│   └── types.ts                 # TypeScript interfaces
├── index.ts                     # Electron main process
├── preload.ts                   # IPC bridge (contextBridge)
└── renderer.ts                  # React renderer entry point
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm start

# Lint code
npm run lint

# Package application
npm run package

# Create distributables
npm run make
```

## How It Works

### Note Creation
1. Press `Ctrl+N` to create a new note
2. Editor opens with `# ` on the first line
3. Type your title after the `#`
4. Press Enter or move to the next line
5. Auto-save activates and creates the note

### Title Extraction
- The first line starting with `# ` becomes the note title
- Title is automatically extracted and saved to the database
- Changing the first line updates the note title

### Auto-Save Behavior
- Saves content 1 second after you stop typing
- Pauses while cursor is on the first line (to avoid saving incomplete titles)
- Resumes immediately when you move off the first line
- Visual indicator shows when auto-save is paused

### Tagging
1. Select a note
2. Type tag name in the tag input field
3. Press Enter to add the tag
4. First tag = primary, second = secondary, third = tertiary, etc.
5. Click a tag to remove it
6. Drag tags to reorder them
7. Click suggested tags ($tag) to quickly add popular tags

### Search
- Type text to search note titles and content
- Type `#tagname` to search by tag
- Results show matching snippets from content
- Click any result to open that note

## Storage

- **Database**: `userData/notes.db` (SQLite)
- **Note Files**: `userData/notes/*.md` (Markdown files)
- Location varies by OS:
  - Linux: `~/.config/measly-notes/`
  - macOS: `~/Library/Application Support/measly-notes/`
  - Windows: `%APPDATA%/measly-notes/`

## Security

-  CodeQL security scan passed with 0 alerts
- Context isolation enabled
- Node integration disabled
- Secure IPC communication via contextBridge

## License

MIT

## Credits

Built with  using Electron and React
