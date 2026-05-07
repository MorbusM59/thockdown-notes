const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

code = code.replace(
  /const handleTextareaKeyDown = \(e: React\.KeyboardEvent<HTMLDivElement>\) => \{\s*if \(showPreview\) return;\s*if \(e\.key === 'Enter'\) \{/,
  \const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showPreview) return;

    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Tab') {
      bundleRecentChars();
    }

    if (e.key === 'Enter') {\
);

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Script completed');
