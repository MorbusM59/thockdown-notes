export const HELP_NOTE_CONTENT = `# Welcome to Thockdown Notes

Hey there! This is Thockdown Notes, a **Markdown** editor built to make typing as enjoyable as possible. Absolutely thrilled to have you here! Let's get you up to speed on how to use this app...

To that end, Thockdown Notes has endless customization options, satisfying typing sounds, a high focus low distraction integrated music player that shuffles your song smartly and lots of things you might not even notice, because they simply work as they should (looking at you, Microsoft universe Ctrl+V).

But first...

## What is Markdown?

Markdown is a simple way to format text using plain characters.

Markdown is based on two simple premises:

1. We want to structure and "format" plain text in a way that is easy to read with what's available: The characters on your keyboard.

2. We want to use a uniform standard for this formatting so that the resulting text can be easily and automatically interpreted across plattforms.

This uniform standard makes markdown incredibly versatile and useful. For instance, Markdown is widely used in creating entries for wikis. It also happens to be the ideal way to write structured prompts for AI. It may be simple and ancient technology, but it will continue to be a highly relevant skill that is also extremely easy to pick up.

There is another advantage: Writing in markdown forces you to employ a certain clarity in your typing. It may feel limiting that you can't highlight and underscore your text on top of also putting it in bold and italics, But honestly, your writing benefits from using a unified and limited set of tools to direct the reader's attention.

## So how do you actually apply styling?
Instead of clicking buttons in a rich text editor, you just **type special characters** to format your notes. To make things a bit more convenient. There are also **buttons in the toolbar** to do that job for you. So, in a way, this isn't as different from using a regular text editor, but you ned up with universally compatible output.

*Hint: To see what your formatting might look like when interpreted, hit "Esc" or click the button on the top left of your toolbar. This switches between "Edit Mode" and "Render View".*

Here are the essentials:

### Headings
Use \`#\` to create headings. More \`#\` = smaller heading:

\`\`\`
# Heading 1 (Biggest)
## Heading 2
### Heading 3
\`\`\`

### Text Styling
\`\`\`
**This is bold text**
*This is italic text*
~~This is strikethrough~~
\`\`\`

### Lists
Use \`-\` or \`*\` for bullet points:

\`\`\`
- First item
- Second item
  - Nested item
  - Another nested item
\`\`\`

For numbered lists, just use numbers:

\`\`\`
1. First step
2. Second step
3. Third step
\`\`\`

### Checkboxes (Great for To-Do Lists!)
\`\`\`
- [x] Completed task
- [ ] Incomplete task
\`\`\`

### Links and Code
\`\`\`
[Click here for a link](https://example.com)
\`inline code\`
\`\`\`

## Creating Your First Note

Ready to write? Here's how:

1. Hit **Ctrl+N** or click the **"File Icon" button** in the top menu to create a new note.
2. Start typing your note! Your note **automatically saves** as you write.
3. The **first line** of the note behind the "#" will automatically be recognized as the **note's title** in the menu.
4. Write your thoughts, ideas, tasks, or anything else.

## Using Tags

Tags help you organize and categorize your notes:

1. **Add a tag** by clicking the tag input field in the top right area of the editor.
2. **Type a tag name** (no spaces or special characters — try \`work\`, \`ideas\`, \`personal\`, etc.).
3. **Press Enter** to add it.
4. You can add as many tags as you want.
5. You can find previously used tags listed to the right of the input field.

Tags make it easy to find related notes later. In the left sidebar, you can filter by tags or search by date.

## The Menu Explained

### Sidebar
On the left, you'll see your notes organized:
- **Date view** (default) — see notes grouped by when you created them.
- **Category view** — see notes grouped by the first two tags you assigned.
- **Archive view** — see notes that you archived (right click on a note card in the menu). These notes no longer appear in date or category view.
- **Trash** — you'll find notes that you deleted (hold right click on a note card in the menu). You can hold right click on the trash icon to delete all notes in trash permanently.
- **Search** — find words in a note. Use "abc > xyz" to replace "abc" with "xyz". Left click on a hit to select the found word(s) in the text. Right click on a hit to apply the replacement to that hit.
- **Filter** bar on top — filter words that contain the expression or that have a #tag.
- **Date Filter** at the bottom — filter words by selected months/years or tags.

### Top Bar

#### Left side
- **Toggle View / New Note / Spell Check**
- **Text tools** in Edit Mode
- **Export tools** in Render View

### Right side
- **Font / Size / Spacing**
- **Dark Mode** toggle
- **Options** — a kazillion settings to customize your experience!

### Editor Area
This is where you write. The app automatically saves your changes, so you never have to worry about losing anything.

- **Cage** You can drag top and bottom boundaries in Edit Mode, resulting in a more focused typing experience. You can still see the text above and below, but the boundaries keep your typing focused in the middle section. This also affects pg down and pg up scrolling, which will scroll by exactly one middle section's worth of lines.

## Pro Tips

1. **Right click** on a word (repeatedly) to select the whole word, the whole sentence or the whole paragraph.
2. **Hover over elements** to read what they do. There is a LOT to discover that can facilitate your workflow.
3. **Shortcuts** can make your life easier. For example. use Ctrl+Shift+N to create a new note with the content of your clipboard as a title. This is great way to get started with a note about an existing topic quickly.
4. **Smart pasting** tries to eliminate needless line breaks when copying text from preformatted formats like PDFs. Use Ctrl+Shift+V to paste without sanitation.
5. More tips and a comprehensive list of all features will follow later. For now, have fun exploring and hunting undocumented features.

## Ready to Dive In?

Try editing this note! Replace this text with your own thoughts. Use the markdown syntax above to format it. You'll see it all come together as you type.

Happy note-taking!

---

**Tip:** Delete this note whenever you're ready. Your next note could be your next great idea!`;
